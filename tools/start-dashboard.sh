#!/usr/bin/env bash
#
# Het dashboard starten op deze machine.
#
# Waarom een script en niet gewoon `node server.mjs`: het dashboard moet
# doorblijven draaien als je de terminal sluit, en je wilt hem kunnen herstarten
# zonder te zoeken naar het proces-id.
#
#   ./tools/start-dashboard.sh          # starten op de achtergrond
#   ./tools/start-dashboard.sh --remote # ook bereikbaar vanaf je andere machines
#
# Standaard luistert het dashboard alleen op 127.0.0.1. Dan kan niemand erbij
# behalve jij, en dat is de veilige stand. Met --remote bindt hij op alle
# interfaces; doe dat alleen als je op een privénetwerk zit zoals Tailscale.
#
set -euo pipefail

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="$(cd "$HIER/.." && pwd)"
LOG="$PROJECT/dashboard/server.log"

# Poort uit de omgeving, anders 8787.
POORT="${CAVASCP_PORT:-8787}"

# Stoppen wat er al draait, zodat je nooit twee servers hebt die om dezelfde
# poort vechten.
if pgrep -f "node server.mjs" > /dev/null 2>&1; then
  echo "  oude server stoppen…"
  pkill -f "node server.mjs" 2>/dev/null || true
  sleep 1
fi

cd "$PROJECT/dashboard"

ARGS=()
if [[ "${1:-}" == "--remote" ]]; then
  ARGS+=("--allow-remote")
  echo "  LET OP: bereikbaar vanaf andere machines op dit netwerk."
fi

nohup node server.mjs "${ARGS[@]}" > "$LOG" 2>&1 &
SERVER_PID=$!

# Wachten tot hij antwoordt. Een koude start duurt een paar seconden.
for i in $(seq 1 20); do
  if curl -s -o /dev/null "http://127.0.0.1:$POORT/" 2>/dev/null; then
    echo "  dashboard draait op http://127.0.0.1:$POORT  (pid $SERVER_PID)"
    echo "  log: $LOG"
    exit 0
  fi
  sleep 1
done

echo "  het dashboard antwoordt niet. Laatste regels van het log:"
tail -20 "$LOG"
exit 1
