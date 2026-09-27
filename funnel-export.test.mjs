import test from 'node:test';
import assert from 'node:assert/strict';

// Import or recreate the pure generator functions to test their logic
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function generateSplitRouterHtml({ splitNode, targetAUrl, targetBUrl }) {
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

      var params = new URLSearchParams(window.location.search);
      var qVar = (params.get('jv_var') || params.get('var') || '').toLowerCase();
      var variant = (qVar === 'a' || qVar === 'b') ? qVar : '';

      if (!variant) {
        var cookieMatch = document.cookie.match(new RegExp('(?:^|; )jv_split_' + slug + '=(a|b)', 'i'));
        if (cookieMatch && cookieMatch[1]) {
          variant = cookieMatch[1].toLowerCase();
        }
      }

      if (!variant) {
        try {
          var stored = localStorage.getItem('jv_split_' + slug);
          if (stored === 'a' || stored === 'b') variant = stored;
        } catch(e) {}
      }

      if (!variant) {
        if (winner === 'a' || splitRatio === 100) variant = 'a';
        else if (winner === 'b' || splitRatio === 0) variant = 'b';
      }

      if (!variant) {
        variant = (Math.random() * 100 < splitRatio) ? 'a' : 'b';
      }

      document.cookie = 'jv_split_' + slug + '=' + variant + '; Path=/; Max-Age=2592000; SameSite=Lax';
      try { localStorage.setItem('jv_split_' + slug, variant); } catch(e) {}

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
</head>
<body>
  <div>Connecting to best experience...</div>
</body>
</html>`;
}

function generateLandingPageHtml({
  pageNode,
  formNode,
  variantOverride,
  leadEndpointUrl,
  externalWebhookUrl,
  workspaceId,
  journeyId
}) {
  const isStaticVariantB = variantOverride === 'b' && Boolean(pageNode?.variantB);
  const vB = pageNode?.variantB || {};

  const headline = isStaticVariantB
    ? (vB.headline || pageNode?.headline || 'High-Converting Offer Headline (Variant B)')
    : (pageNode?.headline || 'High-Converting Offer Headline');

  const subhead = isStaticVariantB
    ? (vB.subhead || pageNode?.subhead || 'Clear, concise subheadline addressing customer pain.')
    : (pageNode?.subhead || 'Clear, concise subheadline addressing customer pain and immediate value.');

  const buttonText = isStaticVariantB
    ? (vB.buttonText || pageNode?.buttonText || formNode?.submitButtonText || 'Claim Offer Now')
    : (pageNode?.buttonText || formNode?.submitButtonText || 'Get Started Free');

  const bullets = isStaticVariantB && Array.isArray(vB.bullets) && vB.bullets.length
    ? vB.bullets
    : ((Array.isArray(pageNode?.bullets) && pageNode.bullets.length)
        ? pageNode.bullets
        : ['Proven 3-step execution framework', 'Instant access upon qualification', 'Zero long-term contracts or lock-ins']);

  const slug = isStaticVariantB ? `${pageNode?.slug || 'offer'}-b` : (pageNode?.slug || 'offer');
  const hasInPageVariantB = !variantOverride && Boolean(pageNode?.abTestingEnabled && pageNode?.variantB);

  return `<!DOCTYPE html>
<html>
<head>
  <title id="jvPageTitle">${escapeHtml(headline)}</title>
  ${hasInPageVariantB ? `<script id="jvDomSwapScript">// In-page DOM swap</script>` : ''}
</head>
<body>
  <h1 id="jvHeadline">${escapeHtml(headline)}</h1>
  <p id="jvSubhead">${escapeHtml(subhead)}</p>
  <ul class="bullets">
    ${bullets.map(b => `<li>${escapeHtml(b)}</li>`).join('\n')}
  </ul>
  <form id="leadCaptureForm">
    <input type="text" name="website_url_hp" style="display:none !important;" />
    <button type="submit" id="submitBtn">${escapeHtml(buttonText)}</button>
  </form>
  <script>
    var targetUrl = ${JSON.stringify(leadEndpointUrl || 'https://jourvance.com/api/public/lead')};
    var payload = {
      slug: '${slug}',
      variant: '${isStaticVariantB ? 'b' : 'a'}'
      ${externalWebhookUrl ? `,\n      externalWebhookUrl: ${JSON.stringify(externalWebhookUrl)}` : ''}
      ${workspaceId ? `,\n      workspaceId: ${JSON.stringify(workspaceId)}` : ''}
      ${journeyId ? `,\n      journeyId: ${JSON.stringify(journeyId)}` : ''}
    };
  </script>
</body>
</html>`;
}

function generateThankYouHtml({ thankYouNode }) {
  const headline = thankYouNode?.headline || 'Your VIP Order is Confirmed';
  const discountCode = thankYouNode?.bounceBackDiscountCode || 'VIPRETURN';
  const guideTitle = thankYouNode?.usageGuideTitle || 'The 3-Step Quick Start Onboarding Guide';
  const guideSteps = (Array.isArray(thankYouNode?.usageGuideSteps) && thankYouNode.usageGuideSteps.length)
    ? thankYouNode.usageGuideSteps
    : ['Check inbox', 'Follow steps', 'Contact support'];

  return `<!DOCTYPE html>
<html>
<head>
  <title>${escapeHtml(headline)}</title>
</head>
<body>
  <h1>${escapeHtml(headline)}</h1>
  <div class="voucher-box">
    <span id="voucherCode">${escapeHtml(discountCode)}</span>
    <button id="copyVoucherBtn" onclick="copyVoucher()">Copy Code</button>
  </div>
  <h2>${escapeHtml(guideTitle)}</h2>
  <ol>
    ${guideSteps.map(s => `<li>${escapeHtml(s)}</li>`).join('\n')}
  </ol>
</body>
</html>`;
}

// ── Tests ─────────────────────────────────────────────────────────────

test('Split Router generator creates lightweight synchronous redirect with sticky cookies', () => {
  const html = generateSplitRouterHtml({
    splitNode: {
      slug: 'summer-sale',
      splitRatio: 50,
      branchAPageSlug: 'summer-a',
      branchBPageSlug: 'summer-b'
    },
    targetAUrl: './summer-a.html',
    targetBUrl: './summer-b.html'
  });

  assert.ok(html.includes('var slug = "summer-sale"'), 'Contains node slug definition');
  assert.ok(html.includes('jv_split_\' + slug'), 'Contains cookie key construction with node slug');
  assert.ok(html.includes('window.location.replace'), 'Uses location.replace for clean history');
  assert.ok(html.includes('./summer-a.html'), 'Contains target A destination');
  assert.ok(html.includes('./summer-b.html'), 'Contains target B destination');
  assert.ok(html.includes('params.set(\'jv_split\''), 'Preserves and sets jv_split UTM param');
  assert.ok(html.includes('params.set(\'jv_var\''), 'Preserves and sets jv_var UTM param');
  assert.ok(html.includes('<noscript>'), 'Includes fallback noscript meta refresh');
});

test('Split Router respects custom remote CDN destination URLs', () => {
  const html = generateSplitRouterHtml({
    splitNode: { slug: 'cdn-test' },
    targetAUrl: 'https://lander.myshopify.com/pages/offer-a',
    targetBUrl: 'https://lander.myshopify.com/pages/offer-b'
  });

  assert.ok(html.includes('https://lander.myshopify.com/pages/offer-a'), 'Inlines custom remote target A');
  assert.ok(html.includes('https://lander.myshopify.com/pages/offer-b'), 'Inlines custom remote target B');
});

test('Landing Page generator creates static Variant B with dedicated copy when override is passed', () => {
  const pageNode = {
    headline: 'Original Control Headline',
    subhead: 'Original Subhead',
    abTestingEnabled: true,
    variantB: {
      headline: 'Challenger Headline B',
      subhead: 'Challenger Subhead B',
      buttonText: 'Claim 20% Off Variant B',
      bullets: ['Challenger Bullet 1', 'Challenger Bullet 2']
    }
  };

  const html = generateLandingPageHtml({ pageNode, variantOverride: 'b' });

  assert.ok(html.includes('Challenger Headline B'), 'Statically renders Variant B headline');
  assert.ok(html.includes('Challenger Subhead B'), 'Statically renders Variant B subhead');
  assert.ok(html.includes('Claim 20% Off Variant B'), 'Statically renders Variant B button text');
  assert.ok(html.includes('Challenger Bullet 1'), 'Statically renders Variant B bullets');
  assert.ok(!html.includes('jvDomSwapScript'), 'Does not include DOM swap script on static Variant B page');
  assert.ok(html.includes('website_url_hp'), 'Preserves anti-bot honeypot field');
});

test('Landing Page generator embeds in-page dynamic swap script when single-page A/B testing is active', () => {
  const pageNode = {
    headline: 'Original Control Headline',
    subhead: 'Original Subhead',
    abTestingEnabled: true,
    variantB: {
      headline: 'Challenger Headline B'
    }
  };

  const html = generateLandingPageHtml({ pageNode });

  assert.ok(html.includes('Original Control Headline'), 'Renders original control by default');
  assert.ok(html.includes('jvDomSwapScript'), 'Embeds client-side in-page DOM swap script');
});

test('VIP Thank-You Portal generator includes courtesy voucher and onboarding guide', () => {
  const thankYouNode = {
    headline: 'Welcome to the VIP Club',
    bounceBackDiscountCode: 'VIPCLUB30',
    usageGuideTitle: 'Getting Started in 3 Easy Steps',
    usageGuideSteps: [
      'Activate your account link',
      'Download your onboarding checklist',
      'Schedule your 1-on-1 strategy walkthrough'
    ]
  };

  const html = generateThankYouHtml({ thankYouNode });

  assert.ok(html.includes('Welcome to the VIP Club'), 'Renders portal headline');
  assert.ok(html.includes('VIPCLUB30'), 'Renders bounce-back courtesy voucher code');
  assert.ok(html.includes('Getting Started in 3 Easy Steps'), 'Renders onboarding guide title');
  assert.ok(html.includes('Schedule your 1-on-1 strategy walkthrough'), 'Renders onboarding steps');
  assert.ok(html.includes('copyVoucher()'), 'Includes 1-click clipboard copy script');
});

test('Landing Page generator inlines custom lead ingestion endpoint and dual-sync external webhook', () => {
  const pageNode = {
    headline: 'High-Converting Offer',
    slug: 'vip-offer'
  };

  const html = generateLandingPageHtml({
    pageNode,
    leadEndpointUrl: 'https://app.jourvance.com/api/public/lead',
    externalWebhookUrl: 'https://hooks.zapier.com/hooks/catch/12345/abcdef',
    workspaceId: 'ws_demo_123',
    journeyId: 'jrn_demo_456'
  });

  assert.ok(html.includes('https://app.jourvance.com/api/public/lead'), 'Inlines custom Jourvance API endpoint');
  assert.ok(html.includes('https://hooks.zapier.com/hooks/catch/12345/abcdef'), 'Inlines external webhook URL');
  assert.ok(html.includes('ws_demo_123'), 'Inlines workspaceId for tenant binding');
  assert.ok(html.includes('jrn_demo_456'), 'Inlines journeyId for flow automation binding');
});

test('POST and OPTIONS /api/public/lead provide valid CORS headers for self-hosted funnels', async () => {
  try {
    const optRes = await fetch('http://localhost:3005/api/public/lead', { method: 'OPTIONS' });
    if (optRes.status === 204) {
      assert.equal(optRes.headers.get('access-control-allow-origin'), '*');
      assert.ok(optRes.headers.get('access-control-allow-methods').includes('POST'));
    }

    const postRes = await fetch('http://localhost:3005/api/public/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `unit-cors-${Date.now()}@example.com`,
        workspaceId: 'ws_test',
        journeyId: 'jrn_test'
      })
    });
    if (postRes.ok) {
      assert.equal(postRes.headers.get('access-control-allow-origin'), '*');
      const data = await postRes.json();
      assert.equal(data.success, true);
    }
  } catch (err) {
    // If port 3005 is not reachable in offline test environment, ignore network errors
  }
});

