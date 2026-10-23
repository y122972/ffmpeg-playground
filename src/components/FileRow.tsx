import { useRef, useState } from 'react';
import { formatBytes, kindOf } from '../lib/format';
import { Modal } from './Modal';
import { Folder, Swap } from './icons';

interface Props {
  file: File | null;
  onPick: (file: File) => void;
}

const KIND_LABEL: Record<string, string> = {
  video: '视频',
  audio: '音频',
  image: '图片',
  other: '文件',
};

/** 素材行：只占一行 —— 文件名（点开预览）+ 换个素材。 */
export function FileRow({ file, onPick }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState(false);

  if (!file) {
    return (
      <div className="picker-row">
        <button
          type="button"
          className="pick-btn"
          onClick={() => inputRef.current?.click()}
          data-testid="pick"
        >
          <Folder size={18} />
          选择素材
        </button>
        <span className="pick-hint">视频 / 音频 / 图片，只在本机处理</span>
        <input
          ref={inputRef}
          type="file"
          accept="video/*,audio/*,image/*"
          className="visually-hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPick(f);
          }}
        />
      </div>
    );
  }

  return (
    <>
      <div className="picker-row picked" data-testid="file-row">
        <button type="button" className="file-name" onClick={() => setPreview(true)} data-testid="src-name">
          {file.name}
        </button>
        <span className="file-meta">
          {KIND_LABEL[kindOf(file.name)]} · {formatBytes(file.size)}
        </span>
        <button type="button" className="mini-btn" onClick={() => inputRef.current?.click()} data-testid="swap">
          <Swap />
          换个素材
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="video/*,audio/*,image/*"
          className="visually-hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              onPick(f);
              if (inputRef.current) inputRef.current.value = '';
            }
          }}
        />
      </div>

      <Modal open={preview} title={file.name} onClose={() => setPreview(false)}>
        <div className="src-media">
          {kindOf(file.name) === 'video' ? (
            <video src={URL.createObjectURL(file)} controls playsInline />
          ) : null}
          {kindOf(file.name) === 'audio' ? <audio src={URL.createObjectURL(file)} controls /> : null}
          {kindOf(file.name) === 'image' ? <img src={URL.createObjectURL(file)} alt={file.name} /> : null}
          {kindOf(file.name) === 'other' ? <p className="hint">这个格式没法直接预览。</p> : null}
        </div>
        <p className="hint">
          {KIND_LABEL[kindOf(file.name)]} · {formatBytes(file.size)} · {file.type || '未知类型'}
        </p>
      </Modal>
    </>
  );
}
