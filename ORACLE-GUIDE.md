# Codelit on Oracle Cloud Always Free — foolproof step-by-step

Follow top to bottom. Do not skip checkpoints. Every phase ends with
what you must see before moving on.

Total time: ~20 minutes of clicking, ~10 minutes of waiting.
Cost: ₹0, as long as every resource you create says **Always Free-eligible**.

Your SSH public key (already generated on this laptop):

```text
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBVPN8dfFby5J/b6ak1kBKYl5qyvL2kUR2oyWsW3LsFf spandev@nua
```

The private key is `~/.ssh/codelit_oracle` on this laptop. Never upload,
email, paste, or commit the private key anywhere. Only the public key
above ever leaves this machine.

---

## Phase 0 — Rules that keep this free

1. Never click **Upgrade to Pay As You Go**. Not once, anywhere.
2. Only create things labelled **Always Free-eligible**.
3. If a screen shows a monthly price above ₹0 / $0, stop. Go back.
   You picked the wrong shape or size.
4. The 30-day free trial credit expiring is normal and harmless.
   Always Free resources keep running after it ends.

---

## Phase 1 — Account (skip if you already have one)

1. Go to `https://www.oracle.com/cloud/free/` → **Start for free**.
2. Enter your email → verify it from your inbox.
3. Fill in: country **India**, your real name, and the **home region
   closest to you** (e.g. Hyderabad / Mumbai / Chennai if offered).

   ⚠️ The home region can **never** be changed. Always Free ARM VMs
   can only be created in the home region, so this choice is permanent.
4. Add a payment method for identity verification. Expect a small
   temporary hold (about ₹80 / $1) that is refunded. This does **not**
   create a paid account.
5. Submit. Account provisioning takes 5–30 minutes; you get an email
   when it is ready.
6. Sign in at `https://cloud.oracle.com`. If asked, keep tenancy type
   as the default free one. Do not accept any upgrade offer.

✅ **Checkpoint:** You are in the Oracle Cloud Console and the top bar
shows your region. No banner says "Pay As You Go".

### Set the cost tripwire (2 minutes, do it now)

1. Top-right menu → **Billing & Cost Management** → **Budgets**.
2. **Create Budget** → name `codelit-guard`, amount: the smallest
   allowed (e.g. ₹100), period Monthly.
3. Add an alert rule: **Actual Spend**, 1% or the smallest threshold,
   your email as recipient.
4. Save.

✅ **Checkpoint:** Budget `codelit-guard` exists. If this ever emails
you, something paid was created — delete it the same day.

---

## Phase 2 — Create the VCN (network) with the wizard

Do this before the instance; the wizard builds everything correctly.

1. Left hamburger menu → **Networking** → **Virtual Cloud Networks**.
2. Make sure the compartment (left dropdown) is your root compartment.
3. Click **Start VCN Wizard**.
4. Choose **Create VCN with Internet Connectivity** → **Start VCN Wizard**.
5. Fill in:
   - VCN Name: `codelit-vcn`
   - Compartment: leave default (root)
   - Everything else (CIDR blocks `10.0.0.0/16`, public subnet
     `10.0.0.0/24`, private subnet): **leave the defaults untouched**.
6. Click **Next** → review → **Create**.
7. Wait until all items show green checkmarks, then **View VCN**.

✅ **Checkpoint:** `codelit-vcn` exists with two subnets, and one is
named **Public Subnet**. The wizard already created an Internet
Gateway and route rules; you do not create those by hand.

---

## Phase 3 — Open ports 80, 443, 3000 in the Security List

Still inside `codelit-vcn`:

1. On the VCN page, left side → **Security Lists**.
2. Click **Default Security List for codelit-vcn**.
3. You will see existing ingress rules. SSH (port 22) is already there.
   Do not delete anything.
4. Click **Add Ingress Rules** and add exactly these three, one at a
   time (click **+ Another Ingress Rule** between them):
   - Source Type: `CIDR`, Source CIDR: `0.0.0.0/0`, IP Protocol: `TCP`,
     Destination Port Range: `80`
   - Same again, Destination Port Range: `443`
   - Same again, Destination Port Range: `3000`
5. Click **Add Ingress Rules** at the bottom.

✅ **Checkpoint:** The ingress list now has rules for 22, 80, 443, 3000
from `0.0.0.0/0`. (A second firewall inside Ubuntu is handled by our
setup script in Phase 5 — Oracle's Ubuntu image blocks ports on the
host too, and this is the step most people miss.)

---

## Phase 4 — Create the instance (the VM)

1. Hamburger menu → **Compute** → **Instances** → **Create instance**.
2. **Name:** `codelit`
3. **Compartment:** root (default).
4. **Placement:** leave the Availability Domain it picks. Remember
   which one (AD-1 / AD-2 / AD-3) — you may need to change it later.
5. **Image:** click **Change image** → **Canonical Ubuntu** →
   **Canonical Ubuntu 24.04** → **Select image**.

   ⚠️ Do not pick "Oracle Linux". The login user and scripts differ.
6. **Shape:** click **Change shape**:
   - Select **Ampere** (ARM).
   - Select **VM.Standard.A1.Flex**.
   - Set **OCPUs: 2**, **Memory: 12 GB**.
   - It must say **Always Free-eligible**. If it does not, you selected
     the wrong shape — go back.
   - Click **Select shape**.

   Why 2/12 and not the max 4/24: the free pool allows 4 OCPU / 24 GB
   total across all ARM VMs. A 2/12 request is rejected far less
   often with "out of capacity", and Codelit runs comfortably in it.
7. **Networking:**
   - Primary network: **Select existing virtual cloud network** →
     `codelit-vcn`.
   - Subnet: **Select existing subnet** → the **Public Subnet**.
   - **Assign a public IPv4 address:** tick **Yes**.
8. **Add SSH keys:**
   - Choose **Paste public keys**.
   - Paste exactly this one line:

     ```text
     ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBVPN8dfFby5J/b6ak1kBKYl5qyvL2kUR2oyWsW3LsFf spandev@nua
     ```
9. **Boot volume:** leave everything at default. Do **not** increase
   the size. (Free pool = 200 GB total across volumes; the default
   ~47 GB is fine.)
10. **Advanced options:** click **Show advanced options** → tab
    **Management** → **User data**: select **Paste user data** and
    paste the full contents of `deploy/cloud-init.yaml` from this
    repo. You can copy it from this machine:

    ```bash
    cat ~/Work/projects/codelit/deploy/cloud-init.yaml
    ```

    It is also visible at
    `https://github.com/Spandan-Mishra/codelit/blob/master/deploy/cloud-init.yaml`

    This makes the VM install and start Codelit itself on first boot.
    It contains no secrets.
11. Review the page. Estimated cost must be **₹0 / Always Free**.
    Click **Create**.

✅ **Checkpoint:** The instance page shows **RUNNING** (green) within
1–3 minutes, with a **Public IP address**. Copy that IP down.

### If you get "Out of host capacity"

This means Oracle's free ARM pool in that Availability Domain is full.
It is not your fault and not a billing issue.

1. Terminate the failed attempt if it created anything (Instance →
   ⋮ → Terminate, tick "permanently delete attached boot volume").
2. Create again, but in Placement pick a different Availability
   Domain (AD-2, then AD-3).
3. Still failing: wait 30–60 minutes and retry, ideally early morning.
4. **Never** "fix" this by choosing an Intel/AMD (VM.Standard.E…) shape
   beyond the small Always Free allowance, and never by upgrading.

---

## Phase 5 — First login and automatic setup

Cloud-init is installing Node, bubblewrap, Python, g++, and building
Codelit. This takes **5–10 minutes** on first boot. Do not judge it
before then.

1. On this laptop:

   ```bash
   ssh -i ~/.ssh/codelit_oracle ubuntu@<PUBLIC_IP>
   ```

   Replace `<PUBLIC_IP>` with the IP from Phase 4. First time it asks
   "Are you sure you want to continue connecting?" — type `yes`.
   The login user is **`ubuntu`**, not `root`, not `opc`.
2. Watch the automatic setup finish:

   ```bash
   sudo tail -f /var/log/cloud-init-output.log
   ```

   Wait until you see the canary JSON and a `systemctl status` block,
   or `Cloud-init ... finished`. Then press `Ctrl+C`.
3. If cloud-init already finished before you logged in, just check:

   ```bash
   systemctl status codelit --no-pager | head -5
   curl -s http://localhost:3000 -o /dev/null -w "%{http_code}\n"
   ```

✅ **Checkpoint:** `codelit` service is **active (running)** and the
curl prints **200**.

What setup did for you (all in `deploy/setup-vm.sh`): installed Node 22
+ bubblewrap/python3/g++/Caddy, enabled unprivileged user namespaces,
cloned the public repo to `/opt/codelit`, built it, installed the
systemd service as the non-root `codelit` user, and opened ports
22/80/443/3000 in the host iptables (Oracle's second firewall).

### If you did NOT paste cloud-init in Phase 4

Run it by hand after SSH login:

```bash
git clone https://github.com/Spandan-Mishra/codelit.git /tmp/codelit-src
sudo bash /tmp/codelit-src/deploy/setup-vm.sh
```

Wait for the canary output at the end, then continue.

---

## Phase 6 — Add the secrets (VM only, never in GitHub)

1. Generate a fresh session secret:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Copy the 64-character output.
2. Create the env file:

   ```bash
   sudo nano /opt/codelit/.env.local
   ```

   Paste these four lines. For `MODEL_API_KEY`, copy the value from
   your local file (`cat ~/Work/projects/codelit/.env.local` on this
   laptop — do not print it anywhere public):

   ```bash
   MODEL_API_KEY=<paste your existing key>
   META_MODEL_INTERROGATE=muse-spark-1.3-contributor
   META_API_BASE=https://api.meta.ai/v1
   NATIVE_SESSION_SECRET=<paste the generated secret>
   ```

   Save in nano: `Ctrl+O`, Enter, `Ctrl+X`.
3. Fix ownership and restart:

   ```bash
   sudo chown codelit:codelit /opt/codelit/.env.local
   sudo chmod 600 /opt/codelit/.env.local
   sudo systemctl restart codelit
   ```

✅ **Checkpoint:** `systemctl status codelit` still shows active, and
`.env.local` exists. Without this file the app still works, but
interrogation silently runs in offline mode — judges must see the
live Meta model, so this step is not optional for the hackathon.

---

## Phase 7 — Verify from this laptop (do not skip)

Run these on this laptop, replacing `<PUBLIC_IP>`:

```bash
# 1. Site loads
curl -s -o /dev/null -w "home:%{http_code}\n" http://<PUBLIC_IP>:3000/

# 2. Code execution canary — Python
curl -s -X POST http://<PUBLIC_IP>:3000/api/run -H 'Content-Type: application/json' \
  -d '{"language":"python","code":"def sum(a,b):\n return a+b","fnName":"sum","tests":[{"input":"sum(2,3)","expected":"5"}]}'

# 3. Code execution canary — JavaScript
curl -s -X POST http://<PUBLIC_IP>:3000/api/run -H 'Content-Type: application/json' \
  -d '{"language":"javascript","code":"function sum(a,b){return a+b}","fnName":"sum","tests":[{"input":"sum(2,3)","expected":"5"}]}'

# 4. Live Meta interrogation (must say muse-spark, NOT offline)
curl -s -X POST http://<PUBLIC_IP>:3000/api/interrogate -H 'Content-Type: application/json' \
  -d '{"action":"question","round":0,"problemTitle":"Two Sum","statement":"Return indices of two numbers that add up to target.","code":"def two_sum(nums, target):\n seen={}\n for i,n in enumerate(nums):\n  if target-n in seen: return [seen[target-n], i]\n  seen[n]=i","fnName":"two_sum","history":[]}'
```

Pass criteria:

| # | Must show |
|---|---|
| 1 | `home:200` |
| 2 | `"passed":true`, `"engine":"local-python"` |
| 3 | `"passed":true`, `"engine":"local-js"` |
| 4 | `"engine":"muse-spark-1.3-contributor"` |

Then open `http://<PUBLIC_IP>:3000` in your browser and complete one
full **Practice → Solve Two Sum → Defend** flow with the timer running.

✅ **Checkpoint:** All four pass and the browser flow completes.
This URL is now your submission URL.

---

## Phase 8 — Optional HTTPS (free, 5 minutes)

Only if you want `https://` instead of `http://IP:3000`:

1. Register a free subdomain at `duckdns.org`, point it at `<PUBLIC_IP>`.
2. Wait 2 minutes, then on the VM:

   ```bash
   sudo bash /opt/codelit/deploy/setup-vm.sh yourname.duckdns.org
   ```

   Caddy fetches a Let's Encrypt certificate automatically.
3. Re-run the Phase 7 checks against `https://yourname.duckdns.org`.

No domain? Skip this. The IP URL is acceptable for judging.

---

## Day-to-day operations

```bash
# Logs / status / restart
sudo journalctl -u codelit -f
systemctl status codelit --no-pager
sudo systemctl restart codelit

# Deploy a new version (after git push from this laptop)
sudo -u codelit git -C /opt/codelit pull --ff-only
sudo bash /opt/codelit/deploy/setup-vm.sh        # add domain arg if using HTTPS

# Confirm you are still at ₹0
# Console → Billing & Cost Management → Cost Analysis (should show 0)
```

Never edit code directly on the VM. Change, commit, push from this
laptop, then pull on the VM.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Site times out, SSH works | Security List ports missing | Redo Phase 3 (80/443/3000 ingress) |
| Site times out, Security List correct | Host iptables (Oracle Ubuntu quirk) | Re-run `sudo bash /opt/codelit/deploy/setup-vm.sh` — it opens host ports |
| `Out of host capacity` | Free ARM pool full in that AD | Change Availability Domain, retry later. Never switch to a paid shape |
| `Permission denied (publickey)` | Wrong key, user, or permissions | User must be `ubuntu`; private key perms `600`; public key pasted must match Phase 4 |
| `Connection refused` on :3000 | Service down or still building | Wait 10 min after first boot; then `sudo journalctl -u codelit -n 100` |
| Canary says "Isolated execution is unavailable" | Namespaces blocked | `sysctl kernel.unprivileged_userns_clone user.max_user_namespaces`; re-run setup script; do **not** switch to Docker |
| Interrogation `engine: "offline"` | No key, or token budget bug (fixed in `f73de59`) | Confirm `/opt/codelit/.env.local` has `MODEL_API_KEY`, then `sudo systemctl restart codelit`; confirm VM runs latest commit |
| Budget alert email | Something paid was created | Console → Cost Analysis → find the resource → Terminate/Delete it the same day |
| `npm run build` OOM / killed | Shape shrunk below 2/12 | Recreate at 2 OCPU / 12 GB (Phase 4) |

---

## Final submission checklist

- [ ] Cost Analysis shows ₹0; budget alert set (Phase 1)
- [ ] Instance RUNNING, Always Free-eligible, public IP noted (Phase 4)
- [ ] `.env.local` present on VM, service restarted (Phase 6)
- [ ] All 4 Phase 7 checks pass; browser Practice → Defend completed
- [ ] Repo public: https://github.com/Spandan-Mishra/codelit
- [ ] Demo video recorded against the Oracle URL (see DEMO.md)
- [ ] Submitted before **Nov 4, 9:00 PM EST**, all team members listed

