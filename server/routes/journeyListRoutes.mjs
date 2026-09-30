/**
 * Mounts the signed-in user's journey list: GET /api/journeys and GET /api/user/:userId/journeys.
 *
 * Both answer {success, journeys, complete, reason?}. `listJourneys(uid)` is server.mjs's wrapper
 * over listJourneyDocs (server/journeyList.mjs), so a hub that refused or answered only part of the
 * list is reported as incomplete with its reason, never as an empty or complete list. A list that
 * throws is a 503, which the client reads as retryable (src/lib/journeyLibrary.ts readJourneyList).
 */

const LIST_FAILED = 'Your journeys could not be listed. Try again in a minute.';

export function setupJourneyListRoutes(app, { requireUser, listJourneys, summarize }) {
  const answerList = async (uid, res) => {
    try {
      const { journeys, complete, reason } = await listJourneys(uid);
      res.json({ success: true, journeys: journeys.map(summarize), complete, ...(reason ? { reason } : {}) });
    } catch (e) {
      console.error('[Jourvance] Journey list failed:', e?.message || e);
      res.status(503).set('Retry-After', '30').json({ success: false, error: LIST_FAILED });
    }
  };

  // A journey belongs to the verified caller. `:userId` is accepted for older clients but
  // must equal the token's uid; naming somebody else is refused.
  app.get('/api/user/:userId/journeys', requireUser, async (req, res) => {
    if (req.params.userId !== req.user.uid) {
      return res.status(403).json({ success: false, error: 'That is not your account.' });
    }
    await answerList(req.user.uid, res);
  });

  app.get('/api/journeys', requireUser, async (req, res) => {
    await answerList(req.user.uid, res);
  });
}
