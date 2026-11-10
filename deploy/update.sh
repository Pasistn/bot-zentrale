#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
source ~/.nvm/nvm.sh >/dev/null

NODE=/usr/local/bin/bot-zentrale-node
BACKUPS=data/backups
KEEP=14

if [ -f data/bot.db ]; then
  mkdir -p "$BACKUPS"
  target="$BACKUPS/bot-$(date +%Y%m%d-%H%M%S).db"
  "$NODE" --disable-warning=ExperimentalWarning -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.argv[1], { readOnly: true });
    db.exec(`VACUUM INTO '"'"'${process.argv[2]}'"'"'`);
  ' data/bot.db "$target"
  echo "Sicherung: $target"
  ls -1t "$BACKUPS"/bot-*.db | tail -n +$((KEEP + 1)) | xargs -r rm --
fi

npm ci --no-audit --no-fund --loglevel=error
npm run build --silent

sudo systemctl restart bot-zentrale
sleep 4
if systemctl is-active --quiet bot-zentrale; then
  echo "Bot läuft, Stand $(git log -1 --format='%h %s')"
else
  sudo journalctl -u bot-zentrale -n 30 --no-pager -o cat
  exit 1
fi
