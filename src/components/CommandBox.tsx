import { forwardRef } from 'react';

interface Props {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * 主体输入框：命令本身就是这里的文本，可自由编辑。
 * 工具栏的「参数 / 配方 / 输入名 / 输出名」都是在光标处插入片段。
 */
export const CommandBox = forwardRef<HTMLTextAreaElement, Props>(function CommandBox(
  { value, onChange, disabled, placeholder },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className="cmd-box"
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      spellCheck={false}
      rows={3}
      aria-label="ffmpeg 命令"
      data-testid="cmd"
      onChange={(e) => onChange(e.target.value)}
    />
  );
});
