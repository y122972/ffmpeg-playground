import { describe, expect, it } from 'vitest';
import { computeRules } from '../src/lib/rules';
import { RECIPES, applyRecipe, recipeArgs } from '../src/lib/recipes';
import { buildCommand } from '../src/lib/command';

describe('快速配方', () => {
  it('五个配方都在', () => {
    expect(RECIPES.map((r) => r.id)).toEqual(['compress', 'cut', 'audio', 'gif', '720p']);
  });

  it('配方不内置输入/输出名，交给 buildCommand 自动放置', () => {
    for (const r of RECIPES) {
      expect(r.chips().some((c) => c.kind === 'input' || c.kind === 'output')).toBe(false);
    }
  });

  it('压缩配方的参数落在 -i 之后（编码参数在输入前面会被当成输入选项）', () => {
    const { chips } = applyRecipe(RECIPES[0], 'clip.mp4');
    const args = buildCommand(chips, 'input.mp4', 'clip_out.mp4').args;
    expect(args.indexOf('-i')).toBe(0);
    expect(args).toContain('-crf');
    expect(args.indexOf('-crf')).toBeGreaterThan(args.indexOf('-i'));
  });

  it('截取配方的 -ss 落在 -i 之后（精确跳转，落点准）', () => {
    const { chips } = applyRecipe(RECIPES[1], 'clip.mp4');
    const args = buildCommand(chips, 'input.mp4', 'clip_out.mp4').args;
    expect(args.indexOf('-ss')).toBeGreaterThan(args.indexOf('-i'));
    expect(args).toContain('-t');
  });

  it('截取配方里若自己插了素材 chip，会触发「-ss 在素材后面」的说明', () => {
    const { chips } = applyRecipe(RECIPES[1], 'clip.mp4');
    expect(
      computeRules(
        [
          { id: 'io', kind: 'input', value: 'input.mp4', label: '素材' },
          ...chips,
        ],
        'clip_out.mp4',
      ).some((r) => r.id === 'ss:after-input'),
    ).toBe(true);
  });

  it('压缩后输出后缀回到 .mp4（不会把视频塞进音频容器）', () => {
    let { chips, outputName } = applyRecipe(RECIPES.find((r) => r.id === 'audio')!, 'clip.mp4');
    expect(outputName).toBe('clip.mp3');
    const compress = RECIPES.find((r) => r.id === 'compress')!;
    ({ chips, outputName } = applyRecipe(compress, outputName));
    expect(outputName).toBe('clip.mp4');
    // 输出名回到了视频容器，音频相关的 -vn 提示不该再出现
    expect(computeRules(chips, outputName).some((r) => r.id === 'audio:vn')).toBe(false);
  });

  it('提取音频配方把后缀改成 mp3 并只留音频', () => {
    const audio = RECIPES.find((r) => r.id === 'audio')!;
    const { chips, outputName } = applyRecipe(audio, 'clip_20261021.mp4');
    expect(outputName).toBe('clip_20261021.mp3');
    expect(chips.some((c) => c.flag === '-vn')).toBe(true);
    expect(computeRules(chips, outputName).some((r) => r.id === 'audio:vn')).toBe(false);
  });

  it('转 GIF 配方带 width + fps', () => {
    const gif = RECIPES.find((r) => r.id === 'gif')!;
    const { chips, outputName } = applyRecipe(gif, 'clip.mp4');
    expect(outputName).toBe('clip.gif');
    expect(chips.map((c) => c.flag)).toEqual(['scale', 'fps']);
  });
});

describe('recipeArgs（插入命令框用）', () => {
  it('滤镜必须包成 -vf / -af，不能裸插', () => {
    expect(recipeArgs(RECIPES.find((r) => r.id === 'gif')!)).toBe('-vf scale=480:-1,fps=12');
    expect(recipeArgs(RECIPES.find((r) => r.id === 'audio')!)).toBe('-vn -c:a libmp3lame -b:a 128k -ac 1');
  });

  it('压缩配方的参数都带前缀且不含输入输出名', () => {
    const s = recipeArgs(RECIPES.find((r) => r.id === 'compress')!);
    expect(s).toBe('-c:v libx264 -crf 28 -b:a 128k -vf scale=1280:-1');
    expect(s).not.toContain('input.');
    expect(s).not.toContain('out.mp4');
  });
});
