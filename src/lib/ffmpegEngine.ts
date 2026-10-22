/** 单线程 ffmpeg core，不需要 COOP/COEP，纯静态部署即可。
 *  用 dist/esm：worker 是 module worker，内部只能靠 import() 拿 core，
 *  dist/umd 是 UMD 包装、没有 export default，会直接报 failed to import ffmpeg-core.js。
 */
export const CORE_SOURCES = [
  'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm',
  'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm',
];

export type LogListener = (line: { text: string; type: string }) => void;

export interface CoreLoadState {
  source: string;
  loaded: number;
  total: number;
}

interface Req {
  type: 'load' | 'run' | 'unlink' | 'close';
  sources?: string[];
  args?: string[];
  inputName?: string;
  outputName?: string;
  input?: ArrayBuffer;
  name?: string;
}

type Phase = 'idle' | 'loading-core' | 'ready' | 'running';

/**
 * 引擎：自己持一个 worker 跑内核。
 * 要点：中止 = terminate worker，之后这个 worker 就废了，必须新建一个并重新 load
 * （浏览器有缓存，第二次会很快）。
 */
class Engine {
  private worker: Worker | null = null;
  private phase: Phase = 'idle';
  private dead = false;
  private progressRatio = 0;
  private log: LogListener = () => {};
  private core: CoreLoadState | null = null;
  /** abort() 时用来把挂起的 run() 唤醒，否则 worker 被杀后那个 promise 永远不会落地 */
  private rejectPending: ((err: Error) => void) | null = null;

  get status(): Phase {
    return this.phase;
  }

  get progress(): number {
    return this.progressRatio;
  }

  get lastCore(): CoreLoadState | null {
    return this.core;
  }

  attach(log: LogListener) {
    this.log = log;
  }

  private spawn() {
    this.worker = new Worker(new URL('./ffmpeg.worker.ts', import.meta.url), { type: 'module' });
    this.core = null;
    this.worker.addEventListener('message', (event: MessageEvent) => {
      const data = event.data;
      if (data.type === 'core-progress') {
        this.core = { source: data.source, loaded: data.loaded, total: data.total };
      } else if (data.type === 'core-error') {
        this.log({ text: `内核加载失败（${data.source}）：${data.message}，换下一个源`, type: 'stderr' });
      } else if (data.type === 'ready') {
        this.phase = 'ready';
        this.log({ text: `内核就绪（${data.source}）`, type: 'info' });
      } else if (data.type === 'core-failed') {
        this.phase = 'idle';
        this.log({ text: `内核加载失败（两个源都不通）：${String(data.message ?? '')}`, type: 'stderr' });
      } else if (data.type === 'log') {
        // emscripten 正常退出也会打一行 Aborted()，纯噪声
        if (String(data.text).trim() === 'Aborted()') return;
        this.log({ text: String(data.text), type: String(data.level ?? '') });
      } else if (data.type === 'progress') {
        this.progressRatio = data.ratio;
      } else if (data.type === 'error') {
        this.log({ text: `worker 错误：${data.message}`, type: 'stderr' });
      }
    });
    this.worker.addEventListener('error', (event) => {
      this.log({ text: `worker 崩溃：${String(event.message ?? event)}`, type: 'stderr' });
    });
    this.core = { source: 'connecting', loaded: 0, total: 0 };
  }

  private send(req: Req, transfer?: Transferable[]) {
    const w = this.worker;
    if (!w) throw new Error('worker 不存在，请重新运行');
    w.postMessage(req, transfer ?? []);
  }

  /** 确保内核就绪。dead（上次被中止）时重建 worker。 */
  async ensureCore(): Promise<void> {
    const now: Phase = this.status;
    if (now === 'loading-core') return;
    if (now === 'ready' && this.worker) return;
    if (this.dead) {
      this.worker?.terminate();
      this.worker = null;
      this.dead = false;
    }
    if (!this.worker) this.spawn();
    this.phase = 'loading-core';
    this.send({ type: 'load', sources: CORE_SOURCES });
    // 就绪与否由 ready / core-failed 消息驱动，这里等状态落地
    await this.waitFor((s) => s === 'ready' || s === 'idle', 900000);
    const settled: Phase = this.status;
    if (settled !== 'ready') throw new Error('内核加载失败：两个 CDN 源都没通，看上方日志。');
  }

  private waitFor(pred: (phase: Phase) => boolean, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        if (pred(this.phase)) {
          resolve();
          return;
        }
        if (Date.now() - started > timeoutMs) {
          reject(new Error('等待内核就绪超时'));
          return;
        }
        window.setTimeout(tick, 120);
      };
      tick();
    });
  }

  async run(
    args: string[],
    inputName: string,
    input: File | Blob,
    outputName: string,
  ): Promise<Uint8Array<ArrayBuffer>> {
    if (this.phase !== 'ready') throw new Error('内核未就绪，请先运行一次');
    const buffer = await input.arrayBuffer();
    this.phase = 'running';
    this.progressRatio = 0;

    const done = new Promise<{ size: number; buffer: ArrayBuffer }>((resolve, reject) => {
      this.rejectPending = reject;
      const onMessage = (event: MessageEvent) => {
        const data = event.data;
        if (data.type === 'done') {
          this.cleanupPending();
          this.worker?.removeEventListener('message', onMessage);
          resolve({ size: data.size, buffer: data.data as ArrayBuffer });
        } else if (data.type === 'error') {
          this.cleanupPending();
          this.worker?.removeEventListener('message', onMessage);
          reject(new Error(String(data.message)));
        }
      };
      this.worker?.addEventListener('message', onMessage);
    });

    this.send({ type: 'run', args, inputName, input: buffer, outputName }, [buffer]);
    const result = await done;
    if (!this.dead) this.phase = 'ready';
    return new Uint8Array(result.buffer);
  }

  /** 让 worker 删掉临时文件，失败无所谓 */
  cleanup(...names: string[]) {
    if (!this.worker) return;
    for (const name of names) {
      if (name) this.send({ type: 'unlink', name });
    }
  }

  private cleanupPending() {
    this.rejectPending = null;
  }

  /** 中止：worker 一杀，实例就废了，下次必须重新 load */
  abort() {
    if (this.phase !== 'running' && this.phase !== 'loading-core') return;
    // 杀掉 worker 就不会有 done/error 消息回来，必须把挂起的 run() 唤醒
    this.rejectPending?.(new Error('已中止'));
    this.rejectPending = null;
    try {
      this.worker?.terminate();
      this.log({ text: '已中止。内核被强制关掉，下次运行需要重新加载（浏览器有缓存会很快）', type: 'stderr' });
    } catch {
      // terminate 本身可能抛错，忽略
    }
    this.worker = null;
    this.dead = true;
    this.phase = 'idle';
    this.progressRatio = 0;
  }
}

export const engine = new Engine();
