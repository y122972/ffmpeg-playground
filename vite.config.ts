import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base 用相对路径：部署到 GitHub Pages 子路径（如 /ffmpeg-playground/）时资源不会 404，
// 换仓库名也不需要改这里。本地 dev 不受影响。
export default defineConfig({
  plugins: [react()],
  base: './',
})
