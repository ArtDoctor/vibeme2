/**
 * Headless smoke test:
 *   1. Unit tests (`npm run test`).
 *   2. Production build (`npm run build` → tsc + vite build).
 *   3. Boot `vite preview` on a private port.
 *   4. Verify GET / returns 2xx.
 *
 * Cross-platform — pure Node, no curl/bash. Used in CI and locally after any
 * substantive change. See docs/RULES.md.
 */
import { execSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const viteBin = join(dirname(require.resolve("vite/package.json")), "bin/vite.js");
const port = Number(process.env.SMOKE_PORT ?? 4173);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForOk() {
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  return false;
}

let preview;
try {
  execSync("npm run test", { cwd: root, stdio: "inherit", shell: true });
  execSync("npm run build", { cwd: root, stdio: "inherit", shell: true });

  preview = spawn(
    process.execPath,
    [viteBin, "preview", "--host", "127.0.0.1", "--port", String(port)],
    { cwd: root, stdio: "inherit" },
  );

  preview.on("error", (err) => {
    console.error("smoke-ci: failed to start preview:", err);
    process.exitCode = 1;
  });

  const ok = await waitForOk();
  if (!ok) {
    console.error(`smoke-ci: timed out waiting for preview on port ${port}`);
    process.exitCode = 1;
  } else {
    console.log("smoke-ci: OK (GET / returned 2xx)");
  }
} finally {
  if (preview && !preview.killed) {
    preview.kill();
  }
}

process.exit(process.exitCode ?? 0);
