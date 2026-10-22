import { useRef, useState } from 'react';
import { formatBytes, kindOf } from '../lib/format';
import { Folder, X } from './icons';

interface Props {
  file: File | null;
  onPick: (file: File) => void;
  onClear: () => void;
}

const KIND_LABEL: Record<string, string> = {
  video: '视频',
  audio: '音频',
  image: '图片',
  other: '文件',
};

/** 单个本地素材。点选或拖入；不预读字节，文件只在浏览器里。 */
export function FilePicker({ file, onPick, onClear }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  if (file) {
    return (
      <div className="picked" data-testid="picked-file">
        <span className="picked-icon">
          <Folder />
        </span>
        <span className="picked-main">
          <span className="picked-name">{file.name}</span>
          <span className="picked-meta">
            {KIND_LABEL[kindOf(file.name)]} · {formatBytes(file.size)}
          </span>
        </span>
        <button
          type="button"
          className="icon-btn"
          onClick={() => {
            onClear();
            if (inputRef.current) inputRef.current.value = '';
          }}
          aria-label="移除素材"
        >
          <X />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`drop${over ? ' over' : ''}`}
      data-testid="dropzone"
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onPick(f);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
      }}
    >
      <Folder />
      <p className="drop-title">选一个视频 / 音频 / 图片</p>
      <p className="drop-hint">或者把文件拖进来。全程本地处理，不上传任何服务器。大文件建议用自带的「文件」选。</p>
      <input
        ref={inputRef}
        type="file"
        className="visually-hidden"
        accept="video/*,audio/*,image/*"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
        }}
      />
    </div>
  );
}
