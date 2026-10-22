import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Chip, RuleItem, RunPhase, RunResult } from './types';
import { buildCommand, chipFromDef, inputChip, parseCommandText } from './lib/command';
import { computeRules } from './lib/rules';
import { applyRecipe, RECIPES } from './lib/recipes';
import { DEF_MAP } from './lib/params';
import { defaultOutputName, formatBytes, inputNameFor, mimeOf } from './lib/format';
import { engine, type CoreLoadState } from './lib/ffmpegEngine';
import { FilePicker } from './components/FilePicker';
import { ChipList } from './components/ChipList';
import { CommandBar } from './components/CommandBar';
import { OutputBar } from './components/OutputBar';
import { ParamPanel } from './components/ParamPanel';
import { ResultPanel } from './components/ResultPanel';
import { Info, Play, Plus, Stop, Warn } from './components/icons';

const MAX_INPUT_BYTES = 2 * 1024 * 1024 * 1024; // ffmpeg.wasm 硬上限
const BIG_INPUT_BYTES = 400 * 1024 * 1024; // wasm 内存余量有限，超过就开始容易 OOM
const MAX_LOGS = 400;

interface LogLine {
  text: string;
  type: string;
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [chips, setChips] = useState<Chip[]>([]);
  const [inputName, setInputName] = useState('input.mp4');
  const [outputName, setOutputName] = useState('output.mp4');
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<Chip | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [phase, setPhase] = useState<RunPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [core, setCore] = useState<CoreLoadState | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(true);
  const abortRef = useRef(false);
  const logBoxRef = useRef<HTMLDivElement>(null);

  const appendLog = useCallback((line: LogLine) => {
    setLogs((prev) => [...prev.slice(-MAX_LOGS), line]);
  }, []);

  /** 选素材：默认输入名 input.<原后缀>，输出名 <上传名>_<时间戳>.mp4 */
  const pickFile = useCallback((f: File) => {
    const input = inputNameFor(f.name);
    setFile(f);
    setInputName(input);
    setOutputName(defaultOutputName(f.name));
    setChips([]);
    setResult(null);
    setError(null);
    setNotice(null);
  }, []);

  const cmd = useMemo(() => buildCommand(chips, inputName, outputName), [chips, inputName, outputName]);
  const rules: RuleItem[] = useMemo(() => computeRules(chips, cmd.outputName), [chips, cmd.outputName]);
  const busy = phase === 'loading-core' || phase === 'writing' || phase === 'running';
  const canAbort = phase === 'writing' || phase === 'running';

  // ── chip 操作 ──────────────────────────────────────────
  const commitChip = (chip: Chip, editingId: string | null) => {
    setResult(null);
    if (editingId) {
      setChips((prev) => prev.map((c) => (c.id === editingId ? { ...chip, id: editingId } : c)));
    } else {
      setChips((prev) => [...prev, chip]);
    }
  };

  const moveChip = (id: string, dir: 'up' | 'down') => {
    setChips((prev) => {
      const i = prev.findIndex((c) => c.id === id);
      const j = i + (dir === 'up' ? -1 : 1);
      if (i === -1 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const removeChip = (id: string) => {
    setResult(null);
    setChips((prev) => prev.filter((c) => c.id !== id));
  };

  const appendIO = (kind: 'input' | 'output') => {
    if (chips.some((c) => c.kind === kind)) {
      setNotice(kind === 'input' ? '素材名已经在列表里了。' : '输出名已经在列表里了。不插的话会自动放在命令末尾。');
      return;
    }
    setChips((prev) => [
      ...prev,
      kind === 'input'
        ? inputChip(inputName)
        : {
            id: `${kind}-${Date.now().toString(36)}`,
            kind,
            value: outputName,
            label: '输出',
          },
    ]);
  };

  /** 配方：只填参数不跑，方便先看命令 */
  const runRecipe = (id: string) => {
    const recipe = RECIPES.find((r) => r.id === id);
    if (!recipe) return;
    const applied = applyRecipe(recipe, outputName);
    setChips(applied.chips);
    if (applied.outputName !== outputName) setOutputName(applied.outputName);
    setResult(null);
    setNotice(
      applied.outputName !== outputName
        ? `已填入「${recipe.label}」：${recipe.hint}（输出后缀改为 .${recipe.ext}）`
        : `已填入「${recipe.label}」：${recipe.hint}`,
    );
  };

  /** 执行规则里的一键修正 */
  const applyFix = (rule: RuleItem) => {
    if (!rule.fix) return;
    setChips((prev) => {
      let next = prev.map((c) => {
        const hit = rule.fix?.setValue?.find((s) => c.kind === 'param' && c.flag === s.flag);
        return hit ? { ...c, value: hit.value } : c;
      });
      const extra = (rule.fix?.add ?? []).map((a) => chipFromDef(DEF_MAP[a.defId], a.value));
      next = [...next, ...extra];
      return next;
    });
    setNotice(`已应用：${rule.fix.label}`);
    setResult(null);
  };

  /** 自由输入 → 解析回 chip */
  const applyManual = (raw: string) => {
    setChips(parseCommandText(raw, inputName));
    setResult(null);
    setNotice('已按这行重新解析。滤镜链会按顺序合回 -vf / -af。');
  };

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
      setError('先选一个素材。');
      return;
    }
    if (file.size > MAX_INPUT_BYTES) {
      setError(
        `素材 ${formatBytes(file.size)}，超过 ffmpeg.wasm 的 2GB 硬上限，无法在浏览器里处理。先切小。`,
      );
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
      appendLog({ text: `执行：${cmd.text}`, type: 'info' });
      const data = await engine.run(cmd.args, cmd.inputName, file, cmd.outputName);

      const outName = cmd.outputName;
      const blob = new Blob([data], { type: mimeOf(outName) });
      const url = URL.createObjectURL(blob);
      setResult({ name: outName, blob, url, mime: blob.type });
      setProgress(1);
      setPhase('done');
      appendLog({ text: `完成：${outName}（${formatBytes(blob.size)}）`, type: 'info' });
      engine.cleanup(cmd.inputName, outName);
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

  const coreHint = (() => {
    if (!core) return '下载解码内核…';
    const loaded = formatBytes(core.loaded);
    const total = formatBytes(core.total);
    return corePct === null
      ? `下载解码内核… 已下载 ${loaded}`
      : `下载解码内核… ${corePct.toFixed(0)}%（${loaded} / ${total}）`;
  })();

  return (
    <div className="app">
      <header className="head">
        <h1>ffmpeg-playground</h1>
        <p className="sub">在浏览器里拼 ffmpeg 命令、本地处理素材。不上传，不装东西。</p>
      </header>

      {notice ? (
        <p className="notice" role="status">
          <Info />
          {notice}
        </p>
      ) : null}

      <section className="card">
        <h2 className="card-title">1. 素材</h2>
        <FilePicker file={file} onPick={pickFile} onClear={() => { setFile(null); setResult(null); }} />
        {bigFile ? (
          <p className="hint warn">
            素材 {formatBytes(file?.size ?? 0)}，偏大：网页版内存有限，很可能中途失败。建议先用别的工具切小，或者本地用 ffmpeg。
          </p>
        ) : null}
      </section>

      <section className="card">
        <h2 className="card-title">2. 快速配方</h2>
        <p className="hint">点一下只填参数，不直接跑。你看看命令合不合心意再决定。</p>
        <div className="recipes">
          {RECIPES.map((r) => (
            <button key={r.id} type="button" className="recipe" onClick={() => runRecipe(r.id)} disabled={!file}>
              <span className="recipe-label">{r.label}</span>
              <span className="recipe-hint">{r.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">3. 参数</h2>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setEditing(null);
              setPanelOpen(true);
            }}
            data-testid="add-param"
          >
            <Plus />
            添加参数
          </button>
        </div>

        <ChipList
          chips={chips}
          onReorder={(c) => { setChips(c); setResult(null); }}
          onMove={moveChip}
          onRemove={removeChip}
          onEdit={(c) => {
            setEditing(c);
            setPanelOpen(true);
          }}
          onAppendIO={appendIO}
        />

        <div className="io-quick">
          <button type="button" className="btn ghost" onClick={() => appendIO('input')} disabled={!file}>
            插入素材名
          </button>
          <button type="button" className="btn ghost" onClick={() => appendIO('output')} disabled={!file}>
            插入输出名
          </button>
          <span className="hint">不插也行：素材会自动放在最前面，输出自动放末尾。顺序随便拖，拼错了 ffmpeg 会报错。</span>
        </div>

        <CommandBar text={cmd.text} onApply={applyManual} />

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
      </section>

      <section className="card">
        <h2 className="card-title">4. 输出</h2>
        <OutputBar
          value={outputName}
          onChange={(v) => {
            setOutputName(v);
            setResult(null);
          }}
          disabled={!file}
        />
        <p className="hint">改了后缀只是改容器；容器和编码器不搭的话上面会出现提示，一键换过去。</p>
      </section>

      <section className="card">
        <h2 className="card-title">5. 运行</h2>

        {phase === 'loading-core' ? (
          <div className="core-load" data-testid="core-load">
            <div className="bar">
              <div
                className="bar-fill"
                style={{ width: `${corePct ?? 6}%`, transition: corePct !== null ? 'width .2s' : 'none' }}
              />
            </div>
            <p className="hint">
              {coreHint}
              首次约 32MB（内核本体 32.2MB），之后走缓存。
            </p>
          </div>
        ) : null}

        {phase === 'running' || phase === 'writing' ? (
          <div className="bar">
            <div className="bar-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        ) : null}

        <div className="run-row">
          <button
            type="button"
            className="btn primary big"
            onClick={doRun}
            disabled={!file || busy}
            data-testid="run"
          >
            <Play />
            {phase === 'running' ? '运行中…' : phase === 'writing' ? '写入素材…' : '开始转换'}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={doAbort}
            disabled={!canAbort}
            data-testid="abort"
          >
            <Stop />
            中止
          </button>
        </div>

        {phase === 'aborted' ? (
          <p className="hint warn" data-testid="aborted-note">
            已中止。内核被强制关掉，下次运行要重新下载（浏览器有缓存会快很多）。
          </p>
        ) : null}
        {error ? (
          <p className="error" data-testid="error">
            {error}
          </p>
        ) : null}

        <button type="button" className="link-btn log-toggle" onClick={() => setLogOpen((v) => !v)}>
          {logOpen ? '收起日志' : '展开日志'}（{logs.length} 行）
        </button>
        {logOpen ? (
          <div className="logbox" ref={logBoxRef} data-testid="log">
            {logs.length === 0 ? (
              <p className="hint">运行后这里滚动显示 ffmpeg 的输出。</p>
            ) : (
              logs.map((l, i) => (
                <p key={i} className={`log ${l.type || 'plain'}`}>
                  {l.text}
                </p>
              ))
            )}
          </div>
        ) : null}
      </section>

      <section className="card">
        <h2 className="card-title">6. 结果</h2>
        <ResultPanel result={result} />
      </section>

      {panelOpen ? (
        <ParamPanel
          key={editing?.id ?? 'new-param'}
          open={panelOpen}
          onClose={() => {
            setPanelOpen(false);
            setEditing(null);
          }}
          editing={editing}
          onCommit={commitChip}
        />
      ) : null}

      <footer className="foot">
        <p>
          解码内核是 ffmpeg.wasm 单线程版（首次约 32MB，从 CDN 拉取，之后走缓存）。纯静态页面，没有后端。素材
          <strong>只在你的浏览器里</strong>处理。
        </p>
        <p className="foot-meta">
          部分浏览器对 MKV / AVI / FLV 播不出来，但下载下来的文件本身是好的。
        </p>
      </footer>
    </div>
  );
}
