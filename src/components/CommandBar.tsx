import { useState } from 'react';
import { Check, Copy, Pencil } from './icons';

interface Props {
  text: string;
  /** 自由输入确认后的回调（App 负责解析回 chip） */
  onApply: (raw: string) => void;
}

/** 命令预览：默认只读可复制；点「自由输入」进入可编辑模式，懂 ffmpeg 的人直接改 */
export function CommandBar({ text, onApply }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [copied, setCopied] = useState(false);

  const start = () => {
    setDraft(text);
    setEditing(true);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // 拿不到剪贴板权限时退化为全选，让用户自己复制
      const el = document.querySelector<HTMLElement>('[data-testid="command-preview"]');
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
    window.setTimeout(() => setCopied(false), 1600);
  };

  if (editing) {
    return (
      <div className="cmdbar">
        <textarea
          className="cmd-edit"
          value={draft}
          spellCheck={false}
          autoFocus
          rows={4}
          aria-label="自由编辑命令"
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="cmd-actions">
          <button type="button" className="btn ghost" onClick={() => setEditing(false)}>
            取消
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              onApply(draft);
              setEditing(false);
            }}
          >
            按这行重新解析
          </button>
        </div>
        <p className="hint">随便写，确认后按空格拆成参数；滤镜链会拆散再合回 -vf / -af。</p>
      </div>
    );
  }

  return (
    <div className="cmdbar">
      <pre className="cmd-preview-text" data-testid="command-preview">
        {text}
      </pre>
      <div className="cmd-actions">
        <button type="button" className="btn ghost" onClick={copy}>
          {copied ? <Check /> : <Copy />}
          {copied ? '已复制' : '复制命令'}
        </button>
        <button type="button" className="btn ghost" onClick={start} data-testid="manual-edit">
          <Pencil />
          自由输入
        </button>
      </div>
    </div>
  );
}
