import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// 项目根目录下拉来参考的 ccusage 源码（不参与构建）。
// 不能写成 "**/ccusage/**"：那样会把我们自己的 src/ccusage 也忽略掉，改了代码热更新不生效
const refSource = `${process.cwd()}/ccusage/`.replace(/\\/g, "/");

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**", (file: string) => file.replace(/\\/g, "/").startsWith(refSource)],
    },
  },
  build: {
    // 桌面应用从本地磁盘加载，单个文件大一点没关系（图表库就有几百 KB），不用为此报警告
    chunkSizeWarningLimit: 1024,
    // 两个页面：大 Dock（index.html）和小 Dock（dock.html）
    rollupOptions: {
      input: {
        main: `${process.cwd()}/index.html`,
        dock: `${process.cwd()}/dock.html`,
      },
    },
  },
}));
