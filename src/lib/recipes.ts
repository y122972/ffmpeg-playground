import type { Chip } from '../types';
import { chipFromDef } from './command';
import { DEF_MAP } from './params';
import { withExt } from './format';

export interface Recipe {
  id: string;
  label: string;
  hint: string;
  /** 生成的参数 chip。不含输入/输出名——交给 buildCommand 自动放置：
   *  输入自动放最前，输出自动放末尾。
   */
  chips: () => Chip[];
  /** 输出后缀变化 */
  ext?: string;
}

/** 5 个快速配方。点下去只填参数，不直接跑——你能先看命令再决定。 */
export const RECIPES: Recipe[] = [
  {
    id: 'compress',
    label: '压缩',
    hint: '宽 1280 + CRF 28 + 音频 128k，体积通常能掉 70% 以上',
    ext: 'mp4',
    chips: () => [
      chipFromDef(DEF_MAP['c:v'], 'libx264'),
      chipFromDef(DEF_MAP['crf'], '28'),
      chipFromDef(DEF_MAP['b:a'], '128k'),
      chipFromDef(DEF_MAP['f:scale'], '1280:-1'),
    ],
  },
  {
    id: 'cut',
    label: '截取',
    hint: '从 00:00:10 起，取 30 秒。-ss 在素材后面是精确跳那一帧，比快速跳转慢一点但准',
    ext: 'mp4',
    chips: () => [
      chipFromDef(DEF_MAP['ss'], '00:00:10'),
      chipFromDef(DEF_MAP['t'], '00:00:30'),
      chipFromDef(DEF_MAP['c:v'], 'copy'),
      chipFromDef(DEF_MAP['c:a'], 'copy'),
    ],
  },
  {
    id: 'audio',
    label: '提取音频',
    hint: '丢掉画面，音频用 libmp3lame 128k 单声道，后缀自动改 .mp3',
    ext: 'mp3',
    chips: () => [
      chipFromDef(DEF_MAP['vn'], ''),
      chipFromDef(DEF_MAP['c:a'], 'libmp3lame'),
      chipFromDef(DEF_MAP['b:a'], '128k'),
      chipFromDef(DEF_MAP['ac'], '1'),
    ],
  },
  {
    id: 'gif',
    label: '转 GIF',
    hint: '宽 480 + 12fps。GIF 会很大，超出预期是正常的',
    ext: 'gif',
    chips: () => [
      chipFromDef(DEF_MAP['f:scale'], '480:-1'),
      chipFromDef(DEF_MAP['f:fps'], '12'),
    ],
  },
  {
    id: '720p',
    label: '720p',
    hint: 'H.264 + yuv420p（浏览器最好播）+ 缩放 1280×720 + faststart',
    ext: 'mp4',
    chips: () => [
      chipFromDef(DEF_MAP['c:v'], 'libx264'),
      chipFromDef(DEF_MAP['crf'], '23'),
      chipFromDef(DEF_MAP['pix_fmt'], 'yuv420p'),
      chipFromDef(DEF_MAP['f:scale'], '1280:720'),
      chipFromDef(DEF_MAP['c:a'], 'aac'),
      chipFromDef(DEF_MAP['b:a'], '128k'),
      chipFromDef(DEF_MAP['movflags'], '+faststart'),
    ],
  },
];

/** 配方应用后的 chip 列表 + 输出名。chip 里不含输入/输出名，由 buildCommand 自动放置。 */
export function applyRecipe(recipe: Recipe, outputName: string): {
  chips: Chip[];
  outputName: string;
} {
  return {
    chips: recipe.chips(),
    outputName: recipe.ext ? withExt(outputName, recipe.ext) : outputName,
  };
}
