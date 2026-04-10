/**
 * Start game server (8080) then Vite dev (5173) for Playwright.
 * Order matters: Vite proxies /ws to 127.0.0.1:8080.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import treeKill from "tree-kill";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const viteBin = join(dirname(require.resolve("vite/package.json")), "bin/vite.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tryConnect(port) {
  const host = "127.0.0.1";
  return new Promise((resolveTry) => {
    const c = net.createConnection({ host, port }, () => {
      c.end();
      resolveTry(true);
    });
    c.on("error", () => resolveTry(false));
  });
}

async function waitForPortWhileProcessRuns(port, proc, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (proc.exitCode !== null && proc.exitCode !== 0) {
      throw new Error(`Process exited early with code ${proc.exitCode}`);
    }
    if (await tryConnect(port)) return;
    await sleep(200);
  }
  throw new Error(`Timeout waiting for 127.0.0.1:${port}`);
}

const serverTimeout = Number(process.env.E2E_SERVER_WAIT_MS ?? 300_000);
const viteTimeout = Number(process.env.E2E_VITE_WAIT_MS ?? 120_000);

const serverProc = spawn("cargo", ["run", "--manifest-path", "server/Cargo.toml"], {
  cwd: root,
  stdio: "inherit",
});

try {
  await waitForPortWhileProcessRuns(8080, serverProc, serverTimeout);
} catch (e) {
  if (serverProc.pid) treeKill(serverProc.pid, "SIGTERM");
  throw e;
}

const viteProc = spawn(
  process.execPath,
  [viteBin, "--host", "127.0.0.1", "--port", "5173", "--strictPort"],
  { cwd: root, stdio: "inherit" },
);

viteProc.on("exit", (code, signal) => {
  if (code !== 0 && code !== null) {
    console.error("e2e-serve: Vite exited", code, signal);
  }
});

try {
  await waitForPortWhileProcessRuns(5173, viteProc, viteTimeout);
} catch (e) {
  if (viteProc.pid) treeKill(viteProc.pid, "SIGTERM");
  if (serverProc.pid) treeKill(serverProc.pid, "SIGTERM");
  throw e;
}

function shutdown() {
  try {
    if (viteProc.pid) treeKill(viteProc.pid, "SIGTERM");
  } catch {
    /* ignore */
  }
  try {
    if (serverProc.pid) treeKill(serverProc.pid, "SIGTERM");
  } catch {
    /* ignore */
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await new Promise(() => {});
