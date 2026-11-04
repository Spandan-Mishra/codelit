#!/usr/bin/env bash
# Pull origin/master into /opt/codelit, rebuild, restart, verify, and roll
# back on failure. Invoked by GitHub Actions through a forced-command SSH
# key (see .github/workflows/deploy-oracle.yml); safe to run by hand:
#   sudo bash /opt/codelit/deploy/deploy.sh
set -Eeuo pipefail

APP_DIR="${CODELIT_APP_DIR:-/opt/codelit}"
SERVICE="${CODELIT_SERVICE:-codelit}"
BRANCH="${CODELIT_DEPLOY_BRANCH:-master}"
BACKUP_DIR="${CODELIT_BACKUP_DIR:-/var/backups/codelit}"
HEALTH_URL="${CODELIT_HEALTH_URL:-http://127.0.0.1:3000/api/health}"

log() { printf '[codelit-deploy %s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
as_app() { sudo -u codelit -- "$@"; }

log "waiting for deploy lock"
exec 9>"/run/${SERVICE}-deploy.lock"
if ! flock -n 9; then
  # A concurrent deploy (manual or a previous Actions run) holds the lock.
  # Wait for it rather than racing the build; the workflow keeps this SSH
  # session alive with ServerAliveInterval while we block.
  if ! flock -w 1800 9; then
    log "another deploy is still running; giving up"
    exit 75
  fi
fi
log "deploy lock acquired"

cd "$APP_DIR"

if [[ -n "$(as_app git status --porcelain --untracked-files=no)" ]]; then
  log "tracked working tree is dirty; refusing to deploy"
  as_app git status --short
  exit 1
fi

old_sha="$(as_app git rev-parse HEAD)"
log "current HEAD $old_sha"
as_app git fetch --prune origin "$BRANCH"
target_sha="$(as_app git rev-parse "origin/$BRANCH")"
log "target HEAD $target_sha"

health_ok() {
  curl -fsS --max-time 10 "$HEALTH_URL" >/dev/null 2>&1
}

if [[ "$old_sha" == "$target_sha" ]]; then
  if systemctl is-active --quiet "$SERVICE" && health_ok; then
    log "already at target and healthy; nothing to do"
    exit 0
  fi
  log "already at target but service is unhealthy; rebuilding in place"
fi

mkdir -p "$BACKUP_DIR"
backup="$BACKUP_DIR/pre-deploy-$(date -u +%Y%m%dT%H%M%SZ)-${old_sha:0:12}.tgz"
tar -czf "$backup" -C "$APP_DIR" data .env.local 2>/dev/null || tar -czf "$backup" -C "$APP_DIR" data
chmod 600 "$backup"
find "$BACKUP_DIR" -name 'pre-deploy-*.tgz' -type f -mtime +14 -delete || true
log "backed up runtime data to $backup"

deps_changed=0
if [[ "$old_sha" != "$target_sha" ]] && as_app git diff --quiet "$old_sha" "$target_sha" -- package.json package-lock.json; then
  deps_changed=0
else
  deps_changed=1
fi
[[ -d node_modules ]] || deps_changed=1

rollback() {
  log "rolling back to $old_sha"
  systemctl stop "$SERVICE" || true
  as_app git reset --hard "$old_sha"
  if [[ "$deps_changed" == "1" ]]; then
    as_app bash -lc "cd '$APP_DIR' && npm ci"
  fi
  as_app bash -lc "cd '$APP_DIR' && npm run build"
  systemctl start "$SERVICE"
  for _ in $(seq 1 60); do
    if health_ok; then
      log "rollback healthy at $old_sha"
      return 0
    fi
    sleep 2
  done
  log "rollback did not become healthy"
  return 1
}

deploy_failed() {
  local rc=$?
  trap - ERR
  log "deploy failed (exit $rc)"
  rollback || true
  exit "$rc"
}
trap deploy_failed ERR

if [[ "$old_sha" != "$target_sha" ]]; then
  as_app git merge --ff-only "$target_sha"
fi
if [[ "$deps_changed" == "1" ]]; then
  log "installing dependencies"
  as_app bash -lc "cd '$APP_DIR' && npm ci"
fi

# The production launcher pins the running build, but the 1 GB VM cannot
# reliably compile while also serving. Stop, build, start, then verify.
log "stopping $SERVICE for build"
systemctl stop "$SERVICE"
log "building $target_sha"
as_app bash -lc "cd '$APP_DIR' && npm run build"
log "starting $SERVICE"
systemctl start "$SERVICE"

for _ in $(seq 1 60); do
  if health_ok; then break; fi
  sleep 2
done
health_ok
log "health check passed"

canary="$(curl -fsS --max-time 60 -X POST http://127.0.0.1:3000/api/run \
  -H 'Content-Type: application/json' \
  -d '{"language":"python","code":"def sum(a,b):\n return a+b","fnName":"sum","tests":[{"input":"sum(2,3)","expected":"5"}]}')"
grep -q '"passed":true' <<<"$canary"
log "python execution canary passed"

trap - ERR
log "deploy complete: $old_sha -> $target_sha"
