import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig(({ mode }) => {
  // The hub's settings live in the repo-root .env (Bun only auto-loads .env from apps/web here).
  const env = { ...loadEnv(mode, repoRoot, ""), ...process.env };
  const hub = env.HUB_DEV_URL || `http://127.0.0.1:${env.HUB_PORT || 8787}`;
  // Not Vite's default 5173: other dev servers on this PC use 5173/5174. strictPort = fail loudly instead of hopping ports.
  const port = Number(env.WEB_DEV_PORT || 5180);

  return {
    plugins: [vue(), tailwindcss()],
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
      proxy: {
        "/api": { target: hub },
        "/ws": { target: hub.replace(/^http/, "ws"), ws: true },
      },
    },
    // Phaser (~1.2 MB) is its own lazy chunk, loaded only when the office view opens.
    build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1300 },
  };
});
