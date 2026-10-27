#!/usr/bin/env bash
# Zet de workspace "Idee om rijk te worden" terug en start DSH opnieuw.
# Nodig omdat DSH bij herstart zijn eigen lijst terugschrijft.
set -euo pipefail

cd "$HOME/cavascp"

echo "--- DSH stoppen ---"
sudo systemctl stop dsh-web
sleep 2

echo "--- workspace terugzetten ---"
python3 tools/dsh-workspace.py "$HOME/Idee om rijk te worden" "Idee om rijk te worden"

echo "--- DSH starten ---"
sudo systemctl start dsh-web
sleep 5
echo "service: $(systemctl is-active dsh-web)"

echo
python3 tools/dsh-workspaces.py
