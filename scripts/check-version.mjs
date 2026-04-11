/**
 * Ensures repo-root `VERSION` matches `package.json` "version".
 * Bump both together on release. Run via `npm run check:version` or `npm run smoke:ci`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fromFile = readFileSync(join(root, "VERSION"), "utf8").trim();
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const fromPkg = pkg.version;

if (fromFile !== fromPkg) {
  console.error(
    `check-version: VERSION (${fromFile}) must match package.json "version" (${fromPkg}).`,
  );
  process.exit(1);
}
console.log(`check-version: OK (${fromFile})`);
