import crypto from 'crypto';
import { planPublishAddresses, NOTHING_CHANGED, cleanCustomDomain } from '../../src/lib/publishAddresses.ts';
import {
  stepFingerprint,
  publishKey,
  normalizeSlug,
  startRevision,
  finishRevision,
  markUnpublished,
  liveRevisionEntry,
  everyLoggedPage,
  PREVIEW_TTL_MS,
  previewMinutesLeft
} from '../../src/lib/publishState.ts';
import { addRevisions, listRevisions, getRevision, revisionsLogId, isRevisionsLogJourneyId, normalizeRevisionsLog } from '../builderRevisions.mjs';
import { validateBuilderDoc } from '../../src/lib/pageBuilder/model.mjs';

/**
 * Mounts journey loading, publishing, unpublishing, publication status, preview links and the
 * slug check. Express answers with the first route that matches, so every literal GET under
 * /api/journey/ must sit above GET /api/journey/:id in this file.
 *
 * What is live is decided here, not by node.data.published: every public record carries the
 * revision that wrote it and a content fingerprint of its step (src/lib/publishState.ts), and a
 * per-journey publish log holds the revision numbers.
 */

const HOSTED_STEP_TYPES = new Set(['landing-page', 'upsell', 'ab-split']);
const PREVIEW_PER_USER = 20;
const PREVIEW_TOTAL = 500;
const PIXEL_KEYS = new Set(['metaPixelId', 'tiktokPixelId', 'ga4TrackingId']);

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/** Blanks every pixel id at any depth, variantB and the merged snapshots included. */
function blankPixelIds(value) {
  if (Array.isArray(value)) {
    value.forEach(blankPixelIds);
  } else if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (PIXEL_KEYS.has(key)) value[key] = '';
      else blankPixelIds(value[key]);
    }
  }
  return value;
}

// Every miss answers these same bytes, whether the token was malformed, unknown or expired.
const PREVIEW_EXPIRED_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>This preview link has expired</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #0F172A; color: #E2E8F0; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; padding: 24px; box-sizing: border-box; }
  main { max-width: 440px; text-align: center; }
  h1 { font-size: 22px; margin: 0 0 12px; color: #FFFFFF; }
  p { font-size: 15px; line-height: 1.55; margin: 0; color: #CBD5E1; }
</style>
</head>
<body>
<main>
  <h1>This preview link has expired</h1>
  <p>Preview links work for one hour. Open the step in Jourvance and make a new preview.</p>
</main>
</body>
</html>`;

const PREVIEW_ERROR_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex, nofollow">
<title>This preview could not be shown</title>
</head>
<body style="font-family: system-ui, sans-serif; padding: 24px;">
<h1 style="font-size: 20px;">This preview could not be shown</h1>
<p>Open the step in Jourvance and make a new preview.</p>
</body>
</html>`;

function setPreviewHeaders(res) {
  res.setHeader('Content-Security-Policy', "connect-src 'none'; form-action 'none'");
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
}

/** Adds noindex and the sticky preview banner to a rendered page. Never adds tracking. */
function decoratePreview(html, minutesLeft) {
  const robots = '<meta name="robots" content="noindex, nofollow">';
  const when = minutesLeft === 1 ? '1 more minute' : `${minutesLeft} more minutes`;
  const banner = `<div role="note" style="position: sticky; top: 0; z-index: 2147483647; margin: 0; padding: 10px 16px; background: #1E293B; color: #F8FAFC; border-bottom: 2px solid #FBBF24; font: 600 14px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif; text-align: center;">Preview. This page is not live, and it sends no data. Store buttons still open your real checkout. This link works for ${when}.</div>`;
  let out = String(html || '');
  out = /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, (m) => m + robots) : robots + out;
  out = /<body[^>]*>/i.test(out) ? out.replace(/<body[^>]*>/i, (m) => m + banner) : banner + out;
  return out;
}

export function setupJourneyRoutes(app, ctx) {
  const {
    requireUser,
    loadJourney,
    saveJourney,
    loadWorkspace,
    realStoreDomain,
    validateSlugAvailability,
    reloadDomainRegistry,
    domainRegistryCache,
    savePublicPage,
    removePublicPage,
    persistPublicPages,
    publicPageCache,
    loadPublishLog = async () => ({ ok: true, log: null }),
    savePublishLog = async () => ({ durable: false, reason: 'No publish log store.' }),
    loadPublicPage = async (key) => publicPageCache[key] || null,
    // { ok, page }: ok false means the store could not say whether a record is there. Without
    // it, every read counts as an answer.
    readPublicPage = async (key) => ({ ok: true, page: await loadPublicPage(key) }),
    // { ok, journey }: ok false means the account store could not say what the journey holds.
    // Without it, every load counts as an answer.
    readJourney = async (uid, id) => ({ ok: true, journey: await loadJourney(uid, id) }),
    renderPublicFunnelHtml,
    renderPublicUpsellHtml,
    now = () => Date.now()
  } = ctx;

  const isoNow = () => new Date(now()).toISOString();

  // A journey the store could not read is not a missing journey: "not found" or an older copy
  // would be a wrong answer, and a publish or unpublish built on either writes it over the account.
  const answerJourneyUnavailable = (res) => {
    res.set('Retry-After', '30');
    return res.status(503).json({ success: false, retryable: true, error: 'Your journey could not be read from your account. Try again.' });
  };

  // Publish and unpublish of one journey run one at a time in this process, so two clicks can
  // never share a revision number or interleave their writes.
  const chains = new Map();
  const serialized = (key, fn) => {
    const run = (chains.get(key) || Promise.resolve()).then(fn);
    const tail = run.catch(() => {});
    chains.set(key, tail);
    tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
    return run;
  };

  // The Shopify config a page is published with: the workspace's store when it is a real one.
  const publishShopifyConfig = (ws) => {
    const connectedDomain = realStoreDomain(ws?.shopifyConfig);
    return connectedDomain
      ? { ...ws.shopifyConfig, storeDomain: connectedDomain }
      : { storeDomain: '', status: 'disconnected' };
  };

  const domainVerifiedFor = (customDomain, uid) => {
    if (!customDomain) return false;
    reloadDomainRegistry();
    const reg = domainRegistryCache[customDomain];
    return Boolean(reg && reg.verified && reg.userId === uid);
  };

  // The steps a landing record carries with it: the first upsell, downsell and thank-you.
  const funnelParts = (nodes) => {
    const upsellNodes = nodes.filter(n => n.type === 'upsell');
    return {
      upsellNode: upsellNodes.find(u => u.data?.offerType !== 'downsell'),
      downsellNode: upsellNodes.find(u => u.data?.offerType === 'downsell'),
      thankYouNode: nodes.find(n => n.type === 'thank-you')
    };
  };

  const landingData = (d, { slug, url, customDomain, isDomainVerified, publishedAt, parts }) => ({
    ...d,
    slug,
    customDomain: customDomain || undefined,
    customDomainVerified: isDomainVerified,
    published: true,
    publishedAt,
    publishedUrl: url,
    upsell: parts.upsellNode?.data ? { ...parts.upsellNode.data } : d.upsell,
    downsell: parts.downsellNode?.data ? { ...parts.downsellNode.data } : d.downsell,
    hasDownsell: Boolean(parts.downsellNode?.data || d.downsell),
    thankYou: parts.thankYouNode?.data ? { ...parts.thankYouNode.data } : d.thankYou
  });

  // A copy of landing data without the builder documents (never the node's own object).
  const withoutBuilder = (data) => {
    const { builder: _builder, builderB: _builderB, ...rest } = data;
    return rest;
  };

  const upsellRecordData = (data, d) => ({
    ...data,
    upsell: d.offerType !== 'downsell' ? data : undefined,
    downsell: d.offerType === 'downsell' ? data : undefined
  });

  // Real-time pre-flight slug check endpoint. The answer is advisory: publish runs the same
  // validator again, so a pass here never reserves the address.
  app.get('/api/journey/check-slug', requireUser, async (req, res) => {
    try {
      const slug = String(req.query.slug || '').trim();
      const type = String(req.query.type || 'page').trim();
      const customDomain = String(req.query.customDomain || '').trim();
      // Optional: with the asking journey's id, an address live on another of the user's journeys
      // reads as taken, as it does at publish.
      const journeyId = String(req.query.journeyId || '').trim();
      const result = await validateSlugAvailability(slug, req.user.uid, { type, customDomain, ...(journeyId ? { journeyId } : {}) });
      if (!result.available && result.retryable) {
        res.set('Retry-After', '30');
        return res.status(503).json({ success: false, available: false, retryable: true, error: result.error });
      }
      if (!result.available) {
        return res.status(409).json({ success: false, available: false, error: result.error });
      }
      // Without a journeyId, an address live on one of the user's journeys is named, not just free.
      return res.json({
        success: true,
        available: true,
        cleanSlug: result.cleanSlug,
        ...(result.liveOnJourneyId ? { liveOnJourneyId: result.liveOnJourneyId } : {})
      });
    } catch (err) {
      console.error('[Jourvance] Slug check failed:', err);
      if (res.headersSent) return;
      res.status(500).json({ success: false, retryable: true, error: 'The address check did not finish. Try again.' });
    }
  });

  // What is live for this journey, read from the public records themselves.
  app.get('/api/journey/:id/publication', requireUser, async (req, res) => {
    try {
      await readPublication(req, res);
    } catch (err) {
      answerReadFailure(res, 'The status check', err);
    }
  });

  // Each publish of a page that carries a builder document keeps that document as a revision
  // (server/builderRevisions.mjs), in the publish log store under its own id. The pages are live
  // by now, so a store that cannot be read or written never fails the publish: the revision is
  // skipped and said so in the log. A log that cannot be READ is never written over.
  async function storeBuilderRevisions(uid, journeyId, number, publishedAt, writes) {
    const entries = writes
      .filter(w => w.record && w.record.builder)
      .map(w => ({ nodeId: w.nodeId, document: w.record.builder, documentB: w.record.builderB, fingerprint: w.record.contentFingerprint }));
    if (!entries.length) return 'none';
    try {
      const read = await loadPublishLog(uid, revisionsLogId(journeyId));
      if (!read || !read.ok) {
        console.error('[Jourvance] Builder revisions were not stored: the revisions log could not be read.');
        return 'failed';
      }
      // A history already at this number or past it holds another publish's version under it:
      // writing would replace that version. It is kept, and this one is said as not saved.
      if (normalizeRevisionsLog(read.log).lastNumber >= number) {
        console.error(`[Jourvance] Builder revisions were not stored: the history already holds number ${number}.`);
        return 'failed';
      }
      const next = addRevisions(read.log, { number, publishedAt, userId: uid, entries });
      const saved = await savePublishLog(uid, revisionsLogId(journeyId), next);
      if (saved && saved.durable === false) {
        console.error('[Jourvance] Builder revisions were kept on this server only:', saved.reason);
        return 'local';
      }
      return 'saved';
    } catch (err) {
      console.error('[Jourvance] Storing builder revisions failed:', err);
      return 'failed';
    }
  }

  // The publish answer's sentence when the publish record did not reach the store.
  const PUBLISH_LOG_NOT_SAVED = 'This publish could not be recorded in storage. Your pages are live; publish again soon so the record is kept.';

  // The publish log, or a copy of it whose lastNumber is raised to the page history's when the
  // history is ahead. A history that cannot be read changes nothing here: storeBuilderRevisions
  // reads it again and refuses to write a number it already holds.
  async function withHistoryFloor(uid, journeyId, log) {
    let history;
    try {
      history = await loadPublishLog(uid, revisionsLogId(journeyId));
    } catch {
      return log;
    }
    if (!history || !history.ok) return log;
    const ahead = normalizeRevisionsLog(history.log).lastNumber;
    const mine = Number.isFinite(log?.lastNumber) ? Number(log.lastNumber) : 0;
    return ahead > mine ? { ...(log && typeof log === 'object' ? log : {}), lastNumber: ahead } : log;
  }

  // The publish answer's sentence when this version did not reach the stored page history.
  const HISTORY_NOT_SAVED = 'This version could not be saved to the page history, so History may not list it later. Your pages are live.';

  // A journey id ending in REVISIONS_LOG_SUFFIX names another journey's history in the publish
  // log store, so nothing that reads or writes a publish log takes one. True when it answered.
  function refusedRevisionsLogId(req, res) {
    if (!isRevisionsLogJourneyId(req.params.id)) return false;
    res.status(400).json({ success: false, retryable: false, error: 'This journey cannot be published because its id ends in "#builder-revisions", which the page history keeps for itself. Duplicate the journey and publish the copy.' });
    return true;
  }

  // Own journeys only: a journey the user does not hold is a 404, and so is one with no revisions.
  async function openRevisionsLog(req, res) {
    const nodeId = typeof req.query.nodeId === 'string' ? req.query.nodeId : '';
    if (!nodeId) {
      res.status(400).json({ success: false, error: 'nodeId is required.' });
      return null;
    }
    let read;
    try {
      read = await readJourney(req.user.uid, req.params.id);
    } catch (err) {
      console.error('[Jourvance] Loading a journey for its revisions failed:', err);
    }
    if (!read || !read.ok) { answerJourneyUnavailable(res); return null; }
    if (!read.journey) {
      res.status(404).json({ success: false, error: 'Journey not found.' });
      return null;
    }
    let logRead;
    try {
      logRead = await loadPublishLog(req.user.uid, revisionsLogId(req.params.id));
    } catch (err) {
      console.error('[Jourvance] Reading builder revisions failed:', err);
    }
    if (!logRead || !logRead.ok) {
      res.set('Retry-After', '30');
      res.status(503).json({ success: false, retryable: true, error: 'The page history could not be read. Try again in a minute.' });
      return null;
    }
    return { nodeId, log: logRead.log };
  }

  // Express 4 does not catch a rejected handler, so each read answers its own failure: a throw
  // here used to leave the request hanging with an unhandled rejection in the log.
  app.get('/api/journey/:id/builder-revisions', requireUser, async (req, res) => {
    try {
      const opened = await openRevisionsLog(req, res);
      if (!opened) return;
      res.json({ success: true, revisions: listRevisions(opened.log, opened.nodeId) });
    } catch (err) {
      answerReadFailure(res, 'Reading the page history', err);
    }
  });

  app.get('/api/journey/:id/builder-revisions/:rev', requireUser, async (req, res) => {
    const rev = /^\d+$/.test(req.params.rev) ? Number(req.params.rev) : NaN;
    if (!Number.isSafeInteger(rev)) return res.status(400).json({ success: false, error: 'The revision must be a number.' });
    try {
      const opened = await openRevisionsLog(req, res);
      if (!opened) return;
      const row = getRevision(opened.log, opened.nodeId, rev);
      if (!row) return res.status(404).json({ success: false, error: 'Revision not found.' });
      res.json({ success: true, revision: row });
    } catch (err) {
      answerReadFailure(res, 'Reading the page history', err);
    }
  });

  // Registered after every literal /api/journey/<name> GET above; see the header.
  app.get('/api/journey/:id', requireUser, async (req, res) => {
    let read;
    try {
      read = await readJourney(req.user.uid, req.params.id);
    } catch (err) {
      console.error('[Jourvance] Loading a journey failed:', err);
    }
    if (!read || !read.ok) return answerJourneyUnavailable(res);
    res.json({ success: true, journey: read.journey || null });
  });

  // Express 4 does not catch a rejected async handler. A throw in here used to leave the request
  // hanging and, with no unhandledRejection handler, exit the process for every tenant (the A/B
  // branch referenced an undefined `splitRecord`). A failure now answers once, in words. Pass
  // changed = false only when the failure landed before the first write.
  const answerFailure = (res, action, err, changed = true) => {
    console.error(`[Jourvance] ${action} failed:`, err);
    if (res.headersSent) return;
    res.status(500).json({
      success: false,
      retryable: true,
      error: changed
        ? `${action} did not finish on the server. Some pages may have changed before it stopped, so try again.`
        : `${action} did not finish on the server. No page was changed, so try again.`
    });
  };

  // For the routes that never change a page: the status read and making a preview.
  const answerReadFailure = (res, action, err) => {
    console.error(`[Jourvance] ${action} failed:`, err);
    if (res.headersSent) return;
    res.status(500).json({ success: false, retryable: true, error: `${action} did not finish on the server. Try again.` });
  };

  // Funnel Publishing Route
  app.post('/api/journey/:id/publish', requireUser, (req, res) => serialized(`${req.user.uid}:${req.params.id}`, async () => {
    const progress = { writing: false };
    try {
      await publishJourney(req, res, progress);
    } catch (err) {
      answerFailure(res, 'Publishing', err, progress.writing);
    }
  }));

  // Publishing is all or nothing. Phase 1 checks every address and writes nothing. Phase 2 builds
  // every record and a new nodes array in memory, never touching the loaded journey: with the hub
  // off, readJourney hands back the live cache entry, so a change to it would outlive a refusal.
  // Phase 3 reserves the revision number, takes one synchronous last look and then starts every
  // write in the same tick.
  async function publishJourney(req, res, progress) {
    if (refusedRevisionsLogId(req, res)) return;
    const uid = req.user.uid;
    const read = await readJourney(uid, req.params.id);
    if (!read || !read.ok) return answerJourneyUnavailable(res);
    const journey = read.journey;
    if (!journey) return res.status(404).json({ success: false, error: 'Journey not found.' });

    // A history that cannot be read must never be overwritten, or revision numbers come round
    // again. A 404 is not a failure: it is a journey that was never published.
    const logRead = await loadPublishLog(uid, req.params.id);
    if (!logRead || !logRead.ok) {
      return res.status(503).json({
        success: false,
        retryable: true,
        error: `The publish history could not be read, so nothing was changed. Try again in a minute.`
      });
    }

    const wsId = journey.workspaceId || req.body?.workspaceId;
    const ws = wsId ? await loadWorkspace(uid, wsId) : null;
    const nodes = Array.isArray(journey.nodes) ? journey.nodes : [];
    const edges = Array.isArray(journey.edges) ? journey.edges : [];
    const shopifyConfig = publishShopifyConfig(ws);

    // A landing page that carries a builder document (LANDING_BUILDER_PLAN.md) is validated before
    // anything else happens, and a document with problems refuses the whole publish: a broken page
    // is never published half drawn, and no page of this journey changes. `builder` is version A;
    // `builderB` is carried for a later wave and checked the same way.
    const builderProblems = [];
    for (const node of nodes) {
      if (node?.type !== 'landing-page') continue;
      for (const field of ['builder', 'builderB']) {
        const doc = node.data?.[field];
        if (doc === undefined || doc === null) continue;
        for (const p of validateBuilderDoc(doc).problems) {
          builderProblems.push({ nodeId: node.id, field, path: p.path, message: p.message });
        }
      }
    }
    if (builderProblems.length) {
      const first = builderProblems[0];
      const where = `${first.field}${first.path ? (first.path.startsWith('[') ? '' : '.') + first.path : ''}`;
      return res.status(400).json({
        success: false,
        error: `The page design has ${builderProblems.length === 1 ? 'a problem' : `${builderProblems.length} problems`}, so nothing was published. First: ${where}: ${first.message}`,
        problems: builderProblems.slice(0, 50)
      });
    }

    // Phase 1: plan every address. Nothing is written. An address live on another of this user's
    // journeys is refused and that journey named, never taken over. A journey that no longer
    // exists owns nothing, so its leftover page may be replaced as before; those keys are
    // remembered so the last look does not refuse them.
    const leftoverKeys = new Set();
    const checkAddress = async (slug, opts) => {
      const r = await validateSlugAvailability(slug, uid, { ...opts, journeyId: journey.id });
      if (!r || r.available || !r.otherJourneyId) return r;
      const other = await readJourney(uid, r.otherJourneyId);
      if (!other || !other.ok) {
        return { available: false, retryable: true, error: `We could not check which of your journeys uses the address ${opts.type === 'ab-split' ? `/p/split/${slug}` : `/p/${slug}`}.` };
      }
      if (!other.journey) {
        const again = await validateSlugAvailability(slug, uid, opts);
        if (again && again.available) {
          leftoverKeys.add(`${opts.type === 'ab-split' ? `split:${slug}` : slug}|${r.otherJourneyId}`);
          if (opts.customDomain) leftoverKeys.add(`domain:${opts.customDomain}|${r.otherJourneyId}`);
        }
        return again;
      }
      const name = typeof other.journey.name === 'string' ? other.journey.name.trim().slice(0, 80) : '';
      return name ? { ...r, error: r.error.replace('another of your journeys', `your journey "${name}"`) } : r;
    };
    const plan = await planPublishAddresses(nodes, {
      check: checkAddress,
      suffix: () => crypto.randomBytes(2).toString('hex')
    });
    if (!plan.ok && plan.retryable) {
      res.set('Retry-After', '30');
      return res.status(503).json({ success: false, retryable: true, error: plan.error, nodeIds: plan.nodeIds });
    }
    if (!plan.ok) {
      return res.status(409).json({ success: false, error: plan.error, nodeIds: plan.nodeIds });
    }

    // Phase 2: build in memory.
    const publishedAt = isoNow();
    const byId = new Map(plan.addresses.map(a => [a.nodeId, a]));
    const pageSlug = (nodeId) => {
      const a = byId.get(nodeId);
      return a && (a.type === 'landing-page' || a.type === 'upsell') ? a.slug : '';
    };
    const parts = funnelParts(nodes);
    const servedThankYou = parts.thankYouNode
      ? { nodeId: parts.thankYouNode.id, fingerprint: stepFingerprint(parts.thankYouNode, edges) }
      : null;

    const writes = [];
    const publishedPages = [];
    const steps = [];
    const livePages = [];
    const nextNodes = nodes.map(node => {
      const a = byId.get(node.id);
      if (!a) return node;
      const d = node.data || {};
      const base = {
        slug: a.slug,
        journeyId: journey.id,
        workspaceId: wsId || 'default',
        userId: uid,
        nodeId: node.id,
        publishedAt
      };
      const stamp = (data) => ({ contentFingerprint: stepFingerprint({ ...node, data }, edges) });
      livePages.push({ nodeId: node.id, type: a.type, key: a.key, url: a.url });

      if (a.type === 'landing-page') {
        const customDomain = a.customDomain;
        const isDomainVerified = domainVerifiedFor(customDomain, uid);
        const data = landingData(d, { slug: a.slug, url: a.url, customDomain, isDomainVerified, publishedAt, parts });
        writes.push({
          nodeId: node.id,
          key: a.key,
          url: a.url,
          customDomain: customDomain && isDomainVerified ? customDomain : '',
          record: {
            ...base,
            // The builder document lives at the top of the record only; data keeps the flat
            // fields. The fingerprint below is taken from the full node data, so it still moves
            // when the design does.
            data: withoutBuilder(data),
            shopifyConfig,
            customDomain: customDomain || undefined,
            customDomainVerified: isDomainVerified,
            ...(d.builder ? { builder: d.builder } : {}),
            ...(d.builderB ? { builderB: d.builderB } : {}),
            ...stamp(data),
            servedThankYou
          }
        });
        publishedPages.push({
          nodeId: node.id,
          slug: a.slug,
          url: a.url,
          headline: d.headline,
          productTitle: d.shopifyProductTitle,
          checkoutMode: d.checkoutMode || 'direct',
          customDomain: customDomain || undefined,
          customDomainVerified: isDomainVerified,
          // The domain check in the publish dialog names the journey, so a verify moves the domain
          // only onto this journey's page.
          ...(customDomain ? { journeyId: journey.id } : {})
        });
        steps.push({ nodeId: node.id, type: a.type, slug: a.slug, url: a.url, publishedAt, customDomain: customDomain || undefined });
        return { ...node, data };
      }

      if (a.type === 'upsell') {
        const data = { ...d, slug: a.slug, published: true, publishedAt, publishedUrl: a.url };
        writes.push({
          nodeId: node.id,
          key: a.key,
          url: a.url,
          record: { ...base, data: upsellRecordData(data, d), shopifyConfig, ...stamp(data) }
        });
        steps.push({ nodeId: node.id, type: a.type, slug: a.slug, url: a.url, publishedAt });
        return { ...node, data };
      }

      // A/B split: each branch sends traffic to the address its page is published at in this
      // same request, whatever the node order and whether or not the page has a chosen path.
      const outgoingEdges = edges.filter(e => e.source === node.id);
      const edgeA = outgoingEdges.find(e => e.sourceHandle === 'branch-a') || outgoingEdges[0];
      const edgeB = outgoingEdges.find(e => e.sourceHandle === 'branch-b') || outgoingEdges[1];
      const branchSlug = (edge, fallback) => {
        if (!edge) return fallback || '';
        const targetNode = nodes.find(n => n.id === edge.target);
        return pageSlug(edge.target) || targetNode?.data?.slug || fallback || '';
      };
      const data = {
        ...d,
        slug: a.slug,
        branchAPageSlug: branchSlug(edgeA, d.branchAPageSlug),
        branchBPageSlug: branchSlug(edgeB, d.branchBPageSlug),
        published: true,
        publishedAt,
        publishedUrl: a.url
      };
      writes.push({
        nodeId: node.id,
        key: a.key,
        url: a.url,
        split: true,
        record: { type: 'ab-split', ...base, data, shopifyConfig, ...stamp(data) }
      });
      publishedPages.push({
        nodeId: node.id,
        slug: a.slug,
        url: a.url,
        headline: d.label || 'A/B Traffic Splitter',
        productTitle: `A/B Split (${d.splitRatio ?? 50}% / ${100 - (d.splitRatio ?? 50)}%)`,
        checkoutMode: 'ab-split'
      });
      steps.push({
        nodeId: node.id,
        type: a.type,
        slug: a.slug,
        url: a.url,
        publishedAt,
        branchAPageSlug: data.branchAPageSlug,
        branchBPageSlug: data.branchBPageSlug
      });
      return { ...node, data };
    });

    // Phase 3: the last look. Another store, or another of this user's journeys, may have claimed
    // a key while phase 1 awaited its checks. It reads the cache, not the hub, so two server
    // instances can still race.
    const otherJourneyHolds = (cur, leftoverKey) =>
      cur.journeyId && journey.id && String(cur.journeyId) !== String(journey.id) && !leftoverKeys.has(`${leftoverKey}|${cur.journeyId}`);
    const takenBy = (w) => {
      const cur = publicPageCache[w.key];
      if (cur && typeof cur === 'object' && cur.userId) {
        if (cur.userId !== uid) return 'store';
        if (otherJourneyHolds(cur, w.key)) return 'journey';
      }
      // The custom domain as well: savePublicPage points it at this page, off the page of
      // another of this user's journeys that took it while phase 1 awaited. A page the pointer
      // was left on after the user took the domain off it does not hold it.
      const holder = w.customDomain ? publicPageCache[publicPageCache[`domain:${w.customDomain}`]] : null;
      if (holder && typeof holder === 'object' && holder.userId === uid && holder.slug !== w.record.slug &&
        cleanCustomDomain(holder.customDomain || holder.data?.customDomain) === w.customDomain &&
        otherJourneyHolds(holder, `domain:${w.customDomain}`)) return 'domain';
      return '';
    };
    const lostAddress = () => writes.find(w => takenBy(w));
    const lostSentence = (lost) => {
      switch (takenBy(lost)) {
        case 'journey': return `The address ${lost.url} was just published by another of your journeys. Change the Page URL Path, then publish again.`;
        case 'domain': return `The custom domain ${lost.customDomain} was just published by another of your journeys. Remove it from this page or take that journey offline, then publish again.`;
        default: return `The address ${lost.url} was just taken by another store. Change the Page URL Path, then publish again.`;
      }
    };
    const refuseLost = (lost) => res.status(409).json({
      success: false,
      error: `${lostSentence(lost)} ${NOTHING_CHANGED}`,
      nodeIds: [lost.nodeId]
    });
    const lostEarly = lostAddress();
    if (lostEarly) return refuseLost(lostEarly);

    // Reserve the revision just before the first record write, so a refusal above never takes a
    // number. Its planned pages are recorded now: a publish that stops partway leaves a "started"
    // entry that unpublish can still find.
    const revisionId = `rev_${crypto.randomBytes(8).toString('hex')}`;
    // The page history keeps its own lastNumber. When the publish log lost a write (a hub put
    // refused, then a fresh disk after a redeploy) the history can be ahead of it, and the next
    // number must clear both, or a new version takes an old version's number in History.
    let log = startRevision(await withHistoryFloor(uid, req.params.id, logRead.log), revisionId, publishedAt, livePages);
    const revisionNumber = log.lastNumber;
    await savePublishLog(uid, req.params.id, log);

    // The look again, because the log save awaited. No await sits between this look and the
    // writes, and savePublicPage claims its cache key before its first await, so nothing can
    // claim a key in between inside this process.
    const lostLate = lostAddress();
    if (lostLate) return refuseLost(lostLate);

    for (const w of writes) {
      w.record.revisionId = revisionId;
      w.record.revisionNumber = revisionNumber;
    }
    for (const p of publishedPages) p.revisionNumber = revisionNumber;

    progress.writing = true;
    // The map starts every save in this tick. There is no rollback across pages: a throw here is a
    // programming error and the 500 says pages may have changed. Each save answers what it
    // achieved; a page the store refused was undone on this server (written: false), a stored page
    // whose custom domain pointer was refused stays live with only the pointer put back
    // (pointerRefused), and a stub that answers nothing counts as saved.
    const saved = await Promise.all(writes.map(w => savePublicPage(w.key, w.record)));
    const refused = writes.filter((w, i) => saved[i] && saved[i].written === false);
    const unpointed = writes.filter((w, i) => saved[i] && saved[i].written !== false && saved[i].pointerRefused);
    for (const w of writes) {
      if (refused.includes(w)) continue;
      if (w.customDomain && !unpointed.includes(w)) publicPageCache[`domain:${w.customDomain}`] = w.record.slug;
      if (w.split) publicPageCache[w.key] = w.record;
    }
    if (refused.length || unpointed.length) {
      // The revision stays "started", so unpublish still finds every page this one wrote, and the
      // journey keeps its old copy. The pages that were saved are live; the next publish rewrites them.
      const failed = [...refused, ...unpointed];
      console.error('[Jourvance] The store refused published pages:', failed.map(w => {
        const r = saved[writes.indexOf(w)];
        return `${r.pointerRefused ? `domain ${r.domain} for ${w.key}` : w.key}: ${r.reason}`;
      }).join('; '));
      const domainList = [...new Set(unpointed.map(w => saved[writes.indexOf(w)].domain || w.customDomain))];
      const domains = domainList.join(', ');
      const domainNoun = domainList.length === 1 ? 'the custom domain' : 'the custom domains';
      let error;
      if (!refused.length) {
        error = unpointed.length === 1
          ? `Your page is live at ${unpointed[0].url}, but ${domainNoun} ${domains} could not be saved to storage. Publish again.`
          : `Your pages are live, but ${domainNoun} ${domains} could not be saved to storage. Publish again.`;
      } else if (refused.length === writes.length) {
        error = 'Your pages could not be saved to storage, so nothing new went live. Publish again.';
      } else {
        error = `${refused.length} of ${writes.length} pages could not be saved to storage, so only part of this publish went live.`
          + (unpointed.length ? ` ${domainNoun[0].toUpperCase()}${domainNoun.slice(1)} ${domains} could not be saved either.` : '')
          + ' Publish again.';
      }
      res.set('Retry-After', '30');
      return res.status(503).json({
        success: false,
        retryable: true,
        error,
        // Something from this publish is live (a stored page), so the client can say so.
        partial: refused.length < writes.length,
        nodeIds: failed.map(w => w.nodeId)
      });
    }
    // Saved on this server only (no store configured): live now, gone after a restart on a fresh disk.
    const notDurable = saved.find(s => s && s.durable === false);

    // An address an earlier revision wrote and this one does not (a Page URL Path edited, a step
    // deleted) would stay live with nothing pointing at it. Each is taken down now, but only when
    // its record says it is this user's and this journey's. One that stays up keeps its place in
    // the log, so unpublish and the next publish try again.
    const stillLive = await takeDownOldAddresses(uid, journey.id || req.params.id, nodes, log, livePages);
    const left = new Set(stillLive.map(p => p.key));
    const { retiredPages = [], ...finished } = finishRevision(log, revisionId, livePages, isoNow());
    const kept = retiredPages.filter(p => left.has(p.key));
    log = kept.length ? { ...finished, retiredPages: kept } : finished;
    const finishSave = await savePublishLog(uid, req.params.id, log);
    // The pages are live either way. A final publish record the store did not take is said,
    // because the next publish after a restart would read an older record. (The "started" save
    // above only matters until this one lands.)
    const logNotSaved = Boolean(finishSave && finishSave.durable === false);
    persistPublicPages();
    await saveJourney(uid, req.params.id, { ...journey, nodes: nextNodes });
    const history = await storeBuilderRevisions(uid, req.params.id, revisionNumber, publishedAt, writes);
    const historyNotSaved = history === 'local' || history === 'failed';

    const stillLiveUrls = stillLive.map(p => p.url);
    res.json({
      success: true,
      publishedPages,
      steps,
      revision: { id: revisionId, number: revisionNumber, publishedAt },
      stillLive: stillLiveUrls,
      ...(notDurable ? { durable: false, reason: notDurable.reason } : {}),
      ...(historyNotSaved ? { historySaved: false, historyNote: HISTORY_NOT_SAVED } : {}),
      ...(logNotSaved && !notDurable ? { publishLogSaved: false, publishLogNote: PUBLISH_LOG_NOT_SAVED } : {}),
      message: (stillLiveUrls.length
        ? `Published ${publishedPages.length} landing page(s). An old address may still be live: ${stillLiveUrls.join(', ')}. Publish again or take the funnel offline to take it down.`
        : notDurable
          ? `Published ${publishedPages.length} landing page(s) on this server only. They were not saved to storage, so a restart could take them offline.`
          : `Published ${publishedPages.length} landing page(s) successfully.`) + (historyNotSaved ? ` ${HISTORY_NOT_SAVED}` : '')
        + (logNotSaved && !notDurable ? ` ${PUBLISH_LOG_NOT_SAVED}` : '')
    });
  }

  const urlForKey = (key) => (key.startsWith('split:') ? `/p/split/${key.slice(6)}` : `/p/${key}`);

  // The old addresses of this journey that may still be live, as { key, url }. A key whose record
  // is another store's, another journey's or already gone is not this journey's to remove. A read
  // that fails is reported only for an address the log says was written: a step's unused default
  // address is a guess, and unpublish reads it again anyway.
  async function takeDownOldAddresses(uid, journeyId, nodes, log, livePages) {
    const current = new Set(livePages.map(p => p.key));
    const logged = new Map(everyLoggedPage(log).map(p => [p.key, p.url]));
    const stillLive = [];
    for (const key of candidateKeys(nodes, log)) {
      if (current.has(key)) continue;
      const url = logged.get(key) || urlForKey(key);
      try {
        const read = await readPublicPage(key);
        if (!read || !read.ok) { if (logged.has(key)) stillLive.push({ key, url }); continue; }
        const rec = read.page;
        if (!rec || typeof rec !== 'object' || rec.userId !== uid || rec.journeyId !== journeyId) continue;
        if ((await removePublicPage(key, uid)) === false) stillLive.push({ key, url });
      } catch (err) {
        console.error('[Jourvance] Taking down an old address failed:', err);
        stillLive.push({ key, url });
      }
    }
    return stillLive;
  }

  // Funnel Unpublishing Route
  app.post('/api/journey/:id/unpublish', requireUser, (req, res) => serialized(`${req.user.uid}:${req.params.id}`, async () => {
    try {
      await unpublishJourney(req, res);
    } catch (err) {
      answerFailure(res, 'Unpublishing', err);
    }
  }));

  // The public record keys a journey may have live: every hosted step's default key and its
  // current slug (it may have been edited since it went live), plus every page any revision in
  // the log wrote or planned. A replaced revision counts too: a Page URL Path edited or a step
  // deleted before a republish leaves its old address live until something takes it down.
  const candidateKeys = (nodes, log) => {
    const keys = new Set();
    for (const node of nodes) {
      if (!node || !HOSTED_STEP_TYPES.has(node.type)) continue;
      const key = publishKey(node);
      if (key) keys.add(key);
      const slug = normalizeSlug(node.data?.slug);
      if (slug) keys.add(node.type === 'ab-split' ? `split:${slug}` : slug);
    }
    for (const p of everyLoggedPage(log)) keys.add(p.key);
    return [...keys];
  };

  async function unpublishJourney(req, res) {
    if (refusedRevisionsLogId(req, res)) return;
    const uid = req.user.uid;
    const read = await readJourney(uid, req.params.id);
    if (!read || !read.ok) return answerJourneyUnavailable(res);
    const journey = read.journey;
    if (!journey) return res.status(404).json({ success: false, error: 'Journey not found.' });

    const journeyId = journey.id || req.params.id;
    // The log names the addresses earlier revisions wrote. Without it only the current paths are
    // known, so an old one could stay live under an answer that says the funnel is offline.
    const logRead = await loadPublishLog(uid, req.params.id);
    if (!logRead || !logRead.ok) {
      return res.status(503).json({ success: false, retryable: true, error: 'What is live could not be read, so nothing was taken offline. Try again.' });
    }
    const log = logRead.log;
    const nodes = Array.isArray(journey.nodes) ? journey.nodes : [];

    const failed = [];
    for (const key of candidateKeys(nodes, log)) {
      // A key this journey's steps would use can hold another store's page, or another of this
      // user's journeys. Neither is taken down. A read that failed says nothing about the owner,
      // so that key is left alone and the answer is a retryable failure.
      const read = await readPublicPage(key);
      if (!read || !read.ok) { failed.push(key); continue; }
      const rec = read.page;
      if (rec && typeof rec === 'object' && ((rec.userId && rec.userId !== uid) || (rec.journeyId && rec.journeyId !== journeyId))) continue;
      const removed = await removePublicPage(key, uid);
      if (removed === false) failed.push(key);
    }
    persistPublicPages();

    // Pages the hub refused to remove are still live, so the log keeps its live revision and a
    // retry probes the same keys again.
    if (failed.length) {
      return res.status(503).json({ success: false, retryable: true, error: 'Some pages could not be taken offline. Try again.' });
    }

    const nextLog = markUnpublished(log, isoNow());
    if (nextLog) await savePublishLog(uid, req.params.id, nextLog);
    const nextNodes = nodes.map(node => (node && HOSTED_STEP_TYPES.has(node.type) && node.data)
      ? { ...node, data: { ...node.data, published: false } }
      : node);
    await saveJourney(uid, req.params.id, { ...journey, nodes: nextNodes });

    res.json({ success: true, message: 'Funnel unpublished successfully.' });
  }

  const newerThan = (a, b) => String(a?.publishedAt || '') > String(b?.publishedAt || '');

  async function readPublication(req, res) {
    if (refusedRevisionsLogId(req, res)) return;
    const uid = req.user.uid;
    const read = await readJourney(uid, req.params.id);
    if (!read || !read.ok) return answerJourneyUnavailable(res);
    const journey = read.journey;
    const journeyId = journey?.id || req.params.id;
    const logRead = await loadPublishLog(uid, req.params.id);
    const log = logRead && logRead.ok ? logRead.log : null;
    const nodes = journey && Array.isArray(journey.nodes) ? journey.nodes : [];

    const keys = candidateKeys(nodes, log);
    const reads = await Promise.all(keys.map(k => readPublicPage(k)));
    // A key whose read failed might hold a live page. Calling that step "Not published" would be
    // a guess, so the whole read is unavailable and the client offers "Check again".
    if (reads.some(r => !r || !r.ok)) {
      return res.status(503).json({ success: false, retryable: true, error: 'What is live could not be read. Try again.' });
    }
    const records = reads.map(r => r.page);
    const byNode = new Map();
    for (const rec of records) {
      if (!rec || typeof rec !== 'object') continue;
      if (rec.userId !== uid || rec.journeyId !== journeyId || typeof rec.nodeId !== 'string') continue;
      const prev = byNode.get(rec.nodeId);
      if (!prev || newerThan(rec, prev)) byNode.set(rec.nodeId, rec);
    }

    const revisionOf = (rec) => (Number.isFinite(rec.revisionNumber) ? rec.revisionNumber : null);
    const steps = {};
    for (const [nodeId, rec] of byNode) {
      steps[nodeId] = {
        live: true,
        url: rec.type === 'ab-split' ? `/p/split/${rec.slug}` : `/p/${rec.slug}`,
        fingerprint: typeof rec.contentFingerprint === 'string' ? rec.contentFingerprint : null,
        revisionNumber: revisionOf(rec),
        publishedAt: typeof rec.publishedAt === 'string' ? rec.publishedAt : ''
      };
    }

    // A live landing page serves the thank-you step. The newest landing record decides.
    const nodeType = new Map(nodes.map(n => [n?.id, n?.type]));
    const firstThankYou = nodes.find(n => n?.type === 'thank-you');
    const served = new Map();
    for (const rec of byNode.values()) {
      if (rec.type === 'ab-split') continue;
      let thankYou = null;
      if ('servedThankYou' in rec) {
        const s = rec.servedThankYou;
        if (s && typeof s.nodeId === 'string') {
          thankYou = { nodeId: s.nodeId, fingerprint: typeof s.fingerprint === 'string' ? s.fingerprint : null };
        }
      } else if (rec.data?.thankYou && nodeType.get(rec.nodeId) === 'landing-page' && firstThankYou) {
        // Published before this change: it serves the thank-you, but nothing says which version.
        thankYou = { nodeId: firstThankYou.id, fingerprint: null };
      }
      if (!thankYou) continue;
      const prev = served.get(thankYou.nodeId);
      if (prev && !newerThan(rec, prev.rec)) continue;
      served.set(thankYou.nodeId, { rec, thankYou });
    }
    for (const [nodeId, { rec, thankYou }] of served) {
      steps[nodeId] = {
        live: true,
        url: `/p/${rec.slug}/thank-you`,
        fingerprint: thankYou.fingerprint,
        revisionNumber: revisionOf(rec),
        publishedAt: typeof rec.publishedAt === 'string' ? rec.publishedAt : ''
      };
    }

    const live = liveRevisionEntry(log);
    res.json({
      success: true,
      checkedAt: isoNow(),
      steps,
      liveRevision: live ? { id: live.id, number: live.number, publishedAt: live.finishedAt || live.startedAt } : null
    });
  }

  // ── Preview links ──────────────────────────────────────────────────────────
  // One hour, anyone holding the link, held in this process only. The token is 192 random bits
  // and only its sha256 is kept, so the map never holds a working link.
  const previews = new Map();

  const storePreview = (entry) => {
    const t = now();
    for (const [hash, p] of previews) if (p.expiresAt <= t) previews.delete(hash);
    const mine = [...previews].filter(([, p]) => p.uid === entry.uid);
    while (mine.length >= PREVIEW_PER_USER) previews.delete(mine.shift()[0]);
    while (previews.size >= PREVIEW_TOTAL) previews.delete(previews.keys().next().value);
    const token = crypto.randomBytes(24).toString('base64url');
    previews.set(sha256(token), entry);
    return token;
  };

  app.post('/api/journey/:id/preview', requireUser, async (req, res) => {
    try {
      await makePreview(req, res);
    } catch (err) {
      answerReadFailure(res, 'Making a preview', err);
    }
  });

  // Builds the record publish would build for one landing or upsell step, from the SAVED copy and
  // with the same workspace, and writes nothing: no public record, no journey, no log, no event.
  async function makePreview(req, res) {
    const uid = req.user.uid;
    const read = await readJourney(uid, req.params.id);
    if (!read || !read.ok) return answerJourneyUnavailable(res);
    const journey = read.journey;
    if (!journey) return res.status(404).json({ success: false, error: 'Journey not found.' });
    const nodes = Array.isArray(journey.nodes) ? journey.nodes : [];
    const nodeId = typeof req.body?.nodeId === 'string' ? req.body.nodeId : '';
    const node = nodeId ? nodes.find(n => n && n.id === nodeId) : null;
    if (!node) return res.status(404).json({ success: false, error: 'That step is not in the saved journey. Save, then try again.' });
    if (node.type !== 'landing-page' && node.type !== 'upsell') {
      return res.status(400).json({ success: false, error: 'Previews are for landing pages and upsell pages.' });
    }

    const wsId = journey.workspaceId || req.body?.workspaceId;
    const ws = wsId ? await loadWorkspace(uid, wsId) : null;
    const shopifyConfig = publishShopifyConfig(ws);
    const slug = publishKey(node);
    const url = `/p/${slug}`;
    const publishedAt = isoNow();
    const d = node.data || {};
    const base = { slug, journeyId: journey.id, workspaceId: wsId || 'default', userId: uid, nodeId: node.id, publishedAt };

    let record;
    if (node.type === 'landing-page') {
      const customDomain = cleanCustomDomain(d.customDomain);
      const isDomainVerified = domainVerifiedFor(customDomain, uid);
      const data = landingData(d, { slug, url, customDomain, isDomainVerified, publishedAt, parts: funnelParts(nodes) });
      record = {
        ...base,
        data: withoutBuilder(data),
        shopifyConfig,
        customDomain: customDomain || undefined,
        customDomainVerified: isDomainVerified,
        ...(d.builder ? { builder: d.builder } : {})
      };
    } else {
      const data = { ...d, slug, published: true, publishedAt, publishedUrl: url };
      record = { ...base, data: upsellRecordData(data, d), shopifyConfig };
    }
    // A copy, so a later edit to the saved journey never changes a link already handed out.
    record = blankPixelIds(structuredClone(record));
    for (const holder of [record.data, record.data?.variantB]) {
      if (holder && typeof holder === 'object') for (const key of PIXEL_KEYS) holder[key] = '';
    }

    const expiresAt = now() + PREVIEW_TTL_MS;
    const token = storePreview({
      uid,
      journeyId: journey.id,
      nodeId: node.id,
      isUpsell: node.type === 'upsell',
      isDownsell: node.type === 'upsell' && d.offerType === 'downsell',
      record,
      expiresAt
    });
    res.json({ success: true, url: `/p/preview/${token}`, expiresAt: new Date(expiresAt).toISOString() });
  }

  // Registered here so it answers before publicRoutes' /p/:wsId/:slug ('preview' is a reserved
  // slug). It never calls next(), and it never adds the tracking snippet.
  app.get('/p/preview/:token', (req, res) => {
    setPreviewHeaders(res);
    const token = String(req.params.token || '');
    const hash = /^[A-Za-z0-9_-]{32}$/.test(token) ? sha256(token) : '';
    const entry = hash ? previews.get(hash) : undefined;
    if (!entry || entry.expiresAt <= now()) {
      if (entry) previews.delete(hash);
      return res.status(410).send(PREVIEW_EXPIRED_HTML);
    }
    try {
      // res is null so resolveSplitVariant sets no cookie; ?variant=b shows version B.
      const fakeReq = { query: { var: req.query.variant === 'b' ? 'b' : 'a' }, headers: {}, params: {} };
      const html = entry.isUpsell
        ? renderPublicUpsellHtml(entry.record, fakeReq, null, entry.isDownsell)
        : renderPublicFunnelHtml(entry.record, fakeReq, null);
      const minutes = previewMinutesLeft(new Date(entry.expiresAt).toISOString(), now());
      res.status(200).send(decoratePreview(html, minutes));
    } catch (err) {
      console.error('[Jourvance] Preview render failed:', err);
      res.status(500).send(PREVIEW_ERROR_HTML);
    }
  });
}
