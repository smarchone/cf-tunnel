// Front door at demo.<you>.workers.dev
//
//   no tunnel_url in KV               → AFK   (everyone)
//   tunnel_url ─► login ✗             → 401
//   tunnel_url ─► login ✓ ─► forward  → no X-Origin marker → AFK
//                                     → marker             → laptop's response
//
// scripts/online.sh on the laptop keeps tunnel_url current with wrangler.

const KEY = "tunnel_url";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
  <title>AFK · zzz</title>
  <style>
    :root {
      --sky-top: #0b1026; --sky-bot: #2a1f4a; --ink: #e8e9ff; --dim: #a9acd6;
      --lid: #3a4066; --lid-edge: #545b8c; --screen: #0e1230; --glow: #8fa3ff;
      --cap: #ff6b8b; --led: #7dffb2;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0; min-height: 100vh; overflow: hidden; display: grid; place-items: center;
      font: 16px/1.5 ui-rounded, "SF Pro Rounded", system-ui, sans-serif; color: var(--ink);
      background: radial-gradient(120% 90% at 50% 0%, var(--sky-top) 30%, var(--sky-bot) 100%);
      background-color: var(--sky-top);
    }
    #stars { position: fixed; inset: 0; pointer-events: none; }
    .star { position: absolute; width: 2px; height: 2px; border-radius: 50%; background: #fff;
            animation: twinkle var(--d) ease-in-out var(--delay) infinite; opacity: .2; }
    @keyframes twinkle { 50% { opacity: 1; transform: scale(1.6); } }
    .moon { position: fixed; top: 8vh; right: 10vw; width: 64px; height: 64px; border-radius: 50%;
            box-shadow: 14px 10px 0 0 #ffe9a8; transform: rotate(-20deg);
            filter: drop-shadow(0 0 18px rgba(255,233,168,.45)); }
    .shooting { position: fixed; height: 2px; width: 120px; pointer-events: none;
                background: linear-gradient(90deg, rgba(255,255,255,.9), transparent);
                transform: rotate(-25deg); animation: shoot 1.1s ease-out forwards; }
    @keyframes shoot { from { opacity: 1; translate: 0 0; } to { opacity: 0; translate: -360px 170px; } }

    main { position: relative; text-align: center; padding: 16px; width: min(440px, 100%); }
    .stage { position: relative; width: min(300px, 80vw); margin: 0 auto; cursor: pointer;
             -webkit-tap-highlight-color: transparent; }
    .stage svg { display: block; width: 100%; height: auto; overflow: visible; }
    .laptop { transform-origin: 50% 100%; animation: breathe 4s ease-in-out infinite; }
    @keyframes breathe { 50% { transform: scale(1.025, 0.985); } }
    .screen-glow { animation: glow 4s ease-in-out infinite; }
    @keyframes glow { 50% { opacity: .55; } }
    .mouth { transform-box: fill-box; transform-origin: center; animation: snore 4s ease-in-out infinite; }
    @keyframes snore { 50% { transform: scale(1.5, 2.2); } }
    .led { animation: led 4s ease-in-out infinite; }
    @keyframes led { 0%, 100% { opacity: .15; } 50% { opacity: 1; } }
    .cap { transform-box: fill-box; transform-origin: 0% 100%; animation: flop 4s ease-in-out infinite; }
    @keyframes flop { 50% { transform: rotate(4deg); } }

    .awake .laptop { animation: jolt .35s ease-out; }
    @keyframes jolt { 30% { transform: translateY(-10px) rotate(-2deg); } 60% { transform: translateY(2px) rotate(1deg); } }
    .eyes-open { opacity: 0; transition: opacity .15s; }
    .awake .eyes-open { opacity: 1; }
    .awake .eyes-shut { opacity: 0; }
    .awake .mouth { animation: none; }

    .z { position: absolute; font-weight: 800; color: var(--ink); pointer-events: none; user-select: none;
         text-shadow: 0 0 12px rgba(143,163,255,.8); animation: float var(--t) ease-out forwards; }
    @keyframes float {
      0%   { opacity: 0; transform: translate(0, 0) rotate(-10deg) scale(.5); }
      15%  { opacity: 1; }
      100% { opacity: 0; transform: translate(var(--dx), -150px) rotate(15deg) scale(1.3); }
    }

    .bubble { position: absolute; left: 50%; top: -12px; translate: -50% -100%; white-space: nowrap;
              background: #fff; color: #1d1f3a; font-weight: 600; font-size: 14px; padding: 6px 12px;
              border-radius: 14px; opacity: 0; scale: .8; transition: opacity .2s, scale .2s; pointer-events: none;
              max-width: 90vw; overflow: hidden; text-overflow: ellipsis; }
    .bubble::after { content: ""; position: absolute; left: 50%; bottom: -6px; translate: -50% 0;
                     border: 6px solid transparent; border-bottom: 0; border-top-color: #fff; }
    .bubble.show { opacity: 1; scale: 1; }

    h1 { font-size: clamp(2.2rem, 8vw, 3rem); margin: 28px 0 0; letter-spacing: .04em; }
    h1 span { display: inline-block; animation: nod 4s ease-in-out infinite; }
    @keyframes nod { 50% { transform: translateY(3px) rotate(-3deg); } }
    p { margin: 4px 0; color: var(--dim); }
    .status { font-size: 14px; font-variant-numeric: tabular-nums; margin-top: 18px; opacity: .8; }
    .hint { font-size: 12px; opacity: .55; margin-top: 6px; }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation: none !important; transition: none !important; }
      .z, .shooting { display: none; }
    }
  </style>
</head>
<body>
  <div id="stars" aria-hidden="true"></div>
  <div class="moon" aria-hidden="true"></div>

  <main>
    <div class="stage" id="stage" role="button" tabindex="0" aria-label="Poke the sleeping laptop">
      <div class="bubble" id="bubble"></div>
      <svg viewBox="0 -34 260 190" aria-hidden="true">
        <g class="laptop">
          <!-- lid -->
          <rect x="35" y="0" width="190" height="125" rx="12" fill="var(--lid)" stroke="var(--lid-edge)" stroke-width="3"/>
          <rect x="47" y="12" width="166" height="101" rx="5" fill="var(--screen)"/>
          <rect class="screen-glow" x="47" y="12" width="166" height="101" rx="5" fill="var(--glow)" opacity=".18"/>
          <!-- sleepy face -->
          <g class="eyes-shut" stroke="var(--glow)" stroke-width="4" stroke-linecap="round" fill="none">
            <path d="M92 58 q11 9 22 0"/>
            <path d="M146 58 q11 9 22 0"/>
          </g>
          <g class="eyes-open" fill="var(--glow)">
            <circle cx="103" cy="58" r="7"/>
            <path d="M146 60 q11 -4 22 0" stroke="var(--glow)" stroke-width="4" stroke-linecap="round" fill="none"/>
          </g>
          <circle cx="86" cy="76" r="7" fill="var(--cap)" opacity=".35"/>
          <circle cx="174" cy="76" r="7" fill="var(--cap)" opacity=".35"/>
          <ellipse class="mouth" cx="130" cy="86" rx="5" ry="3" fill="var(--glow)"/>
          <!-- nightcap -->
          <g class="cap">
            <path d="M150 4 C158 -24 205 -36 238 -12 L214 4 Z" fill="var(--cap)"/>
            <rect x="144" y="-2" width="76" height="12" rx="6" fill="#fff"/>
            <circle cx="240" cy="-12" r="8" fill="#fff"/>
          </g>
          <!-- base -->
          <path d="M8 125 H252 L238 146 H22 Z" fill="var(--lid-edge)"/>
          <rect x="110" y="125" width="40" height="5" rx="2.5" fill="var(--lid)"/>
          <circle class="led" cx="130" cy="138" r="3" fill="var(--led)"/>
        </g>
      </svg>
    </div>

    <h1><span>A</span><span style="animation-delay:.15s">F</span><span style="animation-delay:.3s">K</span></h1>
    <p>Currently napping...</p>
    <p>Services are down for now.</p>
    <p class="status" id="status">Come back after a while</p>
  </main>

  <script>
    var reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    var stage = document.getElementById("stage");
    var bubble = document.getElementById("bubble");

    // stars
    var sky = document.getElementById("stars");
    for (var i = 0; i < 90; i++) {
      var s = document.createElement("i");
      s.className = "star";
      s.style.left = Math.random() * 100 + "%";
      s.style.top = Math.random() * 100 + "%";
      s.style.setProperty("--d", (2 + Math.random() * 4) + "s");
      s.style.setProperty("--delay", (-Math.random() * 6) + "s");
      sky.appendChild(s);
    }

    // zzz rising off the nightcap, in time with the breathing
    var sleeping = true;
    function puff() {
      if (!sleeping || reduced || document.hidden) return;
      var letters = ["z", "Z", "z"];
      letters.forEach(function (ch, k) {
        setTimeout(function () {
          var z = document.createElement("span");
          z.className = "z";
          z.textContent = ch;
          z.style.left = (78 + Math.random() * 8) + "%";
          z.style.top = "4%";
          z.style.fontSize = (16 + k * 8 + Math.random() * 6) + "px";
          z.style.setProperty("--dx", (20 + Math.random() * 50) + "px");
          z.style.setProperty("--t", (2.6 + Math.random()) + "s");
          stage.appendChild(z);
          z.addEventListener("animationend", function () { z.remove(); });
        }, k * 450);
      });
    }
    puff();
    setInterval(puff, 4000);

    // occasional shooting star
    function shoot() {
      if (!reduced && !document.hidden) {
        var el = document.createElement("div");
        el.className = "shooting";
        el.style.left = (40 + Math.random() * 60) + "vw";
        el.style.top = (Math.random() * 35) + "vh";
        document.body.appendChild(el);
        el.addEventListener("animationend", function () { el.remove(); });
      }
      setTimeout(shoot, 6000 + Math.random() * 10000);
    }
    setTimeout(shoot, 3000);

    // poke it
    var grumbles = [
      "five more minutes…",
      "mmph. not now.",
      "dreaming of electric sheep",
      "defragmenting my dreams…",
      "the server is in another castle",
      "404: motivation not found",
      "shhh, I'm compiling dreams",
      "brb, charging my feelings",
      "wake me when it's Friday",
      "ok ok I'm up— zzz"
    ];
    var pokes = 0, wakeTimer;
    function poke() {
      pokes++;
      var line = pokes >= 7 && pokes % 7 === 0
        ? "you've poked me " + pokes + " times. rude."
        : grumbles[Math.floor(Math.random() * grumbles.length)];
      bubble.textContent = line;
      bubble.classList.add("show");
      sleeping = false;
      stage.classList.remove("awake");
      void stage.offsetWidth; // restart jolt
      stage.classList.add("awake");
      clearTimeout(wakeTimer);
      wakeTimer = setTimeout(function () {
        stage.classList.remove("awake");
        bubble.classList.remove("show");
        sleeping = true;
        puff();
      }, 1800);
    }
    stage.addEventListener("click", poke);
    stage.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); poke(); }
    });

    // matches the Retry-After: 300 header — reload to see if it woke up
    var left = 300, status = document.getElementById("status");
    setInterval(function () {
      left--;
      if (left <= 0) { status.textContent = "Peeking…"; location.reload(); return; }
      var m = Math.floor(left / 60), sec = left % 60;
      status.textContent = "Checking again in " + m + ":" + (sec < 10 ? "0" : "") + sec;
    }, 1000);
  </script>
</body>
</html>`;
