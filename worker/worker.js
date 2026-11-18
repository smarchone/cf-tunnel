// Front door at afk-guard.<you>.workers.dev
//
//   no tunnel_url in KV               → AFK   (everyone)
//   tunnel_url ─► login ✗             → 401
//   tunnel_url ─► login ✓ ─► forward  → no X-Origin marker → AFK
//                                     → marker             → laptop's response
//
// The laptop's registrar keeps tunnel_url current via PUT/DELETE /__tunnel.

const KEY = "tunnel_url";
const TUNNEL_URL = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/__tunnel") return register(request, env);

    const tunnel = await env.TUNNEL.get(KEY);
    if (!tunnel) return afk();

    const user = await authenticate(request, env.USERS);
    if (!user) {
      return new Response("Login required\n", {
        status: 401,
        headers: {
          "www-authenticate": 'Basic realm="hi", charset="UTF-8"',
          "cache-control": "no-store",
        },
      });
    }
    if (!env.ORIGIN_KEY) return text(500, "ORIGIN_KEY secret not set");

    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("authorization"); // laptop never sees passwords
    headers.set("x-origin-key", env.ORIGIN_KEY);
    headers.set("x-auth-user", user);

    let res;
    try {
      res = await fetch(new URL(url.pathname + url.search, tunnel), {
        method: request.method,
        headers,
        body: request.body,
        redirect: "manual",
      });
    } catch {
      return afk(); // tunnel hostname gone
    }
    if (res.headers.get("x-origin") !== "laptop") return afk(); // someone else answered

    const out = new Response(res.body, res);
    out.headers.delete("x-origin");
    return out;
  },
};

// PUT body=https://abc.trycloudflare.com → store; DELETE → clear (AFK for everyone).
async function register(request, env) {
  const auth = request.headers.get("authorization") || "";
  if (!env.REGISTER_KEY || !safeEqual(auth, `Bearer ${env.REGISTER_KEY}`)) {
    return text(401, "unauthorized");
  }
  if (request.method === "PUT") {
    const value = (await request.text()).trim();
    if (!TUNNEL_URL.test(value)) return text(400, "expected https://<name>.trycloudflare.com");
    await env.TUNNEL.put(KEY, value);
    return text(200, "ok");
  }
  if (request.method === "DELETE") {
    await env.TUNNEL.delete(KEY);
    return text(200, "ok");
  }
  return text(405, "use PUT or DELETE");
}

// Returns the username, or null. Fails closed if USERS is missing.
async function authenticate(request, usersSecret) {
  if (!usersSecret) return null;
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Basic ")) return null;

  let decoded;
  try {
    decoded = new TextDecoder().decode(
      Uint8Array.from(atob(header.slice(6)), (c) => c.charCodeAt(0)),
    );
  } catch {
    return null;
  }
  const i = decoded.indexOf(":");
  if (i < 0) return null;
  const name = decoded.slice(0, i);
  const password = decoded.slice(i + 1);

  const expected = parseUsers(usersSecret).get(name);
  const actual = await sha256Hex(password);
  // Always compare (even for unknown users) so timing doesn't reveal valid names.
  const ok = safeEqual(actual, expected ?? "0".repeat(64));
  return ok && expected ? name : null;
}

function parseUsers(secret) {
  const users = new Map();
  for (const entry of secret.split(",")) {
    const [name, hash] = entry.trim().split(":");
    if (name && /^[0-9a-f]{64}$/.test(hash)) users.set(name, hash);
  }
  return users;
}

async function sha256Hex(value) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function text(status, body) {
  return new Response(body + "\n", { status, headers: { "cache-control": "no-store" } });
}

function afk() {
  return new Response(AFK_HTML, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": "300",
    },
  });
}

const AFK_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AFK</title>
  <style>
    :root { color-scheme: light dark; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center;
           font: 16px/1.5 system-ui, sans-serif; background: Canvas; color: CanvasText; }
    main { text-align: center; padding: 16px; }
    h1 { font-size: 3rem; margin: 0; }
    p { opacity: .7; }
  </style>
</head>
<body>
  <main>
    <h1>🌙 AFK</h1>
    <p>My laptop is offline. Check back later.</p>
  </main>
</body>
</html>`;
