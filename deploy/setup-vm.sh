#!/usr/bin/env bash
# Codelit on a bare Ubuntu 22.04/24.04 VM (Oracle Always Free ARM qualifies).
# Run as root on a fresh VM:  bash setup-vm.sh
# Bare-metal (not Docker) is deliberate: the bubblewrap runner needs
# unprivileged user namespaces, which nested container sandboxes block.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  bubblewrap util-linux python3 g++ coreutils git curl ca-certificates

# Node 22
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# Unprivileged user namespaces (required by bubblewrap; on by default on Ubuntu)
sysctl -w kernel.unprivileged_userns_clone=1 || true
sysctl -w user.max_user_namespaces=28633 || true

id codelit >/dev/null 2>&1 || useradd --create-home --shell /bin/bash codelit

if [[ ! -d /opt/codelit/.git ]]; then
  sudo -u codelit git clone https://github.com/Spandan-Mishra/codelit.git /opt/codelit
fi
cd /opt/codelit
sudo -u codelit git pull --ff-only || true

if [[ ! -f /opt/codelit/.env.local ]]; then
  echo "!! Create /opt/codelit/.env.local (MODEL_API_KEY, NATIVE_SESSION_SECRET) — see DEPLOY.md"
fi

sudo -u codelit bash -c 'cd /opt/codelit && npm ci && npm run build'

install -m 0644 deploy/codelit.service /etc/systemd/system/codelit.service
systemctl daemon-reload
systemctl enable --now codelit

# Caddy for automatic HTTPS (set a domain in deploy/Caddyfile first, or skip
# and judge over http://<vm-ip>:3000 for the demo window)
if command -v caddy >/dev/null; then
  install -m 0644 deploy/Caddyfile /etc/caddy/Caddyfile
  systemctl reload caddy || systemctl restart caddy
else
  echo "Caddy not installed — app is on :3000. For HTTPS: https://caddyserver.com/docs/install"
fi

echo "== Canary (must NOT say \"Isolated execution is unavailable\") =="
sleep 3
curl -s -X POST http://localhost:3000/api/run -H 'Content-Type: application/json' \
  -d '{"language":"python","code":"def sum(a,b):\n return a+b","fnName":"sum","tests":[{"input":"sum(2,3)","expected":"5"}]}'
echo
systemctl --no-pager status codelit | head -5
