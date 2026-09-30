// Every generator here fills an EMPTY field the way the published page does (publicRoutes.mjs):
// with a plain word or not at all. A new step leaves its copy, codes and prices empty on purpose
// (stepDefaults.ts), and an export used to put "VIPRETURN", "$15 Off" or "$37" back on a page the
// person hosts themselves. add-step.test.mjs runs every generator over a brand-new step.
import { ownCopy, ownCopyList, thankYouView } from './stepDefaults.ts';
import type {
  PageNodeData,
  AbSplitNodeData,
  ThankYouNodeData,
  FormNodeData,
  SequenceNodeData,
  AdNodeData,
  SequenceStep,
  UpsellNodeData
} from '../types/journey';

function escapeHtml(str: string): string {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generates a standalone, client-side A/B traffic split router HTML page.
 * Suitable for self-hosting on Webflow, WordPress, S3, Netlify, Vercel, or custom servers.
 */
export function generateSplitRouterHtml({
  splitNode,
  targetAUrl,
  targetBUrl
}: {
  splitNode?: Partial<AbSplitNodeData>;
  targetAUrl?: string;
  targetBUrl?: string;
}): string {
  const slug = splitNode?.slug || 'split-test';
  const splitRatio = typeof splitNode?.splitRatio === 'number' ? Math.max(0, Math.min(100, splitNode.splitRatio)) : 50;
  const winner = splitNode?.winner || null;
  const label = splitNode?.label || 'A/B Traffic Splitter';

  const destA = targetAUrl || `./${splitNode?.branchAPageSlug || 'variant-a'}.html`;
  const destB = targetBUrl || `./${splitNode?.branchBPageSlug || 'variant-b'}.html`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(label)} | Connecting...</title>
  <script>
  (function() {
    try {
      var slug = ${JSON.stringify(slug)};
      var splitRatio = ${splitRatio};
      var winner = ${JSON.stringify(winner)};
      var targetA = ${JSON.stringify(destA)};
      var targetB = ${JSON.stringify(destB)};

      // 1. Check query parameter override: ?jv_var=a|b or ?var=a|b (ideal for QA & ad creatives)
      var params = new URLSearchParams(window.location.search);
      var qVar = (params.get('jv_var') || params.get('var') || '').toLowerCase();
      var variant = (qVar === 'a' || qVar === 'b') ? qVar : '';

      // 2. Check sticky cookie: jv_split_<slug>=a|b
      if (!variant) {
        var cookieMatch = document.cookie.match(new RegExp('(?:^|; )jv_split_' + slug + '=(a|b)', 'i'));
        if (cookieMatch && cookieMatch[1]) {
          variant = cookieMatch[1].toLowerCase();
        }
      }

      // 3. Check localStorage fallback
      if (!variant) {
        try {
          var stored = localStorage.getItem('jv_split_' + slug);
          if (stored === 'a' || stored === 'b') variant = stored;
        } catch(e) {}
      }

      // 4. Check winner or 100/0 lock
      if (!variant) {
        if (winner === 'a' || splitRatio === 100) variant = 'a';
        else if (winner === 'b' || splitRatio === 0) variant = 'b';
      }

      // 5. Deterministic random allocation based on splitRatio
      if (!variant) {
        variant = (Math.random() * 100 < splitRatio) ? 'a' : 'b';
      }

      // Set 30-day sticky cookie & localStorage
      document.cookie = 'jv_split_' + slug + '=' + variant + '; Path=/; Max-Age=2592000; SameSite=Lax';
      try { localStorage.setItem('jv_split_' + slug, variant); } catch(e) {}

      // Preserve all UTM tracking parameters, search queries, and hash anchors
      params.set('jv_split', slug);
      params.set('jv_var', variant);

      var dest = (variant === 'b' ? targetB : targetA);
      var separator = dest.indexOf('?') !== -1 ? '&' : '?';
      var finalUrl = dest + separator + params.toString() + window.location.hash;

      window.location.replace(finalUrl);
    } catch(err) {
      window.location.replace(${JSON.stringify(destA)});
    }
  })();
  </script>
  <noscript>
    <meta http-equiv="refresh" content="0;url=${destA}">
  </noscript>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: #070A12;
      color: #94A3B8;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      text-align: center;
      padding: 1.5rem;
    }
    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid rgba(139, 92, 246, 0.2);
      border-top-color: #8B5CF6;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-bottom: 1rem;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    p { font-size: 0.95rem; font-weight: 500; }
  </style>
</head>
<body>
  <div class="spinner"></div>
  <p>Loading the page...</p>
</body>
</html>`;
}

/**
 * Generates standalone, production-ready landing page HTML with lead form and optional in-page A/B variant swap.
 */
export function generateLandingPageHtml({
  pageNode,
  formNode,
  variantOverride,
  leadEndpointUrl,
  externalWebhookUrl,
  workspaceId,
  journeyId
}: {
  pageNode?: Partial<PageNodeData>;
  formNode?: Partial<FormNodeData>;
  variantOverride?: 'a' | 'b';
  leadEndpointUrl?: string;
  externalWebhookUrl?: string;
  workspaceId?: string;
  journeyId?: string;
}): string {
  const isStaticVariantB = variantOverride === 'b' && Boolean(pageNode?.variantB);
  const vB = pageNode?.variantB || {};

  // Empty fields read as the published page reads them (renderPublicFunnelHtml): 'Offer', no
  // subhead, no bullets, no badge and a 'Continue' button, never a claim nobody wrote.
  const headline = (isStaticVariantB ? vB.headline : '') || pageNode?.headline || 'Offer';

  const subhead = (isStaticVariantB ? ownCopy(vB.subhead) : '') || ownCopy(pageNode?.subhead);

  const buttonText = (isStaticVariantB ? vB.buttonText : '') || pageNode?.buttonText || formNode?.submitButtonText || 'Continue';

  const bullets = isStaticVariantB && ownCopyList(vB.bullets).length
    ? ownCopyList(vB.bullets)
    : ownCopyList(pageNode?.bullets);

  const badge = (isStaticVariantB ? vB.trustBadge : '') || pageNode?.trustBadge || '';

  const slug = isStaticVariantB
    ? `${pageNode?.slug || 'offer'}-b`
    : (pageNode?.slug || 'offer');

  const fields = (Array.isArray(formNode?.fields) && formNode.fields.length)
    ? formNode.fields
    : [
        { id: '1', label: 'Full Name', type: 'text' as const, placeholder: 'Jane Doe', required: true, enabled: true },
        { id: '2', label: 'Work Email', type: 'email' as const, placeholder: 'jane@company.com', required: true, enabled: true }
      ];

  // In-page swap script is only enabled if no explicit static variant override was requested
  const hasInPageVariantB = !variantOverride && Boolean(pageNode?.abTestingEnabled && pageNode?.variantB);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title id="jvPageTitle">${escapeHtml(headline)} | Powered by Jourvance</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background-color: #070A12;
      color: #F1F5F9;
      line-height: 1.6;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem 1.5rem;
    }
    .container {
      max-width: 640px;
      width: 100%;
      background: #111827;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 20px;
      padding: 2.75rem 2.25rem;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    }
    .badge {
      display: inline-block;
      font-size: 0.75rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #818CF8;
      background: rgba(99, 102, 241, 0.12);
      padding: 0.35rem 0.85rem;
      border-radius: 9999px;
      margin-bottom: 1.25rem;
    }
    h1 {
      font-size: 2.15rem;
      font-weight: 800;
      line-height: 1.25;
      letter-spacing: -0.025em;
      margin-bottom: 0.85rem;
      color: #FFFFFF;
    }
    .subhead {
      font-size: 1.05rem;
      color: #94A3B8;
      margin-bottom: 2rem;
    }
    .bullets {
      list-style: none;
      margin-bottom: 2.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
    }
    .bullets li {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-size: 0.95rem;
      color: #E2E8F0;
    }
    .bullets li::before {
      content: "✓";
      color: #10B981;
      font-weight: 800;
    }
    .form-group {
      margin-bottom: 1.15rem;
    }
    label {
      display: block;
      font-size: 0.85rem;
      font-weight: 600;
      color: #CBD5E1;
      margin-bottom: 0.4rem;
    }
    input {
      width: 100%;
      padding: 0.85rem 1rem;
      border-radius: 10px;
      background: #1E293B;
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #FFFFFF;
      font-size: 0.95rem;
      outline: none;
      transition: border-color 0.2s;
    }
    input:focus {
      border-color: #6366F1;
    }
    button.submit-btn {
      width: 100%;
      padding: 1rem;
      border-radius: 10px;
      background: linear-gradient(135deg, #6366F1 0%, #4F46E5 100%);
      color: #FFFFFF;
      font-size: 1rem;
      font-weight: 700;
      border: none;
      cursor: pointer;
      margin-top: 0.5rem;
      box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);
    }
    .guarantee {
      text-align: center;
      font-size: 0.8rem;
      color: #64748B;
      margin-top: 1.25rem;
    }
  </style>
  ${hasInPageVariantB ? `
  <script>
  (function() {
    var vB = ${JSON.stringify({ ...vB, subhead: ownCopy(vB.subhead), bullets: ownCopyList(vB.bullets) })};
    var splitRatio = ${Number(pageNode?.splitRatio) || 50};
    var params = new URLSearchParams(window.location.search);
    var qVar = (params.get('jv_var') || params.get('var') || '').toLowerCase();
    var variant = (qVar === 'a' || qVar === 'b') ? qVar : '';

    if (!variant) {
      var m = document.cookie.match(/(?:^|; )jv_var=(a|b)/i);
      if (m && m[1]) variant = m[1].toLowerCase();
    }
    if (!variant) {
      try {
        var stored = localStorage.getItem('jv_var_${slug}');
        if (stored === 'a' || stored === 'b') variant = stored;
      } catch(e) {}
    }
    if (!variant) {
      variant = (Math.random() * 100 < splitRatio) ? 'a' : 'b';
    }

    document.cookie = 'jv_var=' + variant + '; Path=/; Max-Age=2592000; SameSite=Lax';
    try { localStorage.setItem('jv_var_${slug}', variant); } catch(e) {}
    window.__jvActiveVariant = variant;

    if (variant === 'b' && vB) {
      document.addEventListener('DOMContentLoaded', function() {
        if (vB.headline) {
          var h = document.getElementById('jvHeadline');
          if (h) h.innerText = vB.headline;
          var t = document.getElementById('jvPageTitle');
          if (t) t.innerText = vB.headline + ' | Powered by Jourvance';
        }
        if (vB.subhead) {
          var s = document.getElementById('jvSubhead');
          if (s) s.innerText = vB.subhead;
        }
        if (vB.buttonText) {
          var b = document.getElementById('submitBtn');
          if (b) b.innerText = vB.buttonText;
        }
      });
    }
  })();
  </script>
  ` : ''}
</head>
<body>
  <div class="container">
    ${badge ? `<span class="badge" id="jvBadge">${escapeHtml(badge)}</span>` : ''}
    <h1 id="jvHeadline">${escapeHtml(headline)}</h1>
    <p class="subhead" id="jvSubhead">${escapeHtml(subhead)}</p>

    ${bullets.length ? `<ul class="bullets">
      ${bullets.map(b => `<li>${escapeHtml(b)}</li>`).join('\n      ')}
    </ul>` : ''}

    <form id="leadCaptureForm" onsubmit="handleLeadSubmit(event)">
      ${fields.map(f => `
      <div class="form-group">
        <label>${escapeHtml(f.label)}</label>
        <input name="${f.type === 'email' ? 'email' : (f.type === 'tel' ? 'phone' : 'name')}" type="${f.type}" placeholder="${escapeHtml(f.placeholder || '')}" ${f.required ? 'required' : ''} />
      </div>`).join('')}
      <input type="text" name="website_url_hp" style="display:none !important; position:absolute; left:-9999px;" tabindex="-1" autocomplete="off" aria-hidden="true" />
      <button type="submit" id="submitBtn" class="submit-btn">${escapeHtml(buttonText)}</button>
      <div id="formMsg" style="display:none; margin-top:1rem; padding:0.75rem; border-radius:6px; font-size:0.875rem; text-align:center;"></div>
    </form>

    <script>
      async function handleLeadSubmit(e) {
        e.preventDefault();
        var form = e.target;
        var btn = document.getElementById('submitBtn');
        var msg = document.getElementById('formMsg');
        var emailInput = form.querySelector('input[type="email"]');
        var nameInput = form.querySelector('input[type="text"]');
        var phoneInput = form.querySelector('input[type="tel"]');
        var hpInput = form.querySelector('input[name="website_url_hp"]');

        var payload = {
          email: emailInput ? emailInput.value : '',
          name: nameInput ? nameInput.value : '',
          phone: phoneInput ? phoneInput.value : '',
          website_url_hp: hpInput ? hpInput.value : '',
          slug: '${slug}',
          variant: window.__jvActiveVariant || '${isStaticVariantB ? 'b' : 'a'}',
          utm_source: 'exported_html'${externalWebhookUrl ? `,\n          externalWebhookUrl: ${JSON.stringify(externalWebhookUrl)}` : ''}${workspaceId ? `,\n          workspaceId: ${JSON.stringify(workspaceId)}` : ''}${journeyId ? `,\n          journeyId: ${JSON.stringify(journeyId)}` : ''}
        };

        btn.disabled = true;
        btn.innerText = 'Submitting...';
        msg.style.display = 'none';

        try {
          var targetUrl = ${JSON.stringify(leadEndpointUrl || 'https://jourvance.com/api/public/lead')};
          var res = await fetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(payload)
          });
          var data = await res.json();
          if (res.ok && data.success) {
            form.style.display = 'none';
            msg.style.display = 'block';
            msg.style.backgroundColor = 'rgba(16, 185, 129, 0.15)';
            msg.style.color = '#10B981';
            msg.style.border = '1px solid rgba(16, 185, 129, 0.3)';
            msg.innerHTML = '<strong>✨ Thank you!</strong> We have received your information.';
            if (data.checkoutUrl) {
              msg.innerHTML += '<div style="margin-top:0.75rem;"><a href="' + data.checkoutUrl + '" style="color:#818CF8; font-weight:700; text-decoration:underline;">Proceed to Complete Order &rarr;</a></div>';
            }
          } else {
            throw new Error(data.error || 'Submission failed');
          }
        } catch (err) {
          btn.disabled = false;
          btn.innerText = '${escapeHtml(buttonText)}';
          msg.style.display = 'block';
          msg.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
          msg.style.color = '#EF4444';
          msg.style.border = '1px solid rgba(239, 68, 68, 0.3)';
          msg.innerText = err.message || 'Something went wrong. Please try again.';
        }
      }
    </script>
  </div>
</body>
</html>`;
}

/**
 * Generates a standalone thank-you page. It reads the step through thankYouView, the same parts and
 * "only when" rules as the published page (renderPublicThankYouHtml) and the editor's Live Customer
 * View: no code, guide, store or community block the person did not write. storeDomain is the
 * connected store ('' when none), which gives the store button its link as it does when published.
 */
export function generateThankYouHtml({
  thankYouNode,
  storeDomain = ''
}: {
  thankYouNode?: Partial<ThankYouNodeData>;
  storeDomain?: string;
}): string {
  const view = thankYouView(thankYouNode ?? {}, storeDomain);
  const { badge: badgeText, headline, subhead, voucher, guide, store, community } = view;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(headline)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background-color: #070A12;
      color: #F1F5F9;
      line-height: 1.6;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2.5rem 1.5rem;
    }
    .container {
      max-width: 600px;
      width: 100%;
      background: #111827;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 20px;
      padding: 2.5rem 2rem;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      text-align: center;
    }
    .check-icon {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.4);
      color: #34D399;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      font-weight: 800;
      margin: 0 auto 1.25rem;
    }
    .badge {
      display: inline-block;
      font-size: 0.75rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #EC4899;
      background: rgba(236, 72, 153, 0.12);
      border: 1px solid rgba(236, 72, 153, 0.3);
      padding: 0.35rem 0.85rem;
      border-radius: 9999px;
      margin-bottom: 1rem;
    }
    h1 {
      font-size: 1.85rem;
      font-weight: 800;
      line-height: 1.3;
      margin-bottom: 0.75rem;
      color: #FFFFFF;
    }
    .subhead {
      font-size: 0.95rem;
      color: #94A3B8;
      margin-bottom: 2rem;
    }
    .voucher-card {
      background: rgba(236, 72, 153, 0.08);
      border: 1px dashed rgba(236, 72, 153, 0.4);
      border-radius: 12px;
      padding: 1.25rem;
      margin-bottom: 2rem;
      text-align: left;
    }
    .voucher-label {
      font-size: 0.75rem;
      font-weight: 700;
      color: #F472B6;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.25rem;
    }
    .voucher-title {
      font-size: 1.05rem;
      font-weight: 800;
      color: #FFFFFF;
      margin-bottom: 0.75rem;
    }
    .voucher-box {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #0B1120;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 0.6rem 0.85rem;
    }
    .voucher-code {
      font-family: monospace;
      font-size: 1.1rem;
      font-weight: 800;
      color: #34D399;
      letter-spacing: 0.05em;
    }
    .copy-btn {
      background: rgba(255, 255, 255, 0.1);
      border: none;
      color: #FFFFFF;
      font-size: 0.8rem;
      font-weight: 700;
      padding: 0.4rem 0.75rem;
      border-radius: 6px;
      cursor: pointer;
    }
    .guide-card {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 1.25rem;
      margin-bottom: 2rem;
      text-align: left;
    }
    .guide-title {
      font-size: 0.95rem;
      font-weight: 700;
      color: #FFFFFF;
      margin-bottom: 0.85rem;
    }
    .guide-steps {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .guide-steps li {
      font-size: 0.875rem;
      color: #CBD5E1;
      display: flex;
      align-items: flex-start;
      gap: 0.65rem;
    }
    .step-num {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: rgba(99, 102, 241, 0.2);
      color: #818CF8;
      font-size: 0.75rem;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      margin-top: 1px;
    }
    .btn-row {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .btn-primary {
      padding: 0.85rem;
      border-radius: 10px;
      background: linear-gradient(135deg, #EC4899 0%, #DB2777 100%);
      color: #FFFFFF;
      font-size: 0.95rem;
      font-weight: 700;
      text-decoration: none;
      display: block;
      box-shadow: 0 4px 14px rgba(236, 72, 153, 0.35);
    }
    .btn-secondary {
      padding: 0.75rem;
      border-radius: 10px;
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: #94A3B8;
      font-size: 0.875rem;
      font-weight: 600;
      text-decoration: none;
      display: block;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="check-icon">✓</div>
    ${badgeText ? `<span class="badge">${escapeHtml(badgeText)}</span>` : ''}
    <h1>${escapeHtml(headline)}</h1>
    ${subhead ? `<p class="subhead">${escapeHtml(subhead)}</p>` : ''}

    ${voucher ? `
    <div class="voucher-card">
      <div class="voucher-label">Next order</div>
      <div class="voucher-title">${escapeHtml(voucher.title)}</div>
      <div class="voucher-box">
        <span class="voucher-code" id="voucherCode">${escapeHtml(voucher.code)}</span>
        <button type="button" class="copy-btn" id="copyVoucherBtn" onclick="copyVoucher()">Copy Code</button>
      </div>
    </div>
    ` : ''}

    ${guide ? `
    <div class="guide-card">
      ${guide.title ? `<div class="guide-title">${escapeHtml(guide.title)}</div>` : ''}
      <ol class="guide-steps">
        ${guide.steps.map((step, idx) => `
        <li>
          <span class="step-num" aria-hidden="true">${idx + 1}</span>
          <span>${escapeHtml(step)}</span>
        </li>`).join('')}
      </ol>
    </div>
    ` : ''}

    ${(store || community) ? `
    <div class="btn-row">
      ${store ? `<a href="${escapeHtml(store.url)}" class="btn-primary">${escapeHtml(store.text)}</a>` : ''}
      ${community ? `<a href="${escapeHtml(community.url)}" class="btn-secondary">${escapeHtml(community.text)}</a>` : ''}
    </div>
    ` : ''}
  </div>

  <script>
    function copyVoucher() {
      var code = document.getElementById('voucherCode');
      var btn = document.getElementById('copyVoucherBtn');
      if (code && navigator.clipboard) {
        navigator.clipboard.writeText(code.innerText.trim());
        btn.innerText = 'Copied!';
        setTimeout(function() { btn.innerText = 'Copy Code'; }, 2000);
      }
    }
  </script>
</body>
</html>`;
}

/**
 * Generates standalone 1-click Upsell / Downsell OTO HTML with urgency countdown timer and tracking preservation.
 */
export function generateUpsellHtml({
  upsellNode,
  thankYouNode,
  downsellNode,
  targetAcceptUrl,
  targetDeclineUrl,
  storeDomain
}: {
  upsellNode?: Partial<UpsellNodeData>;
  thankYouNode?: Partial<ThankYouNodeData>;
  downsellNode?: Partial<UpsellNodeData>;
  targetAcceptUrl?: string;
  targetDeclineUrl?: string;
  storeDomain?: string;
}): string {
  const isDownsell = upsellNode?.offerType === 'downsell';
  const slug = upsellNode?.slug || (isDownsell ? 'downsell-offer' : 'upgrade-offer');
  const label = upsellNode?.label || (isDownsell ? 'Special Downsell Offer' : 'Exclusive VIP Upgrade');
  // As renderPublicUpsellHtml: an empty field is a plain word or nothing. A new upsell has no
  // product, price, discount or badge, and the export used to fill in "$37", "Save 40%" and a
  // product nobody sells.
  const headline = upsellNode?.headline || 'Another offer';
  const subhead = ownCopy(upsellNode?.subhead);
  const badgeText = upsellNode?.badgeText || '';
  const urgencyMins = typeof upsellNode?.urgencyMinutes === 'number' ? Math.max(0, upsellNode.urgencyMinutes) : 0;
  const productTitle = upsellNode?.productTitle || '';
  const productPrice = upsellNode?.productPrice || '';
  const regularPrice = upsellNode?.regularPrice || '';
  const discountPercentage = Number(upsellNode?.discountPercentage) > 0 ? Number(upsellNode?.discountPercentage) : 0;
  const discountCode = upsellNode?.discountCode || '';
  const productImage = upsellNode?.productImage || '';
  const benefits = ownCopyList(upsellNode?.benefits);

  const defaultDeclineTarget = !isDownsell && downsellNode
    ? `./${downsellNode.slug || 'downsell'}.html`
    : `./${thankYouNode?.slug || 'thank-you'}.html`;
  const declineUrl = targetDeclineUrl || defaultDeclineTarget;

  const defaultAcceptTarget = (storeDomain && upsellNode?.shopifyVariantId)
    ? `https://${storeDomain}/cart/${upsellNode.shopifyVariantId}:1${discountCode ? `?discount=${discountCode}` : ''}`
    : (upsellNode?.shopifyVariantId ? `./cart/${upsellNode.shopifyVariantId}:1` : `./${thankYouNode?.slug || 'thank-you'}.html`);
  const acceptUrl = targetAcceptUrl || defaultAcceptTarget;

  const acceptText = upsellNode?.acceptButtonText || 'Continue';
  const declineText = upsellNode?.declineButtonText || (isDownsell ? 'No thanks, continue to my order confirmation' : 'No thanks, skip this offer');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(headline)} | Special Offer</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background-color: #070A12;
      color: #F1F5F9;
      line-height: 1.6;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2.5rem 1.5rem;
    }
    .container {
      max-width: 580px;
      width: 100%;
      background: #111827;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 20px;
      padding: 2.5rem 2rem;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      text-align: center;
    }
    .urgency-banner {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #FCA5A5;
      font-size: 0.8rem;
      font-weight: 700;
      padding: 0.4rem 0.9rem;
      border-radius: 9999px;
      margin-bottom: 1.25rem;
    }
    .badge {
      display: inline-block;
      font-size: 0.725rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #818CF8;
      background: rgba(99, 102, 241, 0.12);
      padding: 0.3rem 0.8rem;
      border-radius: 9999px;
      margin-bottom: 1rem;
    }
    h1 {
      font-size: 1.85rem;
      font-weight: 800;
      line-height: 1.25;
      letter-spacing: -0.025em;
      margin-bottom: 0.65rem;
      color: #FFFFFF;
    }
    .subhead {
      font-size: 0.95rem;
      color: #94A3B8;
      margin-bottom: 1.75rem;
    }
    .product-card {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 14px;
      padding: 1.5rem;
      margin-bottom: 1.75rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1rem;
    }
    .product-img {
      max-width: 140px;
      max-height: 140px;
      object-fit: cover;
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .product-title {
      font-size: 1.15rem;
      font-weight: 700;
      color: #FFFFFF;
    }
    .pricing-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
    }
    .price-special {
      font-size: 1.75rem;
      font-weight: 800;
      color: #34D399;
    }
    .price-reg {
      font-size: 1.15rem;
      color: #64748B;
      text-decoration: line-through;
    }
    .savings-badge {
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #10B981;
      font-size: 0.75rem;
      font-weight: 800;
      padding: 0.2rem 0.5rem;
      border-radius: 6px;
    }
    .benefits-list {
      list-style: none;
      text-align: left;
      margin: 0 auto 2rem;
      max-width: 440px;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .benefits-list li {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      font-size: 0.9rem;
      color: #E2E8F0;
    }
    .benefits-list li::before {
      content: "✓";
      color: #10B981;
      font-weight: 800;
      font-size: 1rem;
    }
    .btn-accept {
      display: block;
      width: 100%;
      padding: 1.1rem;
      border-radius: 12px;
      background: linear-gradient(135deg, #10B981 0%, #059669 100%);
      color: #FFFFFF;
      font-size: 1.05rem;
      font-weight: 700;
      text-decoration: none;
      box-shadow: 0 4px 16px rgba(16, 185, 129, 0.4);
      transition: transform 0.15s ease, box-shadow 0.15s ease;
      cursor: pointer;
    }
    .btn-accept:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(16, 185, 129, 0.5);
    }
    .btn-decline {
      display: inline-block;
      margin-top: 1.15rem;
      color: #94A3B8;
      font-size: 0.85rem;
      text-decoration: underline;
      cursor: pointer;
      transition: color 0.15s;
    }
    .btn-decline:hover {
      color: #CBD5E1;
    }
    .guarantee-note {
      margin-top: 1.25rem;
      font-size: 0.75rem;
      color: #64748B;
    }
  </style>
</head>
<body>
  <div class="container">
    ${urgencyMins > 0 ? `
    <div class="urgency-banner">
      <span>⚡ Limited Offer: Reserved for <span id="jvTimer">${String(urgencyMins).padStart(2, '0')}:00</span></span>
    </div>` : ''}

    ${badgeText ? `<span class="badge">${escapeHtml(badgeText)}</span>` : ''}
    <h1>${escapeHtml(headline)}</h1>
    ${subhead ? `<p class="subhead">${escapeHtml(subhead)}</p>` : ''}

    ${(productImage || productTitle || productPrice || regularPrice) ? `
    <div class="product-card">
      ${productImage ? `<img src="${escapeHtml(productImage)}" alt="${escapeHtml(productTitle || headline)}" class="product-img" />` : ''}
      ${productTitle ? `<div class="product-title">${escapeHtml(productTitle)}</div>` : ''}
      ${(productPrice || regularPrice) ? `<div class="pricing-row">
        ${productPrice ? `<span class="price-special">${escapeHtml(productPrice)}</span>` : ''}
        ${regularPrice ? `<span class="price-reg">${escapeHtml(regularPrice)}</span>` : ''}
        ${discountPercentage ? `<span class="savings-badge">Save ${discountPercentage}%</span>` : ''}
      </div>` : ''}
    </div>` : ''}

    ${benefits.length ? `<ul class="benefits-list">
      ${benefits.map(b => `<li>${escapeHtml(b)}</li>`).join('\n      ')}
    </ul>` : ''}

    <a id="jvAcceptBtn" href="${escapeHtml(acceptUrl)}" class="btn-accept">
      ${escapeHtml(acceptText)} &rarr;
    </a>

    <div>
      <a id="jvDeclineBtn" href="${escapeHtml(declineUrl)}" class="btn-decline">
        ${escapeHtml(declineText)}
      </a>
    </div>

  </div>

  <script>
    (function() {
      // 1. Session-persisted countdown timer
      var urgencyMins = ${urgencyMins};
      if (urgencyMins > 0) {
        var timerKey = 'jv_timer_' + ${JSON.stringify(slug)};
        var totalSecs = urgencyMins * 60;
        var savedEnd = sessionStorage.getItem(timerKey);
        var endTime;

        if (savedEnd) {
          endTime = parseInt(savedEnd, 10);
        } else {
          endTime = Date.now() + (totalSecs * 1000);
          sessionStorage.setItem(timerKey, String(endTime));
        }

        function updateTimer() {
          var remaining = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
          var m = Math.floor(remaining / 60);
          var s = remaining % 60;
          var el = document.getElementById('jvTimer');
          if (el) {
            el.innerText = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
          }
        }
        updateTimer();
        setInterval(updateTimer, 1000);
      }

      // 2. Preserve incoming query parameters (UTMs, tracking) on Accept & Decline clicks
      function forwardParams(linkEl) {
        if (!linkEl) return;
        linkEl.addEventListener('click', function(e) {
          try {
            var search = window.location.search;
            if (!search) return;
            var currentHref = linkEl.getAttribute('href');
            if (!currentHref || currentHref.indexOf('#') === 0) return;
            var sep = currentHref.indexOf('?') !== -1 ? '&' : '?';
            linkEl.setAttribute('href', currentHref + sep + search.replace(/^\\?/, '') + window.location.hash);
          } catch(err) {}
        });
      }

      forwardParams(document.getElementById('jvAcceptBtn'));
      forwardParams(document.getElementById('jvDeclineBtn'));
    })();
  </script>
</body>
</html>`;
}

/**
 * Generates pre-formatted multi-touch email sequence text.
 */
export function generateEmailSequenceText({
  sequenceNode
}: {
  sequenceNode?: Partial<SequenceNodeData>;
}): string {
  // A sequence with no emails exports a note that says so. It used to export three stock emails
  // promising "2 slots remaining" that the person would paste into their email tool.
  const steps: SequenceStep[] = Array.isArray(sequenceNode?.steps) ? sequenceNode.steps : [];
  if (!steps.length) {
    return 'This sequence has no emails yet. Add an email to the step on the map, then export again.\n';
  }
  const rule = '═══════════════════════════════════════════════════════════════';
  const field = (v: unknown, empty: string) => (typeof v === 'string' && v.trim() ? v : empty);

  return steps
    .map(
      (e: SequenceStep, i: number) =>
        `${rule}\nEMAIL #${i + 1} | TIMING: ${field(e.delay, 'Not set').toUpperCase()}\n${rule}\nSUBJECT: ${field(e.subject, '(No subject written yet)')}\nPREVIEW TEXT: ${field(e.previewText, '')}\n\nBODY:\n${field(e.body, '(No body written yet)')}\n`
    )
    .join('\n\n');
}

/**
 * Generates ready-to-run Ad creative hooks and pre-configured UTM campaign URLs.
 */
export function generateAdCopyText({
  adNode,
  destinationUrl = 'https://jourvance.com/p/offer'
}: {
  adNode?: Partial<AdNodeData>;
  destinationUrl?: string;
}): string {
  // The spec carries only what the ad step holds: an empty headline or body says so, and the hook
  // section appears only when a hook was written. The old fallbacks were Jourvance's own pitch.
  const headline = adNode?.headline || '(No headline written yet)';
  const body = ownCopy(adNode?.body) || '(No ad copy written yet)';
  const hook = typeof (adNode as any)?.hook === 'string' ? String((adNode as any).hook).trim() : '';
  const cta = adNode?.ctaText || '(No button text written yet)';

  // Only the step's own campaign tag (U04). An invented one would count visits under a campaign no
  // ad step matches, so with none the links carry no utm_campaign and the spec says why.
  const campaign = adNode?.utmCampaign || '';
  const tag = campaign ? `&utm_campaign=${campaign}` : '';
  const noTag = campaign ? '' : `No campaign tag is set on this ad step, so these links carry none and visits from them
cannot be counted for this ad. Add one in the ad step.

`;
  const utmMeta = `${destinationUrl}?utm_source=meta&utm_medium=cpc${tag}&utm_content=hook_angle_1`;
  const utmGoogle = `${destinationUrl}?utm_source=google&utm_medium=search${tag}&utm_term=customer_journey_builder`;
  const utmTikTok = `${destinationUrl}?utm_source=tiktok&utm_medium=video${tag}&utm_content=problem_agitation`;

  return `═══════════════════════════════════════════════════════════════
AD CREATIVE & COPY SPECIFICATION
═══════════════════════════════════════════════════════════════
${hook ? `HOOK ANGLE:
"${hook}"

` : ''}PRIMARY AD COPY:
${body}

HEADLINE:
${headline}

CALL TO ACTION (CTA):
${cta}

═══════════════════════════════════════════════════════════════
PRE-CONFIGURED UTM TRACKING DESTINATION URLS
═══════════════════════════════════════════════════════════════

${noTag}1. META (FACEBOOK / INSTAGRAM FEED & REELS):
${utmMeta}

2. GOOGLE SEARCH / PMAX:
${utmGoogle}

3. TIKTOK ADS:
${utmTikTok}
`;
}
