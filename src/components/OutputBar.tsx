interface Props {
  value: string;
  onChange: (name: string) => void;
  disabled?: boolean;
}

const SUFFIXES = ['mp4', 'webm', 'mkv', 'mp3', 'm4a', 'wav', 'gif', 'jpg', 'png'];

/** 输出名 + 后缀快选。默认 <上传名>_<时间戳>.mp4，由 App 生成。 */
export function OutputBar({ value, onChange, disabled }: Props) {
  const dot = value.lastIndexOf('.');
  const base = dot === -1 ? value : value.slice(0, dot);
  const ext = dot === -1 ? '' : value.slice(dot + 1);

  return (
    <div className="outbar">
      <label className="field">
        <span className="field-label">输出文件名</span>
        <input
          className="text-input"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-label="输出文件名"
        />
      </label>
      <div className="suffixes" role="group" aria-label="改后缀">
        {SUFFIXES.map((s) => (
          <button
            key={s}
            type="button"
            className={`suffix${ext === s ? ' on' : ''}`}
            disabled={disabled}
            onClick={() => onChange(`${base}.${s}`)}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
