import { defineConfig, loadEnv } from "vite";
import { copyFileSync } from "node:fs";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.MYAI_WORKER_URL || "https://myai-v3-firmansyah.pages.dev";
  const proxy = { "/api": { target, changeOrigin: true } };
  return {
    base: "./",
    server: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true,
      proxy,
    },
    preview: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true,
      proxy,
    },
    plugins: [{
      name: "copy-pages-worker",
      closeBundle() {
        copyFileSync(resolve("pages/_worker.js"), resolve("www/_worker.js"));
      },
    }],
    build: {
      outDir: "www",
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/katex/")) return "katex";
            if (id.includes("node_modules/highlight.js/")) return "highlight";
            if (id.includes("node_modules/marked/") || id.includes("node_modules/dompurify/")) return "markdown";
          },
        },
      },
    },
  };
});
