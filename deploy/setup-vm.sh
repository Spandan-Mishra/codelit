#!/usr/bin/env bash
# Codelit on a bare Ubuntu 22.04/24.04 VM (Oracle Always Free Ampere A1 qualifies).
# Run as root on a fresh VM:  sudo bash deploy/setup-vm.sh [your-domain-or-empty]
# Bare-metal (not Docker) is deliberate: the bubblewrap runner needs
# unprivileged user namespaces, which nested container sandboxes block.
set -euo pipefail

DOMAIN="${1:-}"
REPO="https://github.com/Spandan-Mishra/codelit.git"
APP_DIR="/opt/codelit"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  bubblewrap util-linux python3 g++ coreutils git curl ca-certificates \
  debian-keyring debian-archive-keyring apt-transport-https

# Node 22 (NodeSource publishes arm64 builds for Ampere A1)
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# Caddy (official repo) for automatic HTTPS when a domain is supplied
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy
fi

# Unprivileged user namespaces (required by bubblewrap; persist across reboot)
# Ubuntu 24.04 also restricts them via AppArmor — without the third line
# bwrap fails with "setting up uid map: Permission denied".
sysctl -w kernel.unprivileged_userns_clone=1 || true
sysctl -w user.max_user_namespaces=28633 || true
sysctl -w kernel.apparmor_restrict_unprivileged_userns=0 || true
printf 'kernel.unprivileged_userns_clone=1\nuser.max_user_namespaces=28633\nkernel.apparmor_restrict_unprivileged_userns=0\n' \
  > /etc/sysctl.d/99-codelit.conf

# Tiny free shapes (1 GB RAM) OOM during `next build` without swap.
if [[ -z "$(swapon --show)" ]] && awk '/MemTotal/{exit !($2 < 3145728)}' /proc/meminfo; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

id codelit >/dev/null 2>&1 || useradd --create-home --shell /bin/bash codelit

# Clone or update (create the dir as root first, then hand it to codelit)
if [[ ! -d "$APP_DIR/.git" ]]; then
  mkdir -p "$APP_DIR" && chown codelit:codelit "$APP_DIR"
  sudo -u codelit git clone "$REPO" "$APP_DIR"
fi
sudo -u codelit git -C "$APP_DIR" pull --ff-only || true

if [[ ! -f "$APP_DIR/.env.local" ]]; then
  echo "!! Create $APP_DIR/.env.local before judges use it — see DEPLOY.md"
  echo "   MODEL_API_KEY, META_MODEL_INTERROGATE, META_API_BASE, NATIVE_SESSION_SECRET"
fi

sudo -u codelit mkdir -p "$APP_DIR/data/native" "$APP_DIR/.codelit-runtime"
sudo -u codelit bash -c "cd $APP_DIR && npm ci && npm run build"

install -m 0644 "$APP_DIR/deploy/codelit.service" /etc/systemd/system/codelit.service
systemctl daemon-reload
systemctl enable codelit
systemctl restart codelit

# Oracle Cloud Ubuntu images ship a host iptables REJECT rule: opening a
# port in the Security List alone is not enough. Open it here too.
# Port 3000 stays closed publicly: Caddy (443) is the only app ingress.
for port in 22 80 443; do
  # Oracle's REJECT rule sits at line 5; inserting at 6 lands below it and
  # never matches. Always insert above it.
  iptables -C INPUT -m state --state NEW -p tcp --dport "$port" -j ACCEPT 2>/dev/null \
    || iptables -I INPUT 5 -m state --state NEW -p tcp --dport "$port" -j ACCEPT
done
if command -v netfilter-persistent >/dev/null; then
  netfilter-persistent save || true
fi

# HTTPS only when a domain points at this VM; otherwise judges use :3000.
if [[ -n "$DOMAIN" ]]; then
  sed "s/codelit.example.com/$DOMAIN/" "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
  systemctl reload caddy || systemctl restart caddy
  echo "HTTPS: https://$DOMAIN (after DNS propagates)"
else
  systemctl disable --now caddy || true
  echo "No domain given — app at http://<vm-public-ip>:3000"
fi

echo "== Canary (must NOT say \"Isolated execution is unavailable\") =="
for i in $(seq 1 15); do curl -sf -o /dev/null http://localhost:3000/ && break || sleep 2; done
curl -s -X POST http://localhost:3000/api/run -H 'Content-Type: application/json' \
  -d '{"language":"python","code":"def sum(a,b):\n return a+b","fnName":"sum","tests":[{"input":"sum(2,3)","expected":"5"}]}'
echo
curl -s -X POST http://localhost:3000/api/run -H 'Content-Type: application/json' \
  -d '{"language":"javascript","code":"function sum(a,b){return a+b}","fnName":"sum","tests":[{"input":"sum(2,3)","expected":"5"}]}'
echo
systemctl --no-pager status codelit | head -5
