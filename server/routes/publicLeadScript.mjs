// The browser-side body of a lead submission to POST /api/public/lead, as inline script text.
//
// One function words it so the legacy page template and the builder page's lead form widget
// (LANDING_BUILDER_DESIGN.md section 3, "Commerce widgets and the frame") post the same fields
// in the same order. The text is a fragment: it starts at `body: JSON.stringify({` and ends at
// the closing `})`, so a caller drops it inside `fetch('/api/public/lead', { method, headers, ... })`.
//
// The fragment names variables that the page frame script declares before the form is wired:
//   slug, isBumpChecked, activeVariant, activeCurrency, utm_source, utm_medium, utm_campaign,
//   utm_content, utm_term, fbclid, ttclid, gclid, referralCode
// and the three input values come from the expressions in `context`, so a page whose inputs have
// other names (the builder's lead widget) can say so. The defaults reproduce the legacy modal.
//
// The legacy page snapshot (page-builder-legacy-snapshot.test.mjs) pins these bytes: the
// indentation below is the indentation the template had when the code lived inline.

// The fields, in the order they are posted. Pinned by page-builder-publish.test.mjs.
export const LEAD_BODY_FIELDS = Object.freeze([
  'slug', 'email', 'name', 'phone', 'order_bump_selected', 'variant', 'currency',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'fbclid', 'ttclid', 'gclid', 'visitorId', 'ref'
]);

const DEFAULTS = Object.freeze({
  emailExpr: 'emailInput.value',
  nameExpr: 'nameInput.value',
  phoneExpr: 'phoneInput.value'
});

// An expression is spliced into script text, so it must be a plain dotted or called identifier
// path the frame owns, never anything a merchant typed.
const SAFE_EXPR = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\(\s*(?:'[\w-]*'|"[\w-]*")?\s*\))*$/;

export function leadBodyScript(context = {}) {
  const pick = (key) => {
    const v = context[key] === undefined ? DEFAULTS[key] : context[key];
    if (typeof v !== 'string' || !SAFE_EXPR.test(v)) {
      throw new Error(`leadBodyScript: ${key} must be a plain identifier path`);
    }
    return v;
  };
  const email = pick('emailExpr');
  const name = pick('nameExpr');
  const phone = pick('phoneExpr');
  return `body: JSON.stringify({
                slug,
                email: ${email},
                name: ${name},
                phone: ${phone},
                order_bump_selected: isBumpChecked,
                variant: activeVariant,
                currency: activeCurrency,
                utm_source,
                utm_medium,
                utm_campaign,
                utm_content: (utm_content ? utm_content + '_' : '') + 'var-' + activeVariant,
                utm_term,
                fbclid,
                ttclid,
                gclid,
                visitorId: window.jourvanceVisitor ? window.jourvanceVisitor() : '',
                ref: referralCode || undefined
              })`;
}
