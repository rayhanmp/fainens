#!/usr/bin/env bash
# Ship the current commit to the VPS behind fins.rayhan.id.
#
#   ./scripts/deploy-vps.sh              build, ship and start the current commit
#   ./scripts/deploy-vps.sh --with-db    ...and replace the VPS database with the local one
#   ./scripts/deploy-vps.sh --rollback   start the previously deployed version again
#   ./scripts/deploy-vps.sh --skip-build ship images already built for this commit
#
# Images are built here (the VPS is small) and streamed over SSH, so no registry login is needed.
# Every run backs up the VPS database first, into ~/fainens/backups (the last 10 are kept).
# Override the target with FAINENS_VPS, FAINENS_VPS_PORT and FAINENS_VPS_DIR.
set -euo pipefail

VPS="${FAINENS_VPS:-rayhanmp@103.134.154.154}"
VPS_PORT="${FAINENS_VPS_PORT:-2222}"
VPS_DIR="${FAINENS_VPS_DIR:-fainens}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

WITH_DB=0 ROLLBACK=0 SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --with-db) WITH_DB=1 ;;
    --rollback) ROLLBACK=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

remote() { ssh -o BatchMode=yes -p "$VPS_PORT" "$VPS" "$@"; }
step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

if [ "$ROLLBACK" = 1 ]; then
  step "Rolling back to the previously deployed version"
  remote "cd $VPS_DIR && test -s .previous-tag && tag=\$(cat .previous-tag) && FAINENS_TAG=\$tag docker compose up -d --remove-orphans && cp .deployed-tag .previous-tag.tmp && echo \$tag > .deployed-tag && mv .previous-tag.tmp .previous-tag && echo \"Now running \$tag\""
  exit 0
fi

# A deploy is the committed code: refuse uncommitted changes to tracked files.
if ! git diff --quiet HEAD --; then
  echo "Commit or stash your changes first; a deploy ships the current commit." >&2
  exit 1
fi
TAG="$(git rev-parse --short HEAD)"

if [ "$SKIP_BUILD" = 0 ]; then
  step "Building images for $TAG"
  docker build -t "fainens-frontend:$TAG" ./frontend
  docker build -t "fainens-backend:$TAG" ./backend
fi

step "Streaming images to the VPS"
docker save "fainens-frontend:$TAG" "fainens-backend:$TAG" | gzip -1 | remote 'gunzip | docker load'

step "Uploading the compose file"
remote "cat > $VPS_DIR/docker-compose.yml" < deploy/vps/docker-compose.yml

if [ "$WITH_DB" = 1 ]; then
  step "Uploading a snapshot of the local database"
  snapshot="$(mktemp -d)/fainens.db"
  # A consistent copy even while the dev server has the database open.
  (cd backend && node -e "require('better-sqlite3')('data/fainens.db', { readonly: true }).backup(process.argv[1]).then(() => console.log('snapshot ready'))" "$snapshot")
  remote "cat > $VPS_DIR/fainens.db.upload" < "$snapshot"
  rm -f "$snapshot"
fi

step "Backing up, swapping and starting $TAG on the VPS"
remote "TAG=$TAG WITH_DB=$WITH_DB VPS_DIR=$VPS_DIR bash -s" <<'REMOTE'
set -euo pipefail
cd "$HOME/$VPS_DIR"
mkdir -p backups
stamp="$(date +%Y%m%d-%H%M%S)"

# Stop whatever writes to the database before copying it.
docker compose stop backend worker >/dev/null 2>&1 || true
if [ -f data/fainens.db ]; then
  sudo cp -p data/fainens.db "backups/fainens-$stamp.db"
  [ -f data/fainens.db-wal ] && sudo cp -p data/fainens.db-wal "backups/fainens-$stamp.db-wal"
  echo "Backed up the database to backups/fainens-$stamp.db"
fi
if [ "$WITH_DB" = 1 ]; then
  sudo mv fainens.db.upload data/fainens.db
  sudo rm -f data/fainens.db-wal data/fainens.db-shm
  echo "Replaced the database with the uploaded one"
fi

[ -s .deployed-tag ] && [ "$(cat .deployed-tag)" != "$TAG" ] && cp .deployed-tag .previous-tag
FAINENS_TAG="$TAG" docker compose up -d --remove-orphans
echo "$TAG" > .deployed-tag

# Wait for the backend's own health check (migrations run on start).
for _ in $(seq 1 45); do
  status="$(docker inspect -f '{{.State.Health.Status}}' fainens-backend-1 2>/dev/null || echo starting)"
  [ "$status" = healthy ] && break
  [ "$status" = unhealthy ] && { docker compose logs --tail=60 backend; exit 1; }
  sleep 2
done
[ "$status" = healthy ] || { echo "Backend did not become healthy"; docker compose logs --tail=60 backend; exit 1; }
curl -fsS -o /dev/null http://127.0.0.1:8082/ && echo "Frontend answers on 127.0.0.1:8082"

# The disk is small: keep only the running and previous images, and the last 10 backups.
keep="$TAG $(cat .previous-tag 2>/dev/null || true)"
for repo in fainens-frontend fainens-backend; do
  docker images "$repo" --format '{{.Tag}}' | while read -r tag; do
    case " $keep " in *" $tag "*) ;; *) docker rmi "$repo:$tag" >/dev/null 2>&1 || true ;; esac
  done
done
docker rmi rayhanmp/fainens-frontend:latest rayhanmp/fainens-backend:latest >/dev/null 2>&1 || true
docker image prune -f >/dev/null
ls -1t backups/fainens-*.db 2>/dev/null | tail -n +11 | while read -r old; do sudo rm -f "$old" "$old-wal"; done
echo "Deployed $TAG"
REMOTE

step "Checking https://fins.rayhan.id"
curl -fsS -o /dev/null -w 'fins.rayhan.id answered %{http_code}\n' https://fins.rayhan.id/ || echo "Could not reach https://fins.rayhan.id from here; check nginx/Cloudflare."
