#!/bin/sh
set -eu
# Run from the deploy directory after reviewing both pinned branch revisions.
test "$(id -u)" -eq 0 || { echo 'Run this preparation step as root.'; exit 1; }
test -f ../../../muke/portal/index.html
test -f ../../../muke/data/jobs.json
test -f ../../../muke/data/manual.json
install -d -m 0750 -o 1000 -g 1000 /var/lib/muke-drafts
install -d -m 0750 -o 1000 -g 1000 /var/lib/muke
if [ ! -e /var/lib/muke/seed ]; then
  install -d -m 0750 -o 1000 -g 1000 /var/lib/muke/seed
  cp -a ../../../muke/data/. /var/lib/muke/seed/
  chown -R 1000:1000 /var/lib/muke/seed
  chmod -R go-rwx /var/lib/muke/seed
fi
if [ ! -e .env ]; then
  install -m 0600 env.example .env
fi
docker compose config --quiet
docker compose up -d --build app sync
curl --fail --silent --show-error --retry 30 --retry-all-errors --retry-delay 1 http://127.0.0.1:8080/healthz
printf '\nPreview listens only on server loopback. No DNS or firewall change was made.\n'
