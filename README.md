# ffmpeg-playground

在浏览器里拼装并运行 ffmpeg 命令的小工具。素材只在本地处理，不上传任何服务器。

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 纯静态产物在 dist/，直接丢任何静态托管即可
npm test           # 单元测试（vitest）
npm run e2e        # 真 Chromium 端到端冒烟（需要 dev server 在跑）
```

技术栈：Vite + React + TypeScript + dnd-kit。解码内核是 ffmpeg.wasm **单线程** core，运行时从 CDN 拉取。

## 目标用户与取舍

给「不会 ffmpeg 的人也能一次做对」用，但命令可以完全自由编辑——懂的人直接用，不懂的人靠配方和参数面板。

对应到实现上的几个明确取舍：

| 决定 | 为什么 |
| --- | --- |
| 命令预览**只读 + 可复制**，另给一个「自由输入」入口 | 开了可编辑原始命令框，chip 只是「某种输入方式之一」；现在的做法是两条路，但只有一份真正的状态（chip 列表），切过去时会重新解析回来 |
| chip 自由排序，不做三段式 | 拼错了 ffmpeg 会报错，报错信息原文给出。没有为了「防呆」引入输入/输出段和吸附逻辑 |
| 素材名/输出名是可插拔的 chip，不插就自动放好 | 素材自动放最前面，输出自动放末尾；插入后用户自己决定位置 |
| 后缀与编码器冲突**只提示、不静默改写**，给一键修复 | 静默换编码器会让人搞不清自己下了什么命令 |
| 单例参数重复出现只提示，不拦截 | 规则少而准，剩下的交给 ffmpeg 自己说 |
| 过滤 emscripten 的 `Aborted()` 噪声 | 正常退出也会打这一行，没有信息量 |

## 交互要点

- **素材**：点选或拖入单个本地文件，自动映射为 `input.<原后缀>`。
- **快速配方**：压缩 / 截取 / 提取音频 / 转 GIF / 720p。点下去只填参数，不直接跑。
- **参数编辑区**：chip 构建器。
  - `+ 添加参数` 弹窗：首屏固定 12 项高频，下面一个「全部」按官方分类分组、可搜索，每项带中文注释、枚举值点选或自定义、不会填的给灰字示例。
  - 开关参数（`-an`、`-y`、`-shortest`）插进去就生效，不取值。
  - 滤镜自动合并进 `-vf` / `-af` 链，按 chip 顺序逗号连接；面板不提供裸 `-vf`，从源头消灭双链冲突。
  - **拖拽排序只在右侧手柄上响应**（长按 180ms 激活）：chip 本体点击是「编辑」。面板没有提供「整块可拖」，因为在 375px 上和页面滚动天然打架，误拖比拖不动更烦。溢出菜单里另给「上移 / 下移」作为精确操作兜底。
- **命令预览**：只读 + 复制；「自由输入」可改，确认后按空格拆成参数重新解析。
- **运行**：进度（内核下载进度 / 编码进度）、日志、中止。完成后页面内预览（视频/音频/GIF/图片）并提供下载，不自动下载。
- 浏览器播不了的格式（mkv / avi / flv）给一句说明，下载链接照给。

## 架构

```
src/
  App.tsx                 状态编排：素材 / chip 列表 / 输出名 / 运行状态机
  types.ts                Chip、库定义、规则项
  lib/
    params.ts             参数与滤镜库：12 项高频 + 全部页约 60 项，带中文注释
    recipes.ts            5 个快速配方
    command.ts            chip ⇄ 命令参数（拼装、自由输入回解析、分词）
    rules.ts               温和提示规则（单例重复、后缀/编码器、-ss 位置…）
    format.ts              默认命名后缀映射、mime、字节/时长格式化
    ffmpegEngine.ts       主线程引擎：worker 生命周期、状态机、进度、中止
    ffmpeg.worker.ts      内核 worker：下载 core、编译、writeFile/exec/readFile
  components/             FilePicker / ChipList / CommandBar / OutputBar / ParamPanel / ResultPanel / Modal / icons
tests/                    command / recipes / 复刻实测链路 的单元测试
scripts/                  e2e 冒烟 + core 探针（开发期诊断用）
```

内核的接线方式（`ffmpeg.worker.ts`）值得单独说，这里踩过坑：

- worker 固定 `type: "module"`，里面**没有** `importScripts`，只能走 `import()`。
- `@ffmpeg/core` 的 `dist/umd` 是 UMD 包装，没有 `export default`，被 module worker `import()` 后 `.default` 是 `undefined` → 报 `failed to import ffmpeg-core.js`。**必须用 `dist/esm`**。
- 这个 build 的 `locateFile` 会解析 `mainScriptUrlOrBlob` 里的 **base64 JSON**（`btoa`，不是明文 JSON）。
- 在 worker 里 `import(blobURL)` 时 `import.meta.url` 推导不出 wasm 路径，所以直接把 wasm 字节用 `wasmBinary` 传进去，绕开整条 URL 解析链。
- `exec` 是**可变参数**：`core.exec('-i', 'a.wav', 'b.wav')`，传数组会炸。
- `Module.DEFAULT_ARGS` 已经含 `-nostdin -y`。
- 中止 = `worker.terminate()`；这个 worker 就此作废，下次必须新建并重新 `load()`。浏览器 HTTP 缓存命中时重载约 1.5s（实测），不是重新下 32MB。

## 已验证

`npm run e2e` 在真 Chromium 里跑通：

- 上传素材 → 提取音频 → mp3 80KB，页面内 audio 预览
- 压缩配方 → mp4 359KB，页面内 video 预览
- 后缀切 .webm → 编码器冲突提示出现 → 一键换成 libvpx-vp9
- 自由输入 → 解析回 chip → 命令正确重拼
- 中止：0.6s 内中止，出现提示，运行按钮恢复
- 中止后再跑：1.5s 出结果（内核走缓存）

单测覆盖：命令拼装（输入/输出位置、滤镜链合并、`-ss` 相对位置）、自由输入往返、规则触发、配方与后缀。

## GitHub Pages 部署

Workflow 已写好（`.github/workflows/deploy.yml`）：push 到 main 自动跑 `npm install` → `npm test` → `npm run build` → `touch dist/.nojekyll` → `actions/deploy-pages@v4`。

`base: './'` 保证子路径（`user.github.io/ffmpeg-playground/`）下资源不会 404，换仓库名也不用改配置。

**还需要在仓库网页上手动的两步**（本机没有 gh 凭据，且 MCP 拒绝了 `.github/` 路径写入）：

1. 把 `.github/workflows/deploy.yml` 加到仓库（网页 Add file → Create new file）
2. Settings → Pages → Build and deployment → Source 选 **GitHub Actions**

---

## 已知边界

- 输入文件 2GB 是 ffmpeg.wasm 的硬上限，超过直接拦下；超过 400MB 会先警告。
- 单线程 core：一次只吃一个核心，高分辨率 + 慢预设会等很久。
- vp9 / 720p 以上重编码在浏览器内存里比较吃力，压缩配方默认走 libx264。
- 部分浏览器播不了 mkv/avi/flv 的预览，但下载下来的文件本身是好的。
