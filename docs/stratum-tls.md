# Stratum & getwork TLS

The pool can serve its **stratum** ports (and the optional **getwork** ports — see below)
directly over TLS, so a miner's credentials (worker name / password) and submissions are
encrypted in transit.

This is **separate from [reverse-proxy.md](reverse-proxy.md)**, which terminates TLS for the
**Website** (HTTP / SPA / JSON API). Stratum is a raw binary protocol and cannot go through
an HTTP reverse proxy, so the pool process performs the TLS itself.

## ⚠️ Miner compatibility — read this first

**Most miners do not support encrypted pool connections.** The common cpuminer / ccminer
builds only speak plaintext `stratum+tcp://` and plaintext `http://` getwork; very few
support `stratum+ssl://` (a.k.a. `stratum+tcps://`) or `https://` getwork. If you set
`tls: true` on a port, **miners without TLS support cannot connect to it at all.**

So in practice:

- Keep your **main** stratum/getwork ports **plaintext** (`tls: false`) so every miner can
  connect. Stratum's password field is conventionally unused (`-p x`) and the worker name is
  a public address, so the real exposure of a plaintext stratum port is small — the previous
  problem was only that `tls: true` was silently ignored and served plaintext, i.e. the
  config lied; that mismatch is what got fixed.
- If you want TLS, offer it on **separate, additional ports** for the few miners that support
  it — rather than converting your only ports to TLS and locking everyone else out.

The rest of this document is for operators who want to offer those TLS ports.

## Enabling TLS

Two things in each `pool_configs/<coin>.json`:

1. **`tlsOptions`** — the key/cert the pool reads (shared by every TLS port in that pool):

    ```json
    "tlsOptions": {
        "enabled": true,
        "serverKey":  "/home/POOL_USER/zny-nomp/certs/privkey.pem",
        "serverCert": "/home/POOL_USER/zny-nomp/certs/fullchain.pem",
        "ca": ""
    }
    ```

    > **Order matters.** `serverKey` is the **private key** (`privkey.pem`) and `serverCert`
    > is the **certificate chain** (`fullchain.pem`). Swapping the two makes the TLS
    > handshake fail.

2. **`tls: true`** on each port that should be encrypted:

    ```json
    "ports": {
        "3031": { "diff": 0.5, "tls": true, "varDiff": { "minDiff": 0.0, "maxDiff": 16, "targetTime": 15, "retargetTime": 60, "variancePercent": 30 } }
    }
    ```

A port with `tls: true` is served via `tls.createServer`. **If the key/cert is missing or
unreadable, the pool refuses to open that port** (and logs an error) instead of silently
downgrading to plaintext — a plaintext fallback would leak the credentials that clients send
expecting an encrypted channel. So if a TLS port never comes up, check the cert path and
permissions below.

## Certificate permissions (the important part)

The pool runs as an **unprivileged user** (e.g. `aoi`). Let's Encrypt stores certs under
`/etc/letsencrypt/{live,archive}`, and `archive` is mode `700 root`, so an unprivileged
process **cannot read them**. Note that **adding the user to a group or to sudoers does NOT
help**: the pool process's effective UID is still the unprivileged user, and `sudo` only
elevates an interactive command — not the long-running process.

The robust fix is a Let's Encrypt **deploy hook** that copies the cert into a pool-owned
directory on every renewal:

```bash
# run once, as root:
sudo install -d /etc/letsencrypt/renewal-hooks/deploy
sudo tee /etc/letsencrypt/renewal-hooks/deploy/copy-to-pool.sh >/dev/null <<'EOF'
#!/bin/bash
set -e
DOMAIN=pool.example.com          # your cert's domain
POOL_USER=aoi                    # the user the pool runs as
DEST=/home/$POOL_USER/zny-nomp/certs
install -d -o "$POOL_USER" -g "$POOL_USER" -m 700 "$DEST"
install -o "$POOL_USER" -g "$POOL_USER" -m 644 /etc/letsencrypt/live/$DOMAIN/fullchain.pem "$DEST/fullchain.pem"
install -o "$POOL_USER" -g "$POOL_USER" -m 600 /etc/letsencrypt/live/$DOMAIN/privkey.pem  "$DEST/privkey.pem"
EOF
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/copy-to-pool.sh
sudo /etc/letsencrypt/renewal-hooks/deploy/copy-to-pool.sh   # initial copy
```

Then point `tlsOptions.serverKey` / `serverCert` at `…/certs/privkey.pem` /
`…/certs/fullchain.pem`. Certbot re-runs the hook on every renewal, so the pool-readable
copy stays current; restart the pool after a renewal (or it picks up the new cert on its
next start).

## getwork over TLS

The optional getwork bridge (for getwork-only miners such as the official VIPSTARCOIN
ccminer, which can't build the qtum stratum job) uses the **same** `tls` flag and the same
`tlsOptions`. With `tls: true`, a getwork port is served over **https**:

```json
"getwork": {
    "enabled": true,
    "ports": {
        "3336": { "diff": 0.5, "tls": true, "varDiff": { "minDiff": 0.0, "maxDiff": 16, "targetTime": 15, "retargetTime": 60, "variancePercent": 30 } }
    }
}
```

Keep each getwork port's `diff` / `varDiff` / `tls` matched to the stratum port it mirrors,
so getwork miners and stratum miners are treated identically.

## Verifying

```bash
# stratum (raw TLS) — expect a cert and "Verify return code: 0 (ok)"
openssl s_client -connect POOL_HOST:3031 </dev/null 2>/dev/null \
  | grep -E "subject=|Cipher is|Verify return"

# getwork (https) — expect HTTP 401 (auth required), served over TLS
curl -sI https://POOL_HOST:3336
```

A healthy stratum TLS port reports e.g. `TLSv1.3, Cipher is TLS_AES_256_GCM_SHA384` and
`Verify return code: 0 (ok)`.

## Miner connection

- **stratum + TLS:** connect with `stratum+ssl://POOL_HOST:PORT` (or the miner's `--tls`
  option), e.g. `cpuminer -o stratum+ssl://pool.example.com:3031 -u WALLET.worker -p x`.
- **getwork + TLS:** `-o https://POOL_HOST:PORT`, e.g.
  `ccminer-x64 -a html -o https://pool.example.com:3336 -u WALLET.worker -p x`.

Also open the TLS port(s) in your firewall (e.g. `ufw allow 3031/tcp`), exactly as you would
for a plaintext stratum port.
