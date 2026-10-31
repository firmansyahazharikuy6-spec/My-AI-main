import { defineConfig, loadEnv } from "vite";
import { copyFileSync } from "node:fs";
import { resolve } from "node:path";

export const DEFAULT_PAGES_API_ORIGIN = "https://myai-v3-firmansyah.pages.dev";

export function createApiProxy({ workerUrl, pagesApiOrigin = DEFAULT_PAGES_API_ORIGIN } = {}) {
  const usePagesApi = !workerUrl;
  const target = workerUrl || pagesApiOrigin;
  return {
    target,
    changeOrigin: true,
    rewrite: (path) => usePagesApi ? path : path.replace(/^\/api(?=\/|$)/, ""),
    configure(proxyServer) {
      proxyServer.on("error", (error, request) => {
        console.error(
          `[vite] API proxy failed for ${request.method} ${request.url} (${target}): ${error.code || error.message}. `
          + (usePagesApi
            ? "Check access to the deployed MyAI Pages API."
            : "Start it with `npm run worker:dev` or verify MYAI_WORKER_URL."),
        );
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxy = { "/api": createApiProxy({ workerUrl: env.MYAI_WORKER_URL }) };
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
        copyFileSync(resolve("pages/_headers"), resolve("www/_headers"));
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
