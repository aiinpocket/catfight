#!/usr/bin/env bash
# Deploy catfight to the GCP VM with docker compose.
# usage: deploy/deploy.sh            (from repo root; needs gcloud auth)
# env:   PROJECT, ZONE, VM, REMOTE_DIR override defaults.
#        WAIT_MAX=600  seconds to wait for active battles to finish before restarting the app (0 = don't wait)
#        FORCE=1       restart even if players are mid-battle
set -euo pipefail

PROJECT="${PROJECT:-pressure-507503}"
ZONE="${ZONE:-asia-east1-b}"
VM="${VM:-stress}"
REMOTE_DIR="${REMOTE_DIR:-/opt/catfight}"
WAIT_MAX="${WAIT_MAX:-600}"
FORCE="${FORCE:-0}"

cd "$(dirname "$0")/.."
ARCHIVE="$(mktemp -t catfight-XXXX).tgz"
# ship the tracked source only (no node_modules, no volumes)
git archive --format=tgz -o "$ARCHIVE" HEAD
echo "archive: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"

ssh_vm() { gcloud compute ssh "$VM" --project="$PROJECT" --zone="$ZONE" --quiet --command="$1"; }

# public traffic arrives via Cloudflare Tunnel (cloudflared service on the VM -> localhost:80); no GCP firewall rule for 80/443

ssh_vm "sudo mkdir -p $REMOTE_DIR && sudo chown \$USER $REMOTE_DIR"
gcloud compute scp "$ARCHIVE" "$VM:/tmp/catfight.tgz" --project="$PROJECT" --zone="$ZONE" --quiet
# question banks are not in git: ship whatever *.json is in data/questions (existing files on the VM are kept)
BANKS=$(ls data/questions/*.json 2>/dev/null | grep -v '/e2e_' || true)
if [ -n "$BANKS" ]; then
  ssh_vm "mkdir -p $REMOTE_DIR/data/questions"
  # shellcheck disable=SC2086
  gcloud compute scp $BANKS "$VM:$REMOTE_DIR/data/questions/" --project="$PROJECT" --zone="$ZONE" --quiet
fi
ssh_vm "set -e
  if ! command -v docker >/dev/null; then
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker \$USER
  fi
  cd $REMOTE_DIR
  mkdir -p volumes/postgres volumes/caddy data/questions
  tar xzf /tmp/catfight.tgz
  if [ ! -f .env ]; then
    echo \"JWT_SECRET=\$(head -c 48 /dev/urandom | base64 | tr -d '/+=')\" > .env
    echo \"POSTGRES_PASSWORD=\$(head -c 24 /dev/urandom | base64 | tr -d '/+=')\" >> .env
    echo \"SITE_ADDRESS=:80\" >> .env
    echo 'created .env with a fresh JWT_SECRET'
  fi
  grep -q '^POSTGRES_PASSWORD=' .env || echo \"POSTGRES_PASSWORD=\$(head -c 24 /dev/urandom | base64 | tr -d '/+=')\" >> .env
  # build first (no downtime), then wait until nobody is mid-battle before swapping the app container
  sudo docker compose build
  if [ \"$FORCE\" != 1 ]; then
    waited=0
    while :; do
      active=\$(curl -s --max-time 3 http://127.0.0.1/api/health | sed -n 's/.*\"activeBattles\":\([0-9]*\).*/\1/p')
      active=\${active:-0}
      if [ \"\$active\" = 0 ]; then break; fi
      if [ \"\$waited\" -ge $WAIT_MAX ]; then
        echo \"still \$active player(s) in battle after \${waited}s; aborting (rerun with FORCE=1 to restart anyway)\"; exit 2
      fi
      echo \"\$active player(s) in battle, waiting 15s (\${waited}s/${WAIT_MAX}s)\"; sleep 15; waited=\$((waited+15))
    done
  fi
  sudo docker compose up -d
  sudo docker image prune -f >/dev/null
  sudo docker compose ps"
rm -f "$ARCHIVE"
echo "deployed. https://bank.aiinpocket.com/"
