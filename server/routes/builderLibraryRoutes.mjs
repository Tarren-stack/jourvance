/**
 * The saved sections library (LANDING_BUILDER_PLAN.md, wave 3): a merchant keeps a section they
 * built and drops it into another page.
 *
 * GET    /api/builder/library        { success, items, complete, reason? }
 * POST   /api/builder/library        { name, section } -> { success, item, durable, reason? }
 * DELETE /api/builder/library/:id    { success, durable, reason? }
 *
 * Every route is the signed-in caller's own: the list is read for the token's uid, and an id that
 * is another account's answers the same 404 as one that does not exist. A list holds at most
 * LIBRARY_MAX_ITEMS entries and an entry at most LIBRARY_MAX_BYTES of JSON. A section is checked
 * by the page model itself (the section wrapped in a one-section page), so a library entry can
 * never hold what a page could not publish. `durable` says whether the account store took the
 * write; false carries the reason and the entry is still kept on this server. A delete the account
 * store refused is a 503 (`removeLibraryItem` answers `ok: false`) and the entry is kept everywhere:
 * dropping it from this server first made it come back on the next list, which reads the store.
 *
 * Saves and deletes for one uid run one at a time (`oneAtATime`). The cap is a read, a count and a
 * write with awaits between them, so twenty saves sent together all read 95 and all wrote: the
 * list ended at 115. Queued per uid, the 101st waits for the 100th's write and then sees it. This
 * holds inside one server process, which is how Jourvance runs.
 */
import crypto from 'node:crypto';
import { createEmptyPage, validateBuilderDoc } from '../../src/lib/pageBuilder/model.mjs';

export const LIBRARY_MAX_ITEMS = 100;
export const LIBRARY_MAX_BYTES = 200 * 1024;
export const LIBRARY_NAME_MAX = 80;

const LIST_FAILED = 'Your saved sections could not be listed. Try again in a minute.';
const DELETE_FAILED = 'That saved section could not be deleted. It is still in your library. Try again in a minute.';

/**
 * Removes one entry: from the account store FIRST, then from this server's copy, so a refused
 * remove leaves both copies holding it and the caller is told so. With no store (`hubReady`
 * false) only this server's copy exists, and it is removed with `durable: false`.
 * `remove(docId)` is the store call; it may resolve `{ error }` or throw.
 */
export async function removeLibraryEntry({ cache, uid, id, persist, hubReady, remove, docId }) {
  const drop = () => {
    cache[uid] = (Array.isArray(cache[uid]) ? cache[uid] : []).filter((i) => i && i.id !== id);
    persist();
  };
  if (!hubReady) {
    drop();
    return { ok: true, durable: false, reason: 'HUB_API_KEY is not set on this server.' };
  }
  let failure = null;
  try {
    const r = await remove(docId);
    if (r && r.error) failure = String(r.error);
  } catch (e) {
    failure = e?.message || String(e);
  }
  if (failure) return { ok: false, durable: false, reason: failure };
  drop();
  return { ok: true, durable: true };
}

/** The problems the page model finds in a section, with paths as the model words them. */
export function sectionProblems(section) {
  if (!section || typeof section !== 'object' || Array.isArray(section)) {
    return [{ path: 'section', message: 'a saved section is an object' }];
  }
  const doc = createEmptyPage();
  doc.sections = [section];
  return validateBuilderDoc(doc).problems;
}

/**
 * A per-key queue: `run(key, task)` starts `task` once every earlier task for the same key has
 * settled, and answers what `task` answers. A task that throws does not stop the ones after it.
 */
export function oneAtATime() {
  const tails = new Map();
  return function run(key, task) {
    const before = tails.get(key) || Promise.resolve();
    const result = before.then(() => task());
    const tail = result.then(() => {}, () => {});
    tails.set(key, tail);
    tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
    return result;
  };
}

export function setupBuilderLibraryRoutes(app, { requireUser, listLibrary, putLibraryItem, removeLibraryItem }) {
  const perUser = oneAtATime();
  app.get('/api/builder/library', requireUser, async (req, res) => {
    try {
      const { items, complete, reason } = await listLibrary(req.user.uid);
      const own = (Array.isArray(items) ? items : []).filter((i) => i && i.userId === req.user.uid);
      own.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      res.json({ success: true, items: own, complete: complete !== false, ...(reason ? { reason } : {}) });
    } catch (e) {
      console.error('[Jourvance] Library list failed:', e?.message || e);
      res.status(503).set('Retry-After', '30').json({ success: false, error: LIST_FAILED });
    }
  });

  app.post('/api/builder/library', requireUser, async (req, res) => {
    const uid = req.user.uid;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return res.status(400).json({ success: false, error: 'Give the section a name.' });
    if (name.length > LIBRARY_NAME_MAX) {
      return res.status(400).json({ success: false, error: `A section name is at most ${LIBRARY_NAME_MAX} characters.` });
    }
    const problems = sectionProblems(body.section);
    if (problems.length) {
      return res.status(400).json({
        success: false,
        // The model's paths stay in `problems` for whoever debugs it; the sentence is the merchant's.
        error: 'That section could not be saved because part of it is not in a form the builder can keep. Nothing was saved.',
        problems: problems.slice(0, 50)
      });
    }
    const bytes = Buffer.byteLength(JSON.stringify(body.section), 'utf8');
    if (bytes > LIBRARY_MAX_BYTES) {
      return res.status(400).json({ success: false, error: `That section is ${Math.ceil(bytes / 1024)} KB; a saved section is at most ${LIBRARY_MAX_BYTES / 1024} KB.` });
    }
    try {
      await perUser(uid, () => saveOne(uid, name, body.section, res));
    } catch (e) {
      console.error('[Jourvance] Library save failed:', e?.message || e);
      if (!res.headersSent) res.status(503).set('Retry-After', '30').json({ success: false, error: 'That section could not be saved. Try again in a minute.' });
    }
  });

  // The list read, the cap and the write, run inside the uid's queue.
  async function saveOne(uid, name, section, res) {
    const current = await listLibrary(uid);
    if (current.complete === false) {
      return res.status(503).set('Retry-After', '30').json({ success: false, retryable: true, error: LIST_FAILED });
    }
    const own = (Array.isArray(current.items) ? current.items : []).filter((i) => i && i.userId === uid);
    if (own.length >= LIBRARY_MAX_ITEMS) {
      return res.status(400).json({ success: false, error: `Your library holds ${LIBRARY_MAX_ITEMS} sections, the most it can. Delete one from Saved in Add blocks to save another.` });
    }
    const item = {
      id: `sec_${crypto.randomBytes(9).toString('base64url')}`,
      userId: uid,
      name,
      section,
      createdAt: new Date().toISOString()
    };
    const out = await putLibraryItem(uid, item);
    res.json({ success: true, item, durable: Boolean(out && out.durable), ...(out && out.reason ? { reason: out.reason } : {}) });
  }

  app.delete('/api/builder/library/:id', requireUser, async (req, res) => {
    const uid = req.user.uid;
    try {
      await perUser(uid, () => deleteOne(uid, req.params.id, res));
    } catch (e) {
      console.error('[Jourvance] Library delete failed:', e?.message || e);
      if (!res.headersSent) res.status(503).set('Retry-After', '30').json({ success: false, retryable: true, error: DELETE_FAILED });
    }
  });

  async function deleteOne(uid, id, res) {
    const NOT_FOUND = 'That saved section was not found.';
    const current = await listLibrary(uid);
    const mine = (Array.isArray(current.items) ? current.items : []).find((i) => i && i.id === id && i.userId === uid);
    if (!mine) {
      if (current.complete === false) {
        return res.status(503).set('Retry-After', '30').json({ success: false, retryable: true, error: LIST_FAILED });
      }
      return res.status(404).json({ success: false, error: NOT_FOUND });
    }
    const out = await removeLibraryItem(uid, mine.id);
    if (out && out.ok === false) {
      console.error('[Jourvance] Library delete refused by the store:', out.reason);
      return res.status(503).set('Retry-After', '30').json({ success: false, retryable: true, error: DELETE_FAILED });
    }
    res.json({ success: true, durable: Boolean(out && out.durable), ...(out && out.reason ? { reason: out.reason } : {}) });
  }
}
