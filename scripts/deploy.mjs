import { spawnSync } from "node:child_process";

const host = process.env.DEPLOY_HOST || "bot-zentrale";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const dirty = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" }).stdout.trim();
if (dirty) {
  console.error("Es gibt Änderungen, die noch nicht committet sind. Erst committen, dann deployen.");
  process.exit(1);
}

console.log(`Code an ${host} senden ...`);
run("git", ["push", "server", "main"]);

console.log("Auf dem Server bauen und neu starten ...");
run("ssh", [host, "bash /opt/bot-zentrale/deploy/update.sh"]);
