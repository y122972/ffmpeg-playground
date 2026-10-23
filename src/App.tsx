import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RuleItem, RunPhase, RunResult } from './types';
import {
  argsOf,
  hasFlag,
  insertBeforeToken,
  insertFilterIntoChain,
  outputNameOf,
  outputTokenIndex,
  parseCommandText,
  replaceFlagValue,
  replaceOutputExt,
} from './lib/command';
import { computeRules } from './lib/rules';
import { applyRecipe, recipeArgs, RECIPES, type Recipe } from './lib/recipes';
import { DEF_MAP } from './lib/params';
import { defaultOutputName, formatBytes, inputNameFor, mimeOf } from './lib/format';
import { engine, type CoreLoadState } from './lib/ffmpegEngine';
import { FileRow } from './components/FileRow';
import { CommandBox } from './components/CommandBox';
import { ParamPanel } from './components/ParamPanel';
import { RecipeModal } from './components/RecipeModal';
import { ResultPanel } from './components/ResultPanel';
import { Info, Play, Plus, Stop, Warn } from './components/icons';

const MAX_INPUT_BYTES = 2 * 1024 * 1024 * 1024;
const BIG_INPUT_BYTES = 400 * 1024 * 1024;
const MAX_LOGS = 400;

interface LogLine {
  text: string;
  type: string;
}

/** 库定义 → 命令片段（滤镜不带 -vf，由插入时决定并进哪条链） */
function snippetOfDef(defId: string, value: string): string {
  const d = DEF_MAP[defId];
  if (!d) return '';
  if (d.group === 'vfilter' || d.group === 'afilter') return value ? `${d.flag}=${value}` : d.flag;
  return value ? `${d.flag} ${value}` : d.flag;
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  /** 命令就是唯一输入框：由素材生成初始命令，之后完全自由编辑 */
  const [cmd, setCmd] = useState('');
  /** 是否还停在初始生成的那条命令（决定配方是整体替换还是插入光标处） */
  const [pristine, setPristine] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const [panelOpen, setPanelOpen] = useState(false);
  const [recipeOpen, setRecipeOpen] = useState(false);

  const [phase, setPhase] = useState<RunPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [core, setCore] = useState<CoreLoadState | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const abortRef = useRef(false);
  const logBoxRef = useRef<HTMLDivElement>(null);
  const cmdRef = useRef<HTMLTextAreaElement>(null);

  const appendLog = useCallback((line: LogLine) => {
    setLogs((prev) => [...prev.slice(-MAX_LOGS), line]);
  }, []);

  const pickFile = useCallback((f: File) => {
    setFile(f);
    setCmd(`-i ${inputNameFor(f.name)} ${defaultOutputName(f.name)}`);
    setPristine(true);
    setResult(null);
    setError(null);
    setNotice(null);
  }, []);

  /** 手动编辑命令后就不再是「初始状态」 */
  const editCmd = useCallback((next: string) => {
    setCmd(next);
    setPristine(false);
    setResult(null);
  }, []);

  const outputName = useMemo(() => outputNameOf(cmd), [cmd]);
  const rules: RuleItem[] = useMemo(() => {
    if (!outputName) return [];
    return computeRules(parseCommandText(cmd, 'input.mp4'), outputName);
  }, [cmd, outputName]);

  const busy = phase === 'loading-core' || phase === 'writing' || phase === 'running';
  const canAbort = phase === 'writing' || phase === 'running';

  /** 取输入框当前文本（优先实时值，其次 state） */
  const cur = useCallback((): string => cmdRef.current?.value ?? cmd, [cmd]);

  const focusAt = useCallback((caret: number) => {
    requestAnimationFrame(() => {
      const el = cmdRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }, []);

  /** 插到输出名之前（参数属于输出侧选项，不能落到输出文件后面）；没有输出名就追加 */
  const insertToken = useCallback(
    (snippet: string) => {
      const text = cur();
      const outIdx = outputTokenIndex(text);
      const res = insertBeforeToken(text, outIdx === -1 ? argsOf(text).length : outIdx, snippet);
      editCmd(res.text);
      focusAt(res.caret);
    },
    [editCmd, focusAt, cur],
  );

  /** 在光标处插入（保留用户选中的位置） */
  const insertAtCursor = useCallback(
    (snippet: string) => {
      const el = cmdRef.current;
      if (!el) {
        editCmd(`${cur()} ${snippet}`.trim());
        return;
      }
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      const head = el.value.slice(0, start);
      const tailText = el.value.slice(end);
      const lead = head && !/\s$/.test(head) ? ' ' : '';
      const tail = tailText && !/^\s/.test(tailText) ? ' ' : '';
      editCmd(`${head}${lead}${snippet}${tail}${tailText}`);
      focusAt((head + lead + snippet).length);
    },
    [editCmd, focusAt, cur],
  );

  /** 插入参数：滤镜优先并进已有的同流链；没有链就补一条 -vf / -af，绝不裸插 */
  const insertParam = useCallback(
    (snippet: string, kind: 'param' | 'vfilter' | 'afilter') => {
      if (kind !== 'param') {
        const flag = kind === 'afilter' ? '-af' : '-vf';
        const merged = insertFilterIntoChain(cur(), flag, snippet);
        if (merged) {
          editCmd(merged.text);
          focusAt(merged.caret);
          return;
        }
        insertToken(`${flag} ${snippet}`);
        return;
      }
      insertAtCursor(snippet);
    },
    [editCmd, focusAt, insertAtCursor, insertToken, cur],
  );

  const insertInput = useCallback(() => {
    if (!file || hasFlag(cur(), '-i')) return;
    insertToken(`-i ${inputNameFor(file.name)}`);
  }, [file, insertToken, cur]);

  const insertOutput = useCallback(() => {
    if (!file || outputNameOf(cur())) return;
    insertToken(defaultOutputName(file.name));
  }, [file, insertToken, cur]);

  const applyRecipeToCmd = useCallback(
    (recipe: Recipe) => {
      const args = recipeArgs(recipe);
      const target = applyRecipe(recipe, outputName ?? defaultOutputName(file?.name ?? 'clip.mp4')).outputName;

      if (pristine && file) {
        setCmd(`-i ${inputNameFor(file.name)} ${args} ${target}`);
        setPristine(true);
      } else {
        insertAtCursor(args);
        if (recipe.ext) {
          setCmd((prev) => (outputTokenIndex(prev) === -1 ? prev : replaceOutputExt(prev, recipe.ext!)));
        }
      }
      setNotice(`配方「${recipe.label}」：${recipe.hint}`);
      setResult(null);
    },
    [file, insertAtCursor, outputName, pristine],
  );

  /** 一键修复：在文本层直接改，不动其他部分 */
  const applyFix = useCallback(
    (rule: RuleItem) => {
      if (!rule.fix) return;
      let next = cmd;
      for (const s of rule.fix.setValue ?? []) next = replaceFlagValue(next, s.flag, s.value);
      for (const a of rule.fix.add ?? []) {
        const outIdx = outputTokenIndex(next);
        next = insertBeforeToken(next, outIdx === -1 ? argsOf(next).length : outIdx, snippetOfDef(a.defId, a.value)).text;
      }
      editCmd(next);
      setNotice(`已应用：${rule.fix.label}`);
    },
    [cmd, editCmd],
  );

  // ── 运行 ──────────────────────────────────────────────
  const tick = useCallback(() => {
    if (busy) setProgress(engine.progress);
    if (phase === 'loading-core') {
      const c = engine.lastCore;
      if (c) {
        setCore(c);
        if (c.total > 0) setProgress(Math.min(0.99, c.loaded / c.total));
      }
    }
  }, [busy, phase]);

  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [busy, tick]);

  useEffect(() => {
    if (!logOpen) return;
    logBoxRef.current?.scrollTo({ top: logBoxRef.current.scrollHeight });
  }, [logs, logOpen]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(id);
  }, [notice]);

  const doRun = async () => {
    if (!file) {
      setError('先选素材。');
      return;
    }
    const out = outputNameOf(cmd);
    if (!out) {
      setError('命令里没有输出文件名。最后一个不带 - 的参数就是输出名。');
      return;
    }
    if (file.size > MAX_INPUT_BYTES) {
      setError(`素材 ${formatBytes(file.size)}，超过 ffmpeg.wasm 的 2GB 硬上限，无法在浏览器里处理。`);
      return;
    }

    abortRef.current = false;
    setError(null);
    setResult(null);
    setLogs([]);
    setCore(null);
    setProgress(0);

    try {
      setPhase('loading-core');
      engine.attach(appendLog);
      await engine.ensureCore();
      if (abortRef.current) {
        setPhase('aborted');
        return;
      }

      setPhase('writing');
      appendLog({ text: `执行：ffmpeg ${cmd}`, type: 'info' });
      const data = await engine.run(argsOf(cmd), inputNameFor(file.name), file, out);

      const blob = new Blob([data], { type: mimeOf(out) });
      const url = URL.createObjectURL(blob);
      setResult({ name: out, blob, url, mime: blob.type });
      setProgress(1);
      setPhase('done');
      appendLog({ text: `完成：${out}（${formatBytes(blob.size)}）`, type: 'info' });
      engine.cleanup(inputNameFor(file.name), out);
    } catch (err) {
      if (abortRef.current) {
        setPhase('aborted');
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setPhase('error');
      appendLog({ text: msg, type: 'stderr' });
    }
  };

  const doAbort = () => {
    abortRef.current = true;
    engine.abort();
    setPhase('aborted');
    setProgress(0);
  };

  const bigFile = file ? file.size > BIG_INPUT_BYTES : false;
  const corePct = core && core.total > 0 ? (core.loaded / core.total) * 100 : null;

  return (
    <div className="app">
      <header className="head">
        <h1>ffmpeg-playground</h1>
      </header>

      {notice ? (
        <p className="notice" role="status">
          <Info />
          {notice}
        </p>
      ) : null}

      <div className="stack">
        <FileRow file={file} onPick={pickFile} />

        {bigFile ? (
          <p className="hint warn">素材 {formatBytes(file?.size ?? 0)}，偏大：网页版内存有限，很可能中途失败。</p>
        ) : null}

        <CommandBox
          ref={cmdRef}
          value={cmd}
          onChange={editCmd}
          disabled={!file}
          placeholder={file ? '' : '先选素材，这里会生成一条默认命令'}
        />

        <div className="toolbar">
          <button type="button" className="mini-btn" onClick={() => setPanelOpen(true)} disabled={!file} data-testid="add-param">
            <Plus size={15} />
            参数
          </button>
          <button type="button" className="mini-btn" onClick={() => setRecipeOpen(true)} disabled={!file} data-testid="recipes">
            配方
          </button>
          <button type="button" className="mini-btn" onClick={insertInput} disabled={!file} data-testid="ins-input">
            输入名
          </button>
          <button type="button" className="mini-btn" onClick={insertOutput} disabled={!file} data-testid="ins-output">
            输出名
          </button>
        </div>

        {rules.length > 0 ? (
          <ul className="rules" data-testid="rules">
            {rules.map((r) => (
              <li key={r.id} className={`rule ${r.level}`}>
                <span className="rule-icon">{r.level === 'warn' ? <Warn /> : <Info />}</span>
                <span className="rule-text">{r.text}</span>
                {r.fix ? (
                  <button type="button" className="btn tiny" onClick={() => applyFix(r)}>
                    {r.fix.label}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {phase === 'loading-core' ? (
          <div className="core-load" data-testid="core-load">
            <div className="bar">
              <div className="bar-fill" style={{ width: `${corePct ?? 6}%` }} />
            </div>
            <p className="hint">
              {corePct === null
                ? '下载内核…'
                : `下载内核… ${corePct.toFixed(0)}%（${formatBytes(core?.loaded ?? 0)} / ${formatBytes(core?.total ?? 0)}）`}
              ，首次约 32MB
            </p>
          </div>
        ) : null}

        {phase === 'running' || phase === 'writing' ? (
          <div className="bar">
            <div className="bar-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        ) : null}

        <div className="run-row">
          <button type="button" className="btn primary big" onClick={doRun} disabled={!file || busy} data-testid="run">
            <Play />
            {phase === 'running' ? '运行中…' : phase === 'writing' ? '写入素材…' : '开始转换'}
          </button>
          <button type="button" className="btn ghost" onClick={doAbort} disabled={!canAbort} data-testid="abort">
            <Stop />
            中止
          </button>
        </div>

        {error ? (
          <p className="error" data-testid="error">
            {error}
          </p>
        ) : null}

        {logs.length > 0 ? (
          <>
            <button type="button" className="link-btn log-toggle" onClick={() => setLogOpen((v) => !v)}>
              {logOpen ? '收起日志' : '展开日志'}（{logs.length} 行）
            </button>
            {logOpen ? (
              <div className="logbox" ref={logBoxRef} data-testid="log">
                {logs.map((l, i) => (
                  <p key={i} className={`log ${l.type || 'plain'}`}>
                    {l.text}
                  </p>
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        <ResultPanel result={result} />
      </div>

      <ParamPanel
        key={panelOpen ? 'panel-open' : 'panel-closed'}
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        onInsert={insertParam}
      />
      {/* key 随开合变化：每次打开都是干净状态，搜索词不残留 */}
      <RecipeModal
        key={recipeOpen ? 'recipe-open' : 'recipe-closed'}
        open={recipeOpen}
        onClose={() => setRecipeOpen(false)}
        onPick={applyRecipeToCmd}
        recipes={RECIPES}
      />
    </div>
  );
}
