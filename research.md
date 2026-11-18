# Cloudflare Tunnel — Research Notes

## Goal

A link only approved people can open. Laptop on → **hello world**. Laptop off → **AFK**. No card, no domain, ₹0.

```
                 ┌────────────── CLOUDFLARE (always on, free) ──────────────┐
Visitor ────────►│ Worker  demo.<you>.workers.dev   ← permanent link        │
                 │   1. tunnel_url in KV?               none ─► AFK (public)│
                 │   2. login (Basic Auth)              ✗ ─► 401            │
                 │   3. forward + X-Origin-Key ─► abc.trycloudflare.com     │
                 │   4. response has X-Origin: laptop?  no ─► AFK           │
                 └──────────────────────────────▲───────────────────────────┘
                                                │ outbound only
                 ┌────────────── LAPTOP ─────────────────┼───────────────────┐
                 │  cloudflared  quick tunnel ───┘  (docker)                │
                 │  online.sh    starts stack, URL → wrangler → KV   (Mac)  │
                 │  nginx        checks X-Origin-Key → "hello world" (docker)│
                 └──────────────────────────────────────────────────────────┘
```

## What a tunnel is

- `cloudflared` on the laptop opens an **outbound-only** connection to Cloudflare.
- You need no open ports, public IP or router changes. It works behind CG-NAT.
- Your IP stays hidden. SSL and DDoS protection come free.

## Layers

| # | Layer | Role |
|---|---|---|
| 1 | **Worker** (`*.workers.dev`) | The permanent link. If KV has no tunnel URL, it serves the AFK page to everyone. Otherwise it checks logins, forwards requests, and serves AFK when a response lacks the marker. |
| 2 | **KV** | Holds one value: `tunnel_url`. The Worker reads it; `online.sh` writes it. |
| 3 | **Quick tunnel** | `cloudflared --url http://nginx:8080` (no account). Gets a new `*.trycloudflare.com` URL each time it starts. |
| 4 | **`scripts/online.sh`** (on the Mac) | The one daemon. Startup: `docker compose up -d`. Every 30s: reads `127.0.0.1:2000/quicktunnel` and, when the URL changes, writes it with `wrangler kv key put --binding TUNNEL --remote`. Teardown (Ctrl-C / SIGTERM / SIGHUP): deletes the key, `docker compose down`. |
| 5 | **nginx** (docker) | Rejects requests without the right `X-Origin-Key` (403). Stamps every response with `X-Origin: laptop`, then returns "hello world". |

**Online:** `./scripts/online.sh`. **AFK:** stop it (Ctrl-C, close the terminal, or `pkill -f scripts/online.sh`).

## Findings

- **Zero Trust onboarding asks for a card even on the Free plan.** Access and dashboard-managed tunnels both sit behind that step.
- **Named tunnels and Worker routes need a domain on your account.** The hostname is used three times: the DNS record (pointing to the tunnel), the Worker route and the tunnel's ingress rule.
- **`<id>.cfargotunnel.com` isn't a public URL.** It only works as the target of a DNS record in your own account.
- **Quick tunnels need no account or domain**, but they get a random URL per process and are for testing only: no uptime guarantee, request limits, and Cloudflare can change them.
- **Quick tunnel URLs last as long as the `cloudflared` process.** Edge reconnects (maintenance, Wi-Fi drops) keep the URL. A process restart (reboot, Docker restart, crash) gives a new one. How long Cloudflare keeps a disconnected quick tunnel alive isn't documented.
- **`cloudflared` reports its current quick-tunnel hostname** on its metrics endpoint at `/quicktunnel`.
- **Custom Error Rules are paid-only** (Pro, $20/mo).
- **When a named tunnel is down, Cloudflare returns HTTP 530** (error 1033). A dead quick tunnel's response isn't predictable, which is why the design uses the laptop marker below.

## Decisions

- **No domain: a `workers.dev` front door, a KV pointer and a quick tunnel.** It costs ₹0, in exchange for more moving parts and quick-tunnel limits.
- **Login is in the Worker (Basic Auth), not Access.** It needs no card. One password per person, stored in the `USERS` secret as `name:sha256` entries. There's no logout: people close the browser to end their session. If `USERS` is missing, the Worker blocks everyone.
- **The AFK check comes before the login and is based only on KV.** No URL in KV means everyone sees AFK, so your online status is public. The Worker never probes the laptop before a login, so strangers cause zero traffic to it.
- **The stale-URL case is accepted.** If the laptop sleeps or dies without `online.sh` tearing down, the URL stays in KV: strangers see the login prompt instead of AFK, and logged-in visitors still get AFK at step 4. A probe-based check (`/__alive`, cached ~15s) and a heartbeat in KV (lags 2–3 min, close to the 1k writes/day limit) were both rejected as not worth it.
- **The laptop writes KV directly with its `wrangler login`.** Chosen 2026-11-18 for control: the registrar is a plain local script the owner can run, stop and read, with no Worker write endpoint. Cost: the laptop holds an account-wide Cloudflare OAuth token (in wrangler's config dir), so a compromised laptop can change anything in the account, and nothing server-side validates the URL (the script checks it matches `*.trycloudflare.com`).
  - *Ruled out:* a Worker `PUT/DELETE /__tunnel` endpoint guarded by `REGISTER_KEY`. It had a smaller blast radius (one key, validated URL) but put write logic in the Worker and hid the registrar in a container.
- **Origin key:** the `trycloudflare.com` URL is public, so nginx rejects requests without `ORIGIN_KEY`. The only way past the login is through the Worker.
- **Laptop marker:** AFK shows whenever a response lacks `X-Origin: laptop`. That covers a thrown error, a 530, a 404 or a Cloudflare error page. An nginx 502 still carries the marker, so "broken" looks different from "away".
- **One daemon, `online.sh`, owns the whole lifecycle** (2026-11-18): startup, URL updates, teardown. Online = the process is running; there is no separate registrar or down script, so "containers up but nothing registering" can't happen. Containers use `restart: on-failure`, so a crashed cloudflared comes back (the daemon picks up its new URL) but Docker starting doesn't bring the stack online without the daemon. cloudflared's metrics are on `127.0.0.1:2000` only.
  - *Check interval is 30s, not 5 min:* the check is a local HTTP call (free) and KV is written only on change, so a shorter interval just shrinks the AFK gap after a cloudflared restart.
  - *Ruled out:* the registrar as a compose container (auto-restarts with the stack, but less direct control); a separate `registrar.sh` + `down.sh` pair (two things to keep in sync).

## Secrets

| Secret | Lives in | Purpose |
|---|---|---|
| `USERS` | Worker | The login list |
| wrangler OAuth token | Laptop (wrangler config dir, from `wrangler login`) | Deploys the Worker and writes the KV entry. Account-wide. |
| `ORIGIN_KEY` | Worker + laptop `.env` (passed to nginx) | Proves a request came through the Worker |

## Cost

| Item | Cost |
|---|---|
| Worker (100k req/day), KV (100k reads, 1k writes/day), quick tunnel | ₹0 |
| Domain | Not needed |

## Security

- The tunnel itself is safe. The risk is whatever app you expose behind it.
- The Worker blocks unapproved visitors, and nginx blocks anyone who goes straight to the tunnel URL.
- Give each person their own password of at least 12 characters. To remove someone, re-run `secret put USERS` without them.
- Containers: run as non-root, mount only what's needed (`:ro`), and **never** mount `~`, `/` or `/var/run/docker.sock`.
- Keep `.env` out of git.
- The `wrangler login` token is account-wide. Run `npx wrangler logout` on a laptop you stop trusting.

## Gotchas

- If the laptop sleeps, logged-in visitors see AFK. Strangers still see the login prompt, because the stale URL is still in KV. Stop `online.sh` before leaving so everyone sees AFK. Keep the laptop awake while plugged in.
- After a restart, a new URL can take up to about 60s to reach every Cloudflare location, so a visitor may briefly see AFK.
- Going AFK has the same lag: after `online.sh` deletes the key, the Worker can keep reading the cached URL for up to ~60s (strangers see the login prompt, logged-in visitors already get AFK because the tunnel is gone).
- Path-based routing (`/app1`) breaks most single-page apps' asset paths. Use separate tunnels or hostnames when you add services.

## Routing nginx to local (non-docker) servers

nginx runs in docker, but it can proxy to apps running directly on the Mac through `host.docker.internal`. This was tested: a server bound to `127.0.0.1` on the Mac is reachable from a container, so apps can stay on `localhost`.

```
Worker ─► tunnel ─► cloudflared ─► nginx (docker) ─► host.docker.internal:3000 ─► app on the Mac
```

**The nginx config is the allowlist.** Visitors can only reach ports written into a `proxy_pass` line:

```nginx
server {
    # ...listen, marker and ORIGIN_KEY check stay as they are...

    location /notes/ { proxy_pass http://host.docker.internal:3000/; include /etc/nginx/proxy.conf; }
    location /api/   { proxy_pass http://host.docker.internal:8000/; include /etc/nginx/proxy.conf; }

    location / { return 404; }   # deny everything not listed
}
```

`proxy.conf`, shared by each location:

```nginx
proxy_set_header Host localhost;          # dev servers (e.g. Vite) reject unknown Host headers
proxy_set_header X-Origin-Key "";         # don't pass the secret to the app
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;   # websockets / hot reload
proxy_set_header Connection "upgrade";
```

**Rules**
- Hard-code every port. Never build `proxy_pass` from request data such as `$arg_port`, or a visitor can pick any port on the Mac.
- End with `location / { return 404; }` so unlisted paths reach nothing.
- Don't add `add_header` inside a location, or it stops inheriting the `X-Origin` marker.
- Expose services, not folders. Avoid file browsers, database admin UIs or anything that runs commands.

**Trade-offs compared with apps in containers**

| | App in a container | App on the Mac |
|---|---|---|
| If the app is compromised | The attacker is stuck in the container | The attacker gets your user account: files, SSH keys, browser data |
| App not running | 502 (has the marker, so it doesn't show as AFK) | Same |
| Dev workflow and hot reload | Clunkier | Native |

**Limit:** the allowlist controls what *visitors* reach, not what the *nginx container* can reach. On Docker Desktop for Mac, any container can connect to any port the Mac listens on, `127.0.0.1` included, and there's no simple per-port firewall between containers and the Mac. The risk is small, since nginx is unprivileged, read-only and runs no app code. For a hard limit, keep sensitive services off `localhost` while the stack runs, or move exposed apps into containers and reach them by service name.

**Path routing:** many single-page apps break under a sub-path, because they request `/assets/...` from the root. Set the app's base path (Vite `base`, Next `basePath`) or serve one app at `/`.

## Upgrade path

Buying a domain (~₹150/yr) gets you a named tunnel and a Worker route on `hi.yourdomain.com`. That drops KV, the registrar, the origin key and the quick-tunnel limits.

## Prerequisites

- A free Cloudflare account (no card, no domain)
- Docker Desktop (macOS)
- Node, for `npx wrangler`
