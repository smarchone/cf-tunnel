# Migrating to a named tunnel

How to move from the quick tunnel to a named tunnel once there's a domain. The Worker stays as the login gate; the KV pointer and the registration loop go away.

## Why

| | Quick tunnel (now) | Named tunnel |
|---|---|---|
| Tunnel URL | New `*.trycloudflare.com` per `cloudflared` start | Fixed: DNS → `<tunnel-id>.cfargotunnel.com` |
| Finding the laptop | `online.sh` writes the URL to KV via wrangler | Cloudflare routes to whichever connector is up |
| After coming online | Up to ~60s of AFK while KV propagates | Live as soon as `cloudflared` connects |
| Support | Testing only, no uptime promise, concurrent-request cap | Production feature |
| Laptop holds | Account-wide wrangler OAuth token (used daily) | Tunnel credentials file, scoped to one tunnel |
| Cost | ₹0 | Domain, ~₹150/yr |

The laptop itself (sleep, Wi-Fi, ISP) stays the weakest link either way.

## Target architecture

```
                 ┌──────────── CLOUDFLARE ────────────────────────────────┐
Visitor ────────►│ Worker on route  hi.example.com/*                      │
                 │   1. login (Basic Auth)            ✗ ─► 401            │
                 │   2. fetch(same URL) + X-Origin-Key ─► origin          │
                 │      origin = DNS hi → <tunnel-id>.cfargotunnel.com    │
                 │   3. no X-Origin: laptop (e.g. 530) ─► AFK             │
                 └──────────────────────────▲─────────────────────────────┘
                                            │ outbound only
                 ┌──────────── LAPTOP ──────┼─────────────────────────────┐
                 │  cloudflared  tunnel run ┘  (docker, credentials file) │
                 │  nginx        checks X-Origin-Key → services  (docker) │
                 └────────────────────────────────────────────────────────┘
```

- The Worker and the tunnel share one hostname. A Worker's `fetch()` to its own route's hostname goes to the origin instead of re-running the Worker, so no second public hostname is needed.
- When the tunnel is down, Cloudflare answers the origin fetch with HTTP 530 (error 1033). That response has no `X-Origin: laptop`, so the existing marker check already turns it into AFK.

### What goes, what stays

| Part | Fate |
|---|---|
| KV namespace `TUNNEL`, `tunnel_url` | **Removed** |
| `online.sh` URL polling + `wrangler kv` writes | **Removed**; script becomes start/stop only |
| Daily `wrangler login` on the laptop | **Not needed** for daily use (only for deploys) |
| Metrics port `2000` / `/quicktunnel` | **Removed** |
| Worker Basic Auth, `USERS` | Stays |
| `X-Origin: laptop` marker | Stays (it's what turns 530 into AFK) |
| `ORIGIN_KEY` | Stays, see below |
| `demo.<you>.workers.dev` | Retired, or kept as a redirect to the new hostname |

**`ORIGIN_KEY`:** `research.md` lists it as droppable. With the same-hostname setup, every public request to `hi.example.com` passes through the Worker, and `<tunnel-id>.cfargotunnel.com` only resolves from your own account's DNS. So it's no longer the main defense — but it costs nothing and protects against a misconfigured route (e.g. a route pattern that misses a path, or a second DNS record pointing at the tunnel). Keep it.

## Decision: public AFK before login

Today AFK is shown to everyone when KV is empty, without any traffic reaching the laptop. Without KV the Worker can't know the laptop is offline before login. Options:

1. **Login first, AFK after (recommended).** Strangers always see the login prompt; friends see AFK when the laptop is off. Simplest, and strangers still generate zero traffic to the laptop.
2. **Keep a one-key KV flag** (`online=1`) written by `online.sh`. Restores public AFK, but brings back wrangler on the laptop for daily use — the thing this migration removes.
3. **Probe before login** (cache a 530/marker check for ~15s). Already rejected in `research.md`: unauthenticated visitors would trigger probes that reach the laptop.

## Prerequisites

- [ ] A domain added to the Cloudflare account (nameservers switched, zone **Active**).
- [ ] **Verify the card question.** `research.md` notes Zero Trust onboarding asks for a card and that dashboard-managed tunnels sit behind it. Locally-managed tunnels (`cloudflared tunnel create`, config in a local file) may not go through that step. Confirm before buying the domain, e.g. try `cloudflared tunnel login` + `create` on a throwaway zone or check the current docs.
- [ ] `cloudflared` available locally for the one-time setup (`brew install cloudflared`, or the Docker image).

## Steps

Placeholders: `example.com` = your zone, `hi.example.com` = the public hostname, `cf-tunnel` = the tunnel name.

### 1. Create the tunnel (one time)

```sh
cloudflared tunnel login                      # pick the zone; writes ~/.cloudflared/cert.pem
cloudflared tunnel create cf-tunnel           # writes ~/.cloudflared/<tunnel-id>.json
cloudflared tunnel route dns cf-tunnel hi.example.com   # proxied CNAME → <tunnel-id>.cfargotunnel.com
```

Copy the credentials into the repo's ignored folder:

```sh
mkdir -p .cloudflared
cp ~/.cloudflared/<tunnel-id>.json .cloudflared/credentials.json
```

Add to `.gitignore`:

```
.cloudflared/
```

`cert.pem` is only needed for `create`/`route`/`delete`; the running tunnel needs only `credentials.json`.

### 2. Tunnel config

New file `cloudflared/config.yml` (no secrets, tracked):

```yaml
tunnel: <tunnel-id>
credentials-file: /etc/cloudflared/credentials.json
ingress:
  - hostname: hi.example.com
    service: http://nginx:8080
  - service: http_status:404
```

### 3. `docker-compose.yml`

```yaml
  cloudflared:
    image: cloudflare/cloudflared:2026.11.1
    command: tunnel --no-autoupdate --config /etc/cloudflared/config.yml run
    volumes:
      - ./cloudflared/config.yml:/etc/cloudflared/config.yml:ro
      - ./.cloudflared/credentials.json:/etc/cloudflared/credentials.json:ro
    depends_on: [nginx]
    restart: on-failure
```

Removed: `--url`, `--metrics`, and the `127.0.0.1:2000` port mapping.

### 4. `worker/wrangler.toml`

```toml
name = "demo"
main = "worker.js"
compatibility_date = "2025-11-01"
workers_dev = false

routes = [
  { pattern = "hi.example.com/*", zone_name = "example.com" }
]
```

Removed: the `[[kv_namespaces]]` block. (Keep `workers_dev = true` for a while if friends still have the old link, and have it redirect — see step 5.)

### 5. `worker/worker.js`

Replace the KV lookup and the tunnel URL with the request's own URL:

```js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Optional: send the old link to the new hostname.
    if (url.hostname.endsWith(".workers.dev")) {
      return Response.redirect(`https://${env.HOSTNAME}${url.pathname}${url.search}`, 301);
    }

    const user = await authenticate(request, env.USERS);
    if (!user) return unauthorized();
    if (!env.ORIGIN_KEY) return text(500, "ORIGIN_KEY secret not set");

    const headers = new Headers(request.headers);
    headers.delete("authorization");
    headers.set("x-origin-key", env.ORIGIN_KEY);
    headers.set("x-auth-user", user);

    let res;
    try {
      // Same hostname as the route → goes to the tunnel origin, not back into this Worker.
      res = await fetch(url, { method: request.method, headers, body: request.body, redirect: "manual" });
    } catch {
      return afk();
    }
    if (res.headers.get("x-origin") !== "laptop") return afk(); // includes 530 / 1033 when the tunnel is down

    const out = new Response(res.body, res);
    out.headers.delete("x-origin");
    return out;
  },
};
```

- `headers.delete("host")` goes away: the Host must stay `hi.example.com` so the tunnel's ingress rule matches. nginx still overrides it to `localhost` for the apps.
- `HOSTNAME` is a plain var (`[vars] HOSTNAME = "hi.example.com"`), only needed for the redirect.
- `authenticate`, `afk`, `text`, `AFK_HTML` are unchanged; pull the 401 response into `unauthorized()`.

### 6. `scripts/online.sh`

Becomes start/stop only:

```bash
#!/usr/bin/env bash
# Online while this runs; AFK when it stops.
set -uo pipefail
cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo "Missing .env — run ./scripts/init-env.sh" >&2; exit 1; }
[[ -f .cloudflared/credentials.json ]] || { echo "Missing tunnel credentials — see named-tunnel-migration.md" >&2; exit 1; }

teardown() { trap '' INT TERM HUP; echo "going AFK…"; docker compose down; exit 0; }
trap teardown INT TERM HUP

docker compose up -d || { echo "docker compose up failed" >&2; exit 1; }
echo "online at https://hi.example.com (Ctrl-C to go AFK)"
docker compose logs -f cloudflared & wait $!
```

Optionally wrap with `caffeinate -s` so the Mac doesn't sleep while serving.

### 7. Deploy and docs

```sh
./scripts/deploy-worker.sh      # still uploads USERS and ORIGIN_KEY
```

- `deploy-worker.sh`: the `workers.dev` URL grep no longer applies; set `WORKER_URL=https://hi.example.com` in `.env` (or drop it).
- Delete the KV namespace in the dashboard (or `wrangler kv namespace delete`) once nothing reads it.
- Update `README.md` (setup + Check section) and `research.md` (Decisions, Upgrade path → done).

## Test checklist

- [ ] Stack down, no login → **401** (option 1) — not AFK anymore.
- [ ] Stack down, right password → **AFK** (Worker saw 530).
- [ ] Stack up, wrong password → **401**.
- [ ] Stack up, right password → `hello world`, immediately after `online.sh` (no ~60s lag).
- [ ] `docker compose restart cloudflared` → brief AFK at most, same URL afterwards.
- [ ] Any path on `hi.example.com` without login → 401 (the route pattern covers `/*`, so nothing reaches the tunnel unauthenticated).
- [ ] Old `demo.<you>.workers.dev` link → redirects (if kept) or 404s (if retired).
- [ ] Lid closed without stopping `online.sh` → friends see AFK once the tunnel drops.

## Rollback

The quick-tunnel setup has no dependency on the domain. To roll back: `git revert` the migration commit, `./scripts/deploy-worker.sh` (recreates the KV binding), run the old `online.sh`. The named tunnel can be left in place or removed with `cloudflared tunnel delete cf-tunnel`.

## Open questions

- Card requirement for locally-managed named tunnels (see Prerequisites) — the one thing that could block this.
- Keep `demo.<you>.workers.dev` as a redirect, or retire it?
- Public AFK: go with option 1, or is the always-visible online status worth bringing wrangler back (option 2)?
