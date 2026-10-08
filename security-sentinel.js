/**
 * Security Sentinel — portable drop-in (zero dependencies, ESM).
 *
 * Add to any Node/Express app:
 *
 *   import express from "express";
 *   import { applySecurity } from "./security-sentinel.js";
 *   const app = express();
 *   app.use(express.json());        // <-- REQUIRED BEFORE applySecurity, see below
 *   applySecurity(app, {
 *     hubUrl: process.env.HUB_URL,   // e.g. http://localhost:3000
 *     appId:  process.env.APP_ID,    // unique id issued by the Hub
 *     appName: "My App",
 *     // csp: "default-src 'self'; ..."  // optional: replaces the whole default policy
 *     // extraScriptSrc: ["https://js.stripe.com"],   // optional: appended to script-src
 *     // extraFrameSrc: ["https://js.stripe.com"],    // optional: emits a frame-src directive
 *     // extraConnectSrc / extraMediaSrc / extraWorkerSrc likewise (arrays of origins)
 *     // rateKey: (req) => req.session?.userId || null, // optional: per-user rate bucket
 *     // ipMultiplier: 10,                             // per-IP ceiling = limit * this
 *   });
 *
 * MOUNT ORDER IS LOAD-BEARING. The virtual-patch middleware builds its scan surface from
 * req.url + req.query + req.body. Mounted BEFORE a body parser, req.body is undefined and
 * the POST-body half of VP-002/VP-004/VP-005 is dead code — every JSON body sails through
 * unscanned while the fleet dashboard still reports all six patches as active.
 *
 * Note this makes human prose scannable. VP-002 fires on a chain token followed by a
 * command verb, so an ordinary free-text note ("CO alarm going off; cat is in the attic")
 * can 403 a legitimate request. If an app has genuine prose fields, mask just those fields
 * for the duration of the scan rather than mounting the whole module pre-parser.
 *
 * What it does (all framework-agnostic Express, no external packages):
 *   - Virtual patching middleware (VP-001..006) — blocks path traversal, shell &
 *     SQL & XSS injection, scanner probes, and dangerous executable references.
 *   - Hardened headers (CSP, X-Frame-Options, nosniff, removes X-Powered-By).
 *   - In-memory rate limiting.
 *   - Phones a security report home to the Hub on an interval (and on startup),
 *     so the Hub's Fleet dashboard can confirm every app stays secure.
 *
 * Requires Node 18+ (uses global fetch). No build step needed.
 */

const VIRTUAL_PATCHES = [
  {
    id: "VP-001", name: "Path Traversal Blocker", threatLevel: "critical",
    test: (s) => /\.\.[\/\\]/.test(s) || s.includes("../") || s.includes("..\\"),
  },
  {
    id: "VP-002", name: "Shell Command Shield", threatLevel: "critical",
    // Chain/subshell tokens alone appear in ordinary JSON bodies (data: URLs carry
    // ";base64,", prose carries ";"), so an actual command must follow the token.
    test: (s) => /(;|&&|\|\||\$\(|`)\s*(rm|mv|cp|cat|ls|nc|ncat|sh|bash|zsh|curl|wget|chmod|chown|kill|touch|python\d*|perl|ruby|php)\b/i.test(s) || /\b(nc|ncat)\s+(-\w+\s+)*-e\b/i.test(s),
  },
  {
    id: "VP-003", name: "Scanner / CMS Probe Silencer", threatLevel: "medium",
    test: (s) => /(wp-admin|wp-login|xmlrpc\.php|\/\.env|\/\.git|phpmyadmin|\/vendor\/|\/wp-includes)/i.test(s),
  },
  {
    id: "VP-004", name: "Cross-Site Scripting (XSS) Filter", threatLevel: "high",
    test: (s) => /(<script|<\/script|javascript:|onerror\s*=|onload\s*=|<img[^>]+onerror)/i.test(s),
  },
  {
    id: "VP-005", name: "SQL Injection Filter", threatLevel: "high",
    test: (s) => /(\bUNION\b\s+\bSELECT\b|\bOR\b\s+1\s*=\s*1|';\s*DROP\b|\bINSERT\b\s+\bINTO\b|\bSELECT\b\s+.*\bFROM\b\s+information_schema)/i.test(s),
  },
  {
    id: "VP-006", name: "Dangerous Extension Filter", threatLevel: "medium",
    test: (s) => /\.(php|phtml|py|sh|exe|bat|cgi|pl)(\?|$|\/)/i.test(s),
  },
];

export function applySecurity(app, opts = {}) {
  const {
    hubUrl = process.env.HUB_URL || "",
    appId = process.env.APP_ID || "",
    appName = process.env.APP_NAME || "Connected App",
    reportIntervalMs = 60000,
    aiRateLimit = 30,
    localRateLimit = 120,
    enabled = true,
    csp = null,
    // Optional (req) => string|null. When it returns a key (a VERIFIED session's user id,
    // never a cookie read without checking its signature), that key gets its own fairness
    // bucket in the rate limiter; null, or a throw, falls back to the caller's IP. A
    // classroom or an office behind one NAT is the case per-IP limiting gets wrong. Even a
    // mintable key cannot uncap a machine, because the per-IP ceiling below always applies
    // on top (see ipMultiplier).
    rateKey = null,
    // The per-IP machine ceiling is limit * ipMultiplier (localRateLimit on /api, aiRateLimit
    // on /api/ai), ticked by EVERY request from that IP whatever key it presents. It bounds
    // the total load one address can put on the app: minting throwaway accounts for fresh
    // user buckets amplifies load by at most this factor, never without bound. Less than 1,
    // or not a number, reads as the default.
    ipMultiplier = 10,
    // Extra CSP origins a deployment needs beyond the default policy, each appended to its
    // directive. script-src, connect-src and media-src already exist in the default policy,
    // so their extras only ever lengthen a directive. frame-src and worker-src are NOT in the
    // default policy (a frame or a worker falls back to default-src 'self'), so those two are
    // emitted only when their array is non-empty and every existing policy stays
    // byte-identical. A complete `csp` string still replaces the whole policy, extras included.
    extraScriptSrc = [],
    extraFrameSrc = [],
    extraConnectSrc = [],
    extraMediaSrc = [],
    extraWorkerSrc = [],
  } = opts;

  if (!enabled) return;

  // The hub's own origin, derived from hubUrl so a localhost hub works in dev too.
  const hubOrigin = (() => {
    if (!hubUrl) return "";
    try { return new URL(hubUrl).origin; } catch { return ""; }
  })();

  // A connected app loads the hub's tracker.js as an external <script src> and its brand
  // fonts from Google Fonts. Without the hub origin in script-src the app silently blocks
  // its OWN telemetry — the tag is in the HTML and the browser refuses it — and without a
  // font-src directive, default-src 'self' blocks fonts.gstatic.com so no web font loads.
  // Both were true of every scaffolded spoke until this was fixed.
  //
  // Deliberately conservative: this module runs in live production spokes, so it adds only
  // the directives needed to stop blocking legitimate first-party assets. Pass a complete
  // `csp` string to override the whole policy if an app needs something stricter or wider.
  //
  // The extra* arrays are the middle ground: they append origins to a directive without
  // replacing the policy, so a spoke that only needs Stripe.js or a video player keeps every
  // default it did not ask to change. Built once; the directive set is fixed for the process.
  const origins = (list) => (Array.isArray(list) ? list : [])
    .map((o) => (typeof o === "string" ? o.trim() : ""))
    .filter(Boolean);
  const appended = (list) => origins(list).map((o) => " " + o).join("");
  const frameSrc = origins(extraFrameSrc);
  const workerSrc = origins(extraWorkerSrc);
  const defaultCsp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${hubOrigin ? " " + hubOrigin : ""}${appended(extraScriptSrc)}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    // The hub renders blog posts with absolute hub-origin <video>/<audio> sources. With
    // no media-src the browser falls back to default-src 'self' and refuses them, so the
    // post arrives complete and only the player is dead. Same reason the hub origin is
    // added to script-src and connect-src below.
    `media-src 'self' data: blob: https:${hubOrigin ? " " + hubOrigin : ""}${appended(extraMediaSrc)}`,
    `connect-src 'self' https:${hubOrigin ? " " + hubOrigin : ""}${appended(extraConnectSrc)}`,
    // 'self' is kept beside the extras: same-origin and srcdoc frames (a sandboxed email
    // preview, say) worked under the default-src fallback and must keep working once a
    // frame-src directive exists, because a directive that is present no longer falls back.
    ...(frameSrc.length ? [`frame-src 'self' ${frameSrc.join(" ")}`] : []),
    ...(workerSrc.length ? [`worker-src 'self' ${workerSrc.join(" ")}`] : []),
    "frame-ancestors 'none'",
  ].join("; ");

  const cspPolicy = typeof csp === "string" && csp.trim() ? csp : defaultCsp;

  const state = { threatsBlocked: 0, recent: [], startedAt: new Date().toISOString() };
  const rateMap = new Map();
  let lastSweep = 0;
  const ipMult = Number.isFinite(Number(ipMultiplier)) && Number(ipMultiplier) >= 1 ? Number(ipMultiplier) : 10;

  // --- 1. Hardened headers ---
  app.use((req, res, next) => {
    res.setHeader("Content-Security-Policy", cspPolicy);
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.removeHeader("X-Powered-By");
    next();
  });

  // --- 2. Virtual patching middleware ---
  app.use((req, res, next) => {
    const surface = [
      req.url || "",
      JSON.stringify(req.query || {}),
      typeof req.body === "object" ? JSON.stringify(req.body || {}) : String(req.body || ""),
    ].join(" ");
    for (const p of VIRTUAL_PATCHES) {
      let hit = false;
      try { hit = p.test(surface); } catch { hit = false; }
      if (hit) {
        state.threatsBlocked++;
        const entry = {
          id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          ip: req.ip || req.socket?.remoteAddress || "unknown",
          endpoint: (req.originalUrl || req.url || "").slice(0, 200),
          method: req.method,
          matchedPatchId: p.id,
          matchedPatchName: p.name,
          threatLevel: p.threatLevel,
          timestamp: new Date().toISOString(),
        };
        state.recent.unshift(entry);
        state.recent = state.recent.slice(0, 25);
        console.warn(`[Security Sentinel] BLOCKED ${entry.method} ${entry.endpoint} — ${p.name} (${p.id})`);
        return res.status(403).json({ success: false, error: `Blocked by Security Sentinel: ${p.name} (${p.id})` });
      }
    }
    next();
  });

  // --- 3. Rate limiting ---
  // Two independent fixed 60s windows, and BOTH must pass:
  //   fairness: per signed-in user (its own bucket via the rateKey hook, so an office or a
  //     classroom behind one NAT never shares a window) or per IP when anonymous, at `limit`.
  //     Stops any one identity hogging.
  //   machine: per IP, at `limit * ipMultiplier`, ticked by EVERY request from that IP
  //     whatever key it presents. The per-address backstop: a flood that rotates cookies to
  //     mint fresh user buckets is amplified by at most ipMultiplier, never without bound.
  // With no rateKey the fairness bucket IS the IP bucket, which is exactly what this
  // limiter always did; the machine ceiling then sits ipMultiplier times above it.
  function bump(key, cap, now) {
    const rec = rateMap.get(key);
    if (!rec || now - rec.windowStart > 60000) {
      rateMap.set(key, { windowStart: now, count: 1 });
      return true;
    }
    rec.count++;
    return rec.count <= cap;
  }
  app.use((req, res, next) => {
    // Lowercased path (no query): Express routing is case-INSENSITIVE, so /API/ai/... reaches
    // the same credit-burning handler, and matching on the raw URL let an uppercase spelling
    // skip the limit entirely.
    const p = (req.path || req.url || "").toLowerCase();
    if (!p.startsWith("/api/")) return next();
    const isAi = p.startsWith("/api/ai");
    const limit = isAi ? aiRateLimit : localRateLimit;
    if (limit <= 0) return next();

    let user = null;
    if (typeof rateKey === "function") {
      try {
        const k = rateKey(req);
        if (typeof k === "string" && k) user = k;
        else if (typeof k === "number" && Number.isFinite(k)) user = String(k);
      } catch { user = null; }
    }
    const ip = req.ip || req.socket?.remoteAddress || "x";
    const lane = isAi ? "ai" : "api";
    const now = Date.now();

    // Sweep expired windows at most once per interval and only once the map has grown,
    // never an O(n) scan on the per-request hot path: that would thrash under exactly the
    // flood the limiter exists to shed.
    if (now - lastSweep > 10000 && rateMap.size > 1000) {
      for (const [k, r] of rateMap) if (now - r.windowStart > 60000) rateMap.delete(k);
      lastSweep = now;
    }

    const fairnessKey = (user ? `u:${user}` : `ip:${ip}`) + "|" + lane;
    const machineKey = `m:${ip}|${lane}`;
    // Tick both; either ceiling tripping is a 429.
    const okFair = bump(fairnessKey, limit, now);
    const okMachine = bump(machineKey, limit * ipMult, now);
    if (!okFair || !okMachine) {
      return res.status(429).json({ success: false, error: "Rate limit exceeded (Security Sentinel)." });
    }
    next();
  });

  // --- 4. Phone home to the Hub ---
  async function runSca() {
    // Best-effort local npm audit; returns a 0..100 score (100 = clean).
    return new Promise((resolve) => {
      try {
        import("child_process").then(({ exec }) => {
          exec("npm audit --json", { cwd: process.cwd(), timeout: 30000, maxBuffer: 1024 * 1024 * 20 }, (_e, stdout) => {
            try {
              const j = JSON.parse(stdout || "{}");
              const v = j.metadata?.vulnerabilities || {};
              const penalty = (v.critical || 0) * 25 + (v.high || 0) * 10 + (v.moderate || 0) * 4 + (v.low || 0) * 1;
              resolve(Math.max(0, 100 - penalty));
            } catch { resolve(null); }
          });
        }).catch(() => resolve(null));
      } catch { resolve(null); }
    });
  }

  async function report() {
    if (!hubUrl || !appId) return;
    let scaScore = null;
    try { scaScore = await runSca(); } catch { /* ignore */ }
    const grade = scaScore == null ? "?" : scaScore >= 95 ? "A+" : scaScore >= 90 ? "A" : scaScore >= 80 ? "B" : scaScore >= 70 ? "C" : "D";
    const payload = {
      appId, appName,
      grade, scaScore,
      threatsBlocked: state.threatsBlocked,
      activePatches: VIRTUAL_PATCHES.map((p) => p.id),
      headers: ["CSP", "X-Frame-Options", "X-Content-Type-Options", "no-X-Powered-By"],
      recentThreats: state.recent.slice(0, 10),
      startedAt: state.startedAt,
      reportedAt: new Date().toISOString(),
    };
    try {
      await fetch(`${hubUrl.replace(/\/$/, "")}/api/security/fleet/${encodeURIComponent(appId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.warn(`[Security Sentinel] Hub report failed: ${e?.message || e}`);
    }
  }

  if (hubUrl && appId) {
    // Both timers are unref'd: a report is never the reason a process stays alive.
    const t0 = setTimeout(report, 3000); // initial report shortly after boot
    if (t0.unref) t0.unref();
    const t = setInterval(report, reportIntervalMs);
    if (t.unref) t.unref();
    console.log(`[Security Sentinel] Active — reporting to Hub ${hubUrl} as app "${appId}".`);
  } else {
    console.log("[Security Sentinel] Active (local-only; set HUB_URL + APP_ID to report to the Hub).");
  }

  // Expose a local status route for quick self-check.
  app.get("/__sentinel/status", (_req, res) => {
    res.json({ success: true, appId, appName, threatsBlocked: state.threatsBlocked, activePatches: VIRTUAL_PATCHES.map((p) => p.id) });
  });
}

export default { applySecurity };
