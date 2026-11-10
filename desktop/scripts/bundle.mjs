import { build } from "esbuild";
import { execSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = resolve(desktopDir, "..");
const outDir = resolve(desktopDir, "bundle");

rmSync(outDir, { recursive: true, force: true });

console.log("Dashboard bauen ...");
execSync("npm run build -w web", { cwd: rootDir, stdio: "inherit" });

console.log("Server bündeln ...");
await build({
  entryPoints: [resolve(rootDir, "server/src/index.ts")],
  outfile: resolve(outDir, "server/dist/index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["bufferutil", "utf-8-validate", "pg-native"],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "warning",
});

cpSync(resolve(rootDir, "web/dist"), resolve(outDir, "web/dist"), { recursive: true });
cpSync(resolve(rootDir, "server/assets"), resolve(outDir, "server/assets"), { recursive: true });

console.log("Bundle fertig: desktop/bundle");
