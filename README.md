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
./scripts/init-env.sh            # generates REGISTER_KEY + ORIGIN_KEY into .env
./scripts/add-user.sh alice      # once per person (password ≥ 12 chars)
npx wrangler login               # free Cloudflare account, no card
./scripts/deploy-worker.sh       # deploys Worker + KV + secrets, saves WORKER_URL
```

Share `https://afk-guard.<you>.workers.dev` with your friends.

## Daily use

```sh
docker compose up -d     # online (registrar pushes the tunnel URL within ~30s)
./scripts/down.sh        # AFK for everyone
```

Add or remove people: `./scripts/add-user.sh bob` or `./scripts/remove-user.sh bob`, then `./scripts/deploy-worker.sh`.

## Check

- Stack down → AFK, no login.
- Stack up, no or wrong password → 401.
- Stack up, right password → `hello world`.
- Lid closed without `down.sh` → strangers see login; friends see AFK.
- Raw `*.trycloudflare.com` URL → 403.

`docker compose logs registrar` shows each URL it registered.
