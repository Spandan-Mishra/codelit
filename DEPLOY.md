# Codelit deployment — Meta AI Global Dev Hackathon

**Deadline: Nov 4, 9:00 PM EST.** One team submission, public repo, live
product + 3-minute demo video.

## Architecture (why the host choice is constrained)

Codelit is **one** Next.js app — no database, Redis, or extra services to
deploy. State is browser localStorage plus a JSON file under `data/`.
The one hard requirement: `/api/run` executes untrusted Python/JS/C++
inside **bubblewrap + prlimit, as a non-root user, using unprivileged
user namespaces**, and it *fails closed* (HTTP 503) when namespaces are
unavailable.

Verified locally (Nov 3):

| Host shape | Code execution |
|---|---|
| Native Linux process (this laptop, systemd on a VM) | ✅ Python/JS/C++ pass |
| Plain Docker container on this host | ❌ `Isolated execution is unavailable` |
| Docker with `seccomp=unconfined` | ❌ still unavailable |

So: **serverless and container PaaS (Vercel, Netlify, Render, Fly.io,
Railway, Koyeb, HF Spaces) will very likely serve the pages but kill the
core feature** — judges could open the site yet never run code. Every
candidate host must pass the canary below before you trust it.

### Canary (run against any candidate URL)

```bash
curl -s -X POST https://<your-url>/api/run -H 'Content-Type: application/json' \
  -d '{"language":"python","code":"def sum(a,b):\n return a+b","fnName":"sum","tests":[{"input":"sum(2,3)","expected":"5"}]}'
# PASS: {"results":[{...,"passed":true}],"engine":"local-python"}
# FAIL: "Isolated execution is unavailable" / engine:"local-error" → wrong host, move to next plan
```

## Plan A — no credit card, free (try first, ~30 min)

Free *container* hosts need no card, but the canary decides. In order:

1. **Hugging Face Spaces (Docker)** — free CPU tier, 16 GB RAM, no card.
   Push this repo to a Space with `sdk: docker`; set `app_port: 3000` in
   the Space README front-matter (the Dockerfile now honors `$PORT`).
   Run the canary. Expect failure; if it passes, you are done.
2. **Render Free (Docker web service)** — no card for the free tier;
   spins down after idle, so cold starts are slow. Same canary gate.
3. If both fail the canary (likely), go straight to Plan C — do not burn
   deadline hours on container hosts.

## Plan B — Oracle Cloud Always Free VM (chosen; steps in chat + below)

Never click **Upgrade to Pay As You Go**. Create only resources labelled
**Always Free-eligible**:

1. Sign up at `oracle.com/cloud/free` → **Start for free**. Pick the home
   region closest to you — it cannot be changed later. Card is a
   verification hold only; Always Free shapes are never billed. The
   30-day $300 trial expiring does **not** kill Always Free resources.
2. Console → Compute → Instances → Create instance:
   - Name: `codelit`
   - Image: **Canonical Ubuntu 24.04**
   - Shape: change → Ampere → **VM.Standard.A1.Flex**, 2 OCPU / 12 GB
     (Always Free allows 4 OCPU / 24 GB total; 2/12 leaves headroom and
     hits fewer "out of capacity" errors — retry other availability
     domains if you get one)
   - Networking: new public subnet, **assign public IPv4**
   - SSH: paste/upload your public key (or download the generated pair
     and keep the private key safe)
   - Advanced → Management → User data: paste
     [deploy/cloud-init.yaml](deploy/cloud-init.yaml)
3. Networking → Virtual Cloud Networks → your VCN → Security Lists →
   default: add ingress rules for TCP **80, 443, 3000** from
   `0.0.0.0/0` (22 is already there). `setup-vm.sh` also opens the host
   iptables rules Oracle's Ubuntu image ships closed — both layers are
   required.
4. If you did not use cloud-init, SSH in and run:
   ```bash
   git clone https://github.com/Spandan-Mishra/codelit.git /tmp/codelit-src
   sudo bash /tmp/codelit-src/deploy/setup-vm.sh
   ```
   It installs Node 22 + bubblewrap/python3/g++/Caddy, builds, and starts
   the [systemd unit](deploy/codelit.service) as the non-root `codelit`
   user, then runs the canary.
5. Secrets on the VM only (never commit), then restart:
   ```bash
   sudo nano /opt/codelit/.env.local   # MODEL_API_KEY, NATIVE_SESSION_SECRET
   sudo systemctl restart codelit
   ```
   Fresh secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
6. No-cost guardrails: Billing → Budgets → create a budget with an alert
   at ₹1/$1 actual spend. Only ever pick shapes/boot volumes marked
   Always Free-eligible (total boot volumes ≤ 200 GB). Delete anything
   you create that lacks that label.
7. Run the canary against `http://<public-ip>:3000`, then one full
   Practice → Defend flow in the browser before recording. HTTPS:
   point a free DuckDNS subdomain at the IP and re-run
   `sudo bash deploy/setup-vm.sh your.domain` on the VM.

## Plan C — alternative if A and B both fail: your own machine + tunnel

This is the verified-working fallback, not a compromise demo: the app
already runs natively on this laptop with all runners passing.

```bash
npm ci && npm run build
npm run start -- -p 3000            # keep running (systemd --user or tmux)
cloudflared tunnel --url http://localhost:3000   # free, no card, no account for quick tunnels
```

- Cloudflare quick tunnels print a public `https://*.trycloudflare.com`
  URL. It changes on every restart, so start it once, submit that URL,
  and do not restart it or let the laptop sleep until judging ends
  (`systemctl --user` + disable sleep; keep it plugged in).
- For a stable URL, a free Cloudflare account + your own domain gives a
  named tunnel. Ngrok's free tier or Tailscale Funnel also work.
- Record the demo video against this URL (per [DEMO.md](DEMO.md)), so the
  video stays valid even if the tunnel later dies.

## Hackathon submission checklist

- [ ] **Repo is public** — currently `PRIVATE`, which fails the rules.
      `gh repo edit Spandan-Mishra/codelit --visibility public`
      `.env.local` is gitignored and no key exists in git history
      (verified Nov 3); still, rotate `MODEL_API_KEY` after the event.
- [ ] Live URL passes the canary + one full Practice → Defend flow.
- [ ] `MODEL_API_KEY` set on the host (Stage One checks Meta Model API
      use; without it the interrogator silently runs offline).
- [ ] README/demo clearly mark what was **built during the hackathon**
      (rules require it; judges disqualify unmarked pre-existing work).
      Add a "Built during the hackathon" section listing new features
      and the commit range.
- [ ] 3-minute demo video recorded against the deployed URL, link public.
- [ ] Every team member (max 4) listed on the submission page; one
      representative submits, once, before Nov 4 9:00 PM EST.
