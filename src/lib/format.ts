/** 工具函数：格式判断、默认命名、体积/时长格式化 */

/** 容器后缀 → 浏览器 MIME。浏览器可能仍无法解码，仅用于 <video>/<audio> 的 type 提示 */
const MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  flv: 'video/x-flv',
  wmv: 'video/x-ms-wmv',
  ts: 'video/mp2t',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  gif: 'image/gif',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  bmp: 'image/bmp',
  srt: 'text/plain',
};

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i + 1).toLowerCase();
}

export function baseNameOf(name: string): string {
  const bn = name.split('/').pop() ?? name;
  const i = bn.lastIndexOf('.');
  return i === -1 ? bn : bn.slice(0, i);
}

export function mimeOf(name: string): string {
  return MIME_BY_EXT[extOf(name)] ?? 'application/octet-stream';
}

/** ffmpeg 侧输入文件名：`input.<原后缀>`，无后缀时兜底 mp4 */
export function inputNameFor(fileName: string): string {
  const ext = extOf(fileName);
  return `input.${ext || 'mp4'}`;
}

/** 输出名默认 `<上传名>_<时间戳>` */
export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function defaultOutputName(inputFileName: string): string {
  return `${baseNameOf(inputFileName)}_${stamp()}.mp4`;
}

export function withExt(name: string, ext: string): string {
  const e = ext.startsWith('.') ? ext.slice(1) : ext;
  const i = name.lastIndexOf('.');
  return (i === -1 ? name : name.slice(0, i)) + '.' + e;
}

export function kindOf(name: string): 'video' | 'audio' | 'image' | 'other' {
  const ext = extOf(name);
  if (['gif', 'png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(ext)) return 'image';
  if (['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'flv', 'wmv', 'ts'].includes(ext)) return 'video';
  if (['mp3', 'm4a', 'aac', 'wav', 'ogg', 'opus', 'flac'].includes(ext)) return 'audio';
  return 'other';
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** 秒 → 00:00:00 */
export function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '--:--';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

/** 库 flag（去掉 -）→ 唯一 id，用于「同一个 key 只能有一个值」这类判断 */
export function flagKey(flag: string | undefined): string {
  if (!flag) return '';
  return flag.replace(/^-+/, '');
}
