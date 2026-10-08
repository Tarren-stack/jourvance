// The frame around a landing page built with the page builder (LANDING_BUILDER_DESIGN.md section 3,
// "Commerce widgets and the frame"). The renderer (src/lib/pageBuilder/render.mjs) writes markup and
// CSS and never a script; everything that behaves lives here, in ONE inline script that finds the
// widgets by the ids and data attributes the renderer writes:
//   #main-cta-btn, [data-jvb-cta] (data-jvb-mode, data-jvb-action, data-jvb-code),
//   #bump-checkbox-page, #page-order-bump, .jvb-product (data-variant-id, data-product-id, data-price),
//   [data-jvb-countdown] (data-jvb-mode, data-jvb-minutes, data-jvb-deadline, data-jvb-expired),
//   form[data-jvb-lead] (data-jvb-after, data-jvb-success), [data-jv-photo], [data-base-price].
//
// Everything legacy publicRoutes.mjs does inline and a builder page still needs is repeated here as a
// COPY (the legacy template stays byte for byte, page-builder-legacy-snapshot.test.mjs): the cart
// link with bump, discount, currency and UTMs, the currency charm pricing, the lead modal for a
// lead-gate button, the exit-intent drawer, the sticky mobile bar. The lead body is the one
// publicLeadScript.mjs words for both. This file imports nothing from publicRoutes.mjs, so there is
// no import cycle; the helpers below are small copies of its escapeHtml and scriptJson.
//
// Decisions recorded from the design (section 8): the first checkout button owns #main-cta-btn and a
// later one clicks it (question 3); the beacon and sticky bar read the first product (question 4); a
// builder page serves version A only (question 2). There is no restock form and no currency picker
// on a builder page yet: no widget carries them.
import { leadBodyScript } from './publicLeadScript.mjs';
import { commerceBeaconCall } from '../../shopify-signals.mjs';

function esc(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// A value written into an inline script as a JS literal, unable to close the tag.
function lit(value) {
  return JSON.stringify(value === undefined ? null : value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const str = v => (typeof v === 'string' ? v : '');

// ---------------------------------------------------------------------------------------------
// Head: pixels and fonts
// ---------------------------------------------------------------------------------------------

/**
 * The Google Fonts stylesheet link for the families a page uses, or ''. Families are validated names
 * (render.mjs FONT_RE), joined as the css (v1) endpoint spells them. v1 is used because a family
 * that lacks one of the listed weights does not make the whole sheet fail there.
 * @param {string[]} fonts
 */
export function fontsLinkHtml(fonts) {
  const list = (Array.isArray(fonts) ? fonts : []).filter(f => typeof f === 'string' && /^[A-Za-z][A-Za-z0-9]*(?: [A-Za-z0-9]+)*$/.test(f));
  if (!list.length) return '';
  const family = list.map(f => `${f.replace(/ /g, '+')}:400,500,600,700,800`).join('|');
  return '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    + '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    + `  <link href="https://fonts.googleapis.com/css?family=${family}&display=swap" rel="stylesheet">`;
}

/** The three pixel loaders, the same text the legacy head carries. An empty id writes nothing. */
export function pixelsHtml({ metaPixelId = '', tiktokPixelId = '', ga4TrackingId = '' } = {}) {
  return `${metaPixelId ? `
  <!-- Meta Pixel Code -->
  <script>
  !function(f,b,e,v,n,t,s)
  {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
  n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t,s)}(window, document,'script',
  'https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', ${lit(str(metaPixelId))});
  fbq('track', 'PageView');
  </script>
  <noscript><img height="1" width="1" style="display:none"
  src="https://www.facebook.com/tr?id=${esc(metaPixelId)}&ev=PageView&noscript=1"
  /></noscript>
  <!-- End Meta Pixel Code -->
  ` : ''}${tiktokPixelId ? `
  <!-- TikTok Pixel Code -->
  <script>
  !function (w, d, t) {
    w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
    ttq.load(${lit(str(tiktokPixelId))});
    ttq.page();
  }(window, document, 'ttq');
  </script>
  <!-- End TikTok Pixel Code -->
  ` : ''}${ga4TrackingId ? `
  <!-- Google Analytics (GA4) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=${esc(ga4TrackingId)}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', ${lit(str(ga4TrackingId))});
  </script>
  <!-- End Google Analytics -->
  ` : ''}`;
}

// ---------------------------------------------------------------------------------------------
// Frame CSS: only what the frame's own elements need. Every selector is an id or a jvf- class, so
// nothing here reaches #jvb-root, and nothing in #jvb-root reaches these.
// ---------------------------------------------------------------------------------------------

/** @param {string} background  the page background (a validated hex colour), for the body behind the root */
export function frameCss(background = '#09080E') {
  const bg = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(background) ? background : '#09080E';
  return `*, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background-color: ${bg}; }
    #lead-modal { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.8); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); display: none; align-items: center; justify-content: center; padding: 16px; z-index: 9999; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
    #lead-modal .jvf-modal-card { width: 100%; max-width: 440px; background: #13101C; border: 1px solid rgba(236, 72, 153, 0.3); border-radius: 18px; padding: 28px; box-shadow: 0 25px 60px rgba(0, 0, 0, 0.8); position: relative; color: #FFFFFF; }
    #lead-modal #modal-close-btn { position: absolute; top: 14px; right: 14px; background: transparent; border: none; color: #94A3B8; font-size: 20px; cursor: pointer; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; }
    #lead-modal .jvf-input { width: 100%; padding: 12px 14px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 8px; color: #FFFFFF; font-size: 14px; outline: none; margin-bottom: 12px; font-family: inherit; }
    #lead-modal .jvf-input:focus { border-color: #EC4899; box-shadow: 0 0 0 2px rgba(236, 72, 153, 0.2); }
    #lead-modal #lead-submit-btn { display: block; width: 100%; padding: 14px 24px; background: linear-gradient(135deg, #EC4899 0%, #DB2777 50%, #BE185D 100%); color: #FFFFFF; border: none; border-radius: 12px; font-size: 15px; font-weight: 800; cursor: pointer; }
    #lead-modal #lead-submit-btn:disabled { opacity: 0.7; cursor: default; }
    #lead-modal .loading-spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-radius: 50%; border-top-color: #fff; animation: jvf-spin 0.8s linear infinite; }
    @keyframes jvf-spin { to { transform: rotate(360deg); } }
    #jvb-lightbox { display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(8, 7, 12, 0.88); z-index: 999999; align-items: center; justify-content: center; padding: 20px; }
    #jvb-lightbox.jvf-open { display: flex; }
    #jvb-lightbox .jvf-lightbox-content { position: relative; max-width: 90vw; max-height: 85vh; display: flex; flex-direction: column; align-items: center; }
    #jvb-lightbox img { max-width: 100%; max-height: 80vh; border-radius: 14px; border: 1px solid rgba(255, 255, 255, 0.2); object-fit: contain; }
    #jvb-lightbox .jvf-lightbox-close { position: absolute; top: -38px; right: 0; background: rgba(255, 255, 255, 0.15); border: 1px solid rgba(255, 255, 255, 0.25); color: #ffffff; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; font-size: 18px; display: flex; align-items: center; justify-content: center; line-height: 1; }
    .jv-referral-banner { text-align: center; }
    body.jv-sticky-bar-active { padding-bottom: 72px; }`;
}

// ---------------------------------------------------------------------------------------------
// Frame markup
// ---------------------------------------------------------------------------------------------

/** The lead modal a lead-gate button (or a page with no store) opens. Ids as the legacy modal. */
export function leadModalHtml({ leadOnly = false, leadHasCode = false, code = '' } = {}) {
  const submitLabel = leadOnly ? 'Send' : leadHasCode ? 'Claim Voucher & Checkout &rarr;' : 'Continue to Checkout &rarr;';
  const head = leadHasCode ? `
      <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #ec4899; letter-spacing: 0.08em; margin-bottom: 8px;">
        VIP Access
      </div>
      <h2 id="lead-modal-title" style="font-size: 20px; font-weight: 800; color: #FFFFFF; margin: 0 0 6px;">
        Unlock Your Exclusive Discount
      </h2>
      <p style="font-size: 13px; color: #94A3B8; margin: 0 0 18px; line-height: 1.5;">
        Enter your email to claim your <strong>${esc(code)}</strong> coupon and route straight to checkout.
      </p>` : leadOnly ? `
      <h2 id="lead-modal-title" style="font-size: 20px; font-weight: 800; color: #FFFFFF; margin: 0 0 18px;">
        Leave your email
      </h2>` : `
      <h2 id="lead-modal-title" style="font-size: 20px; font-weight: 800; color: #FFFFFF; margin: 0 0 6px;">
        Continue to checkout
      </h2>
      <p style="font-size: 13px; color: #94A3B8; margin: 0 0 18px; line-height: 1.5;">
        Enter your email to go straight to checkout.
      </p>`;
  return `<div id="lead-modal">
    <div class="jvf-modal-card" role="dialog" aria-modal="true" aria-labelledby="lead-modal-title">
      <button id="modal-close-btn" type="button" aria-label="Close">&times;</button>${head}
      <form id="lead-form">
        <input type="text" id="lead-name" class="jvf-input" placeholder="Your Full Name (optional)" aria-label="Your name (optional)" autocomplete="name">
        <input type="email" id="lead-email" class="jvf-input" placeholder="Your Best Email Address" aria-label="Email address" autocomplete="email" required>
        <input type="tel" id="lead-phone" class="jvf-input" placeholder="${leadOnly ? 'Mobile Phone (optional)' : 'Mobile Phone (for tracking SMS, optional)'}" aria-label="Mobile phone (optional)" autocomplete="tel">
        <button id="lead-submit-btn" type="submit"><span id="btn-text">${submitLabel}</span></button>
      </form>
      <p id="lead-status" role="status" aria-live="polite" style="font-size: 13px; color: #CBD5E1; margin-top: 12px; line-height: 1.5;"></p>
    </div>
  </div>`;
}

/** The exit-intent drawer, the legacy markup. Published only with the merchant's own headline. */
export function exitDrawerHtml({ headline = '', badge = '', subhead = '', buttonText = '', code = '', storeDomain = '', hasVariant = false, leadOnly = false } = {}) {
  return `<div id="jv-exit-backdrop" style="display:none; position:fixed; inset:0; background:rgba(8, 10, 18, 0.75); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); z-index:99998; opacity:0; transition:opacity 0.3s ease;"></div>

  <div id="jv-exit-drawer" role="dialog" aria-modal="true" aria-labelledby="jv-exit-title" style="display:none; position:fixed; bottom:0; left:0; right:0; max-width:540px; margin:0 auto; z-index:99999; transform:translateY(100%); transition:transform 0.38s cubic-bezier(0.16, 1, 0.3, 1); background:linear-gradient(180deg, rgba(24, 18, 30, 0.98), rgba(13, 13, 20, 0.99)); border-top:1px solid rgba(236, 72, 153, 0.4); border-left:1px solid rgba(255, 255, 255, 0.08); border-right:1px solid rgba(255, 255, 255, 0.08); border-radius:24px 24px 0 0; box-shadow:0 -20px 60px rgba(0, 0, 0, 0.85), 0 0 40px rgba(236, 72, 153, 0.12); padding:20px 24px 32px; color:#FFFFFF; text-align:center; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;">
    <div style="width:38px; height:4px; border-radius:9999px; background:rgba(255, 255, 255, 0.22); margin:0 auto 16px; cursor:pointer;" id="jv-exit-drag-handle"></div>

    <button id="jv-exit-close" aria-label="Close" style="position:absolute; top:16px; right:18px; width:30px; height:30px; border-radius:50%; background:rgba(255, 255, 255, 0.06); border:1px solid rgba(255, 255, 255, 0.1); color:#94A3B8; font-size:18px; cursor:pointer; display:flex; align-items:center; justify-content:center; line-height:1;">&times;</button>
    ${badge ? `
    <div style="display:inline-flex; align-items:center; gap:6px; background:rgba(236, 72, 153, 0.14); border:1px solid rgba(236, 72, 153, 0.32); color:#F472B6; padding:4px 12px; border-radius:9999px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:12px;">
      <span>✦</span> ${esc(badge)}
    </div>` : ''}
    <h3 id="jv-exit-title" style="font-size:22px; font-weight:700; line-height:1.28; margin:0 0 ${subhead ? '8px' : '20px'}; color:#F8FAFC;">
      ${esc(headline)}
    </h3>
    ${subhead ? `
    <p style="font-size:13px; color:#CBD5E1; line-height:1.5; margin:0 0 20px;">
      ${esc(subhead)}
    </p>` : ''}

    <div id="jv-exit-form-state">
      <input type="email" id="jv-exit-email" autocomplete="email" aria-label="Email address" aria-describedby="jv-exit-error" placeholder="Enter your email address" style="width:100%; box-sizing:border-box; padding:13px 16px; border-radius:12px; border:1px solid rgba(255, 255, 255, 0.18); background:rgba(10, 14, 26, 0.8); color:#FFFFFF; font-size:14px; margin-bottom:12px; outline:none;" />
      <button id="jv-exit-submit-btn" type="button" style="width:100%; padding:14px 20px; border-radius:12px; border:none; background:linear-gradient(135deg, #EC4899, #DB2777); color:#FFFFFF; font-size:14px; font-weight:700; cursor:pointer; box-shadow:0 10px 25px rgba(236, 72, 153, 0.35);">
        ${esc(buttonText || 'Continue')}
      </button>
      <div id="jv-exit-error" role="alert" style="display:none; font-size:12px; color:#FCA5A5; margin-top:10px;">Your email was not saved, please try again.</div>
    </div>

    <div id="jv-exit-status" role="status" style="position:absolute; width:1px; height:1px; margin:-1px; padding:0; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; border:0;"></div>

    <div id="jv-exit-success-state" style="display:none; text-align:center; padding:4px 0;">
      <div id="jv-exit-code-block" style="display:none; background:rgba(236, 72, 153, 0.12); border:1px dashed rgba(236, 72, 153, 0.4); border-radius:14px; padding:16px; margin-bottom:16px;">
        <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.06em; color:#F472B6; font-weight:700; margin-bottom:4px;">Your code</div>
        <div id="jv-exit-code-display" style="font-size:24px; font-weight:800; color:#FFFFFF; letter-spacing:0.08em; font-family:monospace;">${esc(code)}</div>
        <div style="font-size:11px; color:#94A3B8; margin-top:4px;">${storeDomain && hasVariant ? 'Pre-applied to your checkout link below.' : 'Code saved.'}</div>
      </div>
      <div id="jv-exit-saved-note" style="display:none; font-size:14px; color:#E2E8F0; margin-bottom:16px;">Thanks, your email is saved.</div>
      ${leadOnly ? '' : `<button id="jv-exit-continue-btn" type="button" style="width:100%; padding:14px 20px; border-radius:12px; border:none; background:linear-gradient(135deg, #10B981, #059669); color:#FFFFFF; font-size:14px; font-weight:700; cursor:pointer; box-shadow:0 10px 25px rgba(16, 185, 129, 0.35);">
        Continue &rarr;
      </button>`}
    </div>
  </div>`;
}

/** The mobile sticky bar. Its button clicks #main-cta-btn, so it does what the page's button does. */
export function stickyBarHtml({ title = '', price = '', initialPrice = '', buttonText = '' } = {}) {
  return `<div id="jv-mobile-sticky-bar" style="display:none; position:fixed; bottom:0; left:0; right:0; z-index:9000; background:rgba(15, 23, 42, 0.95); backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px); border-top:1px solid rgba(255, 255, 255, 0.12); padding:10px 16px; box-shadow:0 -10px 25px rgba(0,0,0,0.5); align-items:center; justify-content:space-between; gap:12px; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;">
    <div style="flex:1; min-width:0;">
      <div style="font-size:12px; font-weight:700; color:#FFFFFF; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
        ${esc(title)}
      </div>
      ${price ? `<div id="jv-sticky-product-price" data-base-price="${esc(price)}" style="font-size:12px; font-weight:800; color:#34D399; margin-top:1px;">
        ${esc(initialPrice)}
      </div>` : ''}
    </div>
    <button id="jv-mobile-sticky-btn" type="button" style="flex-shrink:0; padding:10px 18px; border-radius:10px; border:none; background:linear-gradient(135deg, #EC4899, #DB2777); color:#FFFFFF; font-size:13px; font-weight:800; letter-spacing:0.02em; cursor:pointer; box-shadow:0 4px 15px rgba(236, 72, 153, 0.4);">
      ${esc(buttonText || 'Continue')}
    </button>
  </div>`;
}

/** The viewer a review photo opens in. Only written when the page has a photo to open. */
export function lightboxHtml() {
  return `<div id="jvb-lightbox" role="dialog" aria-modal="true" aria-label="Customer photo">
    <div class="jvf-lightbox-content">
      <button type="button" class="jvf-lightbox-close" aria-label="Close photo">&times;</button>
      <img id="jvb-lightbox-target" src="" alt="Customer photo">
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------------------------
// The one frame script
// ---------------------------------------------------------------------------------------------

/**
 * The inline script text of a builder page. It declares the variables publicLeadScript.mjs names
 * (slug, isBumpChecked, activeVariant, activeCurrency, utm_*, fbclid, ttclid, gclid, referralCode)
 * and the two lead handlers splice leadBodyScript() into their fetch.
 * @param {object} c
 * @param {string} c.slug
 * @param {string} [c.journeyId]
 * @param {string} [c.nodeId]
 * @param {string} [c.storeDomain]
 * @param {string} [c.referralCode]
 * @param {string} [c.vipCode]            GIVE15 when a VIP referral link applies, else ''
 * @param {boolean} [c.leadOnly]          no store: the button always opens the lead form
 * @param {boolean} [c.modal]             the lead modal markup is on the page
 * @param {boolean} [c.leadHasCode]
 * @param {string} [c.initialCurrency]
 * @param {string} [c.productTitle]
 * @param {{ code: string } | null} [c.exitDrawer]
 * @param {boolean} [c.sticky]
 * @param {boolean} [c.lightbox]
 */
export function builderFrameScript(c) {
  const leadBodyModal = leadBodyScript();
  const leadBodyWidget = leadBodyScript({ emailExpr: 'f.email.value', nameExpr: 'f.name.value', phoneExpr: 'f.phone.value' });
  const title = lit(str(c.productTitle));
  return `(function() {
      const params = new URLSearchParams(window.location.search);
      const utm_source = params.get('utm_source') || '';
      const utm_medium = params.get('utm_medium') || '';
      const utm_campaign = params.get('utm_campaign') || '';
      const utm_content = params.get('utm_content') || '';
      const utm_term = params.get('utm_term') || '';
      const fbclid = params.get('fbclid') || '';
      const ttclid = params.get('ttclid') || '';
      const gclid = params.get('gclid') || '';
      const jvJourney = ${lit(str(c.journeyId))};
      const jvNode = ${lit(str(c.nodeId))};
      const storeDomain = ${lit(str(c.storeDomain))};
      const vipCode = ${lit(str(c.vipCode))};
      const referralCode = ${lit(str(c.referralCode))};
      const slug = ${lit(str(c.slug))};
      const leadOnly = ${c.leadOnly ? 'true' : 'false'};
      const activeVariant = 'a';
      window.__jvVariant = activeVariant;
      let activeCurrency = ${lit(str(c.initialCurrency) || 'USD')};
      let isBumpChecked = false;

      // The first product, checkout button and bump on the page are the ones the frame binds.
      const mainCta = document.getElementById('main-cta-btn');
      const productEl = document.querySelector('.jvb-product');
      const variantId = productEl ? (productEl.getAttribute('data-variant-id') || '') : '';
      const productId = productEl ? (productEl.getAttribute('data-product-id') || '') : '';
      const productPrice = productEl ? (productEl.getAttribute('data-price') || '') : '';
      const bumpCard = document.getElementById('page-order-bump');
      const bumpCb = document.getElementById('bump-checkbox-page');
      const bumpVariantId = bumpCard ? (bumpCard.getAttribute('data-variant-id') || '') : '';
      const modal = document.getElementById('lead-modal');
      const closeBtn = document.getElementById('modal-close-btn');

      // Countdowns. Evergreen: a clock per visitor kept in localStorage (the key the legacy page
      // uses for the first one). Deadline: counts to a moment that carries a time zone offset.
      function pad2(n) { return (n < 10 ? '0' : '') + n; }
      function showClock(el, ms) {
        var s = Math.floor(ms / 1000);
        var h = Math.floor(s / 3600);
        el.textContent = (h > 0 ? pad2(h) + ':' : '') + pad2(Math.floor((s % 3600) / 60)) + ':' + pad2(s % 60);
      }
      Array.prototype.forEach.call(document.querySelectorAll('[data-jvb-countdown]'), function(box, index) {
        var clock = box.querySelector('.jvb-countdown-clock');
        var label = box.querySelector('.jvb-countdown-label');
        if (!clock) return;
        var expiredText = box.getAttribute('data-jvb-expired') || '';
        var end = 0;
        if (box.getAttribute('data-jvb-mode') === 'deadline') {
          var raw = (box.getAttribute('data-jvb-deadline') || '').replace(' ', 'T');
          var offset = raw.match(/([+-][0-9]{2})([0-9]{2})$/);
          if (offset) raw = raw.slice(0, raw.length - 4) + offset[1] + ':' + offset[2];
          end = Date.parse(raw);
        } else {
          var key = 'jv_reserve_' + slug + (index ? '_' + index : '');
          var minutes = parseInt(box.getAttribute('data-jvb-minutes'), 10) || 0;
          var stored = 0;
          try { stored = parseInt(localStorage.getItem(key), 10); } catch (e) {}
          if (!stored || isNaN(stored) || stored < Date.now()) {
            stored = Date.now() + minutes * 60 * 1000;
            try { localStorage.setItem(key, String(stored)); } catch (e) {}
          }
          end = stored;
        }
        if (!end || isNaN(end)) return;
        function tick() {
          var remaining = Math.max(0, end - Date.now());
          if (remaining > 0) {
            showClock(clock, remaining);
            setTimeout(tick, 1000);
          } else {
            clock.textContent = '00:00';
            if (label && expiredText) label.textContent = expiredText;
          }
        }
        tick();
      });

      // Multi-currency charm pricing, the legacy engine, over every element that carries a base price.
      const CURRENCY_CONFIG = {
        USD: { rate: 1.0, prefix: '$' },
        EUR: { rate: 0.92, prefix: '€' },
        GBP: { rate: 0.79, prefix: '£' },
        CAD: { rate: 1.36, prefix: 'CA$' },
        AUD: { rate: 1.52, prefix: 'A$' }
      };
      function formatCharmPrice(baseStr, targetCurr) {
        if (!baseStr) return '';
        var cfg = CURRENCY_CONFIG[targetCurr] || CURRENCY_CONFIG.USD;
        var num = parseFloat(String(baseStr).replace(/[^0-9.-]/g, ''));
        if (!num || isNaN(num) || num <= 0) return baseStr;
        var rawClean = String(baseStr);
        var hasDecimals = rawClean.indexOf('.') !== -1;
        var ending = 'raw';
        if (rawClean.endsWith('.99') || rawClean.endsWith('99')) ending = '99';
        else if (rawClean.endsWith('.95') || rawClean.endsWith('95')) ending = '95';
        else if (!hasDecimals || rawClean.endsWith('.00')) ending = '00';
        var rawConverted = num * cfg.rate;
        var charmAmount = rawConverted;
        if (ending === '99') {
          charmAmount = Math.max(1, Math.round(rawConverted - 0.99)) + 0.99;
        } else if (ending === '95') {
          charmAmount = Math.max(1, Math.round(rawConverted - 0.95)) + 0.95;
        } else {
          charmAmount = Math.max(1, Math.round(rawConverted));
        }
        var numStr = (hasDecimals || ending !== '00') ? charmAmount.toFixed(2) : Math.round(charmAmount).toString();
        return cfg.prefix + numStr;
      }
      function applyCurrency(code) {
        if (!CURRENCY_CONFIG[code]) return;
        activeCurrency = code;
        try {
          document.cookie = 'jv_currency=' + encodeURIComponent(code) + '; path=/; max-age=2592000; SameSite=Lax';
        } catch (e) {}
        Array.prototype.forEach.call(document.querySelectorAll('[data-base-price]'), function(el) {
          var base = el.getAttribute('data-base-price');
          if (base) el.textContent = formatCharmPrice(base, code);
        });
      }
      // Timezone fallback when no currency cookie is saved yet.
      (function() {
        if (document.cookie.indexOf('jv_currency=') !== -1) return;
        try {
          var tz = Intl.DateTimeFormat().resolvedOptions().timeZone.toLowerCase();
          var detected = null;
          if (tz.indexOf('london') !== -1 || tz.indexOf('belfast') !== -1) detected = 'GBP';
          else if (tz.indexOf('europe/') === 0) detected = 'EUR';
          else if (tz.indexOf('australia/') === 0 || tz.indexOf('pacific/auckland') === 0) detected = 'AUD';
          else if (tz.indexOf('toronto') !== -1 || tz.indexOf('vancouver') !== -1 || tz.indexOf('montreal') !== -1) detected = 'CAD';
          if (detected && detected !== activeCurrency) applyCurrency(detected);
        } catch (e) {}
      })();

      if (bumpCb) {
        bumpCb.addEventListener('change', function(e) {
          isBumpChecked = !!e.target.checked;
          if (bumpCard) bumpCard.classList.toggle('checked', isBumpChecked);
        });
      }

      function buildCheckoutUrl() {
        let items = [];
        if (variantId) items.push(variantId + ':1');
        if (isBumpChecked && bumpVariantId) items.push(bumpVariantId + ':1');
        let base = 'https://' + storeDomain + '/cart/' + (items.length ? items.join(',') : '');
        const discountCode = vipCode || (mainCta ? (mainCta.getAttribute('data-jvb-code') || '') : '');

        const out = new URLSearchParams();
        if (discountCode) out.set('discount', discountCode);
        if (activeCurrency && activeCurrency !== 'USD') out.set('currency', activeCurrency);
        if (utm_source) out.set('utm_source', utm_source);
        if (utm_medium) out.set('utm_medium', utm_medium);
        if (utm_campaign) out.set('utm_campaign', utm_campaign);
        if (utm_content) {
          out.set('utm_content', utm_content);
        } else {
          out.set('utm_content', 'var-' + activeVariant);
        }
        if (utm_term) out.set('utm_term', utm_term);
        if (fbclid) out.set('fbclid', fbclid);
        if (ttclid) out.set('ttclid', ttclid);
        if (gclid) out.set('gclid', gclid);
        var vid = window.jourvanceVisitor ? window.jourvanceVisitor() : '';
        if (vid) out.set('attributes[jv_vid]', vid);
        if (slug) out.set('attributes[jv_slug]', slug);
        if (jvJourney) out.set('attributes[jv_journey]', jvJourney);
        if (jvNode) out.set('attributes[jv_node]', jvNode);
        if (utm_source) out.set('attributes[utm_source]', utm_source);
        if (utm_medium) out.set('attributes[utm_medium]', utm_medium);
        if (utm_campaign) out.set('attributes[utm_campaign]', utm_campaign);
        if (utm_content) out.set('attributes[utm_content]', utm_content);
        if (fbclid) out.set('attributes[fbclid]', fbclid);
        if (ttclid) out.set('attributes[ttclid]', ttclid);
        if (gclid) out.set('attributes[gclid]', gclid);
        if (referralCode) out.set('attributes[jv_ref]', referralCode);
        const qs = out.toString();
        return base + (qs ? '?' + qs : '');
      }

      function fireInitiateCheckout(action) {
        if (window.fbq) {
          try { fbq('track', 'InitiateCheckout', { content_name: ${title}, currency: activeCurrency || 'USD' }); } catch(e){}
        }
        if (window.ttq) {
          try { ttq.track('InitiateCheckout', { content_name: ${title}, currency: activeCurrency || 'USD' }); } catch(e){}
        }
        if (window.gtag) {
          try { gtag('event', 'begin_checkout', { items: [{ item_name: ${title} }], currency: activeCurrency || 'USD' }); } catch(e){}
        }
        if (action === 'add') {
          ${commerceBeaconCall('add')}
        } else {
          ${commerceBeaconCall('checkout')}
        }
      }

      function fireLeadEvent() {
        if (window.fbq) {
          try { fbq('track', 'Lead'); } catch(e){}
        }
        if (window.ttq) {
          try { ttq.track('SubmitForm'); } catch(e){}
        }
        if (window.gtag) {
          try { gtag('event', 'generate_lead'); } catch(e){}
        }
      }

      // The lead modal: a dialog like the exit drawer. Opening it moves focus to the email field,
      // Tab stays inside it, Escape closes it, and closing it hands focus back to the button.
      let focusBeforeModal = null;
      function leadModalOpen() {
        return !!modal && modal.style.display === 'flex';
      }
      function openLeadModal() {
        focusBeforeModal = document.activeElement;
        modal.style.display = 'flex';
        var leadEmail = document.getElementById('lead-email');
        if (leadEmail && leadEmail.getClientRects().length) leadEmail.focus();
        else if (closeBtn) closeBtn.focus();
      }
      function closeLeadModal() {
        modal.style.display = 'none';
        var back = focusBeforeModal && focusBeforeModal !== document.body && document.contains(focusBeforeModal) && focusBeforeModal.getClientRects().length ? focusBeforeModal : mainCta;
        if (back && back.focus) back.focus({ preventScroll: true });
        focusBeforeModal = null;
      }
      document.addEventListener('keydown', function(e) {
        if (!leadModalOpen()) return;
        var exitDrawerEl = document.getElementById('jv-exit-drawer');
        if (exitDrawerEl && exitDrawerEl.style.display === 'block') return;
        if (e.key === 'Escape') { e.preventDefault(); closeLeadModal(); return; }
        if (e.key !== 'Tab') return;
        var items = Array.prototype.filter.call(modal.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'), function(el) {
          return !el.disabled && el.getClientRects().length > 0;
        });
        if (!items.length) return;
        var first = items[0];
        var last = items[items.length - 1];
        var inside = modal.contains(document.activeElement);
        if (e.shiftKey && (!inside || document.activeElement === first)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (!inside || document.activeElement === last)) { e.preventDefault(); first.focus(); }
      });

      // Every checkout button. The first owns #main-cta-btn; a later one clicks it.
      Array.prototype.forEach.call(document.querySelectorAll('[data-jvb-cta]'), function(btn) {
        btn.addEventListener('click', function(e) {
          e.preventDefault();
          if (mainCta && btn !== mainCta) { mainCta.click(); return; }
          var mode = btn.getAttribute('data-jvb-mode');
          var action = btn.getAttribute('data-jvb-action') === 'add' ? 'add' : 'checkout';
          if ((mode === 'lead-gate' || leadOnly) && modal) {
            openLeadModal();
          } else {
            fireInitiateCheckout(action);
            window.location.href = buildCheckoutUrl();
          }
        });
      });

      if (closeBtn) closeBtn.addEventListener('click', closeLeadModal);
      if (modal) {
        modal.addEventListener('click', function(e) {
          if (e.target === modal) closeLeadModal();
        });
      }

      // The modal's form (a lead-gate button).
      const leadForm = document.getElementById('lead-form');
      if (leadForm) {
        leadForm.addEventListener('submit', async function(e) {
          e.preventDefault();
          const emailInput = document.getElementById('lead-email');
          const nameInput = document.getElementById('lead-name');
          const phoneInput = document.getElementById('lead-phone');
          const submitBtn = document.getElementById('lead-submit-btn');
          const btnText = document.getElementById('btn-text');
          const sendLabel = btnText.innerHTML;

          if (!emailInput.value) return;

          btnText.innerHTML = '<span class="loading-spinner"></span> ${c.leadHasCode ? 'Securing Voucher…' : 'Saving…'}';
          submitBtn.disabled = true;

          const leadStatus = document.getElementById('lead-status');
          if (leadStatus) leadStatus.textContent = '';
          try {
            const resp = await fetch('/api/public/lead', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              ${leadBodyModal}
            });

            if (leadOnly) {
              // No checkout follows. Only claim a save the server confirmed.
              if (!resp.ok) throw new Error('lead not saved');
              fireLeadEvent();
              leadForm.style.display = 'none';
              if (leadStatus) leadStatus.textContent = 'Thanks. Your details were received.';
              if (closeBtn) closeBtn.focus({ preventScroll: true });
              return;
            }

            fireLeadEvent();
            fireInitiateCheckout('checkout');

            const resData = await resp.json();
            const finalUrl = resData.checkoutUrl || buildCheckoutUrl();
            btnText.textContent = 'Redirecting to Checkout…';
            setTimeout(function() {
              window.location.href = finalUrl;
            }, 300);
          } catch(err) {
            if (leadOnly) {
              if (leadStatus) leadStatus.textContent = 'Your details were not sent. Try again.';
              btnText.innerHTML = sendLabel;
              submitBtn.disabled = false;
              return;
            }
            console.error('Lead submission failed, proceeding to checkout:', err);
            window.location.href = buildCheckoutUrl();
          }
        });
      }

      // The lead form widget(s). The post is the modal's post, with the form's own inputs.
      function fieldOf(form, name) {
        var el = form.elements.namedItem(name);
        return el && typeof el.value === 'string' ? el : { value: '' };
      }
      function fillHidden(form) {
        var values = {
          order_bump_selected: isBumpChecked ? 'true' : '',
          utm_source: utm_source, utm_medium: utm_medium, utm_campaign: utm_campaign,
          utm_content: (utm_content ? utm_content + '_' : '') + 'var-' + activeVariant,
          utm_term: utm_term, fbclid: fbclid, ttclid: ttclid, gclid: gclid,
          visitorId: window.jourvanceVisitor ? window.jourvanceVisitor() : '',
          ref: referralCode
        };
        Object.keys(values).forEach(function(k) {
          var el = form.elements.namedItem(k);
          if (el && el.type === 'hidden') el.value = values[k];
        });
        var cur = form.elements.namedItem('currency');
        if (cur && cur.type === 'hidden') cur.value = activeCurrency;
      }
      Array.prototype.forEach.call(document.querySelectorAll('form[data-jvb-lead]'), function(form) {
        fillHidden(form);
        form.addEventListener('submit', async function(e) {
          e.preventDefault();
          const f = { email: fieldOf(form, 'email'), name: fieldOf(form, 'name'), phone: fieldOf(form, 'phone') };
          if (!f.email.value) return;
          fillHidden(form);
          const status = form.querySelector('[data-jvb-lead-status]');
          const submit = form.querySelector('button[type="submit"]');
          const after = form.getAttribute('data-jvb-after') || 'message';
          const success = form.getAttribute('data-jvb-success') || '';
          if (status) status.textContent = '';
          if (submit) submit.disabled = true;
          try {
            const resp = await fetch('/api/public/lead', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              ${leadBodyWidget}
            });
            if (after === 'checkout' && !leadOnly) {
              fireLeadEvent();
              fireInitiateCheckout('checkout');
              let resData = {};
              try { resData = await resp.json(); } catch (x) {}
              setTimeout(function() {
                window.location.href = (resData && resData.checkoutUrl) || buildCheckoutUrl();
              }, 300);
              return;
            }
            if (!resp.ok) throw new Error('lead not saved');
            fireLeadEvent();
            if (after === 'thank-you') {
              window.location.href = '/p/' + encodeURIComponent(slug) + '/thank-you';
              return;
            }
            Array.prototype.forEach.call(form.querySelectorAll('.jvb-field'), function(el) { el.style.display = 'none'; });
            if (submit) submit.style.display = 'none';
            if (status) status.textContent = success;
          } catch (err) {
            if (after === 'checkout' && !leadOnly) {
              console.error('Lead submission failed, proceeding to checkout:', err);
              window.location.href = buildCheckoutUrl();
              return;
            }
            if (status) status.textContent = 'Your details were not sent. Try again.';
            if (submit) submit.disabled = false;
          }
        });
      });
${c.lightbox ? `
      // The review photo viewer.
      (function() {
        var box = document.getElementById('jvb-lightbox');
        var target = document.getElementById('jvb-lightbox-target');
        if (!box || !target) return;
        var opener = null;
        function openBox(src, from) {
          opener = from;
          target.src = src;
          box.classList.add('jvf-open');
          document.body.style.overflow = 'hidden';
          var close = box.querySelector('.jvf-lightbox-close');
          if (close) close.focus();
        }
        function closeBox() {
          if (!box.classList.contains('jvf-open')) return;
          box.classList.remove('jvf-open');
          target.removeAttribute('src');
          target.src = '';
          document.body.style.overflow = '';
          if (opener && opener.focus) opener.focus();
          opener = null;
        }
        document.addEventListener('click', function(e) {
          var el = e.target;
          var thumb = el && el.closest ? el.closest('[data-jv-photo]') : null;
          if (thumb) { openBox(thumb.getAttribute('data-jv-photo'), thumb); return; }
          if (el === box || (el && el.closest && el.closest('.jvf-lightbox-close'))) closeBox();
        });
        document.addEventListener('keydown', function(e) {
          if (e.key === 'Escape') closeBox();
        });
      })();
` : ''}${c.sticky ? `
      // The mobile sticky bar appears once the page's own button has scrolled away.
      (function() {
        if (window.innerWidth >= 768) return;
        var stickyBar = document.getElementById('jv-mobile-sticky-bar');
        var stickyBtn = document.getElementById('jv-mobile-sticky-btn');
        if (!stickyBar || !mainCta) return;
        if (stickyBtn) {
          stickyBtn.addEventListener('click', function(e) {
            e.preventDefault();
            mainCta.click();
          });
        }
        window.addEventListener('scroll', function() {
          var rect = mainCta.getBoundingClientRect();
          if (rect.bottom < 0) {
            stickyBar.style.display = 'flex';
            document.body.classList.add('jv-sticky-bar-active');
          } else {
            stickyBar.style.display = 'none';
            document.body.classList.remove('jv-sticky-bar-active');
          }
        }, { passive: true });
      })();
` : ''}${c.exitDrawer ? `
      // Exit-intent drawer: pointer leaving the top edge, a fast scroll up, or 14 seconds idle.
      (function() {
        var exitDismissedKey = 'jv_exit_dismissed_' + slug;
        var backdrop = document.getElementById('jv-exit-backdrop');
        var drawer = document.getElementById('jv-exit-drawer');
        if (!backdrop || !drawer) return;

        var closeBtnX = document.getElementById('jv-exit-close');
        var dragHandle = document.getElementById('jv-exit-drag-handle');
        var submitBtn = document.getElementById('jv-exit-submit-btn');
        var emailInput = document.getElementById('jv-exit-email');
        var formState = document.getElementById('jv-exit-form-state');
        var successState = document.getElementById('jv-exit-success-state');
        var continueBtn = document.getElementById('jv-exit-continue-btn');
        var exitStatus = document.getElementById('jv-exit-status');
        var hasTriggered = false;
        var focusBeforeDrawer = null;

        function showExitDrawer() {
          if (hasTriggered || sessionStorage.getItem(exitDismissedKey)) return;
          hasTriggered = true;
          focusBeforeDrawer = document.activeElement;
          backdrop.style.display = 'block';
          drawer.style.display = 'block';
          if (emailInput) emailInput.focus({ preventScroll: true });
          requestAnimationFrame(function() {
            backdrop.style.opacity = '1';
            drawer.style.transform = 'translateY(0)';
          });
        }

        function closeExitDrawer() {
          backdrop.style.opacity = '0';
          drawer.style.transform = 'translateY(100%)';
          setTimeout(function() {
            backdrop.style.display = 'none';
            drawer.style.display = 'none';
          }, 380);
          sessionStorage.setItem(exitDismissedKey, '1');
          if (focusBeforeDrawer && focusBeforeDrawer.focus && document.contains(focusBeforeDrawer)) focusBeforeDrawer.focus({ preventScroll: true });
          focusBeforeDrawer = null;
        }

        function drawerFocusables() {
          return Array.prototype.filter.call(drawer.querySelectorAll('button, input, a[href], [tabindex]:not([tabindex="-1"])'), function(el) {
            return !el.disabled && el.getClientRects().length > 0;
          });
        }

        if (closeBtnX) closeBtnX.addEventListener('click', closeExitDrawer);
        if (dragHandle) dragHandle.addEventListener('click', closeExitDrawer);
        backdrop.addEventListener('click', closeExitDrawer);
        document.addEventListener('keydown', function(e) {
          if (drawer.style.display !== 'block') return;
          if (e.key === 'Escape') { closeExitDrawer(); return; }
          if (e.key !== 'Tab') return;
          var items = drawerFocusables();
          if (!items.length) return;
          var first = items[0];
          var last = items[items.length - 1];
          var inside = drawer.contains(document.activeElement);
          if (e.shiftKey && (!inside || document.activeElement === first)) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && (!inside || document.activeElement === last)) { e.preventDefault(); first.focus(); }
        });

        document.addEventListener('mouseleave', function(e) {
          if (e.clientY <= 0) showExitDrawer();
        });

        var lastScrollY = window.scrollY;
        var lastScrollTime = Date.now();
        var maxScrollDepth = 0;
        var idleTimer = null;

        function resetIdleTimer() {
          if (idleTimer) clearTimeout(idleTimer);
          if (window.scrollY > 150 && !hasTriggered && !sessionStorage.getItem(exitDismissedKey)) {
            idleTimer = setTimeout(function() {
              showExitDrawer();
            }, 14000);
          }
        }

        window.addEventListener('scroll', function() {
          var currentY = window.scrollY;
          var now = Date.now();
          var dt = Math.max(1, now - lastScrollTime);
          var dy = currentY - lastScrollY;
          var scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
          var depthRatio = scrollHeight > 0 ? (currentY / scrollHeight) : 0;
          if (depthRatio > maxScrollDepth) maxScrollDepth = depthRatio;
          if (maxScrollDepth > 0.20 && dy < -45 && dt < 120) showExitDrawer();
          lastScrollY = currentY;
          lastScrollTime = now;
          resetIdleTimer();
        }, { passive: true });

        window.addEventListener('touchstart', resetIdleTimer, { passive: true });
        window.addEventListener('mousemove', resetIdleTimer, { passive: true });
        resetIdleTimer();

        if (submitBtn && emailInput) {
          submitBtn.addEventListener('click', async function() {
            var val = (emailInput.value || '').trim();
            var exitError = document.getElementById('jv-exit-error');
            if (!val || !val.includes('@')) {
              emailInput.style.borderColor = '#EF4444';
              emailInput.setAttribute('aria-invalid', 'true');
              if (exitError) { exitError.textContent = 'Enter a valid email address.'; exitError.style.display = 'block'; }
              emailInput.focus();
              return;
            }
            emailInput.style.borderColor = '';
            emailInput.removeAttribute('aria-invalid');
            var submitLabel = submitBtn.textContent;
            if (exitError) exitError.style.display = 'none';
            submitBtn.disabled = true;
            submitBtn.textContent = 'Saving…';

            try {
              var exitCode = ${lit(str(c.exitDrawer.code))};
              var exitResp = await fetch('/api/public/lead', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  slug: slug,
                  email: val,
                  variant: activeVariant,
                  exit_intent: true,
                  currency: activeCurrency,
                  utm_source: utm_source,
                  utm_campaign: utm_campaign,
                  fbclid: fbclid,
                  ttclid: ttclid,
                  gclid: gclid,
                  visitorId: window.jourvanceVisitor ? window.jourvanceVisitor() : ''
                })
              });
              var exitData = await exitResp.json().catch(function() { return null; });
              if (!exitResp.ok || !exitData || exitData.success === false) throw new Error('Lead not saved');
              if (!exitCode && exitData.discountCode) exitCode = String(exitData.discountCode);
              var codeBlock = document.getElementById('jv-exit-code-block');
              var savedNote = document.getElementById('jv-exit-saved-note');
              if (exitCode) {
                var codeDisplay = document.getElementById('jv-exit-code-display');
                if (codeDisplay) codeDisplay.textContent = exitCode;
                if (codeBlock) codeBlock.style.display = 'block';
              } else if (savedNote) {
                savedNote.style.display = 'block';
              }
              formState.style.display = 'none';
              successState.style.display = 'block';
              if (exitStatus) exitStatus.textContent = exitCode ? 'Your email is saved. Your code is ' + exitCode + '.' : 'Your email is saved.';
              if (continueBtn) continueBtn.focus({ preventScroll: true });
              else if (closeBtnX) closeBtnX.focus({ preventScroll: true });

              if (continueBtn) {
                continueBtn.addEventListener('click', function() {
                  var checkoutUrl = (exitData && exitData.checkoutUrl) ? exitData.checkoutUrl : buildCheckoutUrl();
                  if (exitCode) {
                    try { var exitUrl = new URL(checkoutUrl); exitUrl.searchParams.set('discount', exitCode); checkoutUrl = exitUrl.toString(); } catch (urlErr) {}
                  }
                  window.location.href = checkoutUrl;
                });
              }
            } catch(e) {
              console.error('Exit lead submission error:', e);
              submitBtn.disabled = false;
              submitBtn.textContent = submitLabel;
              if (exitError) { exitError.textContent = 'Your email was not saved, please try again.'; exitError.style.display = 'block'; }
            }
          });
        }
      })();
` : ''}    })();`;
}
