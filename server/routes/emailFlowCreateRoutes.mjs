/**
 * POST /api/email/flows: a new flow on the caller's account (EMAIL_STUDIO_PLAN.md Wave 7, D3).
 *
 * Moved here from server.mjs so a route test can mount it on a bare Express app. A body with no
 * graph makes what New flow always made: a start and one empty email, named from `name`, started
 * by `trigger`. A body with `nodes` and `edges` (Build a flow in Email Studio, from a funnel step's
 * letters) is that graph, through the same shape check, cleaner and validation that
 * POST /api/email/flows/:id runs, so a create can hold nothing a save could not. The cleaner drops a
 * node or a line it cannot read; a graph that loses one that way is refused rather than stored
 * shorter. Either way the flow is created OFF and first in the account's list.
 *
 * TENANCY: the flow goes into the signed-in caller's own program record; nothing in the body names
 * whose it is.
 *
 * CAP: an account holds FLOW_LIMIT flows, and writeUserPrograms keeps the first FLOW_LIMIT, so a
 * create at the cap would push the oldest flow off the end without a word. It is refused instead.
 *
 * SIZE: a create that would take the account's email record past its size cap (saveProgramStore in
 * server.mjs) saves nothing and is a 413 with the sentence naming what to delete, never a 200.
 */
import { FLOW_LIMIT } from '../../email-flows.mjs';
import { programWriteRefusal } from '../../email-flow-content.mjs';

export const FLOW_NOT_CREATED = 'That flow could not be created.';
export const FLOW_GRAPH_SHAPE = 'That flow could not be created, because its steps and lines must both be lists.';
export const FLOW_GRAPH_DROPPED = 'That flow could not be created, because some of its steps or lines could not be read.';
export const FLOW_LIMIT_REACHED = `This account already has ${FLOW_LIMIT} flows, the most it can hold. Delete one, then make the new flow.`;

export function setupEmailFlowCreateRoutes(app, ctx) {
  const {
    requireUser,
    userProgramBag,
    writeUserPrograms,
    cleanFlow,
    flowShapeError,
    validateFlow,
    rememberUntranslated,
    presentCustomFlow
  } = ctx;

  app.post('/api/email/flows', requireUser, (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const graph = body.nodes !== undefined || body.edges !== undefined;
    if (graph && !(Array.isArray(body.nodes) && Array.isArray(body.edges))) return res.status(400).json({ success: false, error: FLOW_GRAPH_SHAPE });
    if (graph) {
      const shape = flowShapeError(body);
      if (shape) return res.status(400).json({ success: false, error: shape });
    }
    const id = `flow_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const flow = cleanFlow({
      id,
      name: body.name || 'New flow',
      enabled: false,
      trigger: body.trigger || 'manual',
      quietAfterDays: body.quietAfterDays,
      nodes: graph ? body.nodes : [
        { id: 'n_start', type: 'trigger' },
        { id: 'n_mail', type: 'email', subject: 'A note from the store', blocks: [{ id: 'n_mail_b', kind: 'text', text: '' }] }
      ],
      edges: graph ? body.edges : [{ id: 'e_start', source: 'n_start', target: 'n_mail', branch: '' }]
    });
    if (!flow) return res.status(400).json({ success: false, error: FLOW_NOT_CREATED });
    if (graph) {
      if (flow.nodes.length !== body.nodes.length || flow.edges.length !== body.edges.length) {
        return res.status(400).json({ success: false, error: FLOW_GRAPH_DROPPED });
      }
      rememberUntranslated(flow);
      const check = validateFlow(flow);
      if (!check.ok) return res.status(400).json({ success: false, error: check.error });
    }
    flow.enabled = false;
    const bag = userProgramBag(req.user.uid);
    if (bag.flows.length >= FLOW_LIMIT) return res.status(409).json({ success: false, error: FLOW_LIMIT_REACHED });
    bag.flows.unshift(flow);
    const refused = programWriteRefusal(writeUserPrograms(req.user.uid, bag));
    if (refused) return res.status(413).json(refused);
    res.json({ success: true, flow: presentCustomFlow(flow, bag, req.user.uid) });
  });
}
