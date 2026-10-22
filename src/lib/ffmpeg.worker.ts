/// <reference lib="webworker" />

/**
 * ffmpeg 内核 worker。
 *
 * 为什么要自己写这一层：@ffmpeg/ffmpeg 的 worker 固定以 type:"module" 创建，
 * 里面 importScripts 不可用、只能走 import()，而它的 UMD/ESM 双分支在这个组合下不成立；
 * 更关键的是 exec 是可变参数、进度要 setProgress、中止要 terminate worker——
 * 自己握一条消息协议，比迁就别人的兼容分支可靠。
 */

interface CoreLike {
  exec: (...args: string[]) => number;
  FS: {
    writeFile: (path: string, data: Uint8Array) => void;
    readFile: (path: string) => Uint8Array;
    unlink: (path: string) => void;
  };
  setLogger: (fn: (line: unknown) => void) => void;
  setProgress: (fn: (data: { progress: number; time?: number }) => void) => void;
}

type Request =
  | { type: 'load'; sources: string[] }
  | { type: 'run'; args: string[]; inputName: string; input: ArrayBuffer; outputName: string }
  | { type: 'unlink'; name: string }
  | { type: 'close' };

let core: CoreLike | null = null;

const post = (message: Record<string, unknown>, transfer?: Transferable[]) => {
  (self as unknown as Worker).postMessage(message, transfer ?? []);
};

/** 把 URL 内容拉成 blob: URL（core js 用） */
async function fetchAsBlobURL(url: string, type: string, on: (loaded: number, total: number) => void): Promise<string> {
  return URL.createObjectURL(new Blob([await fetchBytes(url, on)], { type }));
}

/** fetch 成字节并报进度；拿不到 content-length 就只报已下载量 */
async function fetchBytes(url: string, on: (loaded: number, total: number) => void): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 ${res.status}：${url}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  const chunks: Uint8Array[] = [];
  if (res.body) {
    const reader = res.body.getReader();
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      on(loaded, total);
    }
  } else {
    const one = new Uint8Array(await res.arrayBuffer());
    chunks.push(one);
    on(one.byteLength, total);
  }
  let size = 0;
  for (const c of chunks) size += c.byteLength;
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return merged;
}

async function loadCore(sources: string[]) {
  let lastError: unknown = null;
  for (const base of sources) {
    try {
      const jsURL = await fetchAsBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript', (loaded, total) =>
        post({ type: 'core-progress', source: base, loaded, total }),
      );
      const wasmBytes = await fetchBytes(`${base}/ffmpeg-core.wasm`, (loaded, total) =>
        post({ type: 'core-progress', source: base, loaded, total }),
      );
      const mod = (await import(jsURL)) as { default: (opts: unknown) => Promise<CoreLike> };
      if (typeof mod.default !== 'function') throw new Error('core 没有 default 导出');
      core = await mod.default({
        // 直接把 wasm 字节塞进去，绕开 locateFile / import.meta.url 那套 URL 推导：
        // 在 worker 里 import blob 模块时 import.meta.url 解析不出来，会被 isDataURI(undefined) 打断。
        wasmBinary: wasmBytes,
        mainScriptUrlOrBlob: `${jsURL}#${btoa(JSON.stringify({ wasmURL: jsURL, workerURL: jsURL }))}`,
      });
      core.setLogger((line: unknown) => {
        const entry =
          typeof line === 'string'
            ? { message: line, type: 'stderr' }
            : {
                message: String((line as { message?: unknown })?.message ?? ''),
                type: String((line as { type?: unknown })?.type ?? 'stderr'),
              };
        post({ type: 'log', text: entry.message, level: entry.type });
      });
      core.setProgress((data) => {
        const ratio = typeof data?.progress === 'number' ? Math.max(0, Math.min(1, data.progress)) : 0;
        post({ type: 'progress', ratio });
      });
      post({ type: 'ready', source: base });
      return;
    } catch (err) {
      lastError = err;
      post({ type: 'core-error', source: base, message: String(err) });
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** 两个源都失败：明确告知主线程，别让 UI 干等到超时 */

self.addEventListener('message', (event: MessageEvent<Request>) => {
  const data = event.data;
  void (async () => {
    try {
      if (data.type === 'load') {
        await loadCore(data.sources);
        return;
      }
      if (data.type === 'run') {
        if (!core) throw new Error('内核未就绪');
        core.FS.writeFile(data.inputName, new Uint8Array(data.input));
        const code = core.exec(...data.args);
        if (code !== 0) throw new Error(`ffmpeg 退出码 ${code}，看日志定位问题`);
        const out = core.FS.readFile(data.outputName);
        const copy = new Uint8Array(out.byteLength);
        copy.set(out);
        post({ type: 'done', outputName: data.outputName, size: copy.byteLength, data: copy.buffer }, [copy.buffer]);
        return;
      }
      if (data.type === 'unlink') {
        if (!core) return;
        try {
          core.FS.unlink(data.name);
        } catch {
          // 文件本来就不存在
        }
        return;
      }
      if (data.type === 'close') {
        self.close();
      }
    } catch (err) {
      if (data.type === 'load') post({ type: 'core-failed' });
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  })();
});
