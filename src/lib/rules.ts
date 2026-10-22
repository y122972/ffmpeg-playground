import type { Chip, RuleItem } from '../types';
import { extOf, kindOf } from './format';

/** 「一个 key 只该有一个值」的参数。重复时只提示，不拦截——ffmpeg 反正会用最后一次。 */
const SINGLETONS = [
  '-c:v', '-c:a', '-crf', '-b:v', '-b:a', '-q:v', '-q:a', '-r', '-preset',
  '-pix_fmt', '-profile:v', '-ss', '-t', '-to', '-ac', '-ar', '-f', '-movflags',
  '-frames:v', '-frames:a', '-an', '-vn', '-shortest', '-y', '-n',
];

/** 后缀 → 希望的视频编码器 */
const PREFERRED_VCODEC: Record<string, string> = {
  mp4: 'libx264',
  m4v: 'libx264',
  mov: 'libx264',
  webm: 'libvpx-vp9',
  avi: 'mpeg4',
};

const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'opus', 'flac'];
const IMAGE_EXT = ['gif', 'jpg', 'jpeg', 'png', 'webp', 'bmp'];

function valueOf(chips: Chip[], flag: string): string | undefined {
  for (const c of chips) {
    if (c.kind === 'param' && c.flag === flag && (c.value ?? '') !== '') return c.value;
    if (c.kind === 'param' && c.flag === flag) return '';
  }
  return undefined;
}

function hasFlag(chips: Chip[], flag: string): boolean {
  return chips.some((c) => c.kind === 'param' && c.flag === flag);
}

function hasFilter(chips: Chip[], name: string): boolean {
  return chips.some((c) => c.kind === 'filter' && c.flag === name);
}

/**
 * 计算温和提示。全都不阻塞运行——用户自己拼错，交给 ffmpeg 报错，
 * 这里只把能预先看到的坑点摆出来，并给一键修正。
 */
export function computeRules(chips: Chip[], outputName: string): RuleItem[] {
  const rules: RuleItem[] = [];
  const ext = extOf(outputName);
  const k = kindOf(outputName);

  // 重复单例参数
  for (const flag of SINGLETONS) {
    const count = chips.filter((c) => c.kind === 'param' && c.flag === flag).length;
    if (count > 1) {
      rules.push({
        id: `dup:${flag}`,
        level: 'warn',
        text: `${flag} 加了 ${count} 次，ffmpeg 只会用最后一次，前面的等于白设。`,
      });
    }
  }

  // -ss 位置：放在素材后 = 精确跳转，放在素材前 = 快速跳转
  const ssIndex = chips.findIndex((c) => c.kind === 'param' && c.flag === '-ss');
  const inputIndex = chips.findIndex((c) => c.kind === 'input');
  if (ssIndex !== -1 && inputIndex !== -1 && ssIndex > inputIndex) {
    rules.push({
      id: 'ss:after-input',
      level: 'info',
      text: '-ss 现在在素材后面：会精确跳到那一帧，但慢。想快就把它拖到素材前面（可能差 1 秒内）。',
    });
  }

  // 视频编码器与后缀不匹配
  const cv = valueOf(chips, '-c:v');
  if (cv && PREFERRED_VCODEC[ext] && cv !== 'copy' && cv !== PREFERRED_VCODEC[ext]) {
    rules.push({
      id: `codec:${ext}`,
      level: 'warn',
      text: `${cv} 配 .${ext}：浏览器常见播放器不一定认这套组合，容易得到播不动的文件。`,
      fix: { label: `换成 ${PREFERRED_VCODEC[ext]}`, setValue: [{ flag: '-c:v', value: PREFERRED_VCODEC[ext] }] },
    });
  }

  // 纯音频后缀却没丢画面
  if (AUDIO_EXT.includes(ext) && !hasFlag(chips, '-vn') && k === 'audio') {
    rules.push({
      id: 'audio:vn',
      level: 'warn',
      text: '输出是纯音频，建议加上 -vn 明确丢掉画面，否则可能得到一个「壳是音频、里面塞着视频」的文件。',
      fix: { label: '加上 -vn', add: [{ defId: 'vn', value: '' }] },
    });
  }

  // GIF
  if (ext === 'gif') {
    rules.push({
      id: 'gif:size',
      level: 'info',
      text: 'GIF 会非常占地方：一秒 12 帧、宽度 480 通常就是几十 MB 起步。建议先设宽度和帧率。',
      fix: {
        label: '按建议调整（宽 480 / 12fps）',
        add: [
          { defId: 'f:scale', value: '480:-1' },
          { defId: 'f:fps', value: '12' },
        ],
      },
    });
  }

  // 图片后缀没限制帧数
  if (IMAGE_EXT.includes(ext) && ext !== 'gif' && !hasFlag(chips, '-frames:v')) {
    rules.push({
      id: 'image:frames',
      level: 'info',
      text: '输出是图片，不加 -frames:v 1 的话 ffmpeg 默认会按视频长度吐出一整串图片文件，这里只会显示第一张。',
      fix: { label: '加上 -frames:v 1', add: [{ defId: 'frames:v', value: '1' }] },
    });
  }

  // 压缩提示：改分辨率 + 降帧率是最有效的两招，比调码率更容易估
  if (k === 'video' && !hasFilter(chips, 'scale') && !hasFlag(chips, '-b:v') && !hasFlag(chips, '-crf')) {
    rules.push({
      id: 'compress:nudge',
      level: 'info',
      text: '想让文件变小：改小分辨率（scale）和降低帧率（fps）通常比调码率更有效，画质损失也更好估。',
    });
  }

  return rules;
}
