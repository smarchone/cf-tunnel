# Cloudflare Tunnel — Research Notes

## Goal

A link only approved people can open. Laptop on → **hello world**. Laptop off → **AFK**. No card, no domain, ₹0.

```
                 ┌────────────── CLOUDFLARE (always on, free) ──────────────┐
Visitor ────────►│ Worker  afk-guard.<you>.workers.dev   ← permanent link   │
                 │   1. tunnel_url in KV?               none ─► AFK (public)│
                 │   2. login (Basic Auth)              ✗ ─► 401            │
                 │   3. forward + X-Origin-Key ─► abc.trycloudflare.com     │
                 │   4. response has X-Origin: laptop?  no ─► AFK           │
                 └──────────────────────────────▲───────────────────────────┘
                                                │ outbound only
                 ┌────────────── LAPTOP (docker compose) ┼───────────────────┐
                 │  cloudflared  quick tunnel ───┘                          │
                 │  registrar    watches tunnel URL → PUT to Worker → KV    │
                 │  nginx        checks X-Origin-Key → "hello world"        │
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
| 2 | **KV** | Holds one value: `tunnel_url`. Only the Worker reads or writes it. |
| 3 | **Quick tunnel** | `cloudflared --url http://nginx:8080` (no account). Gets a new `*.trycloudflare.com` URL each time it starts. |
| 4 | **registrar** (docker) | Every 30s, reads `cloudflared:2000/quicktunnel`. When the URL changes, it sends a `PUT` to the Worker's `/__tunnel` with `REGISTER_KEY`. |
| 5 | **nginx** (docker) | Rejects requests without the right `X-Origin-Key` (403). Stamps every response with `X-Origin: laptop`, then returns "hello world". |

**Online:** `docker compose up -d`. **AFK:** `./scripts/down.sh` (clears KV, then stops the stack). Plain `docker compose down` also ends up showing AFK.

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
- **The stale-URL case is accepted.** If the laptop closes without `down.sh`, the URL stays in KV: strangers see the login prompt instead of AFK, and logged-in visitors still get AFK at step 4. A probe-based check (`/__alive`, cached ~15s) and a heartbeat in KV (lags 2–3 min, close to the 1k writes/day limit) were both rejected as not worth it.
- **The laptop never holds a Cloudflare login or API token.** It only knows `REGISTER_KEY`, and the Worker writes to KV for it.
- **Origin key:** the `trycloudflare.com` URL is public, so nginx rejects requests without `ORIGIN_KEY`. The only way past the login is through the Worker.
- **Laptop marker:** AFK shows whenever a response lacks `X-Origin: laptop`. That covers a thrown error, a 530, a 404 or a Cloudflare error page. An nginx 502 still carries the marker, so "broken" looks different from "away".
- **The registrar runs as a container, not a script on the Mac.** It starts and stops with the stack, comes back after a restart, and reaches cloudflared's metrics over Docker's internal network only. This makes `restart: unless-stopped` safe: a new URL reaches KV within about 30–90s, and visitors see AFK in that gap.

## Secrets

| Secret | Lives in | Purpose |
|---|---|---|
| `USERS` | Worker | The login list |
| `REGISTER_KEY` | Worker + laptop `.env` | Lets the laptop update the KV entry |
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

## Gotchas

- If the laptop sleeps, logged-in visitors see AFK. Strangers still see the login prompt, because the stale URL is still in KV. Use `./scripts/down.sh` before leaving so everyone sees AFK. Keep the laptop awake while plugged in.
- After a restart, a new URL can take up to about 60s to reach every Cloudflare location, so a visitor may briefly see AFK.
- Path-based routing (`/app1`) breaks most single-page apps' asset paths. Use separate tunnels or hostnames when you add services.
- With `restart: unless-stopped`, the stack comes back online whenever Docker Desktop starts.

## Upgrade path

Buying a domain (~₹150/yr) gets you a named tunnel and a Worker route on `hi.yourdomain.com`. That drops KV, the registrar, the origin key and the quick-tunnel limits.

## Prerequisites

- A free Cloudflare account (no card, no domain)
- Docker Desktop (macOS)
- Node, for `npx wrangler`
