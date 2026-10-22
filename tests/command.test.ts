import { describe, expect, it } from 'vitest';
import { buildCommand, inputChip, outputChip, parseCommandText, chipFromDef, tokenize } from '../src/lib/command';
import { DEF_MAP } from '../src/lib/params';
import { computeRules } from '../src/lib/rules';

const def = (id: string, value = '') => chipFromDef(DEF_MAP[id], value);

describe('buildCommand', () => {
  it('没插输入/输出时，输入放最前、输出放末尾', () => {
    const chips = [def('crf', '28')];
    const cmd = buildCommand(chips, 'input.mp4', 'out.mp4');
    expect(cmd.args).toEqual(['-i', 'input.mp4', '-crf', '28', 'out.mp4']);
  });

  it('输出名出现在中间时，按用户放的位置走', () => {
    const chips = [outputChip('mid.mp4'), def('crf', '28')];
    const cmd = buildCommand(chips, 'input.mp4', 'out.mp4');
    expect(cmd.args).toEqual(['-i', 'input.mp4', 'mid.mp4', '-crf', '28']);
  });

  it('多个滤镜按顺序合并成一条 -vf，且停在它原本的位置', () => {
    const chips = [
      def('crf', '28'),
      def('f:scale', '1280:-1'),
      def('f:fps', '30'),
    ];
    const cmd = buildCommand(chips, 'input.mp4', 'out.mp4');
    expect(cmd.args).toEqual(['-i', 'input.mp4', '-crf', '28', '-vf', 'scale=1280:-1,fps=30', 'out.mp4']);
  });

  it('视频滤镜进 -vf，音频滤镜进 -af，两链互不干扰', () => {
    const chips = [def('f:volume', '1.5'), def('f:scale', '640:-1'), def('f:atempo', '1.2')];
    const cmd = buildCommand(chips, 'input.mp4', 'out.mp4');
    expect(cmd.args).toEqual([
      '-i',
      'input.mp4',
      '-af',
      'volume=1.5,atempo=1.2',
      '-vf',
      'scale=640:-1',
      'out.mp4',
    ]);
  });

  it('开关参数不带值', () => {
    const cmd = buildCommand([def('an')], 'input.mp4', 'out.mp4');
    expect(cmd.args).toEqual(['-i', 'input.mp4', '-an', 'out.mp4']);
  });

  it('含空格的 token 在展示文本里加引号', () => {
    const chips = [
      { kind: 'param' as const, flag: '-metadata', value: 'title=my video', label: '写入元数据', id: 'x' },
    ];
    expect(buildCommand(chips, 'input.mp4', 'out.mp4').text).toContain('-metadata "title=my video"');
  });

  it('-ss 在素材前后决定它在参数里的位置', () => {
    const before = buildCommand([def('ss', '10'), inputChip('input.mp4')], 'input.mp4', 'out.mp4');
    const after = buildCommand([inputChip('input.mp4'), def('ss', '10')], 'input.mp4', 'out.mp4');
    expect(before.args).toEqual(['-ss', '10', '-i', 'input.mp4', 'out.mp4']);
    expect(after.args).toEqual(['-i', 'input.mp4', '-ss', '10', 'out.mp4']);
  });
});

describe('tokenize', () => {
  it('尊重双引号和单引号', () => {
    expect(tokenize('ffmpeg -metadata title="my video" out.mp4')).toEqual([
      'ffmpeg',
      '-metadata',
      'title=my video',
      'out.mp4',
    ]);
  });
});

describe('parseCommandText', () => {
  it('能解析回 chip，且重新拼装得到等价的参数序列', () => {
    const text =
      'ffmpeg -i input.mp4 -ss 5 -c:v libx264 -crf 23 -vf scale=1280:-1,fps=30 -af volume=1.5 -c:a copy out.mp4';
    const chips = parseCommandText(text, 'input.mp4');

    const cmd = buildCommand(chips, 'input.mp4', 'out.mp4');
    expect(cmd.args).toEqual([
      '-i', 'input.mp4',
      '-ss', '5',
      '-c:v', 'libx264',
      '-crf', '23',
      '-vf', 'scale=1280:-1,fps=30',
      '-af', 'volume=1.5',
      '-c:a', 'copy',
      'out.mp4',
    ]);
  });

  it('滤镜链按逗号拆成多个滤镜 chip（顺序保留）', () => {
    const chips = parseCommandText('ffmpeg -i input.mp4 -vf scale=640:-1,crop=4:3 out.mp4', 'input.mp4');
    const filters = chips.filter((c) => c.kind === 'filter');
    expect(filters.map((f) => f.flag)).toEqual(['scale', 'crop']);
  });

  it('自由输入里没写素材名时，自动补一个输入', () => {
    const chips = parseCommandText('-crf 28', 'input.mp4');
    expect(chips.some((c) => c.kind === 'input')).toBe(true);
  });

  it('负数不被当成 flag（scale=1280:-1 里的 -1 在滤镜值里不受影响）', () => {
    const chips = parseCommandText('ffmpeg -i input.mp4 -b:v -1 out.mp4', 'input.mp4');
    const bv = chips.find((c) => c.flag === '-b:v');
    expect(bv?.value).toBe('-1');
  });

  it('库外参数保留成自定义参数', () => {
    const chips = parseCommandText('ffmpeg -i input.mp4 -mysteriousvalue 3 out.mp4', 'input.mp4');
    expect(chips.some((c) => c.kind === 'param' && c.flag === '-mysteriousvalue' && c.value === '3')).toBe(true);
  });
});

describe('computeRules', () => {
  it('gif 输出给出体积提醒和一键调整', () => {
    const rules = computeRules([], 'out.gif');
    const r = rules.find((x) => x.id === 'gif:size');
    expect(r?.level).toBe('info');
    expect(r?.fix?.add?.map((a) => a.defId)).toEqual(['f:scale', 'f:fps']);
  });

  it('纯音频后缀没有 -vn 时提示，一键补上', () => {
    const rules = computeRules([], 'out.mp3');
    const r = rules.find((x) => x.id === 'audio:vn');
    expect(r?.fix?.add).toEqual([{ defId: 'vn', value: '' }]);
  });

  it('webm 配 libx264 时提示并给换编码器的一键修复', () => {
    const rules = computeRules([def('c:v', 'libx264')], 'out.webm');
    const r = rules.find((x) => x.id === 'codec:webm');
    expect(r?.fix?.setValue).toEqual([{ flag: '-c:v', value: 'libvpx-vp9' }]);
  });

  it('单例参数重复出现只提示，不阻断（ffmpeg 自己会用最后一次）', () => {
    const rules = computeRules([def('crf', '23'), def('crf', '28')], 'out.mp4');
    expect(rules.find((x) => x.id === 'dup:-crf')?.level).toBe('warn');
  });

  it('-ss 放在素材后面时说明为什么慢', () => {
    const rules = computeRules([inputChip('input.mp4'), def('ss', '5')], 'out.mp4');
    expect(rules.some((x) => x.id === 'ss:after-input')).toBe(true);
  });

  it('图片后缀没加 -frames:v 时提醒', () => {
    expect(computeRules([], 'out.png').some((x) => x.id === 'image:frames')).toBe(true);
  });
});
