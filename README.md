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
./scripts/cf-tunnel install   # once: symlinks cf-tunnel into ~/.local/bin (or $BIN_DIR)

cf-tunnel start      # online in the background; prints the tunnel + share URLs
cf-tunnel status     # online/AFK, current URL, containers
cf-tunnel stop       # clears KV, stops the stack (AFK)
cf-tunnel logs       # follow .run/online.log
```

Prefer a foreground session? `./scripts/online.sh` does the same and goes AFK on Ctrl-C or when the terminal closes.

Add or remove people: `./scripts/add-user.sh bob` or `./scripts/remove-user.sh bob`, then `./scripts/deploy-worker.sh`.

Expose a local service: add `nginx/templates/services/<name>.conf.template` with its `location` blocks (proxy to `host.docker.internal:<port>`), then `cf-tunnel restart`.

## Check

- Stack down → AFK, no login.
- Stack up, no or wrong password → 401.
- Stack up, right password → `hello world`.
- Lid closed without `cf-tunnel stop` → strangers see login; friends see AFK.
- Raw `*.trycloudflare.com` URL → 403.

`cf-tunnel logs` shows each URL it registered.
