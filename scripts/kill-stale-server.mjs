/**
 * Terminate any running vibeme2-server so Cargo can overwrite the binary (Windows locks the .exe).
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function killStaleServerProcess() {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      execFile(
        "taskkill",
        ["/F", "/IM", "vibeme2-server.exe"],
        { windowsHide: true },
        () => resolve(),
      );
    } else {
      execFile("pkill", ["-x", "vibeme2-server"], { windowsHide: true }, () => resolve());
    }
  });
}

export async function killStaleServerAndWaitForUnlock() {
  await killStaleServerProcess();
  await sleep(process.platform === "win32" ? 400 : 100);
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  await killStaleServerAndWaitForUnlock();
}
