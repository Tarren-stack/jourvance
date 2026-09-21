/**
 * Hub SDK — portable drop-in (zero dependencies, ESM).
 *
 * The server-side complement to the browser telemetry tracker. It lets a generated
 * ("spoke") app pull from the shared AI Brain and feed winners back, authenticated with
 * the per-app API key the Hub provisioned at scaffold time. The key is a SECRET — use this
 * only from your app's Node/Express backend, never the browser.
 *
 * Add to any Node 18+ app:
 *
 *   import { createHubClient } from "./hub-sdk.js";
 *   const hub = createHubClient({
 *     hubUrl:    process.env.HUB_URL,       // e.g. https://zeluslabs.dev
 *     appId:     process.env.APP_ID,        // your app id (== the builder's project id)
 *     accountId: process.env.ACCOUNT_ID,    // the business/tenant id
 *     apiKey:    process.env.HUB_API_KEY,   // provisioned by the Hub — keep secret
 *   });
 *
 *   // Improve a generation before you run it (RAG augment):
 *   const { chunks } = await hub.brain.query("headline that converts for a salon");
 *   // Teach the brain from a rated winner (rating >= 4 is ingested):
 *   await hub.brain.learn({ kind: "image", prompt, rating: 5, niche: "salon" });
 *
 *   // Generative media (credit-metered) — image + video from the hub's model garden:
 *   const { imageUrl } = await hub.image.generate({ prompt, aspectRatio: "1:1", provider: "muapi" });
 *   const { videoUrl } = await hub.video.generate({ prompt, aspectRatio: "9:16", durationSeconds: 6 });
 *
 *   // Server-rendered SEO from the hub (title + meta description per path — crawler-visible):
 *   app.use(hub.seoMiddleware());   // mount BEFORE routes/static, AFTER compression()
 *   // Hub-published blog at /blog and /blog/:slug (SEO-ready pages, no redeploy):
 *   app.use(hub.blogMiddleware());
 *   // Living sitemap + IndexNow key file (hub builds it from crawls/SEO/blog):
 *   app.use(hub.sitemapMiddleware());
 *   // Hub-published programmatic landing pages at /lp/:slug:
 *   app.use(hub.pagesMiddleware());
 *
 *   // The full SEO Suite as an API (tenant-scoped, credit-metered — see hub.seo below):
 *   const { tasks } = await hub.seo.tasks();
 *   await hub.seo.rankCheck("yourdomain.com", ["best salon austin"]);
 *
 *   // The spoke holds NO platform credential (lockdown wave 3): durable storage, media,
 *   // domains and end-user funding all run over this key on hub routes:
 *   await hub.store.docs.put("settings", { theme: "dark" });          // Firestore mirror
 *   const { url } = await hub.media.signRead("photos/hero.jpg");      // Cloud Storage
 *   await hub.credits.user(uid).fund({ credits: 500, key: orderId }); // app wallet -> user
 *   const { results } = await hub.domains.resale.search("acme");      // registrar, scoped
 *
 * Requires Node 18+ (uses global fetch). No build step needed.
 */

export function createHubClient(config = {}) {
  const hubUrl = String(config.hubUrl || "").replace(/\/$/, "");
  const appId = config.appId;
  const accountId = config.accountId;
  const apiKey = config.apiKey;
  // Optional operator token (x-admin-token) — only needed for admin-gated calls such
  // as per-user credit grants. Most spokes never set this; reads never need it.
  const adminToken = config.adminToken;

  if (!hubUrl) console.warn("[Hub SDK] Missing hubUrl — set HUB_URL.");
  if (!apiKey) console.warn("[Hub SDK] Missing apiKey — brain/service calls will be rejected once the Hub enforces keys. Set HUB_API_KEY.");

  // A refusal keeps the SDK's { error, status } shape and carries the hub's other fields
  // underneath (a 402's balance and needed, a 409's userId, a 413's bytes and maxBytes, a
  // 429's limit, a 502's storageStatus, a 503's retryable, a 400's premiumPrice,
  // requiredEnv or cap), so a caller can act on them without a second request.
  // `error` and `status` always win over anything the body named.
  function refused(status, data) {
    var extra = data && typeof data === "object" && !Array.isArray(data) ? data : {};
    return { ...extra, error: extra.error ? extra.error : "HTTP " + status, status: status };
  }

  async function post(pathname, body, timeoutMs) {
    try {
      const res = await fetch(hubUrl + pathname, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}),
        },
        body: JSON.stringify(body || {}),
        // A hung hub call must not hang the spoke's request path. Most calls cap at 60s
        // so a model or Meta round-trip is not aborted as a hang; image/video still pass
        // a larger timeoutMs.
        ...(typeof AbortSignal !== "undefined" && AbortSignal.timeout ? { signal: AbortSignal.timeout(timeoutMs || 60000) } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return refused(res.status, data);
      return data;
    } catch (err) {
      return { error: (err && err.message) || "Network error reaching the Hub." };
    }
  }

  // POST a RAW body (the file itself, not JSON) — the media upload routes read the
  // request body verbatim and take the type from Content-Type. Accepts a Buffer, Blob,
  // ArrayBuffer or typed array; whatever fetch can send, the hub can store.
  async function raw(pathname, body, contentType, timeoutMs) {
    try {
      if (!body) return { error: "Nothing to upload." };
      if (!contentType) return { error: "A Content-Type is required (audio/mpeg, video/mp4, …)." };
      const res = await fetch(hubUrl + pathname, {
        method: "POST",
        headers: {
          "Content-Type": contentType,
          ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}),
        },
        body: body,
        // An upload is streamed and can be large, so the ceiling is generous.
        ...(typeof AbortSignal !== "undefined" && AbortSignal.timeout ? { signal: AbortSignal.timeout(timeoutMs || 10 * 60 * 1000) } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return refused(res.status, data);
      return data;
    } catch (err) {
      return { error: (err && err.message) || "Network error reaching the Hub." };
    }
  }

  // POST to an operator/admin-gated route — adds x-admin-token when the client was
  // created with { adminToken }. Without it the call still goes and the Hub returns an
  // honest 403 (grants are not a spoke self-service capability).
  async function postAdmin(pathname, body, timeoutMs) {
    try {
      const res = await fetch(hubUrl + pathname, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}),
          ...(adminToken ? { "x-admin-token": adminToken } : {}),
        },
        body: JSON.stringify(body || {}),
        ...(typeof AbortSignal !== "undefined" && AbortSignal.timeout ? { signal: AbortSignal.timeout(timeoutMs || 60000) } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return refused(res.status, data);
      return data;
    } catch (err) {
      return { error: (err && err.message) || "Network error reaching the Hub." };
    }
  }

  async function put(pathname, body, timeoutMs) {
    try {
      const res = await fetch(hubUrl + pathname, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}),
        },
        body: JSON.stringify(body || {}),
        ...(typeof AbortSignal !== "undefined" && AbortSignal.timeout ? { signal: AbortSignal.timeout(timeoutMs || 60000) } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return refused(res.status, data);
      return data;
    } catch (err) {
      return { error: (err && err.message) || "Network error reaching the Hub." };
    }
  }

  async function get(pathname) {
    try {
      const res = await fetch(hubUrl + pathname, {
        method: "GET",
        headers: apiKey ? { Authorization: "Bearer " + apiKey } : {},
        ...(typeof AbortSignal !== "undefined" && AbortSignal.timeout ? { signal: AbortSignal.timeout(60000) } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return refused(res.status, data);
      return data;
    } catch (err) {
      return { error: (err && err.message) || "Network error reaching the Hub." };
    }
  }

  async function del(pathname) {
    try {
      const res = await fetch(hubUrl + pathname, {
        method: "DELETE",
        headers: apiKey ? { Authorization: "Bearer " + apiKey } : {},
        ...(typeof AbortSignal !== "undefined" && AbortSignal.timeout ? { signal: AbortSignal.timeout(60000) } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return refused(res.status, data);
      return data;
    } catch (err) {
      return { error: (err && err.message) || "Network error reaching the Hub." };
    }
  }

  // ── SEO middleware internals ────────────────────────────────────────────────
  // The hub's On-Page editor publishes per-path { title, metaDescription } on the app's
  // keyless config overlay. This middleware rewrites the server's outgoing HTML so
  // crawlers (which may never run JS) see the hub-managed head facts — no redeploy, no
  // IDE session. Fail-open everywhere: any hub problem serves the original HTML.
  var seoCache = { seo: null, at: 0, pending: null };

  function seoRefresh(timeoutMs) {
    if (seoCache.pending) return seoCache.pending;
    var signal;
    try { signal = AbortSignal.timeout ? AbortSignal.timeout(timeoutMs || 4000) : undefined; } catch (e) {}
    seoCache.pending = fetch(hubUrl + "/api/apps/" + appId + "/config", { signal: signal })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        seoCache.seo = (d && d.success && d.seo) || {};
        seoCache.at = Date.now();
      })
      .catch(function () {
        // Remember the miss so a hub outage doesn't add latency to every request.
        if (!seoCache.seo) seoCache.seo = {};
        seoCache.at = Date.now();
      })
      .then(function () { seoCache.pending = null; });
    return seoCache.pending;
  }

  function seoEscape(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Insert new head tags after <meta charset> when present (charset must stay first
  // in <head>), otherwise right after the opening <head> tag.
  function seoInsertInHead(html, tag) {
    var charsetRe = /<meta\s[^>]*charset[^>]*>/i;
    if (charsetRe.test(html)) return html.replace(charsetRe, function (m) { return m + tag; });
    return html.replace(/<head([^>]*)>/i, function (m) { return m + tag; });
  }

  function seoRewriteHtml(html, entry) {
    if (entry.title) {
      var titleTag = "<title>" + seoEscape(entry.title) + "</title>";
      if (/<title[^>]*>[\s\S]*?<\/title>/i.test(html)) {
        html = html.replace(/<title[^>]*>[\s\S]*?<\/title>/i, function () { return titleTag; });
      } else {
        html = seoInsertInHead(html, titleTag);
      }
    }
    if (entry.metaDescription) {
      var metaTag = '<meta name="description" content="' + seoEscape(entry.metaDescription).replace(/"/g, "&quot;") + '">';
      if (/<meta\s[^>]*name=["']description["'][^>]*\/?>/i.test(html)) {
        html = html.replace(/<meta\s[^>]*name=["']description["'][^>]*\/?>/i, function () { return metaTag; });
      } else {
        html = seoInsertInHead(html, metaTag);
      }
    }
    if (entry.jsonLd) {
      // Marked with data-zlab-seo so a re-publish replaces rather than stacks. The hub
      // stores jsonLd as canonical JSON with "</" escaped, safe inside a script tag.
      var ldTag = '<script type="application/ld+json" data-zlab-seo="1">' + entry.jsonLd + "</script>";
      var ldRe = /<script[^>]*data-zlab-seo=["']1["'][^>]*>[\s\S]*?<\/script>/i;
      if (ldRe.test(html)) html = html.replace(ldRe, function () { return ldTag; });
      else if (/<\/head>/i.test(html)) html = html.replace(/<\/head>/i, function (m) { return ldTag + m; });
      else html = seoInsertInHead(html, ldTag);
    }
    return html;
  }

  function seoEntryFor(pathname) {
    if (!seoCache.seo) return null;
    var p = String(pathname || "/").replace(/\/+$/, "") || "/";
    var entry = seoCache.seo[p];
    return entry && (entry.title || entry.metaDescription || entry.jsonLd) ? entry : null;
  }

  function seoMiddleware(opts) {
    var ttlMs = (opts && opts.ttlMs) || 60000;
    return function (req, res, next) {
      if (req.method !== "GET") return next();
      if (seoCache.seo === null) {
        // First request after boot: wait briefly so the very first crawler hit is
        // already rewritten. Every later request is served from cache instantly.
        seoRefresh(2500).then(proceed, proceed);
      } else {
        if (Date.now() - seoCache.at > ttlMs) seoRefresh(); // background, serve current
        proceed();
      }
      function proceed() {
        var entry;
        try { entry = seoEntryFor(req.path || (req.url || "").split("?")[0]); } catch (e) { entry = null; }
        if (!entry) return next();
        // Buffer the response (covers res.send, sendFile AND express.static streams),
        // rewrite when it turns out to be HTML, pass everything else through untouched.
        var origWrite = res.write.bind(res);
        var origEnd = res.end.bind(res);
        var bufs = [];
        var active = true;
        function offload() {
          active = false;
          res.write = origWrite;
          res.end = origEnd;
        }
        function looksHtml(chunk) {
          // Never touch compressed bodies — rewriting gzip bytes would corrupt them.
          var ce = String((res.getHeader && res.getHeader("content-encoding")) || "");
          if (ce && ce !== "identity") {
            // Compressed bytes reach this wrapper only when compression() was mounted
            // AFTER this middleware (its wrapper then sits outside ours). Say so once,
            // because the symptom is silent: every pushed title is dropped while the
            // middleware looks mounted, and a CDN asks the origin for gzip every time.
            if (!seoCache.warnedCompressed) {
              seoCache.warnedCompressed = true;
              try { console.warn("[Hub SDK] seoMiddleware received a " + ce + " body: mount app.use(hub.seoMiddleware()) AFTER compression(), or pushed titles and meta never reach the page."); } catch (e) {}
            }
            return false;
          }
          var ct = String((res.getHeader && res.getHeader("content-type")) || "");
          if (ct) return ct.indexOf("text/html") !== -1;
          var head = chunk ? String(chunk).slice(0, 200).toLowerCase() : "";
          return head.indexOf("<!doctype html") !== -1 || head.indexOf("<html") !== -1 || head.indexOf("<head") !== -1;
        }
        function toBuf(chunk, enc) {
          return Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof enc === "string" ? enc : "utf8");
        }
        res.write = function (chunk, enc, cb) {
          if (!active) return origWrite(chunk, enc, cb);
          if (bufs.length === 0 && !looksHtml(chunk)) {
            offload();
            return origWrite(chunk, enc, cb);
          }
          if (chunk) bufs.push(toBuf(chunk, enc));
          var done = typeof enc === "function" ? enc : cb;
          if (done) done();
          return true;
        };
        res.end = function (chunk, enc, cb) {
          if (!active) return origEnd(chunk, enc, cb);
          if (typeof chunk === "function") { cb = chunk; chunk = null; enc = undefined; }
          else if (typeof enc === "function") { cb = enc; enc = undefined; }
          if (chunk && bufs.length === 0 && !looksHtml(chunk)) {
            offload();
            return origEnd(chunk, enc, cb);
          }
          if (chunk) bufs.push(toBuf(chunk, enc));
          var body = Buffer.concat(bufs);
          if (bufs.length && res.statusCode === 200) {
            try {
              body = Buffer.from(seoRewriteHtml(body.toString("utf8"), entry), "utf8");
            } catch (e) { /* fail-open: original body */ }
          }
          offload();
          try {
            if (!res.headersSent && res.getHeader && res.getHeader("content-length") !== undefined) {
              res.setHeader("content-length", body.length);
            }
          } catch (e) {}
          return origEnd(body.length ? body : undefined, cb);
        };
        next();
      }
    };
  }

  // ── Blog middleware internals ───────────────────────────────────────────────
  // The hub's Blog Studio publishes posts for this app; the hub renders complete,
  // SEO-ready pages (title/meta/canonical/JSON-LD/tracker). This middleware serves
  // them at the spoke's own /blog paths — posts published or auto-published on a
  // schedule in the hub go live here with no redeploy. Cached + fail-open: if the
  // hub is unreachable, cached pages serve; otherwise the request falls through.
  function blogMiddleware(opts) {
    var basePath = ((opts && opts.basePath) || "/blog").replace(/\/+$/, "");
    var ttlMs = (opts && opts.ttlMs) || 60000;
    var cache = new Map(); // slug ("" = index) → { html, status, at }
    function remember(key, entry) {
      entry.at = Date.now();
      cache.set(key, entry);
      if (cache.size > 200) cache.delete(cache.keys().next().value); // oldest-first cap
    }
    return function (req, res, next) {
      if (req.method !== "GET") return next();
      var p = String(req.path || "/").replace(/\/+$/, "") || "/";
      if (p !== basePath && p.indexOf(basePath + "/") !== 0) return next();
      var slug = p === basePath ? "" : p.slice(basePath.length + 1);
      if (slug.indexOf("/") !== -1) return next(); // no nested blog paths
      var hit = cache.get(slug);
      function serve(html) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.send(html);
      }
      if (hit && Date.now() - hit.at < ttlMs) {
        if (hit.status === 404) return next();
        return serve(hit.html);
      }
      var origin = (req.protocol || "https") + "://" + req.get("host");
      var url =
        hubUrl + "/api/apps/" + appId + "/blog/render/" +
        (slug ? "post/" + encodeURIComponent(slug) : "index") +
        "?origin=" + encodeURIComponent(origin);
      var signal;
      try { signal = AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined; } catch (e) {}
      fetch(url, { signal: signal })
        .then(function (r) { return r.text().then(function (t) { return { ok: r.ok, t: t }; }); })
        .then(function (r) {
          if (!r.ok) { remember(slug, { status: 404 }); return next(); }
          remember(slug, { html: r.t, status: 200 });
          serve(r.t);
        })
        .catch(function () {
          // Hub unreachable: serve the stale copy if we ever had one, else fall through.
          if (hit && hit.html) return serve(hit.html);
          next();
        });
    };
  }

  // ── Programmatic pages middleware internals ────────────────────────────────
  // The hub's SEO Suite generates and publishes landing pages (service × location
  // and similar); this middleware serves them at /lp/:slug — the same
  // no-redeploy channel as the blog. The published-page list is fetched from the
  // hub (cached) so unpublished pages 404 naturally on the spoke.
  /** How soon a FAILED slug-feed refresh may be retried, rather than after the full TTL. */
  var FEED_RETRY_MS = 15000;

  /**
   * Refresh a middleware's published-slug feed. One implementation for both feeds.
   *
   * A feed that could not be READ is not a feed with nothing in it, and this used to treat
   * them as the same thing: `r.json()` was taken without ever looking at `r.ok`, so a 503
   * body parsed cleanly, `d.pages` came back undefined, and the empty result was cached as
   * the answer for the whole TTL. Every published page 404'd on the spoke's own domain for
   * five minutes because the hub had a bad minute, and a perfectly good previous feed was
   * thrown away to do it. Now a failure KEEPS the slugs already held (stale beats missing,
   * the same rule the HTML path below follows) and comes back in FEED_RETRY_MS instead of
   * sitting on a known-bad answer. A first refresh that fails still yields an empty feed,
   * which is the fail-open direction: the spoke serves its own 404.
   */
  function refreshSlugFeed(feed, url, ttlMs) {
    if (feed.pending) return feed.pending;
    var signal;
    try { signal = AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined; } catch (e) {}
    feed.pending = fetch(url, { signal: signal })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }, function () { return { ok: false, d: null }; }); })
      .then(function (payload) {
        var pages = payload.ok && payload.d && Array.isArray(payload.d.pages) ? payload.d.pages : null;
        if (!pages) throw new Error("The hub did not answer with a page list.");
        var slugs = {};
        pages.forEach(function (p) { if (p && p.slug) slugs[p.slug] = true; });
        feed.slugs = slugs;
        feed.at = Date.now();
      })
      .catch(function () {
        if (!feed.slugs) feed.slugs = {};
        // Back-date the stamp so the next request retries soon instead of after the TTL.
        feed.at = Date.now() - ttlMs + Math.min(ttlMs, FEED_RETRY_MS);
      })
      .then(function () { feed.pending = null; });
    return feed.pending;
  }

  function pagesMiddleware(opts) {
    var ttlMs = (opts && opts.ttlMs) || 300000; // page list changes rarely — 5 min
    var feed = { slugs: null, at: 0, pending: null };
    var htmlCache = new Map(); // slug → { html, at }
    function refreshFeed() {
      return refreshSlugFeed(feed, hubUrl + "/api/apps/" + appId + "/pages/feed", ttlMs);
    }
    return function (req, res, next) {
      if (req.method !== "GET") return next();
      var m = /^\/lp\/([a-z0-9-]+)\/?$/.exec(String(req.path || (req.url || "").split("?")[0]));
      if (!m) return next();
      var slug = m[1];
      function proceed() {
        if (!feed.slugs || !feed.slugs[slug]) return next();
        var hit = htmlCache.get(slug);
        if (hit && Date.now() - hit.at < ttlMs) {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          return res.send(hit.html);
        }
        var origin = (req.protocol || "https") + "://" + req.get("host");
        var signal;
        try { signal = AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined; } catch (e) {}
        fetch(hubUrl + "/api/apps/" + appId + "/pages/render/" + encodeURIComponent(slug) + "?origin=" + encodeURIComponent(origin), { signal: signal })
          .then(function (r) { return r.text().then(function (t) { return { ok: r.ok, t: t }; }); })
          .then(function (r) {
            if (!r.ok) return next();
            htmlCache.set(slug, { html: r.t, at: Date.now() });
            if (htmlCache.size > 300) htmlCache.delete(htmlCache.keys().next().value);
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.send(r.t);
          })
          .catch(function () {
            if (hit && hit.html) {
              res.setHeader("Content-Type", "text/html; charset=utf-8");
              return res.send(hit.html); // stale beats missing
            }
            next();
          });
      }
      if (feed.slugs === null || Date.now() - feed.at > ttlMs) refreshFeed().then(proceed, proceed);
      else proceed();
    };
  }

  /**
   * Hub-built landing pages on this app's own domain. Same two-stage shape as
   * pagesMiddleware: a cached slug list decides whether a path is ours at all
   * (so unpublished slugs fall through to your own 404), then the HTML is
   * proxied and cached. Fails open in every direction: a hub outage serves the
   * stale copy if there is one and otherwise calls next().
   *
   * basePath defaults to "/p" and is configurable because a spoke may already
   * own that prefix.
   */
  function landingMiddleware(opts) {
    var ttlMs = (opts && opts.ttlMs) || 300000;
    var basePath = ((opts && opts.basePath) || "/p").replace(/\/+$/, "");
    if (basePath.charAt(0) !== "/") basePath = "/" + basePath;
    var re = new RegExp("^" + basePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/([a-z0-9-]+)/?$");
    var feed = { slugs: null, at: 0, pending: null };
    var htmlCache = new Map(); // slug → { html, at }
    function refreshFeed() {
      return refreshSlugFeed(feed, hubUrl + "/api/apps/" + appId + "/landing/feed", ttlMs);
    }
    return function (req, res, next) {
      if (req.method !== "GET") return next();
      var m = re.exec(String(req.path || (req.url || "").split("?")[0]));
      if (!m) return next();
      var slug = m[1];
      function proceed() {
        if (!feed.slugs || !feed.slugs[slug]) return next();
        var hit = htmlCache.get(slug);
        if (hit && Date.now() - hit.at < ttlMs) {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          return res.send(hit.html);
        }
        var origin = (req.protocol || "https") + "://" + req.get("host");
        var signal;
        try { signal = AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined; } catch (e) {}
        fetch(hubUrl + "/api/apps/" + appId + "/landing/render/" + encodeURIComponent(slug) + "?origin=" + encodeURIComponent(origin), { signal: signal })
          .then(function (r) { return r.text().then(function (t) { return { ok: r.ok, t: t }; }); })
          .then(function (r) {
            if (!r.ok) return next();
            htmlCache.set(slug, { html: r.t, at: Date.now() });
            if (htmlCache.size > 300) htmlCache.delete(htmlCache.keys().next().value);
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.send(r.t);
          })
          .catch(function () {
            if (hit && hit.html) {
              res.setHeader("Content-Type", "text/html; charset=utf-8");
              return res.send(hit.html); // stale beats missing
            }
            next();
          });
      }
      if (feed.slugs === null || Date.now() - feed.at > ttlMs) refreshFeed().then(proceed, proceed);
      else proceed();
    };
  }

  // ── Sitemap middleware internals ────────────────────────────────────────────
  // The hub already knows this app's pages (bot crawls), SEO pushes and published
  // blog posts — so it can build the sitemap centrally. This middleware serves it
  // at /sitemap.xml, plus the app's IndexNow key file at /{key}.txt so the hub's
  // publish-time pings verify. Optional { robots: true } serves a minimal
  // /robots.txt referencing the sitemap — leave it off if the app has its own.
  // Cached + fail-open: hub trouble serves the stale copy or falls through.
  function sitemapMiddleware(opts) {
    var ttlMs = (opts && opts.ttlMs) || 600000; // sitemap changes slowly — 10 min
    var serveRobots = Boolean(opts && opts.robots);
    // Keyed by the origin the request arrived on: the hub writes that origin into every
    // <loc>, so one shared copy served the apex's URLs on www (and a studio's on the root).
    var xmlCache = new Map();
    var keyCache = { key: null, pending: null };
    function fetchKey() {
      if (keyCache.key) return Promise.resolve(keyCache.key);
      if (keyCache.pending) return keyCache.pending;
      var signal;
      try { signal = AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined; } catch (e) {}
      keyCache.pending = fetch(hubUrl + "/api/apps/" + appId + "/indexnow-key", { signal: signal })
        .then(function (r) { return r.json(); })
        .then(function (d) { if (d && d.key) keyCache.key = String(d.key); return keyCache.key; })
        .catch(function () { return null; })
        .then(function (k) { keyCache.pending = null; return k; });
      return keyCache.pending;
    }
    return function (req, res, next) {
      if (req.method !== "GET") return next();
      var p = String(req.path || (req.url || "").split("?")[0]);
      var origin = (req.protocol || "https") + "://" + req.get("host");
      if (p === "/sitemap.xml") {
        var cached = xmlCache.get(origin);
        if (cached && Date.now() - cached.at < ttlMs) {
          res.setHeader("Content-Type", "application/xml; charset=utf-8");
          return res.send(cached.xml);
        }
        var signal;
        try { signal = AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined; } catch (e) {}
        return fetch(hubUrl + "/api/apps/" + appId + "/sitemap.xml?origin=" + encodeURIComponent(origin), { signal: signal })
          .then(function (r) { return r.text().then(function (t) { return { ok: r.ok, t: t }; }); })
          .then(function (r) {
            if (!r.ok) return next(); // hub can't build one — let the app's own file win
            if (xmlCache.size >= 20 && !xmlCache.has(origin)) xmlCache.delete(xmlCache.keys().next().value);
            xmlCache.set(origin, { xml: r.t, at: Date.now() });
            res.setHeader("Content-Type", "application/xml; charset=utf-8");
            res.send(r.t);
          })
          .catch(function () {
            var stale = xmlCache.get(origin);
            if (stale) {
              res.setHeader("Content-Type", "application/xml; charset=utf-8");
              return res.send(stale.xml); // stale beats missing for crawlers
            }
            next();
          });
      }
      if (serveRobots && p === "/robots.txt") {
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        return res.send("User-agent: *\nAllow: /\n\nSitemap: " + origin + "/sitemap.xml\n");
      }
      var keyMatch = /^\/([a-f0-9]{64})\.txt$/.exec(p);
      if (keyMatch) {
        return fetchKey().then(function (key) {
          if (key && keyMatch[1] === key) {
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            return res.send(key);
          }
          next();
        });
      }
      next();
    };
  }

  // ── Phase 2 namespaces (the appId is the PATH segment on these routes) ─────────
  var RESALE = "/api/domain-resale/" + encodeURIComponent(appId);
  var RENDER = "/api/domains/render/" + encodeURIComponent(appId);
  var STORE = "/api/app-store/" + encodeURIComponent(appId);
  var MEDIA = "/api/app-media/" + encodeURIComponent(appId);

  // A caller-supplied value that becomes a PATH SEGMENT, screened before the URL is built.
  // encodeURIComponent leaves "." and ".." untouched (both sit in the spec's unreserved
  // set), and the URL parser then REMOVES that segment on the way out, so a per-document
  // call made with "." lands on the collection route and one made with ".." a level above
  // it: a 200 carrying another resource's payload, or an HTML page whose failed json()
  // reads as an empty document, instead of the 400 the hub's own name check would have
  // answered. An empty value collapses the same way and a missing one travels as the
  // literal "undefined". Refused here, in the SDK's own { error, status } shape, so the
  // caller reads it exactly like a refusal from the hub. Returns null when the value is
  // safe to interpolate.
  function badSegment(label, value, opts) {
    var s = value === undefined || value === null ? "" : String(value);
    if (s === "" || s === "." || s === "..") {
      return Promise.resolve({
        error: "A " + label + " is required, and cannot be \".\" or \"..\".",
        status: 400,
      });
    }
    // A slash INSIDE one segment is the same fault a step earlier: the caller is holding a
    // path where the route wants a name. encodeURIComponent hides it as %2F, which this
    // hub's router keeps whole, so nothing collapses today; a proxy that decodes before it
    // routes splits the segment in two and the call lands somewhere else entirely. Refused
    // here so the answer never depends on what is sitting in front of the hub. Pass
    // { path: true } for a value that IS a whole path (a media object name), where the
    // slashes are the point and the value travels in the query string, not the path.
    if (!(opts && opts.path) && (s.indexOf("/") >= 0 || s.indexOf("\\") >= 0)) {
      return Promise.resolve({
        error: "A " + label + " is one path segment, so it cannot contain \"/\" or \"\\\".",
        status: 400,
      });
    }
    return null;
  }

  // A namespace FACTORY takes its id ONCE and hands back an object of calls, so the screen
  // cannot ride on each method the way it does on a flat namespace. Screen the id at the
  // factory instead, and hand back the same shape with every call replaced by the refusal:
  // nothing is ever sent, and whichever call the caller reaches for reads the same
  // { error, status } it would have read from the hub. Every call gets its OWN copy of the
  // refusal, because a caller that annotates what came back must not be editing the answer
  // the next call on the same accessor is about to read.
  function refuseNamespace(bad, ops) {
    var refusing = {};
    Object.keys(ops).forEach(function (k) {
      refusing[k] = typeof ops[k] === "function"
        ? function () { return bad.then(function (r) { return { ...r }; }); }
        : ops[k];
    });
    return refusing;
  }

  // One page of a rows collection, ordered by _updatedAt then id. Named here so the
  // async iterator below can call it without depending on `this`.
  /**
   * limit + cursor for the paged list routes, as query parts a caller joins.
   *
   * A list route answers ONE page (100 rows by default, 500 at most) and carries a
   * `nextCursor`. Dropping it made an app with more rows than that see only its first page
   * and never learn there was a second, which reads exactly like "that is all there is".
   * Page on nextCursor, never on rows.length === limit: a page can be short and still have
   * a cursor. `error` is on the same object, so a refusal is never an empty list either.
   */
  function pageParams(opts) {
    var o = opts || {};
    var q = [];
    if (o.limit) q.push("limit=" + encodeURIComponent(o.limit));
    if (o.cursor) q.push("cursor=" + encodeURIComponent(o.cursor));
    return q;
  }

  /** Join query parts onto a path that may already carry a "?" or nothing at all. */
  function withQuery(pathname, parts) {
    if (!parts.length) return pathname;
    return pathname + (pathname.indexOf("?") >= 0 ? "&" : "?") + parts.join("&");
  }

  function listRowsPage(collection, opts) {
    var bad = badSegment("collection", collection);
    if (bad) return bad;
    var o = opts || {};
    var q = [];
    if (o.since) q.push("since=" + encodeURIComponent(o.since));
    if (o.limit) q.push("limit=" + encodeURIComponent(o.limit));
    if (o.cursor) q.push("cursor=" + encodeURIComponent(o.cursor));
    return get(STORE + "/rows/" + encodeURIComponent(collection) + (q.length ? "?" + q.join("&") : ""));
  }

  return {
    /** The shared hierarchical AI Brain (biz → app → main), scoped to this app + account. */
    brain: {
      // Raw retrieval — returns { success, chunks:[{text,...}] }.
      query: (query, opts = {}) => post("/api/brain/query", { query, appId, accountId, ...opts }),
      // Grounded answer — returns { success, text, citations }.
      chat: (prompt, opts = {}) => post("/api/brain/chat", { prompt, appId, accountId, ...opts }),
      // Training flywheel — ingests rated winners (server ignores rating < 4).
      learn: (body = {}) => post("/api/brain/learn", { appId, accountId, ...body }),
      // Feed private knowledge into a sub-brain. { filename, content, scope:"app"|"biz", accountId? }
      // scope:"app" grounds every answer for this app; scope:"biz" grounds only calls that
      // pass the same accountId (e.g. accountId:"prop-123" → a per-listing/per-customer corpus).
      // Main-corpus ingestion stays hub-admin only. (metered)
      ingest: (body = {}) => post("/api/brain/ingest/text", { appId, accountId, ...body }),
      // Historical-data training: compile this app's stored history (A/B winners, email
      // stats, social posts, telemetry, SEO) into "what worked" docs in its own corpus.
      training: {
        // Per-source counts + what a run would ingest now.
        inventory: () => get(`/api/brain-training/inventory?appId=${encodeURIComponent(appId)}`),
        // { sources?:["experiments","email","social","telemetry","gsc","seo-ranks"], dryRun?, full? }
        run: (opts = {}) => post("/api/brain-training/run", { appId, ...opts }),
        history: () => get(`/api/brain-training/history?appId=${encodeURIComponent(appId)}`),
        // Retrieval probe: does the corpus answer from the trained material?
        verify: (query) => post("/api/brain-training/verify", { appId, query }),
      },
    },
    /** The app's universal profile on the Hub (moat, features, brand, tone, colors…). */
    profile: {
      // Push your app's OWN facts into its profile (free — feeding the moat is frictionless).
      // e.g. hub.profile.push({ tagline, features:[{name,description}], brand:{ tone, colors:{primary:"#7c3aed"} } })
      push: (fields = {}) => post(`/api/profiles/${appId}/ingest`, fields),
      // Ask the Hub to rebuild the profile from every live signal (telemetry, A/B winners,
      // brain, your site). Pass { siteUrl } so the Hub can read your public site.
      sync: (opts = {}) => post(`/api/profiles/${appId}/sync`, opts),
    },
    /**
     * Hub→spoke config: the full variable map, feature flags, copy overrides and brand
     * facts the hub last published for this app. Poll with { since: lastVersion } —
     * the Hub answers { unchanged: true, version } when nothing new was published.
     * (The BROWSER copy overlay needs no code at all: the injected tracker applies it.)
     */
    config: {
      get: (opts = {}) =>
        get(`/api/apps/${appId}/config/full` + (opts.since ? `?since=${encodeURIComponent(opts.since)}` : "")),
    },
    /**
     * Express middleware: server-renders the hub-published per-path SEO head facts
     * (<title> + <meta name="description">) into every outgoing HTML response — so
     * changes made in the hub's On-Page editor are crawler-visible with NO redeploy.
     * Mount once, before your routes/static:  app.use(hub.seoMiddleware());
     * Keyless, cached (60s default — pass { ttlMs }), fail-open: if the hub is
     * unreachable the original HTML is served untouched.
     */
    seoMiddleware: seoMiddleware,
    /**
     * Express middleware: serves this app's hub-published blog at /blog and
     * /blog/:slug — complete SEO-ready pages rendered by the hub (title, meta,
     * canonical to THIS domain, JSON-LD schema, telemetry tracker). Posts published
     * or auto-published on schedule in the hub's Blog Studio appear here with no
     * redeploy. Mount before static/catch-all routes:  app.use(hub.blogMiddleware());
     * Options: { basePath: "/blog", ttlMs: 60000 }. Keyless, cached, fail-open.
     */
    blogMiddleware: blogMiddleware,
    /**
     * Express middleware: serves a living /sitemap.xml the hub builds from
     * everything it knows is live (crawled pages, SEO pushes, published blog
     * posts) plus this app's IndexNow key file at /{key}.txt — so the hub can
     * ping Bing/Yandex the moment it publishes something here. Mount before
     * static/catch-all routes:  app.use(hub.sitemapMiddleware());
     * Options: { ttlMs: 600000, robots: true } — robots serves a minimal
     * /robots.txt referencing the sitemap (skip if the app ships its own).
     * Keyless, cached, fail-open. Note: Google doesn't support IndexNow — it
     * reads the sitemap itself; reference it in robots.txt or Search Console.
     */
    sitemapMiddleware: sitemapMiddleware,
    /**
     * Express middleware: serves hub-published programmatic landing pages at
     * /lp/:slug (service × location pages the SEO Suite generates) — complete
     * SEO-ready pages rendered by the hub, live/unlisted with no redeploy.
     * Mount with the blog middleware:  app.use(hub.pagesMiddleware());
     * Options: { ttlMs: 300000 }. Keyless, cached, fail-open.
     */
    pagesMiddleware: pagesMiddleware,
    /**
     * Express middleware: serves hub-built LANDING pages at /p/:slug — the
     * standalone campaign pages you (or your own customers) build with the
     * landing builder, complete with theme, motion and SEO tags.
     * Mount alongside the others:  app.use(hub.landingMiddleware());
     * Options: { basePath: "/p", ttlMs: 300000 }. Keyless, cached, fail-open.
     * Not to be confused with pagesMiddleware, which serves the SEO Suite's
     * generated service-by-location pages at /lp/:slug.
     */
    landingMiddleware: landingMiddleware,
    /**
     * The full SEO Suite as an API — every feature the hub's SEO tabs use, callable
     * with this app's key, tenant-scoped to its own data. Reads of stored data are
     * free; provider/AI calls are metered in credits (live price card:
     * GET {hubUrl}/api/credits/pricing — 1 credit = $0.01; indicative prices below).
     */
    seo: {
      // ── Free reads (stored/cached data) ─────────────────────────────────────
      // Prioritized to-do list (crawl+GSC+ranks+blog+AI sources; done tasks are
      // live re-verified). { includePaid: true } adds backlink/domain checks (15 cr).
      tasks: (opts = {}) =>
        get(`/api/seo/tasks?appId=${encodeURIComponent(appId)}` +
          (opts.origin ? `&origin=${encodeURIComponent(opts.origin)}` : "") +
          (opts.includePaid ? "&includePaid=1" : "")),
      setTaskStatus: (taskId, status) => post("/api/seo/tasks/status", { appId, taskId, status }),
      rankHistory: () => get(`/api/seo/rank/history?appId=${encodeURIComponent(appId)}`),
      serpFeatures: () => get(`/api/seo/serp/features?appId=${encodeURIComponent(appId)}`),
      linkSuggestions: () => get(`/api/seo/links/suggest?appId=${encodeURIComponent(appId)}`),
      prospects: () => get(`/api/seo/links/prospects?appId=${encodeURIComponent(appId)}`),
      setProspectStatus: (domain, status, note) =>
        post("/api/seo/links/prospects/status", { appId, domain, status, ...(note ? { note } : {}) }),
      localHistory: () => get(`/api/seo/local/history?appId=${encodeURIComponent(appId)}`),
      aiVisibilityHistory: () => get(`/api/seo/ai-visibility/history?appId=${encodeURIComponent(appId)}`),
      landingPages: () => get(`/api/seo/progpages/list?appId=${encodeURIComponent(appId)}`),
      publishLandingPages: (slugs, unpublish) =>
        post("/api/seo/progpages/publish", { appId, slugs, ...(unpublish ? { unpublish: true } : {}) }),
      indexnowStatus: () => get(`/api/seo/indexnow/status?appId=${encodeURIComponent(appId)}`),
      indexnowPing: (paths) =>
        post("/api/seo/indexnow/ping", { appId, ...(paths && paths.length ? { paths } : {}) }),
      copilotContext: () => get(`/api/seo/copilot/context?appId=${encodeURIComponent(appId)}`),
      rankSchedule: () => get(`/api/seo/rank/schedule?appId=${encodeURIComponent(appId)}`),
      // Daily tracked checks, hard monthly USD cap; runs also debit this app's credits.
      setRankSchedule: (opts = {}) => post("/api/seo/rank/schedule", { appId, ...opts }),

      // ── Metered actions (indicative credits — pricing endpoint is the contract) ──
      siteSync: (url, opts = {}) => post("/api/seo/site/sync", { appId, url, ...opts }),               // 5
      rankCheck: (target, keywords) => post("/api/seo/rank/check", { appId, target, keywords }),       // 2/kw
      volumes: (keywords) => post("/api/seo/keywords/volume", { keywords }),                           // 25
      cluster: (target, keywords) => post("/api/seo/keywords/cluster", { target, keywords }),          // 2/kw
      keywordGap: (target, competitor) => post("/api/seo/keywords/gap", { target, competitor }),       // 10
      keywordSuggestions: (keyword) => post("/api/seo/keywords/suggestions", { keyword }),             // 10
      domainOverview: (target) => get(`/api/seo/domain/overview?target=${encodeURIComponent(target)}`),          // 10
      rankedKeywords: (target) => get(`/api/seo/domain/ranked-keywords?target=${encodeURIComponent(target)}`),   // 10
      competitors: (target) => get(`/api/seo/domain/competitors?target=${encodeURIComponent(target)}`),          // 10
      backlinks: (target) => get(`/api/seo/backlinks/summary?target=${encodeURIComponent(target)}`),             // 10
      prospect: (target, competitor) => post("/api/seo/links/prospect", { appId, target, competitor }),          // 25
      localCheck: (opts = {}) => post("/api/seo/local/check", { appId, ...opts }), // {businessName, domain, location, keywords} — 5
      aiVisibilityCheck: (opts = {}) => post("/api/seo/ai-visibility/check", { appId, ...opts }), // {brand, domain, prompts, platforms} — 15/platform×prompt
      geoPlan: (opts = {}) => post("/api/seo/geo/plan", { appId, ...opts }),                           // 5
      onpageAudit: (url) => post("/api/seo/onpage/audit", { url }),                                    // 1
      aifix: (url, targetKeyword) =>
        post("/api/seo/onpage/aifix", { url, ...(targetKeyword ? { targetKeyword } : {}) }),           // 2
      brief: (keyword, target) => post("/api/seo/brief", { appId, keyword, ...(target ? { target } : {}) }), // 10
      explainTask: (task = {}) => post("/api/seo/tasks/explain", task), // {title, detail, source} — 1
      copilotAsk: (question, history = []) => post("/api/seo/copilot/ask", { appId, question, history }),    // 5
      generateLandingPages: (opts = {}) => post("/api/seo/progpages/generate", { appId, ...opts }), // {businessName, services, locations, facts} — 3/page
    },
    /**
     * The Paid Ads engine as an API — research, generate, score and optimize ads
     * with this app's key (billed to its own wallet). Stateless AI only: the hub's
     * own Meta account, ad-account provisioning and live campaign launch are NOT
     * exposed. Metered calls cost credits (live price card:
     * GET {hubUrl}/api/credits/pricing — 1 credit = $0.01; indicative prices below).
     */
    ads: {
      // Research (free): live ads in the Meta Ad Library by topic/competitor.
      // { q, countries:["US"], status:"ACTIVE", adType:"ALL"|"POLITICAL_AND_ISSUE_ADS", limit }
      library: (opts = {}) =>
        get(`/api/meta/ad-library?q=${encodeURIComponent(opts.q || "")}` +
          (opts.countries ? `&countries=${encodeURIComponent([].concat(opts.countries).join(","))}` : "") +
          (opts.status ? `&status=${encodeURIComponent(opts.status)}` : "") +
          (opts.adType ? `&adType=${encodeURIComponent(opts.adType)}` : "") +
          (opts.limit ? `&limit=${encodeURIComponent(opts.limit)}` : "")),
      // Create (metered ~25 cr): AI writes the copy + renders the creative graphic.
      // { brief, audience, dailyBudget, destinationUrl, brandStyle, includeImage, includeVideo }
      buildAd: (opts = {}) => post("/api/meta/ai-build-ad", opts),
      // Create (metered): high-CRO ad copy for any channel (Meta/Google/Twitter/Reddit/TikTok).
      // { channel, objective, budget, appName, goal, audience, currentUSP }
      generateCopy: (opts = {}) => post("/api/ai/crm-action", { actionType: "generate-ad-campaign", payload: opts }),
      // Measure (metered ~3 cr): predicted 0-100 performance score for a draft before spend.
      // { headline, primaryText, description, callToAction, channel, objective, audience }
      scoreCreative: (opts = {}) => post("/api/meta/score-creative", opts),
      // Optimize (metered ~4 cr): prioritized, data-grounded actions over campaign insights.
      // recommend([{ name, objective, insights:{impressions,clicks,ctr,spend,conversions} }])
      recommend: (campaigns = []) => post("/api/meta/recommendations", { campaigns }),
    },
    /**
     * Email (ESP) — send marketing/transactional email through the Hub's SendGrid
     * transport plus the AI layer. Your AUDIENCE stays in YOUR app: you pass the
     * recipients (no per-contact storage tax). Sends go through the Hub's SendGrid
     * account; the underlying key is never exposed. Your customers can connect their
     * OWN domains via email.senders.* (scoped to your appId) and you send from them.
     * (Sends metered — see GET {hubUrl}/api/credits/pricing; sender setup is free.)
     */
    email: {
      // Is the Hub email transport connected/live for your app? (free)
      status: () => get("/api/email/status?appId=" + encodeURIComponent(appId)),
      // Send (metered per recipient): { subject, html, appName, segment, recipients:[{email,name}], sandbox }
      //   Optional { senderId } or { accountId } sends from a connected sender identity
      //   (a customer's own verified domain); omit both to use your app's default From.
      //   Optional { attachments:[{ filename, content (base64), type? }] } — file
      //   attachments (e.g. a signed PDF); sanitized + size-capped (~20MB total) hub-side.
      // Injects a CAN-SPAM List-Unsubscribe header + suppression automatically.
      send: (opts = {}) => post("/api/email/send", { appId: appId, ...opts }),
      // Compose (metered): AI writes subject + responsive HTML from a brief.
      // { brief, appName, characterId? (write in that brand character's voice —
      //   see hub.characters; also accepted by /api/email/ai-flow) }
      compose: (opts = {}) => post("/api/email/ai-compose", { appId: appId, ...opts }, 3 * 60 * 1000),
      // Segment (metered): compile a plain-English audience over YOUR contacts.
      // { query, contacts:[{email,name,status,lastContacted,tags,leadScore}] } → { matched, filters }
      segment: (opts = {}) => post("/api/email/segment/nl", { appId: appId, ...opts }),
      // Track a customer event → auto-enrolls the contact into any flow whose trigger
      // matches, and (with a value) attributes revenue to the send that drove it. (free)
      //   { email, event, name?, accountId?, properties?, value?, currency? }
      //   Built-in events: "subscribed" (opt-in), "tag_added" (properties.tag); any other
      //   name is a custom trigger, e.g. track({ email, event:"placed_order", value:120 }).
      track: (opts = {}) => post("/api/email/track", { appId: appId, accountId: accountId, ...opts }),
      // Account analytics: deliverability health (bounce/spam vs Gmail thresholds),
      // attributed revenue, and per-flow funnel. (free)
      analytics: () => get("/api/email/analytics?appId=" + encodeURIComponent(appId)),
      // Broadcast ledger (real live stats). { accountId? } scopes to one end-customer of a
      //   multi-tenant spoke; omit for the app-level list. (free)
      //   → { broadcasts:[{ id, subject, sentDate, delivered, opens, clicks, bounces, spamreports, unsubscribes }] }
      broadcasts: (opts = {}) => get("/api/email/broadcasts?appId=" + encodeURIComponent(appId) +
        (opts.accountId ? "&accountId=" + encodeURIComponent(opts.accountId) : "")),
      // Audience intelligence (free, LLM-free): engaged/cold lifecycle split, per-contact
      // engagement scores, churn risk, LTV — plus what Klaviyo would charge for this list.
      // Cold profiles are stored FREE and held out of broadcasts (send { includeCold:true }
      // or a win-back flow to reach them). send() also accepts { sendTime:"optimal" } to
      // deliver at each contact's own best open hour.
      audience: () => get("/api/email/audience?appId=" + encodeURIComponent(appId)),
      // Full predictive read for one contact: CLV, churn risk, next-order estimate,
      // best send hour. (free) → { predictions }
      predictions: (email) => get("/api/email/predictions?appId=" + encodeURIComponent(appId) + "&email=" + encodeURIComponent(email)),
      // Live-at-open content: create deadline/stock-driven blocks; embed the returned
      // img/go URLs in your emails — they 302 to the RIGHT asset at the moment of open.
      live: {
        list: () => get("/api/email/live?appId=" + encodeURIComponent(appId)),
        // { name, kind:"image"|"link", deadline?, beforeUrl, afterUrl, stockUrl?, stockPath?, stockThreshold? }
        create: (opts = {}) => post("/api/email/live", { appId: appId, ...opts }),
        remove: (id) => badSegment("live campaign id", id) || del("/api/email/live/" + encodeURIComponent(id) + "?appId=" + encodeURIComponent(appId)),
      },
      // Live bandit standings for a flow's send-step variants (add `variants` to a send
      // step and the scheduler auto-optimizes by open rate — no manual A/B). (free)
      bandit: (flowId) => badSegment("flow id", flowId) || get("/api/email/flows/" + encodeURIComponent(flowId) + "/bandit?appId=" + encodeURIComponent(appId)),
      // Signup forms (list growth, free): design popups/bars/flyouts/embeds — the app's
      // tracker tag renders them; submits join the audience as "subscribed" (+ tags).
      forms: {
        // Running A/B tests are decorated with abResults (cvr per side, z, leader).
        list: () => get("/api/email-forms?appId=" + encodeURIComponent(appId)),
        // End a form's A/B test: variant "b" makes the challenger the champion.
        promote: (id, variant) => badSegment("signup form id", id) || post("/api/email-forms/" + encodeURIComponent(id) + "/promote", { appId, variant: variant }),
        // AI copywriter (grounded in the app profile): { goal?, tone?, formType? } →
        // { suggestions: [{ headline, body, buttonText, successMessage }] }. Keyed.
        aiCopy: (opts = {}) => post("/api/email-forms/ai-copy", { appId, ...opts }, 60 * 1000),
        // { name, type:"popup"|"bar"|"flyout"|"embed", design:{headline,buttonText,...}, targeting?, action? }
        save: (opts = {}) => post("/api/email-forms", { appId, ...opts }),
        toggle: (id) => badSegment("signup form id", id) || post("/api/email-forms/" + encodeURIComponent(id) + "/toggle", { appId }),
        remove: (id) => badSegment("signup form id", id) || del("/api/email-forms/" + encodeURIComponent(id) + "?appId=" + encodeURIComponent(appId)),
      },
      // Pre-send deliverability/compliance check (spam words, links, unsubscribe). (free)
      //   { subject, html } → { score, warnings, checks:[{ id, label, level, detail }] }
      lint: (opts = {}) => post("/api/email/lint", { appId: appId, ...opts }),
      // Sender identities — let YOUR customers connect & send from their own domains.
      // Domain authentication (SPF/DKIM) runs on the Hub's SendGrid account; the key
      // stays hidden. All scoped to your appId; accountId identifies one of your users.
      senders: {
        // List sender identities (optionally for one customer account). (free)
        list: (accountId) => get("/api/email/senders?appId=" + encodeURIComponent(appId) + (accountId ? "&accountId=" + encodeURIComponent(accountId) : "")),
        // Create: { type:"domain"|"single_sender", accountId?, domain?, fromEmail, fromName?, replyTo?, physicalAddress }
        //   domain → returns { sender: { dns } } CNAME records to add; single_sender → SendGrid emails a confirm link. (free)
        create: (opts = {}) => post("/api/email/senders", { appId: appId, ...opts }),
        // Re-check verification (validate DNS / poll the confirmation). (free)
        verify: (id) => badSegment("sender id", id) || post("/api/email/senders/" + encodeURIComponent(id) + "/verify", { appId: appId }),
        // Remove a sender identity. (free)
        remove: (id) => badSegment("sender id", id) || del("/api/email/senders/" + encodeURIComponent(id) + "?appId=" + encodeURIComponent(appId)),
        // Domain authentication report: SPF / DKIM / DMARC / MX + a send-ready verdict.
        // Gmail & Yahoo require DMARC for bulk mail — check before you send. (free)
        //   → { auth: { spf, dkim, dmarc:{present,policy,suggestedHost,suggestedValue}, mx, sendReady } }
        auth: (id) => badSegment("sender id", id) || get("/api/email/senders/" + encodeURIComponent(id) + "/auth?appId=" + encodeURIComponent(appId)),
      },
      // Per-tenant inbox (receiving). Scoped to your appId; accountId identifies one of
      // your end-customers ("" = your app's own inbox). Inbound mail addressed to
      // acct-<accountId>@<your inbound hostname> lands in that account's inbox. (free)
      inbox: {
        // List messages. { accountId?, status?, threadId? } → { messages, counts }
        list: (opts = {}) => get("/api/email/inbox?appId=" + encodeURIComponent(appId) +
          (opts.accountId ? "&accountId=" + encodeURIComponent(opts.accountId) : "") +
          (opts.status ? "&status=" + encodeURIComponent(opts.status) : "") +
          (opts.threadId ? "&threadId=" + encodeURIComponent(opts.threadId) : "")),
        // (Re)generate the AI draft. { accountId?, direction? } (metered)
        draft: (id, opts = {}) => badSegment("inbox message id", id) || post("/api/email/inbox/" + encodeURIComponent(id) + "/draft", { appId: appId, ...opts }, 3 * 60 * 1000),
        // Send a human reply (or the draft verbatim via useDraft:true).
        //   { accountId?, text?, useDraft?, senderId? } (metered)
        reply: (id, opts = {}) => badSegment("inbox message id", id) || post("/api/email/inbox/" + encodeURIComponent(id) + "/reply", { appId: appId, ...opts }),
        // Archive / ignore / reopen. { accountId?, status:"archived"|"ignored"|"new" }
        setStatus: (id, opts = {}) => badSegment("inbox message id", id) || post("/api/email/inbox/" + encodeURIComponent(id) + "/status", { appId: appId, ...opts }),
        // Per-tenant policy (the autopilot dial). { accountId? }
        policy: (accountId) => get("/api/email/inbox/policy?appId=" + encodeURIComponent(appId) + (accountId ? "&accountId=" + encodeURIComponent(accountId) : "")),
        setPolicy: (opts = {}) => post("/api/email/inbox/policy", { appId: appId, ...opts }),
      },
      // Receiving (SendGrid Inbound Parse). One hostname per app; mail addressed to
      // acct-<accountId>@<host> lands in that account's inbox. (free)
      inboundParse: {
        // Status of the app's receiving hostname (e.g. reply.acme.com). → { configured, hostname }
        status: () => get("/api/email/inbound-parse/status?appId=" + encodeURIComponent(appId)),
        // Register a receiving hostname. { hostname } → { hostname, mx:{type,host,value,mxPref}, note }
        setup: (hostname) => post("/api/email/inbound-parse/setup", { appId: appId, hostname }),
      },
      // Engagement tracking (SendGrid Event Webhook): delivered/opens/clicks/bounces
      // attributed back to each send, scoped per accountId. (free)
      webhook: {
        // Status. → { configured, signed, url, events, publicBase }
        status: () => get("/api/email/webhook/status?appId=" + encodeURIComponent(appId)),
        // Point SendGrid's Event Webhook at this hub and enable signing. → { id, url, events, signed }
        setup: (opts = {}) => post("/api/email/webhook/setup", { appId: appId, ...opts }),
      },
      /** HANDS-FREE domain connect: authenticate a sending domain with SendGrid AND
       *  write every DNS record (DKIM/SPF CNAMEs + a starter DMARC) into Namecheap for
       *  you, then poll to validate — no copy-pasting records. Idempotent: re-run as DNS
       *  propagates to finish verifying. { domain, fromEmail?, accountId? } →
       *  { sendReady, verified, dns:{applied,verified,records}, note }. If the domain
       *  isn't Namecheap-managed it hands the records back to publish yourself. (free) */
      connectDomain: (opts = {}) => post("/api/email/domain-connect", { appId: appId, ...opts }, 60000),
      /** SMS channel (BYO Telnyx/Twilio key — connect in the hub's Email → SMS tab).
       *  One audience, two channels: sends go ONLY to contacts with explicit SMS
       *  opt-in (TCPA); STOP replies opt out automatically. 1 cr/SMS, 2 cr/MMS on
       *  live deliveries; sandbox mode records without sending, free. */
      sms: {
        // Channel status + consent counts. (free)
        status: () => get("/api/sms/status?appId=" + encodeURIComponent(appId)),
        // Record explicit opt-in your app collected: { email, phone, consent?:"opted_in"|"opted_out", name? } (free)
        consent: (opts = {}) => post("/api/sms/consent", { appId: appId, consent: "opted_in", ...opts }),
        // Text every opted-in contact: { message, mediaUrl? } → { blast } (1 cr/SMS · 2 cr/MMS, quiet hours defer)
        send: (opts = {}) => post("/api/sms/send", { appId: appId, ...opts }),
        // Opted-in audience + channel stats. (free)
        audience: () => get("/api/sms/audience?appId=" + encodeURIComponent(appId)),
        // Recent blasts + message log (including inbound STOP/replies). (free)
        history: () => get("/api/sms/history?appId=" + encodeURIComponent(appId)),
      },
    },
    /** End-user sign-in (Firebase Auth) — let your users sign up / sign in with
     *  Google, Apple, email-link, etc. Your frontend runs the Firebase client
     *  SDK (bootstrap it from auth.config()); after sign-in it sends the ID
     *  token to YOUR backend, which calls auth.login() — the hub verifies the
     *  token cryptographically, links the person onto the shared account plane,
     *  and ensures their per-user credits wallet. Use user.uid as the userId
     *  for hub.credits.user(uid) — a verified id, never browser-asserted. Free.
     *    1. const { webConfig } = await hub.auth.config()  // → initializeApp(webConfig)
     *    2. browser: signInWithPopup(auth, new GoogleAuthProvider())
     *                → idToken = await result.user.getIdToken()
     *    3. your server: const s = await hub.auth.login({ idToken })
     *       → { user:{uid,email,emailVerified,name,provider}, account, wallet } */
    auth: {
      // Firebase web-app config (public-safe) for the client SDK. (free)
      config: () => get("/api/auth/config?appId=" + encodeURIComponent(appId)),
      // Verify an ID token, no side effects: { idToken } → { user }. (free)
      verify: (idToken) => post("/api/auth/verify", { appId: appId, idToken: idToken }),
      // Verify + provision shared account + ensure per-user wallet — call on
      // every sign-in: { idToken, name?, role? } → { user, account, wallet }. (free)
      login: (opts = {}) => post("/api/auth/login", { appId: appId, ...opts }),
    },
    /** Shared account plane (Tier B) — provision your authenticated people onto
     *  the Hub's cross-app account plane, and register your Firestore rules
     *  fragment (the Hub is the sole rules deployer — spokes never run
     *  `firebase deploy`). Free, keyed to YOUR app; the appId in the path is
     *  enforced against your key server-side. */
    account: {
      // { email, personId, name?, role? } → { created, storage, account }.
      // Idempotent — call on magic-link consume / first authenticated request.
      provision: (opts = {}) => post("/api/shared-accounts/" + encodeURIComponent(appId) + "/provision", { ...opts }),
      // ?email= → { exists, linkedToThisApp, appCount, link } (only YOUR app's
      // link is disclosed; other apps appear as a count).
      lookup: (email) => get("/api/shared-accounts/" + encodeURIComponent(appId) + "/lookup?email=" + encodeURIComponent(email)),
      // Register/update this app's INNER rules fragment (match blocks only —
      // the Hub owns the rules_version/service shell). Never deploys by itself.
      submitRulesFragment: (fragment) => post("/api/shared-accounts/" + encodeURIComponent(appId) + "/rules-fragment", { fragment }),
    },
    /** Generative media — images & video via the Hub's model garden (Imagen/Veo by
     *  default; provider:"muapi" routes FLUX/Kling/Sora/Seedance/etc and returns a
     *  hosted URL). Keyed + credit-metered. Long-running, so call from a background
     *  job or queue, not inside a user's request path. */
    image: {
      // { prompt, aspectRatio?, provider?, muapiModel? } → { imageUrl, model }
      // Default Imagen returns a base64 data: URL; provider:"muapi" returns a hosted URL.
      generate: (opts = {}) => post("/api/ai/generate-image", { appId: appId, ...opts }, 3 * 60 * 1000),
      // Image→image editing via the Hub's i2i model garden (virtual staging, object
      // removal, product shots, upscaling…). { modelId, prompt, referenceImages:[dataUrl|url], params? }
      //   → { outputs, model }. e.g. modelId:"nano-banana-edit", "flux-kontext-dev-i2i",
      //   "ai-object-eraser" (catalog: GET /api/studio/muapi-models). data: URL references
      //   are hosted for you. Metered at the model's live catalog price.
      edit: (opts = {}) => post("/api/ai/generate", { appId: appId, provider: "muapi", ...opts }, 5 * 60 * 1000),
    },
    video: {
      // { prompt, aspectRatio?, durationSeconds?, imageBase64?, imageMimeType?, provider?, muapiModel?, quality? }
      //   → { jobId, videoUrl, model }. Default Veo blocks until the clip is ready
      //   (up to ~6 min, served from /api/studio/media/:jobId/clip.mp4);
      //   provider:"muapi" (Kling/Sora/…) returns a hosted URL.
      //   quality:"draft" renders a cheap low-cost cut (~2 cr) to approve the
      //   direction before paying for a premium model.
      generate: (opts = {}) => post("/api/ai/generate-video", { appId: appId, ...opts }, 10 * 60 * 1000),
      // Instant poster frame (~seconds, 2 cr): { prompt, aspectRatio? } →
      //   { previewUrl, model }. Show it while generate() renders — fire both
      //   in parallel: const [poster, clip] = [hub.video.preview({prompt}), hub.video.generate({prompt})];
      preview: (opts = {}) => post("/api/ai/video-preview", { appId: appId, ...opts }, 3 * 60 * 1000),
    },
    /** App Trailer — a produced explainer/pitch video for THIS app: the Hub writes
     *  a script from your profile/brain, records your REAL UI (headless browser),
     *  generates an AI spokesperson, and lays in voiceover + captions + a ducked
     *  music bed → an MP4 (openable in the Video Editor). Long-running: create()
     *  returns a jobId in seconds; poll status() every ~5s until status==="done"
     *  (2–10 min). Metered on create (draft ≈ 100 cr, final ≈ 350 cr — see
     *  /api/credits/prices). Needs MUAPI_API_KEY on the hub; UI capture degrades to
     *  brand slides when the host has no headless browser. */
    trailer: {
      // { url?, tier?:"draft"|"final", aspects?:["16:9"|"9:16"], avatarId?, referenceImage?,
      //   avatarOutro?, voiceId?, withMusic?, requireCapture?, brief? }
      //   → { jobId, captureAvailable, estCredits }
      create: (opts = {}) => post("/api/app-trailer/jobs", { appId: appId, ...opts }, 30000),
      // → { job: { status, stage, progress, notes, videoUrl?, videoUrlVertical?, docUrl? } }
      //   videoUrl and videoUrlVertical are signed links that expire six hours after this
      //   call: render them, never persist them; call status() again for a fresh one. A
      //   stored copy dies on a clock your database knows nothing about.
      status: (jobId) => badSegment("job id", jobId) || get("/api/app-trailer/jobs/" + encodeURIComponent(jobId)),
    },
    /** Real Estate Reels — listing photos in, a produced 9:16 reel MP4 out: AI shot
     *  plan, camera motion (free Ken Burns draft / AI-animated final), music bed,
     *  optional narration in the agent's cloned voice, per-shot captions, agent/DRE
     *  compliance overlay and an end-card CTA. Long-running: create() returns a jobId;
     *  poll status() every ~5s until status==="done" (draft ~1-3 min, final longer).
     *  Metered on create: draft FREE (daily cap per app) / final 200 cr (+50
     *  withVoiceover) — see /api/credits/prices. Agent defaults (name, DRE#,
     *  brokerage, headshot, CTA, cloned voice) live in settings; per-request `agent`
     *  overrides them. cloneVoice() requires consent:true — the sample must be the
     *  agent's own voice. */
    reels: {
      // { photos:[{url|dataUrl,label?}] (2-12), listing?:{address,price,beds,baths,sqft,features?},
      //   tier?:"draft"|"final", agent?, dreOverlay?:"persistent"|"endcard", cta?, brief?,
      //   withMusic?, withVoiceover? (final only), fromJobId? (reuse a draft's plan+music) }
      //   → { jobId, estCredits }
      // Revision (edit words/transitions, regenerate VO, re-render — reuses footage+music,
      // currently free): { revision: { ofJobId, plan: { hook?, cta?, endHeadline?, endNarration?,
      //   shots?: [{ caption?, narration?, motion?, durMs?, transition?: { kind, duration } }] } },
      //   withVoiceover?, withMusic? } — shots keep the same count/order; transition kinds are
      //   the editor2 library (fade, blur-dissolve, push, whip-pan, zoom-blur, dip-to-black, …).
      create: (opts = {}) => post("/api/reels/jobs", { appId: appId, ...opts }, 60000),
      // → { job: { status, stage, progress, notes, videoUrl?, docUrl? } }
      //   videoUrl is a signed link that expires six hours after this call: render it,
      //   never persist it; call status() or list() again for a fresh one.
      status: (jobId) => badSegment("job id", jobId) || get("/api/reels/jobs/" + encodeURIComponent(jobId)),
      // → { jobs: [...] } (live + recent history); every videoUrl is a six hour signed link
      list: () => get("/api/reels/jobs?appId=" + encodeURIComponent(appId)),
      // → { settings: { agent: { agentName, dreLicense, brokerageName, voiceId?, … } } }
      getSettings: () => get("/api/reels/settings?appId=" + encodeURIComponent(appId)),
      // { agentName?, phone?, dreLicense?, brokerageName?, headshotUrl?, disclaimer?,
      //   defaultCta?, dreOverlay? } → { settings } (voice fields are set by cloneVoice)
      saveSettings: (agent = {}, style) => put("/api/reels/settings", { appId: appId, agent: agent, ...(style ? { style: style } : {}) }),
      // { sampleUrl (http(s) or data URL, ~10s clean recording), consent: true,
      //   consentName (whose voice it is), voiceName? } → { voiceId, settings }
      cloneVoice: (opts = {}) => post("/api/reels/voice/clone", { appId: appId, ...opts }, 6 * 60 * 1000),
    },
    /** Voice to Video — two pipelines on one upload.
     *  A SPEECH becomes footage that follows the words (transcript-timed scenes, free
     *  stock or generated shots, captions burned in, your audio untouched). A LONG
     *  VIDEO becomes standalone vertical clips: the finder picks the moments that stand
     *  alone, cuts land in real silence, the crop is framed on the speaker, long pauses
     *  close, and each clip comes back with a caption, hashtags and a cover image.
     *  Priced at cost while the feature is first-party: plan 5 cr, scenes job 10 + 6 per
     *  scene that must be generated (+2 with music), reels 2 + 4 per clip. A job that
     *  fails refunds itself. Upload → plan (cheap, reviewable) → jobs → poll. */
    voiceVideo: {
      // (bytes, contentType) — the RAW file is the body: audio/mpeg, audio/wav, audio/mp4,
      // video/mp4, video/quicktime, video/webm. → { audioId, kind, url, durationMs? }
      // Accepts a Buffer, a Blob, an ArrayBuffer or a typed array.
      upload: (body, contentType) => raw("/api/voice-video/upload?appId=" + encodeURIComponent(appId), body, contentType, 10 * 60 * 1000),
      // { audioId, kind?:"scenes"|"reels", durationMs?, aspectRatio?:"9:16"|"16:9",
      //   source?:"auto"|"generate"|"stock", captions?:"off"|"subtitle"|"bold"|"karaoke",
      //   style?, mood?, brief?, withMusic?,  reels: count?, length?:"short"|"medium"|"long" }
      //   → scenes: { transcript, plan, durationMs, estCredits }
      //     reels:  { transcript, reels:[{startMs,endMs,hook,tag,score,caption,hashtags}], learning? }
      //   Nothing is spent here beyond the plan price: review it, edit it, then create.
      plan: (opts = {}) => post("/api/voice-video/plan", { appId: appId, ...opts }, 10 * 60 * 1000),
      // scenes: { audioId, plan, aspectRatio?, source?, captions?, withMusic?, title? }
      //   a scene may carry { media } from an earlier job's sceneMedia to reuse its
      //   footage for free: hand media.url back exactly as status() gave it, signed or
      //   not. Only this app's own hub-hosted media is accepted; anything else is dropped
      //   and that scene is sourced fresh at the per-scene price (the job's notes say so).
      // reels:  { audioId, kind:"reels", reels, aspectRatio?, captions?, punchUp?, fill?,
      //   bRoll?, outro?, title? } → { jobId, estCredits, queue }
      create: (opts = {}) => post("/api/voice-video/jobs", { appId: appId, ...opts }, 60000),
      // → { job: { status, stage, progress, notes, videoUrl?, docUrl?, portions?,
      //     sceneMedia?, reels?: [{ videoUrl, coverUrl, caption, hashtags, tag, score }] } }
      //   Every media URL in the job (videoUrl, portions[].url, sceneMedia[].url, each
      //   reel's videoUrl and coverUrl) is a signed link that expires six hours after
      //   this call: render it, never persist it; call status() or list() again for a
      //   fresh one. A stored copy dies on a clock your database knows nothing about.
      status: (jobId) => badSegment("job id", jobId) || get("/api/voice-video/jobs/" + encodeURIComponent(jobId) + "?appId=" + encodeURIComponent(appId)),
      // → { jobs: [...] } (running + recent history); every media URL is a six hour signed link
      list: () => get("/api/voice-video/jobs?appId=" + encodeURIComponent(appId)),
      // → { learning: { favours:[tag], postedSeconds, made, posted, note } | null }
      //   What the finder has learned from the clips this app actually published.
      learning: () => get("/api/voice-video/learning?appId=" + encodeURIComponent(appId)),
    },
    /** Characters — one canonical character, every surface (Character OS).
     *  A character = full-res reference images + an AI identity descriptor + an
     *  optional 6-shot sheet, narrative bible, saved wardrobe presets, and an
     *  assigned TTS voice. Generation runs the server likeness guard and returns
     *  a 0-100 score per image. Pricing: generate 70 cr/image (guard retries bill
     *  as generated images), sheet 500 cr, develop 20 cr; save/list/get are free.
     *  Characters live under an accountId — the SDK defaults it to your appId;
     *  pass an explicit accountId to share one cast across apps you own. */
    characters: {
      // → { characters: [...] }
      list: (accountId) => get("/api/character/list?accountId=" + encodeURIComponent(accountId || appId)),
      // → { character } (refs, sheet, bible, voice, presets)
      get: (id, accountId) => badSegment("character id", id) || get("/api/character/" + encodeURIComponent(id) + "?accountId=" + encodeURIComponent(accountId || appId)),
      // { id?, name, notes?, refs?:[{ dataUrl (send FULL-RES bytes) | url, role? }],
      //   voice?:{voiceId,voiceName}, bible?, presets?:[{name,controls}] } → { character }
      save: (opts = {}) => post("/api/character/save", { accountId: appId, ...opts }, 2 * 60 * 1000),
      // (id, { prompt, controls?:{pose,expression,outfit,setting,action,style}, presetId?,
      //   variants?:1|2|4, aspect?, photoreal?, detail? (upscale the winner),
      //   secondCharacterId? (duo scene), guard?:{threshold?,maxRetries?,hardGate?} })
      //   → { results:[{url,score,verdict,notes}], best, model } — 70 cr per generated image
      generate: (id, opts = {}) => badSegment("character id", id) || post("/api/character/" + encodeURIComponent(id) + "/generate", { accountId: appId, ...opts }, 6 * 60 * 1000),
      // 6-shot canonical sheet (front/profile/three-quarter/full-body/expressions)
      // persisted as the character's durable identity anchor — 500 cr
      sheet: (id, accountId, opts = {}) => badSegment("character id", id) || post("/api/character/" + encodeURIComponent(id) + "/sheet", { accountId: accountId || appId, ...opts }, 10 * 60 * 1000),
      // { brief?, fields? } → { bible } — AI-drafts personality/backstory/voice — 20 cr
      develop: (id, opts = {}) => badSegment("character id", id) || post("/api/character/" + encodeURIComponent(id) + "/develop", { accountId: appId, ...opts }, 2 * 60 * 1000),
      // → { summary:{total,published,scheduled,apps}, recent:[...] } — social posts composed as this character
      performance: (id, accountId) => badSegment("character id", id) || get("/api/character/" + encodeURIComponent(id) + "/performance?accountId=" + encodeURIComponent(accountId || appId)),
      // Removes the character (its brandReferences mirror is kept)
      remove: (id, accountId) => badSegment("character id", id) || del("/api/character/" + encodeURIComponent(id) + "?accountId=" + encodeURIComponent(accountId || appId)),
    },
    /** Forms — a form builder as a service (intake, waivers, feedback, contact).
     *  Building/hosting/collecting is FREE; the AI helper (forms.aiDraft) is
     *  currently free too (unpriced). publish() mints a hub-hosted public page at
     *  {hubUrl}/f/<slug> anyone can fill; the server re-validates every submission.
     *  Each response is your app's first-party data, readable via submissions(). */
    forms: {
      // → { forms: [...] }
      list: () => get("/api/forms?appId=" + encodeURIComponent(appId)),
      // → { form }
      get: (id) => badSegment("form id", id) || get("/api/forms/" + encodeURIComponent(id) + "?appId=" + encodeURIComponent(appId)),
      // { title?, description?, fields?:[{type,label,required?,options?,…}] } → { form }
      create: (opts = {}) => post("/api/forms", { appId: appId, ...opts }),
      // (id, { title?, description?, fields? }) → { form } (republishes the public page if already live)
      update: (id, patch = {}) => badSegment("form id", id) || put("/api/forms/" + encodeURIComponent(id), { appId: appId, ...patch }),
      // → { form, publicUrl:"/f/<slug>" } — the form goes live
      publish: (id) => badSegment("form id", id) || post("/api/forms/" + encodeURIComponent(id) + "/publish", { appId: appId }),
      unpublish: (id) => badSegment("form id", id) || post("/api/forms/" + encodeURIComponent(id) + "/unpublish", { appId: appId }),
      remove: (id) => badSegment("form id", id) || del("/api/forms/" + encodeURIComponent(id) + "?appId=" + encodeURIComponent(appId)),
      // → { submissions: [...] } — the response inbox (your first-party data)
      submissions: (id) => badSegment("form id", id) || get("/api/forms/" + encodeURIComponent(id) + "/submissions?appId=" + encodeURIComponent(appId)),
      // { prompt } → { title, description, fields } — drafts fields to insert (does NOT save)
      aiDraft: (prompt) => post("/api/forms/ai-draft", { appId: appId, prompt: prompt }),
      /** WHITE-LABEL: mint a short-lived, scoped builder session token and hand it to
       *  ONE of your end-users' browsers so they can build forms in the embedded
       *  builder WITHOUT ever seeing your secret key. Call this SERVER-SIDE.
       *  { ownerId?, ttlSeconds? } — pass a per-user ownerId to wall each end-user
       *  off to their own forms. → { token, builderUrl:"/forms/build?bt=…", expiresAt }.
       *  Embed builderUrl in an iframe (or open it) for that user. */
      createBuilderSession: (opts = {}) => post("/api/forms/builder-session", { appId: appId, ...opts }),
      // Absolute URL for the embeddable builder given a session token.
      builderUrl: (token) => hubUrl + "/forms/build?bt=" + encodeURIComponent(token),
      // The hub-hosted fill page for a published form — link people straight to it.
      fillUrl: (slug) => hubUrl + "/f/" + encodeURIComponent(slug),
      // Public (keyless): fetch a published form's definition, or submit one programmatically.
      render: (slug) => badSegment("form slug", slug) || get("/api/public/forms/" + encodeURIComponent(slug)),
      submit: (slug, answers, meta = {}) => badSegment("form slug", slug) || post("/api/public/forms/" + encodeURIComponent(slug) + "/submit", { answers: answers, ...meta }),
    },
    /** Linktree — a "link in bio" page as a service. Build unlimited pages (avatar,
     *  bio, a stack of tappable link buttons + social icons), publish each to a short
     *  URL the hub hosts at /l/<slug>, and read back per-link click + view stats.
     *  Building/hosting/analytics are FREE; the public page is keyless. The AI
     *  "draft a whole page from a sentence" call is currently free (key-gated).
     *
     *  MULTI-TENANT: the flat methods drive the app's OWN pages; pass { ownerId } to
     *  give each of your end-users their own page + stats (you scope your users, same
     *  as accountId). Fields on create/update: { title, bio?, avatarUrl?, themeName?
     *  (midnight|snow|sunset|forest|mono), theme?:{bg,button,…hex}, bgImage?:url (full-page
     *  background photo), tracking?:{ga4?:"G-…",metaPixel?:"digits"} (consent-gated on the
     *  public page — only well-formed ids are kept), links:[{label,url,icon?,thumbnailUrl?,
     *  active?}], socials:[{platform,url}] }. Server-side only. */
    linktree: {
      // (ownerId?, { limit?, cursor? }) → { pages:[...], nextCursor:string|null, themes:[...] }.
      //   Pass ownerId to list one end-user's pages. ONE page: keep calling with
      //   cursor = the previous nextCursor until it comes back null. A 503 answers
      //   { error, status } and never an empty pages array.
      list: (ownerId, opts) => get(withQuery(
        "/api/linktree?appId=" + encodeURIComponent(appId) + (ownerId ? "&ownerId=" + encodeURIComponent(ownerId) : ""),
        pageParams(opts))),
      // (id) → { page, publicUrl }. page.views + page.clicks{linkId:n} are live stats.
      get: (id, ownerId) => badSegment("linktree id", id) || get("/api/linktree/" + encodeURIComponent(id) + "?appId=" + encodeURIComponent(appId) + (ownerId ? "&ownerId=" + encodeURIComponent(ownerId) : "")),
      // { title?, bio?, avatarUrl?, themeName?, theme?, bgImage?, tracking?, links?, socials?, ownerId? } → { page }
      create: (opts = {}) => post("/api/linktree", { appId: appId, ...opts }),
      // (id, { title?, bio?, avatarUrl?, themeName?, theme?, bgImage?, tracking?, links?, socials?, ownerId? }) → { page } (republishes if live)
      update: (id, patch = {}) => badSegment("linktree id", id) || put("/api/linktree/" + encodeURIComponent(id), { appId: appId, ...patch }),
      // (id, { slug?, ownerId? }) → { page, publicUrl:"/l/<slug>" }. Omit slug to keep/auto-mint one; a chosen handle 409s if taken.
      publish: (id, opts = {}) => badSegment("linktree id", id) || post("/api/linktree/" + encodeURIComponent(id) + "/publish", { appId: appId, ...opts }),
      unpublish: (id, ownerId) => badSegment("linktree id", id) || post("/api/linktree/" + encodeURIComponent(id) + "/unpublish", { appId: appId, ...(ownerId ? { ownerId } : {}) }),
      remove: (id, ownerId) => badSegment("linktree id", id) || del("/api/linktree/" + encodeURIComponent(id) + "?appId=" + encodeURIComponent(appId) + (ownerId ? "&ownerId=" + encodeURIComponent(ownerId) : "")),
      // (id) → { views, totalClicks, ctr, links:[{id,label,url,clicks}] }
      analytics: (id, ownerId) => badSegment("linktree id", id) || get("/api/linktree/" + encodeURIComponent(id) + "/analytics?appId=" + encodeURIComponent(appId) + (ownerId ? "&ownerId=" + encodeURIComponent(ownerId) : "")),
      // (slug) → { available, reason? } — is this handle free to publish?
      checkSlug: (slug) => get("/api/linktree/check-slug?appId=" + encodeURIComponent(appId) + "&slug=" + encodeURIComponent(slug)),
      // { prompt } → { title, bio, themeName, links, socials } drafted to insert (does NOT save).
      aiGenerate: (prompt) => post("/api/linktree/ai-generate", { appId: appId, prompt: prompt }),
      // Blocks in links[] can be: {type:"link"} (default; featured?, thumbnailUrl? — a
      // cover photo renders the link as a full-width photo card), {type:"header",label}
      // (section title), {type:"email",label} (capture form → subscribers), {type:"embed"}
      // (a YouTube/Vimeo/Spotify url renders as a responsive iframe; other urls fall back
      // to a link card), {type:"quote",text,author?,rating?} (a testimonial/quote card, no
      // url). Any block: startAt?/endAt? (ISO) to schedule when it shows (honored live on
      // the public page). e.g. update(id,{ links:[{type:"header",label:"Shop"},
      // {type:"link",label:"New drop",url:"...",featured:true,thumbnailUrl:"..."}] }).
      // analytics() also returns viewsBySource/clicksBySource/topSources (utm_source or
      // referer-derived channel: instagram/tiktok/…); add ?utm_source= to your share url.
      // → a theme auto-derived from the app's brand profile colors: { theme, themeName } | { theme:null }.
      brandTheme: () => get("/api/linktree/brand-theme?appId=" + encodeURIComponent(appId)),
      // { dataUrl:"data:image/png;base64,...", kind?:"avatar"|"cover"|"background" } → { url }
      // (resized webp; GCS or inline). kind picks the sizing; use the url as avatarUrl, a
      // block thumbnailUrl (kind:"cover"), or the page bgImage (kind:"background").
      uploadImage: (dataUrl, opts) => post("/api/linktree/upload", { appId: appId, dataUrl: dataUrl, ...(opts && opts.kind ? { kind: opts.kind } : {}) }),
      // (id, ownerId?, { limit?, cursor? }) → { subscribers:[{email,name?,at,source}],
      //   nextCursor:string|null } — emails captured by email-blocks on this page. ONE page:
      //   an export walks nextCursor, or it stops at 100 and calls that the whole list.
      subscribers: (id, ownerId, opts) => badSegment("linktree id", id) || get(withQuery(
        "/api/linktree/" + encodeURIComponent(id) + "/subscribers?appId=" + encodeURIComponent(appId) + (ownerId ? "&ownerId=" + encodeURIComponent(ownerId) : ""),
        pageParams(opts))),
      // Absolute URL to a scannable SVG QR for a published page (print/offline funnel).
      qrUrl: (id) => hubUrl + "/api/linktree/" + encodeURIComponent(id) + "/qr.svg?appId=" + encodeURIComponent(appId),
      // (id, "links.yoursite.com") → { url } — front a PUBLISHED page at your own domain
      //   root. The domain must already be attached to this app (hub.domains / Domains tab).
      attachDomain: (id, domain, ownerId) => badSegment("linktree id", id) || post("/api/linktree/" + encodeURIComponent(id) + "/domain", { appId: appId, domain: domain, ...(ownerId ? { ownerId } : {}) }),
      detachDomain: (id, ownerId) => badSegment("linktree id", id) || del("/api/linktree/" + encodeURIComponent(id) + "/domain?appId=" + encodeURIComponent(appId) + (ownerId ? "&ownerId=" + encodeURIComponent(ownerId) : "")),
      // The hub-hosted public page for a published slug — drop this straight in a bio.
      publicUrl: (slug) => hubUrl + "/l/" + encodeURIComponent(slug),
      // Public (keyless): fetch a published page's definition to render it elsewhere.
      render: (slug) => badSegment("linktree slug", slug) || get("/api/public/linktree/" + encodeURIComponent(slug)),
      // Public (keyless): subscribe an email to a page (what an email-block does). { email, name? }.
      subscribe: (slug, email, name) => badSegment("linktree slug", slug) || post("/api/public/linktree/" + encodeURIComponent(slug) + "/subscribe", { email: email, ...(name ? { name } : {}), source: "api" }),
    },
    /** Standalone landing pages built from the shared block engine. Building,
     *  hosting, publishing and stats are FREE; only the AI drafting calls meter.
     *  Multi-tenant: pass ownerId to wall each of your own end-users off to their
     *  own pages (caller-asserted, same partition doctrine as linktree). Slugs are
     *  unique per app, and a page is only public after publish(). Serve them on
     *  your own domain with app.use(hub.landingMiddleware()). */
    landing: {
      // → { templates:[{id,name,description,goal,blockCount,blockTypes,colors,...}], presets }
      templates: () => get("/api/landing/templates"),
      // (id) → { template } including its blocks and resolved theme.
      template: (id) => get("/api/landing/templates?id=" + encodeURIComponent(id)),
      // (ownerId?, { limit?, cursor? }) → { pages:[{id,name,slug,status,visitors,…}],
      //   nextCursor:string|null }. Omit ownerId for the app's own pages; pass one to scope
      //   to that end-user. ONE page: follow nextCursor until it is null.
      list: (ownerId, opts) => get(withQuery(
        "/api/landing/" + encodeURIComponent(appId) + (ownerId !== undefined ? "?ownerId=" + encodeURIComponent(ownerId) : ""),
        pageParams(opts))),
      // (pageId) → { page } with blocks, theme and the published snapshot.
      get: (pageId, ownerId) => badSegment("page id", pageId) || get("/api/landing/" + encodeURIComponent(appId) + "/pages/" + encodeURIComponent(pageId) + (ownerId !== undefined ? "?ownerId=" + encodeURIComponent(ownerId) : "")),
      // { name?, slug?, templateId?, goal?, blocks?, theme?, seo?, ownerId? } → { page } (draft).
      create: (opts = {}) => post("/api/landing/" + encodeURIComponent(appId), opts),
      // (pageId, { name?, slug?, seo?, goal?, theme?, chrome?, blocks?, ownerId? }) → { page }.
      update: (pageId, patch = {}) => badSegment("page id", pageId) || put("/api/landing/" + encodeURIComponent(appId) + "/pages/" + encodeURIComponent(pageId), patch),
      // Snapshots the draft into the live page. Nothing you edit is public until this.
      publish: (pageId, ownerId) => badSegment("page id", pageId) || post("/api/landing/" + encodeURIComponent(appId) + "/pages/" + encodeURIComponent(pageId) + "/publish", ownerId !== undefined ? { ownerId } : {}),
      unpublish: (pageId, ownerId) => badSegment("page id", pageId) || post("/api/landing/" + encodeURIComponent(appId) + "/pages/" + encodeURIComponent(pageId) + "/publish", { unpublish: true, ...(ownerId !== undefined ? { ownerId } : {}) }),
      remove: (pageId, ownerId) => badSegment("page id", pageId) || del("/api/landing/" + encodeURIComponent(appId) + "/pages/" + encodeURIComponent(pageId) + (ownerId !== undefined ? "?ownerId=" + encodeURIComponent(ownerId) : "")),
      // (pageId) → { analytics:{ visitors, conversions, cvr, approximate:true } }.
      analytics: (pageId) => badSegment("page id", pageId) || get("/api/landing/" + encodeURIComponent(appId) + "/pages/" + encodeURIComponent(pageId) + "/analytics"),
      // (slug) → { slug, available } — slugs are unique within your app only.
      checkSlug: (slug, pageId) => get("/api/landing/" + encodeURIComponent(appId) + "/check-slug?slug=" + encodeURIComponent(slug) + (pageId ? "&pageId=" + encodeURIComponent(pageId) : "")),
      // PRICED. { brief, framework?:"12-module"|"pas"|"aida"|"bab"|"storybrand",
      // awareness?, templateId?, goal?, slug?, ownerId?, endUserId? } → { page } (draft).
      aiGenerate: (opts = {}) => post("/api/landing/" + encodeURIComponent(appId) + "/ai/generate-page", opts),
      // PRICED. (block, instruction) → { block } — same type and id, new copy. Not saved.
      aiRewriteBlock: (block, instruction, opts = {}) => post("/api/landing/" + encodeURIComponent(appId) + "/ai/rewrite-block", { block: block, instruction: instruction, ...opts }),
      // Public (keyless): count a conversion yourself when your own CTA converts
      // somewhere the page's own beacon cannot see it.
      trackConversion: (slug) => post("/api/apps/" + encodeURIComponent(appId) + "/landing/event?slug=" + encodeURIComponent(slug) + "&type=conversion", {}),
      // The hub-hosted URL for a published page (before you point a domain at it).
      publicUrl: (slug) => hubUrl + "/api/apps/" + encodeURIComponent(appId) + "/landing/render/" + encodeURIComponent(slug),
    },
    /** Self-serve BYO custom domains (customer-scoped, callerOwnsApp). Attach a
     *  SUBDOMAIN you own at your own registrar: request() hands back the CNAME to
     *  add; the hub adds the domain to Render only after it verifies (by resolving
     *  DNS) that the CNAME points at the hub — it never writes your DNS. Poll
     *  status() until "live", then point a published page at it with
     *  linktree.attachDomain(pageId, domain).
     *  Two scoped sub-namespaces sit beside these: domains.resale (buy and manage
     *  domains for your customers on the operator's registrar) and domains.render
     *  (custom domains on your OWN Render service). Both need an operator-granted
     *  scope; the flat methods here need none. */
    domains: {
      // (domain) → { domain, cname:{host,type,value}, records, status, verified, manual, poll }.
      request: (domain) => post("/api/domains/self/attach", { appId: appId, domain: domain }),
      // (domain) → { status:"pending-dns"|"pending-tls"|"live"|"error", verified, tlsOk, records }.
      status: (domain) => get("/api/domains/self/status?appId=" + encodeURIComponent(appId) + "&domain=" + encodeURIComponent(domain)),
      // → { domains:[{domain,status,records}] } for this app.
      list: () => get("/api/domains/self/list?appId=" + encodeURIComponent(appId)),
      // (domain) → { detached:[domain] }. Removes the domain from the hub's Render
      //   service; leaves your registrar CNAME in place for you to remove.
      detach: (domain) => post("/api/domains/self/detach", { appId: appId, domain: domain }),
      /** Domain RESALE: sell your customers web addresses through the operator's registrar
       *  account, with no registrar credential in your deploy. Every call needs the
       *  operator-granted domain-resale scope (Connections); without it the hub answers
       *  403 naming the scope. A purchase spends the operator's REAL Namecheap balance,
       *  so the quote is taken live at purchase time and refused above DOMAIN_RESALE_MAX_USD
       *  (default $400) or past DOMAIN_RESALE_MAX_PER_DAY (default 20 per app, rolling 24h).
       *  A domain is "yours" only when THIS app bought it here; anything else is 404 with
       *  one wording (ownership is never revealed). FREE, unmetered: you charge your own
       *  customer. Server-side only. */
      resale: {
        // → { configured, connected, sandbox, lastOkAt, lastError, limits:{ maxUsd, maxPerDay },
        //     purchasedLast24h, remainingToday }
        status: () => get(RESALE + "/status"),
        // (q, tlds?) q = a bare name (fans out over com, io, ai, dev, app, co, net, org, xyz,
        //   studio) or a full domain; tlds = ["com","io"] or "com,io" narrows the fan-out (max 30).
        //   → { results:[{ domain, available, premium, price, regularPrice, currency, icannFee, eapFee }] }
        //   price is null when the registrar quoted nothing for that name (an unpriced premium, or a
        //   TLD whose rate card row carries no usable price): render that as "no live price", never 0.
        search: (q, tlds) => {
          // A tlds list that filtered down to nothing means NO tld, but "&tlds=" travels as
          // one blank entry and the route falls back to the whole ten-TLD fan-out, so a
          // caller who narrowed the list to none would be answered with everything.
          var given = tlds !== undefined && tlds !== null && tlds !== "";
          var list = given ? [].concat(tlds).map(function (t) { return String(t).trim(); }).filter(Boolean).join(",") : "";
          if (given && !list) return Promise.resolve({ error: "tlds holds no TLD. Omit it to search the default ten.", status: 400 });
          return get(RESALE + "/search?q=" + encodeURIComponent(q) + (list ? "&tlds=" + encodeURIComponent(list) : ""));
        },
        // (domain, action?) action "register" (default) | "renew"
        //   → { domain, action, tld, price (always above 0), regular, currency, maxUsd }.
        //   404 "No <action> price for .<tld>." when the TLD is off the rate card OR its row carries
        //   no usable price: a blank row is a 404, never a 200 quoting a price of nothing.
        price: (domain, action) => get(RESALE + "/price?domain=" + encodeURIComponent(domain) +
          (action ? "&action=" + encodeURIComponent(action) : "")),
        /** REAL MONEY. { domain (the registrable name, e.g. example.com; a subdomain is 400),
         *  years? (1..10, default 1), registrant: { firstName, lastName, address1, city,
         *  stateProvince, postalCode, country ("US"), phone ("+1.5551234567"), email,
         *  organization?, address2? } (REQUIRED: ICANN's registrant of record is your
         *  customer, never the operator), acceptPremium?: true (a premium name is refused
         *  without it: 400 { premium:true, premiumPrice }) }
         *  → { appId, domain, years, priceUsd (the live quote), purchasedAt, registrantEmail,
         *      chargedAmount (what the registrar really billed), orderId, transactionId, whoisGuard,
         *      nameServers:"namecheap"|"pending" }, plus ceilingBreached:true and a `warning`
         *      sentence together when that charge came back ABOVE the ceiling the quote passed:
         *      the purchase succeeded and the money moved, so show the warning rather than
         *      reading the call as failed.
         *  400 over the ceiling ({ priceUsd, maxUsd }), an incomplete registrant, a subdomain, a
         *  PREMIUM name the registrar would not quote, or no live register price for the TLD (the
         *  last two refuse rather than buy blind); 409 taken, already bought, or already being
         *  bought; 429 { limit, purchasedLast24h } at the per-day cap; 502 when the registrar
         *  refused (retry reaches it again); 503 + Retry-After when the purchase ledger was
         *  unreachable. There is no caller-supplied maxUsd: no retry can lift the ceiling. */
        buy: (opts = {}) => post(RESALE + "/buy", opts, 90 * 1000),
        // (domain, years? | { years? }) renews a domain THIS app bought here. REAL MONEY, same ceiling.
        //   → { domain, years, priceUsd, chargedAmount, orderId, transactionId, renewedAt, warning? }
        //   (a warning means the registrar charged above the ceiling; the renewal still happened).
        //   404 when not yours; 400 over the ceiling or with no live renew price for the TLD;
        //   429 the app is at its registrar orders for the day (a renewal is one of those);
        //   409 a renewal of this name is already with the registrar; 502 registrar;
        //   503 + Retry-After when the ledger was unreachable.
        //   There is no idempotency key on this route, and the 90s ceiling below can time out
        //   a renewal the registrar went on to accept. The hub answers that case 502 with
        //   retrySafe:false and KEEPS its claim, so an immediate retry comes back 409 rather
        //   than paying twice. Confirm with info(domain) (has `expires` moved?) before
        //   trying again.
        renew: (domain, opts) => post(RESALE + "/renew", { domain: domain, ...(typeof opts === "number" ? { years: opts } : (opts || {})) }, 90 * 1000),
        // (domain, { records:[{ type, host, value, ttl?, mxPref? }] (1..50), remove?:[{ type, host }],
        //   emailType?, mode?:"apply" (default) | "preview" }) merges records into the zone of a
        //   domain this app bought: existing records survive; preview writes nothing.
        //   → { ok, zone, mode, applied, verified, changes:[{ action, record, previous? }], resulting,
        //       current?, emailType?, warning? }; 400 { error, reason } invalid or not-our-dns; 502 registrar.
        dnsApply: (domain, opts = {}) => badSegment("domain", domain) ||
          post(RESALE + "/dns/" + encodeURIComponent(domain) + "/apply", opts, 60 * 1000),
        // (domain) → { domain, created, expires, locked, whoisGuard, nameservers, usesNamecheapDns,
        //   isPremium, transferableAt, daysUntilTransferable, purchasedAt, years }; 404 when not yours.
        info: (domain) => badSegment("domain", domain) || get(RESALE + "/domain/" + encodeURIComponent(domain)),
        // (domain, locked:boolean) the registrar lock; unlocking is the first step of a transfer out.
        //   → { domain, locked }; 400 unless locked is a boolean; 404 when not yours.
        lock: (domain, locked) => badSegment("domain", domain) ||
          post(RESALE + "/domain/" + encodeURIComponent(domain) + "/lock", { locked: locked }),
      },
      /** Custom domains on YOUR OWN Render service (the spoke's, not the hub's). The
       *  operator records your service id + host under Connections and grants the
       *  render-domains scope; the Render API key stays on the hub. add() a domain,
       *  show your user the records, then poll status() (or verify()) until it reports
       *  live. Status is Render's own verification; the service id is never echoed, and any
       *  Render wording that reaches you has it stripped out.
       *  Two per-app per-minute budgets bound this surface: reads (config, list, status) 240 a
       *  minute, writes (add, verify, remove) 20, each answering 429 + Retry-After: 60 { error }.
       *  A poller must back off on a 429 rather than retry at once.
       *  FREE, unmetered. Server-side only. */
      render: {
        // (domain?) → { ready, requiredEnv:string[], cnameTarget, apexIp, records:[{ host, type, value }], note }.
        //   Always 200: requiredEnv names what the hub (RENDER_API_KEY) or the operator (your
        //   service) still has to set. With a domain, records are the exact ones for that hostname.
        config: (opts) => {
          var d = typeof opts === "string" ? opts : (opts && opts.domain) || "";
          return get(RENDER + "/config" + (d ? "?domain=" + encodeURIComponent(d) : ""));
        },
        // → { domains:[{ domain, status:"pending-dns"|"live", verificationStatus, verified, records,
        //     render:{ ok, error? }, lastCheckedAt, createdAt }] }
        list: () => get(RENDER + "/list"),
        // (domain) → { domain, appId, records, status, render:{ ok:true, already }, poll, note }.
        //   400 names the missing setup ({ requiredEnv }) or this app's ceiling on custom domains
        //   ({ cap, held } — detach one first); 409 when another app (or the hub's own hosting)
        //   holds it; 429 at the write budget; 502 { kept, render:{ ok:false, error } } when Render
        //   refused, where kept:true means the claim survives (records, status and poll come with
        //   it) and the same call can be retried, and kept:false means the hostname was released.
        add: (domain) => post(RENDER + "/add", { domain: domain }),
        // (domain) → { domain, status, verificationStatus, verified, records, render, lastCheckedAt,
        //   createdAt }; 404 "No such domain for this app." for any domain this app did not add.
        status: (domain) => get(RENDER + "/status?domain=" + encodeURIComponent(domain)),
        // (domain) asks Render to re-check DNS now, then answers exactly like status().
        verify: (domain) => post(RENDER + "/verify", { domain: domain }),
        // (domain) → { appId, detached:[domain], note }. 404 when not this app's (no Render call is
        //   made); 429 at the write budget; 502 when Render did not remove it (mapping kept: retry).
        remove: (domain) => del(RENDER + "/delete?domain=" + encodeURIComponent(domain)),
      },
    },
    /** Tickets — first-class support tickets with a canonical home in the hub.
     *  File one when your chat widget escalates to a human (or from any contact
     *  surface). Create/list/status/message are FREE; the AI reply draft is 3 cr
     *  and each real emailed reply is 1 cr. Replies go out as real email from
     *  your sending domain with Reply-To ticket-<id>@reply.<domain> (once
     *  inbound receiving is set up), so the visitor's answer threads back onto
     *  the ticket automatically. Server-side only — never from the browser. */
    tickets: {
      // { email, message, subject?, name?, page?, source?, transcript?:[{role,text}], priority? }
      //   → { ticket, replyAddress? }. Urgent-sounding tickets auto-flag priority "high".
      create: (opts = {}) => post("/api/tickets/" + encodeURIComponent(appId), opts),
      // → { tickets, counts:{open,pending,closed} }; optional status filter.
      list: (status) => get("/api/tickets/" + encodeURIComponent(appId) + (status ? "?status=" + encodeURIComponent(status) : "")),
      // → { ticket, replyAddress? }
      get: (id) => badSegment("ticket id", id) || get("/api/tickets/" + encodeURIComponent(appId) + "/" + encodeURIComponent(id)),
      // Visitor follow-up while the widget is still open (before any email reply).
      message: (id, text) => badSegment("ticket id", id) || post("/api/tickets/" + encodeURIComponent(appId) + "/" + encodeURIComponent(id) + "/message", { text: text }),
      // { direction? } → { ticket } with ticket.aiDraft — grounded on the app's brain corpus when one exists. 3 cr.
      draft: (id, opts = {}) => badSegment("ticket id", id) || post("/api/tickets/" + encodeURIComponent(appId) + "/" + encodeURIComponent(id) + "/draft", opts, 2 * 60 * 1000),
      // { text } or { useDraft:true } (+ senderId?, sandbox?) → real email to the visitor. 1 cr (sandbox bills 0).
      reply: (id, opts = {}) => badSegment("ticket id", id) || post("/api/tickets/" + encodeURIComponent(appId) + "/" + encodeURIComponent(id) + "/reply", opts),
      // "open" | "pending" | "closed"
      status: (id, status) => badSegment("ticket id", id) || post("/api/tickets/" + encodeURIComponent(appId) + "/" + encodeURIComponent(id) + "/status", { status: status }),
    },
    /** Phone — the AI voice agent. It ANSWERS your provisioned number and PLACES
     *  outbound calls (sales / cold leads / support), holds a real spoken
     *  conversation over Twilio ConversationRelay driven by the Hub's own brain,
     *  then extracts a lead and files it into the CRM. Config/status/reads are
     *  FREE; connected calls bill per completed minute (Twilio + LLM × margin) plus a
     *  monthly per-line rental — both to the line's own (appId, userId) wallet.
     *
     *  MULTI-TENANT: the flat methods below drive the app's OWN business line (the
     *  reserved end-user "owner"); hub.phone.user(endUserId) gives each of YOUR
     *  end-users their own number + agent + wallet + call log. Server-side only. */
    phone: {
      // ── Business line (the app's own number; end-user "owner") ─────────────────
      // → { configured, provisioned, personaSet, autopilot, phoneNumber, direction, brainMode, balance,
      //     suspended, recordCalls, voices:[{ id, label }], stats }  (voices = curated picker options;
      //     persona.voice stays free-form; there's no preview API — the honest preview is a test call)
      //   Tool-bridge posture (four honest booleans, not one fuzzy "connected"):
      //     toolsFeature    the HUB is armed for tool calling at all
      //     toolsConfigured this line has a webhook on record   ·  toolsTokenSet  …and a secret
      //     toolsPaused     toolsEnabled was explicitly set false
      //     toolsActive     all of the above AND the URL still passes the call-time check
      //     toolCount, toolsSendCaller, toolsUpdatedAt, toolsUrlProblem?, and toolsNote (the honest
      //     outcome of the LAST call's tool use — surface it; it's how "the receptionist can't see
      //     the calendar" shows up before a customer reports it).
      //   stats gains toolCalls / toolErrors. Tool rounds are COUNTED, not charged — they sit inside
      //   the existing per-minute allowance.
      status: () => get("/api/phone/status?appId=" + encodeURIComponent(appId)),
      // → { config } (persona, direction, brainMode, autopilot, recordCalls, phoneNumber)
      getConfig: () => get("/api/phone/config/" + encodeURIComponent(appId)),
      // { persona:{ role, goal:"sales"|"support"|"cold-lead", greeting, voice, language, guardrails, forbidden[] },
      //   direction?, brainMode?, autopilot?, recordCalls?, transferNumber?,
      //   toolsUrl?, toolsToken?, toolsEnabled?, toolsSendCaller?, tools? } → { config }
      //   transferNumber "+1…" arms cold transfer: the hub injects a native transfer_to_human tool and
      //   the agent can hand a live caller to that human number mid-call; if nobody answers, the caller
      //   comes back to the agent to leave a message. "" turns it off (omitting the field keeps the
      //   stored value — this config is a patch). Doesn't count against your 8-tool catalog.
      //   recordCalls opts the line into call recording (default OFF) — surface consent language when enabling;
      //   the audio streams from GET .../calls/:id/recording once call.recordingUrl is set.
      //   spamMode: "screen" (default) answers everything and lets the agent hang up politely on a clear
      //   robocall/telemarketer (hub-native end_spam_call tool, no catalog cost); "decline" also rejects
      //   strong-evidence spam BEFORE answering (owner blocklist via spamBlocklist: string[], repeat
      //   offenders, or a marketplace spam score when the operator enabled one); "off" disables both.
      //   Spam-marked calls bill ZERO minutes. Declined calls are still recorded on the calls list
      //   (status "no-answer", spam:true, spamReason) so nothing is invisibly dropped.
      //
      //   LIVE-DATA TOOL BRIDGE (opt-in per line; a line with no toolsUrl behaves exactly as before).
      //   Set toolsUrl to an https endpoint on YOUR server and the agent can call it MID-CALL for real
      //   availability, prices, or a real booking, instead of reciting a persona written at setup time.
      //     toolsUrl        https only, no credentials, port 443. Re-checked at call time.
      //     toolsToken      shared secret. Sent as `Authorization: Bearer <token>` AND as
      //                     `X-Zelus-Signature: sha256=<hmac_sha256(token, timestamp + "." + rawBody)>`
      //                     with `X-Zelus-Timestamp` — verify the HMAC, don't just check the Bearer.
      //                     WRITE-ONLY: getConfig()/status never return it (`toolsTokenSet: true` instead),
      //                     and omitting it on a later save keeps the stored one. Send toolsUrl:"" to
      //                     take the bridge down and forget the URL + catalog.
      //     toolsEnabled    false pauses the bridge while keeping url/token/catalog on record.
      //     toolsSendCaller false suppresses the caller's number + CNAM name (a real person's name from
      //                     a carrier database) — you get a per-call `callerRef` to correlate instead.
      //                     The TRANSCRIPT is never sent, only the model-extracted args.
      //     tools           the CATALOG, stored here rather than fetched per call (a call-start fetch
      //                     would sit between the carrier's inbound webhook and the answer, and the
      //                     caller hears dead air for the whole timeout). Max 8 tools, ≤4000 chars
      //                     serialized. Closed scalar grammar — no nesting:
      //                       { name: "check_availability",            // ^[a-z][a-z0-9_]{0,39}$
      //                         description: "…what it does AND when to use it", // ≤300
      //                         speakWhileRunning: "Let me check the book.",     // ≤120, "" = say nothing
      //                         args: [{ name, type:"string"|"number"|"boolean",
      //                                  description, required?, enum? }] }       // ≤8 args
      //                     ⚠ Declarations describe CAPABILITY, never DATA. Putting today's open slots or
      //                     prices in a description bakes them into the prompt and they get read out stale —
      //                     the exact failure this bridge exists to prevent. The live answer only ever
      //                     comes back from an invocation.
      //   Your endpoint is POSTed { v:1, op:"invoke", appId, endUserId, callId, direction, from, callerName?,
      //   callerRef?, turn, tool, args, requestId, at }. `requestId` is the IDEMPOTENCY KEY — dedupe on it.
      //   `turn` counts the caller's utterances so far: two invocations with the same turn arrived with no
      //   caller speech between them — use it to refuse a write whose read the caller never got to answer
      //   (e.g. booking a window in the same breath as fetching the schedule).
      //   Answer inside 2.5s (hard timeout, not configurable per line), ≤8KB, ALWAYS HTTP 200 for
      //   tool-level outcomes: { ok:true, result:{…}, speak?, end? } or { ok:false, error, speak }.
      //   A non-empty `speak` is spoken VERBATIM and skips the hub's rephrasing turn — use it for
      //   confirmations and for your own failure wording. A 5xx makes the caller hear an apology
      //   instead of your answer. Never retried on timeout (a timed-out booking may have succeeded);
      //   retried exactly once on a connect error or 502/503/504, with the same requestId.
      //   Verify end to end without placing a call: POST .../tools/test { tool, args }.
      setConfig: (opts = {}) => post("/api/phone/config/" + encodeURIComponent(appId), opts),
      // { areaCode? } → { config } — buys + wires a Twilio Voice number for this app.
      provision: (opts = {}) => post("/api/phone/provision/" + encodeURIComponent(appId), opts),
      // Place an outbound call. { to (E.164), goal?, context? } → { call }. Billed per minute on
      // completion. `context` (≤600 chars) is a per-call brief layered on the persona for THIS call only.
      call: (to, opts = {}) => post("/api/phone/" + encodeURIComponent(appId) + "/call", { to: to, ...opts }, 60 * 1000),
      // → { calls:[{ id, direction, from, to, status, durationSec, transcript, outcome }], stats }
      calls: () => get("/api/phone/" + encodeURIComponent(appId) + "/calls"),
      // → { call } with full transcript + extracted lead + outcome.
      getCall: (id) => badSegment("call id", id) || get("/api/phone/" + encodeURIComponent(appId) + "/calls/" + encodeURIComponent(id)),
      // Settle THIS line's monthly rental now (e.g. reactivate a suspended line after a top-up). → { outcome, config }
      rentalRun: () => post("/api/phone/" + encodeURIComponent(appId) + "/rental/run", {}),
      // Pre-flight the live-data tool bridge with no call in flight. { tool, args } → { ok, ms, speak?, result }.
      toolsTest: (tool, args = {}) => post("/api/phone/" + encodeURIComponent(appId) + "/tools/test", { tool: tool, args: args }),

      // ── Per-end-user lines (the self-serve multi-tenant surface) ───────────────
      /** endUserId is caller-asserted (like accountId — the Hub NEVER validates it;
       *  your app key is the only tenancy wall). Pass a STABLE id from your OWN
       *  authenticated user; never take it unchecked from the browser. Returns the
       *  same operations as the business line, scoped to that user, plus per-user
       *  wallet reads, an operator grant, and TEXTING: the same number the line
       *  answers calls on also receives + sends SMS, answered by the same persona
       *  (texts()/text()/sendText()/closeText() below). */
      user: function (endUserId) {
        var bad = badSegment("end-user id", endUserId);
        var A = encodeURIComponent(appId);
        var eu = encodeURIComponent(endUserId);
        var base = "/api/phone/" + A + "/users/" + eu;
        var walletQ = "?appId=" + A + "&userId=" + eu;
        var ops = {
          // → { …status…, balance, suspended, rentalNote }
          status: () => get(base + "/status"),
          getConfig: () => get(base + "/config"),
          // Same shape as the business line, plus an optional { displayName }.
          setConfig: (opts = {}) => post(base + "/config", opts),
          provision: (opts = {}) => post(base + "/provision", opts),
          call: (to, opts = {}) => post(base + "/call", { to: to, ...opts }, 60 * 1000),
          calls: () => get(base + "/calls"),
          getCall: (id) => badSegment("call id", id) || get(base + "/calls/" + encodeURIComponent(id)),
          rentalRun: () => post(base + "/rental/run", {}),
          // Fire ONE declared tool at your own webhook right now, with no call in flight —
          // the pre-flight for the live-data bridge. { tool, args } → { ok, ms, speak?, result, error? }.
          // Uses this line's STORED toolsUrl (never a URL from the request) and sends no caller
          // number. Works even while the hub's tool feature flag is still off.
          toolsTest: (tool, args = {}) => post(base + "/tools/test", { tool: tool, args: args }),
          // ── Texts on the SAME number (the AI answers; same persona, SMS-short) ──
          // COMING SOON: while `smsEnabled` is false (Hub awaiting A2P 10DLC registration),
          // inbound texts ARE received, stored, and listed here, but nothing is sent —
          // sendText() returns { success:false, comingSoon:true, error } and the AI does
          // not reply. Render the inbox read-only with a "Texting coming soon" state.
          // Thread list → { conversations:[{ id, counterparty, lastMessage, optedOut,
          //   unread, capturedLead, needsCredits, closed }], smsCapable, smsEnabled,
          //   comingSoon?, comingSoonNote?, needsCredits, a2pNote }.
          // smsCapable null = the number predates SMS wiring (operator repair:
          // POST /api/phone/admin/sms-backfill). Mirror threads instantly via the
          // "sms.conversation.updated" automation event ({ appId, endUserId, conversationId }).
          texts: () => get(base + "/texts"),
          // Full thread (clears its unread badge) → { conversation } with messages[].
          text: (convId) => badSegment("conversation id", convId) || get(base + "/texts/" + encodeURIComponent(convId)),
          // Realtor-authored outbound: { to (E.164), body } → { conversation }. STOP'd
          // contacts are hard-blocked; TCPA quiet hours apply unless the contact texted
          // within 24h; billed per segment to this user's wallet. No bulk/cold sends here.
          sendText: (opts = {}) => post(base + "/texts/send", opts),
          // Close the thread now → runs lead extraction immediately. → { conversation }
          closeText: (convId) => badSegment("conversation id", convId) || post(base + "/texts/" + encodeURIComponent(convId) + "/close", {}),
          // This user's wallet balance → { wallet:{ balance, granted, spent } }. (free)
          wallet: () => get("/api/credits/wallet" + walletQ),
          // This user's recent ledger (spend + grants) → { entries:[…] }. (free)
          usage: (limit = 50) => get("/api/credits/usage" + walletQ + "&limit=" + limit),
          // Operator-only credit grant (needs { adminToken } on the client; else 403). → { wallet }
          grant: (credits, note = "") => postAdmin("/api/credits/grant", { appId: appId, userId: endUserId, credits: credits, note: note }),
          /** Operator-only membership renewal: issue this period's credits and clear last
           *  period's unused allowance atomically. `keep` is REQUIRED and names the credits
           *  this user PURCHASED (those never expire). Pass { key } for idempotency.
           *  Same call as hub.credits.user(id).renew — see there for the full contract.
           *  → { wallet, granted, expired, skipped } */
          renew: (credits, keep, opts = {}) => postAdmin("/api/credits/renew", {
            appId: appId, userId: endUserId, credits: credits, keep: keep,
            note: opts.note || "", key: opts.key || undefined,
          }),
        };
        return bad ? refuseNamespace(bad, ops) : ops;
      },
      // List every line under this app (owner + all end-users) — for an admin dashboard.
      // → { users:[{ endUserId, displayName, phoneNumber, provisioned, autopilot, suspended,
      //     toolsConfigured, balance }] }
      users: () => get("/api/phone/" + encodeURIComponent(appId) + "/users"),
    },
    /** Calendar sync — YOUR END USERS' calendars, per (appId, userId), like phone
     *  and per-user credits. Two mechanisms: Google (real OAuth the user completes
     *  in a browser — two-way capable) and an ICS subscription feed (Apple Calendar,
     *  also Google/Outlook — one-way, zero credentials, works with Google never
     *  connected). Push every booking on create/change and cancel on cancel; the
     *  hub's event store is the truth and the Google mirror is best-effort, with
     *  the outcome reported per call as { google: "synced"|"skipped"|"failed: …" }. */
    calendar: {
      // Is Google configured on the hub, and which redirect URI must be registered?
      // → { configured, redirectUri, scope } (free)
      status: () => get("/api/calendar/connect/status"),
      /** Everything for ONE of your users. `userId` is your own account id for them
       *  (the same id you use for their wallet) — pick one spelling and keep it. */
      user: function (userId) {
        var bad = badSegment("user id", userId);
        var seg = "/api/calendar/" + encodeURIComponent(appId) + "/" + encodeURIComponent(userId);
        var ops = {
          // → { google:{ connected, needsReconnect, email }, feedUrl, events }
          status: () => get(seg + "/status"),
          /** Mint the hosted Google-consent URL for this user (valid 15 minutes) and
           *  send their BROWSER there (link or redirect — it is a normal web page).
           *  Optional { returnUrl } bounces them back to your app afterwards with
           *  ?calendar=connected|error appended. → { url, expiresInMinutes } */
          connectLink: (opts = {}) => post(seg + "/connect-link", { returnUrl: opts.returnUrl }),
          // Forget the Google link (feed + events untouched). → { google:{ connected:false } }
          disconnect: () => post(seg + "/disconnect", {}),
          /** Upsert one event — `id` is YOUR booking id; pushing the same id again
           *  updates it in place (so call this on every booking change, idempotent).
           *  { id, title, startsAt, endsAt, notes?, location?, allDay? }.
           *  Times MUST carry a timezone (end with Z or ±hh:mm) — an offset-less
           *  datetime is refused rather than guessed. allDay:true takes YYYY-MM-DD
           *  with an EXCLUSIVE end date (omit endsAt for a one-day event).
           *  → { event, google } where google is "synced" | "skipped" | "failed: …" */
          push: (event) => post(seg + "/events", event),
          // Remove a booking from the feed and (when mirrored) from Google. → { google }
          cancel: (eventId) => badSegment("event id", eventId) || post(seg + "/events/" + encodeURIComponent(eventId) + "/cancel", {}),
          // The stored events, soonest first. → { events:[…] }
          events: () => get(seg + "/events"),
          /** The user's ICS subscription URL is in status().feedUrl — show it with an
           *  "add to Apple Calendar" hint. This mints a NEW one and kills every URL
           *  shared before (use when a feed link leaked). → { feedUrl } */
          rotateFeed: () => post(seg + "/feed/rotate", {}),
        };
        return bad ? refuseNamespace(bad, ops) : ops;
      },
    },
    /** Credits & wallets. Every wallet is per (appId, userId); the business owner is
     *  the reserved user "owner". Balance/usage reads work with the app key; grants
     *  are operator-only (create the client with { adminToken } or they 403 — a spoke
     *  cannot grant itself credits). Paid top-ups run through the Hub's Stripe flow. */
    credits: {
      // The public price card (free) → { services:[{ service, credits, … }] }
      pricing: () => get("/api/credits/pricing"),
      // The app's OWN (owner) wallet → { wallet:{ balance, granted, spent } }. (free)
      balance: () => get("/api/credits/wallet?appId=" + encodeURIComponent(appId)),
      // The top-up pack menu → { packs:[{ id, name, credits, usd }] }. (free)
      packs: () => get("/api/stripe/packs?appId=" + encodeURIComponent(appId)),
      /** Start a Stripe Checkout to buy credits. Funds the "owner" wallet unless you pass
       *  { userId }. { packId } OR { credits }, optional { successUrl, cancelUrl, embedded }.
       *  → { url } (redirect the buyer there) or { clientSecret } when embedded:true.
       *  Call from YOUR server; redirect the browser to the returned url. */
      checkout: (opts = {}) => post("/api/stripe/checkout", { appId: appId, ...opts }),
      /** Per-user wallet accessor — mirrors hub.phone.user(id)'s wallet/usage/grant, plus
       *  a self-serve topUp so ANY of your end-users can buy their own credits. */
      user: function (userId) {
        var q = "?appId=" + encodeURIComponent(appId) + "&userId=" + encodeURIComponent(userId);
        return {
          // → { wallet:{ balance, granted, spent } } (free)
          balance: () => get("/api/credits/wallet" + q),
          // → { entries:[…] } recent ledger (free)
          usage: (limit = 50) => get("/api/credits/usage" + q + "&limit=" + limit),
          // Self-serve purchase: a Stripe Checkout that credits THIS user's wallet.
          // { packId } OR { credits }, optional { successUrl, cancelUrl, embedded }.
          // → { url } (redirect the user there) or { clientSecret } (embedded).
          topUp: (opts = {}) => post("/api/stripe/checkout", { appId: appId, userId: userId, ...opts }),
          /** FUND this user from the APP's own wallet, exactly once per `key`. Sent with the
           *  app key (no adminToken): the operator grants the credits-transfer scope from
           *  Connections, else the hub answers 403 naming the scope. This is how a spoke
           *  hands a member the credits they paid the spoke for, with no operator token in
           *  its deploy. { credits (a whole number 1..100000, or a string that spells one:
           *  "0x10" and "1e2" are refused on a route that moves money), key (your payment or
           *  order id: the same key never moves credits twice), note?, protected? (a real
           *  boolean, or the strings "true"/"false" a form post produces; default true: the
           *  user OWNS these credits and a renewal never reclaims them; false = a bonus that
           *  expires at the next renewAllowance) }
           *  The userId is stored EXACTLY as sent and must be 1 to 120 characters of letters,
           *  digits, _ or -. Anything the hub would have to rewrite (an email, a space, 200
           *  characters) is a 400 naming both spellings, because two ids that fold together
           *  would share one wallet.
           *  → { transferred, alreadyApplied, key, userId, owner, user } (both wallets,
           *  annotated). `userId` names the user the CLAIM funded, so on a replay it is the
           *  FIRST call's recipient and not this request's argument.
           *  402 { error, balance, needed } when the app wallet cannot cover it: nothing is
           *  written and the same key succeeds after a top-up. Never overdraws the app.
           *  409 { error, key, userId } when this key already funded a DIFFERENT user, who is
           *  named in userId: do not record this request's user as paid, use a new key.
           *  The user this accessor names is the one funded: a userId inside opts is ignored,
           *  never sent, and can never point the money at somebody else. */
          fund: (opts = {}) => post("/api/credits/transfer", { ...opts, appId: appId, userId: userId }),
          /** Membership renewal funded by the APP wallet (same scope as fund): reclaims this
           *  user's unused allowance into the app wallet, then issues this period's allowance,
           *  in one commit, exactly once per periodKey. The reclaim is capped at what THIS APP
           *  funded unprotected and the user has NOT SPENT, so a credit the user bought and a
           *  credit the operator granted them both stay theirs.
           *  { credits (0 ends the allowance: reclaim only), periodKey ("2026-09" or the
           *  invoice id), note?, period? (optional monotonic watermark such as a unix
           *  timestamp; one at or behind the wallet's last answers skipped:"already-renewed"
           *  and moves nothing) }
           *  → { granted, reclaimed, alreadyApplied, skipped, periodKey, userId, owner, user },
           *  with the same userId and id rules as fund(), the accessor's userId included: one
           *  inside opts is ignored.
           *  402 { error, balance, reclaimable, available, needed } when the app wallet, even
           *  after the reclaim, cannot fund it: nothing is written, not even the reclaim, the
           *  user keeps the old allowance, and the error names the exact top-up.
           *  409 like fund(), on a key that funded a different user. */
          renewAllowance: (opts = {}) => post("/api/credits/renew-allowance", { ...opts, appId: appId, userId: userId }),
          // Operator-only free grant (needs { adminToken }; else 403). → { wallet }
          grant: (credits, note = "") => postAdmin("/api/credits/grant", { appId: appId, userId: userId, credits: credits, note: note }),
          /** Operator-only MEMBERSHIP RENEWAL (needs { adminToken }; else 403).
           *  Issues this period's `credits` and clears last period's unused allowance in one
           *  atomic step — the subscription counterpart to grant(), which only ever adds and
           *  so lets an unused allowance pile up forever.
           *
           *  `keep` is REQUIRED: the credits this user BOUGHT and still owns. Everything above
           *  keep + credits is treated as unused allowance and removed. Purchased credits are
           *  not a membership benefit and must never expire, and only YOU know which those
           *  are — so there is no default and omitting it is a 400, not a guess.
           *
           *  Pass { key } (your billing period id) to make it idempotent; payment webhooks
           *  retry, and renewing twice would grant twice.
           *
           *  The hub rejects an empty or unusable id rather than guessing. An absent userId
           *  used to fall back to the APP's own wallet, so one missing member id in a
           *  renewal loop expired the business's credits instead of a member's — call
           *  hub.credits.user("owner").renew(...) if the app wallet is genuinely the target.
           *  An empty `keep` ("" or []) is rejected for the same reason: it reads as 0 and
           *  would expire every credit the customer purchased.
           *  → { wallet, granted, expired, skipped } */
          renew: (credits, keep, opts = {}) => postAdmin("/api/credits/renew", {
            appId: appId, userId: userId, credits: credits, keep: keep,
            note: opts.note || "", key: opts.key || undefined,
          }),
        };
      },
    },
    /** Automations — the Hub's Zapier-class workflow engine. An automation =
     *  trigger (webhook / app event / schedule / manual) → linear steps with
     *  {{trigger.x}} / {{steps.<id>.y}} templating: http.request, filter.continue-if,
     *  delay.for (durable), formatter.text, ai.text, brain.query, hub.event.
     *  Step/trigger catalog + rate card: GET /api/automations/catalog.
     *  Billing: live runs 1 cr on success + 2-5 cr per AI step + 1 cr per Brain
     *  step; test runs pay paid steps only; filters/delays/HTTP/formatter free. */
    automations: {
      // → { automations: [...] }
      list: () => get("/api/automations/" + encodeURIComponent(appId)),
      // Create (no id) or update (with id) → { automation }. New automations start
      // "off" — toggle() to go live. Shape: { name, trigger:{type,config}, steps:[{use,config}] }.
      // Triggers include "poll" ({ source:"rss"|"sheets.newRow"|…, everyMinutes, url?/connectionId? })
      // — each new item fires a run with the item as {{trigger}}.
      save: (automation) => post("/api/automations/" + encodeURIComponent(appId), automation),
      /** Connections (connector pack): BYO tokens for Slack/Discord/Telegram/Sheets/
       *  Notion/Airtable/GitHub — unlock their steps + polling triggers. Secrets are
       *  stored server-side and never returned. (free) */
      connections: {
        list: () => get("/api/connections?appId=" + encodeURIComponent(appId)),
        // { service:"slack"|…, label?, secrets:{…} } — see list().services for each service's fields
        save: (opts = {}) => post("/api/connections", { appId: appId, ...opts }),
        remove: (id) => badSegment("connection id", id) || del("/api/connections/" + encodeURIComponent(id) + "?appId=" + encodeURIComponent(appId)),
        // Live connectivity check (webhook services post a visible test message)
        test: (id) => badSegment("connection id", id) || post("/api/connections/" + encodeURIComponent(id) + "/test", { appId: appId }),
      },
      /** Recipes — one-click automation templates (lead alerts, RSS watchers,
       *  follow-up journeys…). Installs land switched OFF with a `needs` list of
       *  remaining setup (missing connections etc.); review, then toggle on. (free) */
      recipes: {
        // → { recipes: [{ id, name, category, description, connections, setup, automation }] }
        list: () => get("/api/automation-recipes"),
        // → { automation, needs: ["Add a Slack connection…", …] }
        install: (recipeId) => post("/api/automation-recipes/install", { appId: appId, recipeId: recipeId }),
      },
      toggle: (id) => badSegment("automation id", id) || post("/api/automations/" + encodeURIComponent(appId) + "/" + encodeURIComponent(id) + "/toggle", {}),
      remove: (id) => badSegment("automation id", id) || del("/api/automations/" + encodeURIComponent(appId) + "/" + encodeURIComponent(id)),
      // Synchronous test run → { run } with the per-step trace (no task fee).
      test: (id, payload = {}) => badSegment("automation id", id) || post("/api/automations/" + encodeURIComponent(appId) + "/" + encodeURIComponent(id) + "/test", { payload: payload }, 60 * 1000),
      // → { runs: [...] } newest first, each with per-step status/output/ms + credits billed.
      runs: (limit = 30) => get("/api/automations/" + encodeURIComponent(appId) + "/runs?limit=" + encodeURIComponent(limit)),
      // Public inbound URL for a webhook-triggered automation (POST any JSON body;
      // add an x-hook-secret header if the trigger config sets one).
      hookUrl: (id) => hubUrl + "/api/automations/hook/" + encodeURIComponent(appId) + "/" + encodeURIComponent(id),
      // Fire an app event: triggers every switched-on "event" automation whose
      // name matches (wildcards ok) AND feeds the CRM telemetry stream. Free.
      emit: (event, payload = {}) => post("/api/crm/webhook/" + encodeURIComponent(appId), { event: event, payload: payload }),
    },
    /** Social Suite — schedule + publish to your app's connected social channels
     *  (instagram/facebook via the Hub's Meta connection; discord/slack/telegram/
     *  mastodon/bluesky/x/linkedin via pasted credentials). Posts support per-network
     *  variants + a first comment where the platform allows it; a 30s scheduler
     *  publishes due posts with per-channel retry. Publishing bills 1 cr per channel
     *  that actually succeeds; generate 3 cr; customize 2 cr/network (cap 8);
     *  everything else (CRUD, categories, feeds, best-time, trends) is free. */
    social: {
      // Channel catalog (auth style, char limits, credential fields per platform). Free.
      platforms: () => get("/api/social/platforms"),
      accounts: {
        // → { accounts: [{ id, platform, label, status }] } (credentials never returned)
        list: () => get("/api/social/accounts?appId=" + encodeURIComponent(appId)),
        // { platform, label?, meta: { ...credential fields from platforms() } } → { account }
        connect: (opts = {}) => post("/api/social/accounts", { appId: appId, ...opts }),
        // Sends a test publish through the channel → { success, error? }
        test: (id) => badSegment("social account id", id) || post("/api/social/accounts/" + encodeURIComponent(id) + "/test", { appId: appId }),
        remove: (id) => badSegment("social account id", id) || del("/api/social/accounts/" + encodeURIComponent(id) + "?appId=" + encodeURIComponent(appId)),
      },
      posts: {
        // → { posts: [...] } newest first; ?status= filters (draft|queued|scheduled|retrying|published|partial|failed)
        list: (opts = {}) => get("/api/social/posts?appId=" + encodeURIComponent(appId) + (opts.status ? "&status=" + encodeURIComponent(opts.status) : "")),
        // { content, mediaUrls?, accountIds, scheduleAt?, status?:"draft", variants?, firstComment?, category?, audio? } → { post }
        // No scheduleAt + a category = joins that category's cadence queue. Free (spend happens at publish).
        create: (opts = {}) => post("/api/social/posts", { appId: appId, ...opts }),
        update: (id, patch = {}) => badSegment("post id", id) || post("/api/social/posts/" + encodeURIComponent(id) + "/update", { appId: appId, ...patch }),
        remove: (id) => badSegment("post id", id) || del("/api/social/posts/" + encodeURIComponent(id) + "?appId=" + encodeURIComponent(appId)),
        // Publish an existing post now → { post } with per-channel results. 1 cr per channel published.
        publish: (id) => badSegment("post id", id) || post("/api/social/posts/" + encodeURIComponent(id) + "/publish", { appId: appId }, 3 * 60 * 1000),
      },
      // Create + publish in one call: { content, mediaUrls?, accountIds, variants?, firstComment? }
      //   → { post }. 1 cr per channel that actually publishes.
      publishNow: (opts = {}) => post("/api/social/publish-now", { appId: appId, ...opts }, 3 * 60 * 1000),
      // AI post copy from a brief: { brief, platforms?, tone?, characterId? (write in
      //   that character's voice — see hub.characters) } → { variants, hashtags }. 3 cr.
      generate: (opts = {}) => post("/api/social/generate", { appId: appId, ...opts }, 60 * 1000),
      // Character autopilot: draft a WEEK of posts as a brand character — copy in
      // their voice + a likeness-guarded image per post. Lands as DRAFTS for your
      // approval (pass queue:true + category + accountIds to queue into cadence).
      // { characterId, brief?, category?, accountIds?, platforms?, presetId?,
      //   withImages? (default true), postCount? (default 5 or the category's
      //   next-7-day slots, cap 7), queue? }
      //   → { created, postIds, images, queued, notes }. 5 cr + 70 cr per image.
      characterWeek: (opts = {}) => post("/api/social/character-week", { appId: appId, ...opts }, 15 * 60 * 1000),
      // Engagement lift of character posts vs plain posts (free, read-only).
      //   characterLift(characterId) → { measurable, liftRatio, withCharacter, withoutCharacter, note }.
      //   Needs Instagram connected for per-post insights; else returns cohort sizes + an honest note.
      characterLift: (characterId) => get("/api/social/character-lift?appId=" + encodeURIComponent(appId) + "&characterId=" + encodeURIComponent(characterId)),
      // AI per-network adaptation: { content, platforms:[...], tone? } →
      //   { variants: { platform: { content, firstComment?, hashtags? } } }. 2 cr/network (cap 8).
      customize: (opts = {}) => post("/api/social/customize", { appId: appId, ...opts }, 60 * 1000),
      categories: {
        // Content categories with weekly cadence slots + optional evergreen recycling. Free.
        list: () => get("/api/social/categories?appId=" + encodeURIComponent(appId)),
        // { category: { id?, name, color?, cadence:{ slots:[{dow:0-6, time:"HH:mm"}] }, recycleDays? } }
        save: (category) => post("/api/social/categories", { appId: appId, category: category }),
        remove: (id) => badSegment("category id", id) || del("/api/social/categories/" + encodeURIComponent(id) + "?appId=" + encodeURIComponent(appId)),
      },
      feeds: {
        // RSS/Atom-to-social. mode:"draft" makes drafts; mode:"queue" auto-captions
        // into the category queue (3 cr per captioned item, billed in background).
        list: () => get("/api/social/feeds?appId=" + encodeURIComponent(appId)),
        // { feed: { id?, url, categoryId?, accountIds?, mode:"draft"|"queue" } }
        save: (feed) => post("/api/social/feeds", { appId: appId, feed: feed }),
        remove: (id) => badSegment("feed id", id) || del("/api/social/feeds/" + encodeURIComponent(id) + "?appId=" + encodeURIComponent(appId)),
      },
      // Bulk import (≤100): { posts:[{ content, accountIds?, scheduleAt?, category?, mediaUrls?, firstComment? }] }
      //   → { created, postIds, errors }. Free CRUD.
      bulk: (posts) => post("/api/social/bulk", { appId: appId, posts: posts }),
      // Best time to post from YOUR publish history (+ IG insights when Meta is live).
      //   → { suggestions:[{dow,hour}], matrix, source:"history"|"heuristic", sandbox }. Free, LLM-free.
      bestTime: (platform) => get("/api/social/best-time?appId=" + encodeURIComponent(appId) + (platform ? "&platform=" + encodeURIComponent(platform) : "")),
      trends: {
        // Instagram trending audio / catalog search (official Audio API; sandbox until Meta is live). Free.
        sounds: (q, type) => get("/api/social/trends/sounds?appId=" + encodeURIComponent(appId) + (q ? "&q=" + encodeURIComponent(q) : "") + (type ? "&type=" + encodeURIComponent(type) : "")),
        // TikTok trending songs via the optional third-party provider. Free.
        tiktok: () => get("/api/social/trends/tiktok?appId=" + encodeURIComponent(appId)),
        // Match sounds to a post draft (LLM-free keyword ranking): { content, vibe? } → { sounds }. Free.
        match: (opts = {}) => post("/api/social/trends/match", { appId: appId, ...opts }),
      },
      dm: {
        // DM-automation flow mirror (the Replai canvas publishes here). Free.
        flows: () => get("/api/social/dm/flows?appId=" + encodeURIComponent(appId)),
        saveFlow: (flow) => post("/api/social/dm/flows", { appId: appId, flow: flow }),
        removeFlow: (id) => badSegment("flow id", id) || del("/api/social/dm/flows/" + encodeURIComponent(id) + "?appId=" + encodeURIComponent(appId)),
        // Comment-to-DM: attach a flow + keyword to a post — matching comments run
        // the flow automatically (the ManyChat wedge). Free.
        attach: (postId, opts = {}) => badSegment("post id", postId) || post("/api/social/posts/" + encodeURIComponent(postId) + "/update", { appId: appId, dmAutomation: { flowId: opts.flowId, keyword: opts.keyword } }),
      },
      /** Unified inbox — comments/DMs/mentions from your connected channels.
       *  Live today: telegram, mastodon, bluesky (polled ~2 min); IG/FB arrive via
       *  the Meta webhook once the app passes review. Arrivals emit
       *  social.inbox.message on the automations bus. */
      inbox: {
        // → { items: [...] } newest first; ?status= open|auto-replied|replied|handed-off|closed
        list: (opts = {}) => get("/api/social/inbox?appId=" + encodeURIComponent(appId) + (opts.status ? "&status=" + encodeURIComponent(opts.status) : "")),
        // Sandbox intake — runs the full pipeline (bus → comment-to-DM → autopilot). Free.
        simulate: (opts = {}) => post("/api/social/inbox/simulate", { appId: appId, ...opts }),
        // AI reply draft via the hybrid KB cascade → { draft:{text,confidence,source} }.
        // 2 cr (free when the KB can't answer — you get { handoff:true } instead).
        draftReply: (id) => badSegment("message id", id) || post("/api/social/inbox/" + encodeURIComponent(id) + "/draft-reply", { appId: appId }, 60 * 1000),
        // Send a reply on the item's own channel → { item }. Free.
        reply: (id, text) => badSegment("message id", id) || post("/api/social/inbox/" + encodeURIComponent(id) + "/reply", { appId: appId, text: text }),
        setStatus: (id, status) => badSegment("message id", id) || post("/api/social/inbox/" + encodeURIComponent(id) + "/status", { appId: appId, status: status }),
      },
      /** Engagement autopilot: off | draft (AI suggests) | auto (AI sends when
       *  confidence ≥ confidenceFloor; 1 cr per auto-sent reply; low confidence →
       *  handed-off + social.inbox.handoff on the bus). */
      settings: {
        get: () => get("/api/social/settings?appId=" + encodeURIComponent(appId)),
        set: (settings) => post("/api/social/settings", { appId: appId, settings: settings }),
      },
      // Repurpose long-form content into platform-native drafts + clip moments.
      //   { text?|url?, platforms:[...], tone?, save?:true } →
      //   { drafts: { platform: { content, firstComment?, hashtags? } }, clipMoments, postId? }
      //   3 cr per target platform (min 8). save:true also creates one draft post
      //   carrying every platform as a variant.
      repurpose: (opts = {}) => post("/api/social/repurpose", { appId: appId, ...opts }, 2 * 60 * 1000),
      // Pre-publish score: { content, platform? } →
      //   { score: 0-100, factors:[{name,score,note}], suggestions, hookRewrite? }. 3 cr.
      score: (opts = {}) => post("/api/social/score", { appId: appId, ...opts }, 60 * 1000),
      /** Audience — the server-side subscriber store (ManyChat parity). Every
       *  inbound comment/DM auto-captures a contact; flows tag them; segments are
       *  saved filters. All free. */
      contacts: {
        // → { contacts: [...], total }. opts: { tag, channel, status, segmentId, q }
        list: (opts = {}) => get("/api/social/contacts?appId=" + encodeURIComponent(appId) + Object.entries(opts).map(([k, v]) => v ? "&" + k + "=" + encodeURIComponent(v) : "").join("")),
        // Manual add/import: { channel, externalId, handle?, displayName?, email?, tags?, fields? }
        upsert: (contact) => post("/api/social/contacts", { appId: appId, contact: contact }),
        // Tag/untag (tag adds also fire sequence auto-enrollment): tag(id, ["vip"], ["cold"])
        tag: (id, add = [], remove = []) => badSegment("contact id", id) || post("/api/social/contacts/" + encodeURIComponent(id) + "/tags", { appId: appId, add: add, remove: remove }),
        setStatus: (id, status) => badSegment("contact id", id) || post("/api/social/contacts/" + encodeURIComponent(id) + "/status", { appId: appId, status: status }),
        remove: (id) => badSegment("contact id", id) || del("/api/social/contacts/" + encodeURIComponent(id) + "?appId=" + encodeURIComponent(appId)),
      },
      segments: {
        // → { segments: [{ ..., count }] } — live counts against the contact store.
        list: () => get("/api/social/segments?appId=" + encodeURIComponent(appId)),
        // { segment: { id?, name, rules: { channels?, tagsAny?, tagsAll?, notTags?, status? } } }
        save: (segment) => post("/api/social/segments", { appId: appId, segment: segment }),
        remove: (id) => badSegment("segment id", id) || del("/api/social/segments/" + encodeURIComponent(id) + "?appId=" + encodeURIComponent(appId)),
      },
      /** DM broadcasts — send blocks ({ text, image?, buttons?, quickReplies? }) to a
       *  segment/tag audience. Creation free; delivery bills 1 cr per DELIVERED
       *  message in rate-limited background batches (failed/skipped free). */
      broadcasts: {
        list: () => get("/api/social/broadcasts?appId=" + encodeURIComponent(appId)),
        // { broadcast: { id?, name, blocks, audience: { segmentId? | tagsAny?, channels? }, scheduleAt? } }
        save: (broadcast) => post("/api/social/broadcasts", { appId: appId, broadcast: broadcast }),
        // Resolve the audience + start delivery → { broadcast } with live stats.
        send: (id, opts = {}) => badSegment("broadcast id", id) || post("/api/social/broadcasts/" + encodeURIComponent(id) + "/send", { appId: appId, ...opts }),
        test: (id, contactId) => badSegment("broadcast id", id) || post("/api/social/broadcasts/" + encodeURIComponent(id) + "/test", { appId: appId, contactId: contactId }),
        remove: (id) => badSegment("broadcast id", id) || del("/api/social/broadcasts/" + encodeURIComponent(id) + "?appId=" + encodeURIComponent(appId)),
      },
      /** Drip sequences — timed DM series. Auto-enroll via enrollTag (contacts
       *  gaining that tag), a flow's enroll_sequence action, or enroll() here.
       *  1 cr per delivered step message. */
      sequences: {
        list: () => get("/api/social/sequences?appId=" + encodeURIComponent(appId)),
        // { sequence: { id?, name, enrollTag?, active?, steps: [{ delayHours, blocks }] } }
        save: (sequence) => post("/api/social/sequences", { appId: appId, sequence: sequence }),
        toggle: (id) => badSegment("sequence id", id) || post("/api/social/sequences/" + encodeURIComponent(id) + "/toggle", { appId: appId }),
        enroll: (id, contactIds) => badSegment("sequence id", id) || post("/api/social/sequences/" + encodeURIComponent(id) + "/enroll", { appId: appId, contactIds: contactIds }),
        remove: (id) => badSegment("sequence id", id) || del("/api/social/sequences/" + encodeURIComponent(id) + "?appId=" + encodeURIComponent(appId)),
      },
      /** Competitor shadow agents — watch public accounts (bluesky/mastodon free
       *  today; instagram via business_discovery once Meta is live). CRUD free;
       *  digest (on-demand here, or weekly via settings.competitorDigest) 5 cr. */
      competitors: {
        // → { competitors: [...], lastDigest }
        list: () => get("/api/social/competitors?appId=" + encodeURIComponent(appId)),
        // { platform: "bluesky"|"mastodon"|"instagram", handle, label? } → { competitor }
        add: (opts = {}) => post("/api/social/competitors", { appId: appId, ...opts }),
        remove: (id) => badSegment("competitor id", id) || del("/api/social/competitors/" + encodeURIComponent(id) + "?appId=" + encodeURIComponent(appId)),
        // Fetch everyone's recent activity + AI synthesis → { digest }. 5 cr.
        digest: () => post("/api/social/competitors/digest", { appId: appId }, 2 * 60 * 1000),
      },
    },
    /** Durable per-app storage on the hub's Firestore, behind your key: the mirror a
     *  spoke used to keep with its own service account. Two models. DOCS: whole JSON
     *  documents by name (any JSON value up to 6.4 MB, chunked for you). ROWS:
     *  collections of JSON objects by id (900 KB each, 500 per batch), listed in
     *  _updatedAt order with a cursor so a sync can resume from `since`. Names, ids
     *  and shapes are validated by the hub and the 400 names the offending entry;
     *  another app's appId is 403. A name, collection or id that is empty, missing, "."
     *  or ".." is refused HERE, before the request, because the URL parser would eat the
     *  segment and land the call on another route. FREE, unmetered. Server-side only. */
    store: {
      docs: {
        // (name, document, { sourceUpdatedAt? }) any JSON value (null allowed)
        //   → { name, bytes, chunks, rev, updatedAt, sourceUpdatedAt? }; 413 over 6,400,000 bytes.
        put: (name, document, opts = {}) => badSegment("name", name) || put(STORE + "/docs/" + encodeURIComponent(name),
          { document: document, ...(opts.sourceUpdatedAt ? { sourceUpdatedAt: opts.sourceUpdatedAt } : {}) }, 2 * 60 * 1000),
        // (name) → { name, document, bytes, chunks, rev, updatedAt, sourceUpdatedAt? };
        //   404 { error:"No such document." }; 409 "holds parts from two different writes" when a
        //   rewrite raced the read (the hub retries once first): read it again.
        get: (name) => badSegment("name", name) || get(STORE + "/docs/" + encodeURIComponent(name)),
        // (name) → { name, deleted:boolean }
        remove: (name) => badSegment("name", name) || del(STORE + "/docs/" + encodeURIComponent(name)),
        // → { documents:[{ name, bytes, chunks, rev, updatedAt, sourceUpdatedAt? }] } sorted by name (metadata only)
        list: () => get(STORE + "/docs"),
        // (names: 1..50, every one UNIQUE) → { documents:[{ name, found:true, document, bytes, chunks,
        //   rev, updatedAt } | { name, found:false }] } in request order; 400 when one name is asked
        //   for twice; 413 when the named documents exceed 16,000,000 bytes together (ask for fewer).
        batchGet: (names) => post(STORE + "/docs/batch-get", { names: names }, 2 * 60 * 1000),
      },
      rows: {
        // (collection, id, row, { sourceUpdatedAt? }) row = a JSON object (no array directly inside an
        //   array, field names up to 1,500 bytes) → { collection, id, created, updatedAt }; 413 over 900,000 bytes.
        put: (collection, id, row, opts = {}) => badSegment("collection", collection) || badSegment("row id", id) ||
          put(STORE + "/rows/" + encodeURIComponent(collection) + "/" + encodeURIComponent(id),
            { row: row, ...(opts.sourceUpdatedAt ? { sourceUpdatedAt: opts.sourceUpdatedAt } : {}) }, 2 * 60 * 1000),
        // (collection, id) → { collection, id, row } (row carries _id, _updatedAt and, when given,
        //   _sourceUpdatedAt); 404 { error:"No such row." }
        get: (collection, id) => badSegment("collection", collection) || badSegment("row id", id) ||
          get(STORE + "/rows/" + encodeURIComponent(collection) + "/" + encodeURIComponent(id)),
        // (collection, id) → { collection, id, deleted:boolean }
        remove: (collection, id) => badSegment("collection", collection) || badSegment("row id", id) ||
          del(STORE + "/rows/" + encodeURIComponent(collection) + "/" + encodeURIComponent(id)),
        // (collection, { since?, limit?, cursor? }) one page ordered by _updatedAt then id. since is
        //   inclusive (ISO); limit 1..500 (default 100); cursor = the previous page's nextCursor.
        //   → { collection, rows:[{ id, row }], bytes, nextCursor:string|null }
        //   A page also stops at 8,000,000 bytes, so it can be SHORTER than limit and still carry a
        //   nextCursor: page on nextCursor, never on rows.length === limit (each() already does).
        list: listRowsPage,
        // (collection, [{ id, row, sourceUpdatedAt? }] 1..500, unique ids) one commit; a bad entry
        //   is 400 naming it and NOTHING is written → { collection, written, created, updated, updatedAt };
        //   413 { index } for one row over 900,000 bytes, or over 9,000,000 bytes together.
        batch: (collection, rows) => badSegment("collection", collection) ||
          post(STORE + "/rows/" + encodeURIComponent(collection) + "/batch", { rows: rows }, 2 * 60 * 1000),
        // → { collections:[{ name, count, updatedAt }], updatedAt } sorted by name
        collections: () => get(STORE + "/rows"),
        /** Walk a whole collection (or everything changed since an ISO time) page by page,
         *  following nextCursor for you:
         *    for await (const { id, row } of hub.store.rows.each("leads", { since })) { ... }
         *  The one method here that THROWS: on the first page the hub refuses, so a sync
         *  never ends half-done in silence. */
        each: async function* (collection, opts = {}) {
          var cursor = opts.cursor || null;
          for (;;) {
            var page = await listRowsPage(collection, { since: opts.since, limit: opts.limit, cursor: cursor });
            if (page.error) throw new Error(page.error);
            var rows = page.rows || [];
            for (var i = 0; i < rows.length; i++) yield rows[i];
            if (!page.nextCursor) return;
            cursor = page.nextCursor;
          }
        },
      },
    },
    /** Media on the hub's Cloud Storage credential: your app's bucket (or its folder in
     *  the shared one), addressed by a RELATIVE path the hub prefixes for you, so no
     *  Google credential lives in your deploy and no path can reach another app's
     *  objects. sign* mint short-lived V4 URLs (upload 15 min, read 30 min) and the
     *  bytes go straight to Cloud Storage, never through the hub. Paths: forward
     *  slashes, segments of [A-Za-z0-9._~@+=,()-], no "." or ".." segment, no leading
     *  slash, and at most status().maxPathChars characters (200 less this app's prefix).
     *  object() and remove() refuse an empty or missing path before the request, so a stray
     *  undefined never becomes a read or a DELETE of an object named "undefined".
     *  Reading a refusal: a 400 carrying configured:false is the OPERATOR's to fix and its
     *  sentence names the env var, so retrying will not help; a plain 400 is this call's own
     *  path, type or size; a 502 is Cloud Storage refusing (its wording stays in the hub's
     *  log, and storageStatus carries its status); a 503 says retryable:true and is the one
     *  to try again. FREE, unmetered. Server-side only. */
    media: {
      // → { configured, credential, bucket, prefix, maxBytes, maxPathChars, uploadUrlSeconds:900,
      //     readUrlSeconds:1800, error? } (always 200; error is the sentence naming what the
      //     operator must set, and maxPathChars is how long one of THIS app's paths may be)
      status: () => get(MEDIA + "/status"),
      // { path, contentType ("image/jpeg"), bytes (the exact size) } → { method:"PUT", url, headers, bucket,
      //   object, path, expiresAt, expiresInSeconds:900, maxBytes }. PUT the body to url with EXACTLY
      //   those headers: the signature binds the type and a size bound, so a different type or a
      //   larger body is refused by Cloud Storage itself. 400 names the path rule or the limit
      //   (APP_MEDIA_MAX_BYTES, with maxBytes); a 400 carrying configured:false names the env var
      //   the operator must set and is not the caller's to fix.
      signUpload: (opts = {}) => post(MEDIA + "/sign-upload", opts),
      // (path, { expiresSeconds? }) → { method:"GET", url, bucket, object, path, expiresAt, expiresInSeconds:1800 }
      //   expiresSeconds is optional: 60..86400 (a day), for a lesson-length read that outlives the
      //   30 minute default; out of range is a 400 naming the range, never a silently shorter link.
      signRead: (path, opts = {}) => post(MEDIA + "/sign-read", { path: path, ...(opts || {}) }),
      // (path) → { object:{ path, object, bucket, size, contentType, updated, created, md5Hash, generation } };
      //   404 { error:"No such object." }; 502 { storageStatus } when Cloud Storage answered and
      //   refused; 503 { retryable:true } + Retry-After when it could not be reached at all.
      object: (path) => badSegment("path", path, { path: true }) || get(MEDIA + "/object?path=" + encodeURIComponent(path)),
      // (path) → { deleted:true, bucket, object, path }; 404 when it was not there (loss is never
      //   reported as success); 502 { storageStatus } / 503 { retryable:true } exactly as object().
      remove: (path) => badSegment("path", path, { path: true }) || del(MEDIA + "/object?path=" + encodeURIComponent(path)),
      /** Sign and upload in one call. { path, contentType, bytes: Buffer | Uint8Array | ArrayBuffer
       *  | Blob, timeoutMs? } → { success:true, path, bucket, object, bytes, expiresAt } once Cloud
       *  Storage accepted the PUT; otherwise { error, status } from the hub (the signing step) or
       *  from Cloud Storage (the upload). Plain fetch, no other transport. */
      upload: async (opts = {}) => {
        var body = opts.bytes;
        var size = body == null ? -1
          : typeof body.byteLength === "number" ? body.byteLength
          : typeof body.size === "number" ? body.size
          : -1;
        if (size < 1) return { error: "bytes must be a Buffer, Uint8Array, ArrayBuffer or Blob holding at least one byte." };
        var signed = await post(MEDIA + "/sign-upload", { path: opts.path, contentType: opts.contentType, bytes: size });
        if (signed.error) return signed;
        try {
          var res = await fetch(signed.url, {
            method: signed.method || "PUT",
            headers: signed.headers || {},
            body: body,
            ...(typeof AbortSignal !== "undefined" && AbortSignal.timeout ? { signal: AbortSignal.timeout(opts.timeoutMs || 10 * 60 * 1000) } : {}),
          });
          if (!res.ok) {
            var text = await res.text().catch(function () { return ""; });
            return { error: "Cloud Storage answered " + res.status + (text ? ": " + text.slice(0, 300) : "") + ".", status: res.status };
          }
          return { success: true, path: signed.path, bucket: signed.bucket, object: signed.object, bytes: size, expiresAt: signed.expiresAt };
        } catch (err) {
          return { error: (err && err.message) || "Network error reaching Cloud Storage." };
        }
      },
    },
    /** Raw keyed passthrough — any Hub endpoint, both methods, no body injection.
     *  Long-running endpoints (generation) accept an optional timeoutMs (default 60s). */
    api: {
      get: (pathname) => get(pathname),
      post: (pathname, body = {}, timeoutMs) => post(pathname, body, timeoutMs),
    },
    /** Escape hatch for any other keyed Hub service (e.g. /api/studio/*, /api/video/*). */
    call: (pathname, body = {}, timeoutMs) => post(pathname, { appId, accountId, ...body }, timeoutMs),
  };
}

export default createHubClient;
