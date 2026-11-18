# cf-tunnel

A permanent link that shows **hello world** when my laptop is online and **AFK** when it isn't. No domain, no card.

```
no URL in KV                          ─► AFK   (everyone)
URL ─► login ✗                        ─► 401
URL ─► login ✓ ─► no marker           ─► AFK   (laptop not connected)
URL ─► login ✓ ─► X-Origin: laptop    ─► hello world
```

See `research.md` for the design and decisions.

## One-time setup

```sh
./scripts/init-env.sh            # generates ORIGIN_KEY into .env
./scripts/add-user.sh alice      # once per person (password ≥ 12 chars)
npx wrangler login               # free Cloudflare account, no card 
                                 #    (online.sh reuses this login)
./scripts/deploy-worker.sh       # deploys Worker + KV + secrets, saves WORKER_URL
```

Share `https://demo.<you>.workers.dev` with your friends.

## Daily use

```sh
./scripts/online.sh      # starts the stack, registers the URL; online while it runs
                         # Ctrl-C (or close the terminal) → clears KV, stops the stack (AFK)
```

Add or remove people: `./scripts/add-user.sh bob` or `./scripts/remove-user.sh bob`, then `./scripts/deploy-worker.sh`.

Expose a local service: add `nginx/templates/services/<name>.conf.template` with its `location` blocks (proxy to `host.docker.internal:<port>`), then restart `online.sh`.

## Check

- Stack down → AFK, no login.
- Stack up, no or wrong password → 401.
- Stack up, right password → `hello world`.
- Lid closed without stopping `online.sh` → strangers see login; friends see AFK.
- Raw `*.trycloudflare.com` URL → 403.

`online.sh` prints each URL it registered.
