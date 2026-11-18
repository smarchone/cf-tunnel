# Cloudflare Tunnel — Research Notes

## Goal

A link only approved people can open. Laptop on → **hello world**. Laptop off → **AFK**.

```
Visitor ─► Access login ─► Worker (AFK guard) ─► Tunnel ─► cloudflared ─► nginx ─► "hello world"
                               │                          (docker)       (docker)
                               └─ 530 (laptop off) ─► 🌙 AFK page
```

Login and the AFK page both run at Cloudflare's edge, so they work even when the laptop is off.

## What a tunnel is

- `cloudflared` on the laptop opens an **outbound-only** connection to Cloudflare.
- You need no open ports, public IP or router changes. It works behind CG-NAT.
- Your IP stays hidden. SSL and DDoS protection come free.

## Layers

| # | Layer | Role |
|---|---|---|
| 1 | **Access** | Login (email one-time code or Google), plus an allowlist of specific emails. Anyone else is blocked at the edge. |
| 2 | **Worker** | Passes responses through. If the tunnel returns **530** (error 1033, tunnel down), it serves the AFK page with status 503. |
| 3 | **Named tunnel** | Permanent hostname → `http://nginx:80`. Created in the Zero Trust dashboard; gives you a token. |
| 4 | **cloudflared** (docker) | Runs `tunnel run --token $TUNNEL_TOKEN`. |
| 5 | **nginx** (docker) | `return 200 "hello world"`. No host ports published. |

**Toggle:** `docker compose up -d` puts you online. `docker compose down` makes you AFK.

## Decisions

- **AFK page uses a Worker, not a Custom Error Rule.** Custom Error Rules need a paid plan (Pro, $20/mo). The Worker is free and does the same job.
- **Use a named tunnel, not a quick tunnel.** A `*.trycloudflare.com` URL changes on every restart and doesn't support Access or Workers.
- **The Worker only catches 530.** If nginx itself is down, a 502 still shows through, so "away" and "broken" look different.

## Cost

| Item | Cost |
|---|---|
| Tunnel, Access (≤50 users), Worker (100k req/day) | ₹0 |
| Domain on Cloudflare | ~₹150–900/yr |

## Security

- The tunnel itself is safe. The risk is whatever app you expose behind it.
- Access blocks unapproved visitors before they reach the laptop.
- Containers: run as non-root, mount only what's needed (`:ro`), and **never** mount `~`, `/` or `/var/run/docker.sock`.
- After login, Access sends the user's email to the app in the `Cf-Access-Authenticated-User-Email` header.

## Gotchas

- If the laptop sleeps, the page shows AFK. Keep it awake while plugged in.
- Path-based routing (`/app1`) breaks most single-page apps' asset paths. Use subdomains when you add services.

## Prerequisites

- A domain on Cloudflare
- Docker Desktop (macOS)
