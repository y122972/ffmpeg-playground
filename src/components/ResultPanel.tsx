import { useMemo } from 'react';
import type { RunResult } from '../types';
import { formatBytes, kindOf, mimeOf } from '../lib/format';

interface Props {
  result: RunResult | null;
}

/** 完成后页面内预览 + 下载按钮；浏览器播不了的格式给一句说明，不自动下载 */
export function ResultPanel({ result }: Props) {
  const kind = useMemo(() => (result ? kindOf(result.name) : 'none'), [result]);
  const mime = useMemo(() => (result ? mimeOf(result.name) : ''), [result]);

  const playable = useMemo(() => {
    if (!result || kind === 'image') return true;
    if (kind !== 'video' && kind !== 'audio') return false;
    const probe = document.createElement(kind === 'video' ? 'video' : 'audio');
    return probe.canPlayType(mime) !== '';
  }, [result, kind, mime]);

  if (!result) {
    return <p className="hint">跑完之后这里直接出预览，点下载再拿走，不自动下载。</p>;
  }

  return (
    <div className="result" data-testid="result">
      <div className="result-media">
        {kind === 'video' ? <video src={result.url} controls playsInline preload="metadata" /> : null}
        {kind === 'audio' ? <audio src={result.url} controls preload="metadata" /> : null}
        {kind === 'image' ? <img src={result.url} alt={result.name} /> : null}
      </div>

      {!playable ? (
        <p className="hint warn">
          浏览器播不了 {result.name}（MKV / AVI / FLV 常见），用下面的下载按钮拿走再看。
        </p>
      ) : null}

      <div className="result-meta">
        <span className="result-name" data-testid="result-name">
          {result.name}
        </span>
        <span className="result-size">{formatBytes(result.blob.size)}</span>
      </div>

      <a className="btn primary block" href={result.url} download={result.name} data-testid="download">
        下载 {result.name}
      </a>
    </div>
  );
}
