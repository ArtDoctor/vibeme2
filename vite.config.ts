import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = dirname(fileURLToPath(import.meta.url));
const appVersion = readFileSync(join(root, "VERSION"), "utf8").trim();

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  root: ".",
  publicDir: "public",
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "/ws": {
        target: "ws://127.0.0.1:8080",
        ws: true,
      },
    },
  },
});
