#!/usr/bin/env bash
# Deploy catfight to the GCP VM with docker compose.
# usage: deploy/deploy.sh            (from repo root; needs gcloud auth)
# env:   PROJECT, ZONE, VM, REMOTE_DIR override defaults.
set -euo pipefail

PROJECT="${PROJECT:-pressure-507503}"
ZONE="${ZONE:-asia-east1-b}"
VM="${VM:-stress}"
REMOTE_DIR="${REMOTE_DIR:-/opt/catfight}"

cd "$(dirname "$0")/.."
ARCHIVE="$(mktemp -t catfight-XXXX).tgz"
# ship the tracked source only (no node_modules, no volumes)
git archive --format=tgz -o "$ARCHIVE" HEAD
echo "archive: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"

ssh_vm() { gcloud compute ssh "$VM" --project="$PROJECT" --zone="$ZONE" --quiet --command="$1"; }

# open 80/443 once (idempotent)
if ! gcloud compute firewall-rules describe catfight-allow-http --project="$PROJECT" >/dev/null 2>&1; then
  gcloud compute firewall-rules create catfight-allow-http --project="$PROJECT" --network=default     --direction=INGRESS --allow=tcp:80,tcp:443 --source-ranges=0.0.0.0/0 --target-tags=catfight-web --quiet
fi
gcloud compute instances add-tags "$VM" --project="$PROJECT" --zone="$ZONE" --tags=catfight-web --quiet >/dev/null

ssh_vm "sudo mkdir -p $REMOTE_DIR && sudo chown \$USER $REMOTE_DIR"
gcloud compute scp "$ARCHIVE" "$VM:/tmp/catfight.tgz" --project="$PROJECT" --zone="$ZONE" --quiet
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
  sudo docker compose up -d --build
  sudo docker image prune -f >/dev/null
  sudo docker compose ps"
rm -f "$ARCHIVE"
echo "deployed. http://$(gcloud compute instances describe "$VM" --project="$PROJECT" --zone="$ZONE" --format='value(networkInterfaces[0].accessConfigs[0].natIP)')/"
