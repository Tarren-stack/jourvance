/**
 * Saving a journey: POST /api/journey/:id and POST /api/user/:userId/journey/:id.
 *
 * A save replaces the whole stored journey. The browser decides by lineage whether its copy may
 * replace the account copy (src/lib/accountSync.ts), and this is the same rule on the server, for
 * a copy the browser could not know was stale: a save that names `baseUpdatedAt`, the account
 * revision it was made on, is refused with 409 when the stored copy is another revision, so a save
 * made on another device or by another tab since is never replaced silently (F1). The browser then
 * reads the account copy again and keeps both. A save that names no base (a journey this browser
 * made, or an older client) is written as before.
 *
 * The check and the write run one at a time per journey, so two saves on the same base cannot both
 * pass the check.
 */

export const SAVE_CONFLICT = 'Your account copy of this journey was changed somewhere else, so this copy was not saved over it.';
export const SAVE_UNCHECKED = 'Your account copy of this journey could not be read to check for changes made elsewhere, so nothing was saved.';

/**
 * readJourney(uid, id) answers {ok, journey}; ok:false when the store could not answer.
 * saveJourney(uid, id, body) answers {journey, durable, reason?}.
 */
export function setupJourneySaveRoutes(app, { requireUser, readJourney, saveJourney }) {
  const tails = new Map();
  const serialized = (key, fn) => {
    const run = (tails.get(key) || Promise.resolve()).then(fn, fn);
    const tail = run.catch(() => undefined);
    tails.set(key, tail);
    tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
    return run;
  };

  const save = (req, res) => serialized(`${req.user.uid}:${req.params.id}`, async () => {
    const uid = req.user.uid;
    const id = req.params.id;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const base = typeof body.baseUpdatedAt === 'string' && body.baseUpdatedAt ? body.baseUpdatedAt : null;
    try {
      if (base) {
        let read = null;
        try {
          read = await readJourney(uid, id);
        } catch (err) {
          console.error('[Jourvance] Reading a journey before saving it failed:', err);
        }
        if (!read || !read.ok) {
          res.set('Retry-After', '5');
          return res.status(503).json({ success: false, retryable: true, error: SAVE_UNCHECKED });
        }
        const stored = read.journey;
        if (stored && String(stored.updatedAt) !== base) {
          return res.status(409).json({ success: false, conflict: true, error: SAVE_CONFLICT });
        }
      }
      const { journey, durable, reason } = await saveJourney(uid, id, body);
      res.json({ success: true, journey, durable, ...(reason ? { reason } : {}) });
    } catch (err) {
      console.error('[Jourvance] Saving a journey failed:', err);
      if (!res.headersSent) res.status(500).json({ success: false, retryable: true, error: 'The journey was not saved on the server, so try again.' });
    }
  });

  app.post('/api/journey/:id', requireUser, save);

  app.post('/api/user/:userId/journey/:id', requireUser, (req, res) => {
    if (req.params.userId !== req.user.uid) {
      return res.status(403).json({ success: false, error: 'That is not your account.' });
    }
    return save(req, res);
  });
}
