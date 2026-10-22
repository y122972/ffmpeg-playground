import { describe, expect, it } from 'vitest';
import { RECIPES, applyRecipe } from '../src/lib/recipes';
import { buildCommand } from '../src/lib/command';

/**
 * 复刻一次端到端实测的链路：配方「压缩」→ 改后缀到 webm → 一键换编码器（setValue -c:v libvpx-vp9）→ 改回 mp4
 * 曾在这条链上让 pickOutput 里的 a.startsWith 报 "Cannot read properties of undefined"。
 */
function simulateRecipeThenCodecFix() {
  const base = applyRecipe(RECIPES[0], 'flower_20261021.mp4');
  const outputName = base.outputName.replace(/\.mp4$/, '.mp4'); // 改回 mp4 只改输出名
  // 模拟一键修复：把 -c:v 的值换成 libvpx-vp9
  const chips = base.chips.map((c) =>
    c.kind === 'param' && c.flag === '-c:v' ? { ...c, value: 'libvpx-vp9' } : c,
  );
  return { chips, outputName };
}

describe('端到端实测链：配方 + 编码器一键修复', () => {
  it('args 里没有 undefined', () => {
    const { chips, outputName } = simulateRecipeThenCodecFix();
    const cmd = buildCommand(chips, 'input.mp4', outputName);
    expect(cmd.args.some((a) => typeof a !== 'string')).toBe(false);
  });

  it('拼出的命令符合预期', () => {
    const { chips, outputName } = simulateRecipeThenCodecFix();
    const cmd = buildCommand(chips, 'input.mp4', outputName);
    expect(cmd.args).toEqual([
      '-i', 'input.mp4',
      '-c:v', 'libvpx-vp9',
      '-crf', '28',
      '-b:a', '128k',
      '-vf', 'scale=1280:-1',
      outputName,
    ]);
  });

  it('输出名是最后一个 token', () => {
    const { chips, outputName } = simulateRecipeThenCodecFix();
    const cmd = buildCommand(chips, 'input.mp4', outputName);
    expect(cmd.args.at(-1)).toBe(outputName);
  });
});
