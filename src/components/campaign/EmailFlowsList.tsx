import React, { useEffect, useId, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { authHeaders } from '../../lib/firebase';
import { ghostBtn, readJson, solidBtn } from './emailChrome';
import { FLOW_MAP_WRITE_UNREACHABLE, sendFlowWrite, settleRead } from '../../lib/flowMapLoad';
import { StudioListLine } from './StudioListLine';
import { statText } from '../../lib/emailStats';
import {
  FLOWS_EMPTY, FLOWS_FIGURES_UNCOUNTED, FLOWS_NOT_CONNECTED, SENDS_AN_EMAIL, emailCountText, figuresLeftOut, flowRows, flowStateText, flowsListLoad, groupFlowRows,
  noOwnFlows, starterOffNotice, stateWarns, switchRequest, switchText, type FlowRow, type FlowsListLoad
} from '../../lib/emailFlowsList';
import type { DripSequence } from '../../types/journey';

/**
 * Flows, All flows (EMAIL_STUDIO_PLAN.md Wave 4): every flow, from one read of GET /api/email/flow-map,
 * in four groups, each its own list under its own heading (open list, 2026-10-09): Your flows (with New
 * flow), Starter flows, Built-in flows, Order emails (groupFlowRows). Each row is one button that opens the flow
 * editor on that flow with its first email chosen (D3). Every row has Turn on or Turn off beside it (a
 * built-in flow's and an order email's notes on the map send the reader here); a starter flow's is for
 * this account only (Wave 2). New flow (D1's primary action) makes a flow and
 * opens it on its first email, so designing an email from scratch is one click from this list.
 *
 * The row model (what each row says) is src/lib/emailFlowsList.ts. A starter row's revenue is the
 * sequence list HubEmailSuite already reads. A figure shows only when the server sent a number; the list
 * says once, under its heading, that the others are not counted (FLOWS_FIGURES_UNCOUNTED), rather than
 * printing Unavailable on every row.
 */

type ListLoad = FlowsListLoad | { state: 'loading' };

const rowButton: React.CSSProperties = {
  flex: '1 1 280px',
  minWidth: 0,
  minHeight: 44,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  textAlign: 'left',
  padding: '12px 14px',
  borderRadius: 12,
  border: '1px solid rgba(255, 255, 255, 0.1)',
  background: 'rgba(255, 255, 255, 0.03)',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
  overflowWrap: 'anywhere'
};

const tagStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  padding: '2px 8px',
  borderRadius: 9999,
  border: '1px solid rgba(255, 255, 255, 0.16)',
  background: 'rgba(255, 255, 255, 0.06)',
  color: '#e5e7eb'
};

const listStyle: React.CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 };
const groupStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const groupHeading: React.CSSProperties = { margin: 0, fontSize: 15, color: '#f3f4f6' };

export const EmailFlowsList: React.FC<{
  /** Opens the flow editor on a flow, on the given step. */
  onOpenFlow: (flowId: string, nodeId?: string) => void;
  /** The starter flows as GET /api/drips/sequences answered, for their last-touch revenue. */
  sequences: DripSequence[];
  /** Reads the studio's other lists again (Refresh). */
  onRefresh?: () => void;
}> = ({ onOpenFlow, sequences, onRefresh }) => {
  const ids = useId();
  const [rows, setRows] = useState<FlowRow[]>([]);
  const [load, setLoad] = useState<ListLoad>({ state: 'loading' });
  const [reading, setReading] = useState(false);
  const [hubConnected, setHubConnected] = useState(true);
  const [notice, setNotice] = useState('');
  const [switching, setSwitching] = useState('');
  const [creating, setCreating] = useState(false);

  // A failed read keeps the rows it last showed and says why, with Retry where it can help.
  const read = async () => {
    setReading(true);
    try {
      const settled = await settleRead(async () => {
        const res = await fetch('/api/email/flow-map', { headers: await authHeaders() });
        return { status: res.status, data: await readJson(res) };
      });
      const outcome = flowsListLoad(settled.answered ? { answered: true, status: settled.data.status, data: settled.data.data } : { answered: false });
      setLoad(outcome);
      if (outcome.state !== 'loaded' || !settled.answered) return;
      const data = settled.data.data;
      setRows(flowRows(data.flows, data.triggers));
      setHubConnected(data.hubConnected !== false);
    } finally {
      setReading(false);
    }
  };

  useEffect(() => { read(); }, []);

  // New flow: the same write as the editor's New flow, then the editor opens on the new flow's email.
  const create = async () => {
    if (creating) return;
    setCreating(true);
    setNotice('');
    try {
      const sent = await sendFlowWrite(async () => fetch('/api/email/flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ name: 'New flow', trigger: 'manual' })
      }));
      if (!sent.answered) {
        setNotice(FLOW_MAP_WRITE_UNREACHABLE.create);
        return;
      }
      const flow = sent.data?.flow;
      if (!sent.ok || !flow?.id) {
        setNotice(sent.data?.error || 'A flow was not created.');
        return;
      }
      const first = Array.isArray(flow.nodes) ? flow.nodes.find((node: { id?: string; type?: string }) => node && SENDS_AN_EMAIL.has(String(node.type))) : undefined;
      onOpenFlow(flow.id, first?.id || undefined);
    } finally {
      setCreating(false);
    }
  };

  // Turn on or Turn off: an account's own flow through its own save route, a starter flow through the
  // flow-content route for this account only, a built-in flow or an order email through the programs
  // route (switchRequest).
  const toggle = async (row: FlowRow) => {
    if (switching) return;
    const next = !row.on;
    const word = next ? 'on' : 'off';
    setSwitching(row.id);
    setNotice('');
    try {
      const request = switchRequest(row, next);
      const sent = await sendFlowWrite(async () => fetch(request.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify(request.body)
      }));
      if (!sent.answered) {
        setNotice(`The server did not answer, so ${row.name} may not be turned ${word}.`);
        return;
      }
      if (!sent.ok || !sent.data?.success) {
        setNotice(sent.data?.error || `${row.name} was not turned ${word}.`);
        return;
      }
      setNotice(next ? `${row.name} is on. An email from it sends only when the email service accepts it.` : row.kind === 'sequence' ? starterOffNotice(row.name) : `${row.name} is off.`);
      await read();
    } finally {
      setSwitching('');
    }
  };

  const revenueOf = (id: string) => sequences.find((item) => item.id === id)?.attributedSales;
  const counted = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

  const renderRow = (row: FlowRow) => {
    const seq = row.kind === 'sequence' ? sequences.find((item) => item.id === row.id) : undefined;
    const nameId = `${ids}-${row.id}-name`;
    const tagId = `${ids}-${row.id}-tag`;
    const metaId = `${ids}-${row.id}-meta`;
    const described = [row.tag ? tagId : '', metaId].filter(Boolean).join(' ');
    const label = switchText(row, switching === row.id);
    return (
      <li key={row.id} style={{ display: 'flex', gap: 8, alignItems: 'stretch', flexWrap: 'wrap' }}>
        <button
          type="button"
          data-flow-row={row.id}
          aria-labelledby={nameId}
          aria-describedby={described}
          onClick={() => onOpenFlow(row.id, row.firstEmailId || undefined)}
          style={rowButton}
        >
          <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span id={nameId} style={{ fontSize: 14, fontWeight: 700, color: '#f3f4f6' }}>{row.name}</span>
            {row.tag && <span id={tagId} style={tagStyle}>{row.tag}</span>}
          </span>
          <span id={metaId} style={{ fontSize: 12, color: '#d1d5db', lineHeight: 1.5 }}>
            {/* Open list: the state says when an On flow sends nothing yet because its emails are still the
                starter drafts the sender skips (flowStateText), in words and not by colour alone. */}
            Starts when: {row.startsWhen} · <strong data-flow-state={row.id} style={{ color: stateWarns(row) ? '#fbbf24' : row.on ? '#6ee7b7' : '#d1d5db' }}>{flowStateText(row)}</strong> · {emailCountText(row.emails)}
            {/* A figure only when the server counted it; FLOWS_FIGURES_UNCOUNTED says once why the others are not here. */}
            {row.group === 'flows' && counted(row.enrolled) && <> · Enrolled {statText(row.enrolled)}</>}
            {seq && counted(seq.attributedSales) && <> · Last-touch revenue {statText(seq.attributedSales, (n) => `$${n.toLocaleString()}`)}</>}
          </span>
        </button>
        <button
          type="button"
          data-flow-switch={row.id}
          // The name begins with the word on the button, Saving included (switchText).
          aria-label={label.label}
          // aria-disabled, not disabled: a disabled button drops keyboard focus to the page.
          aria-disabled={switching === row.id}
          onClick={() => toggle(row)}
          // Wave 8: an outline in every state. The filled button is New flow's alone (D1), and On or Off is
          // said in words in the row beside it.
          style={{ ...ghostBtn, minHeight: 44, alignSelf: 'center', opacity: switching === row.id ? 0.6 : 1 }}
        >
          {label.text}
        </button>
      </li>
    );
  };

  const groups = groupFlowRows(rows);
  const headingOf = (kind: string) => `${ids}-group-${kind}`;
  // The New flow button: Your flows' own action, and the one filled button on All flows (D1).
  const newFlow = (
    <button type="button" aria-disabled={creating} onClick={create} style={{ ...solidBtn, minHeight: 44, opacity: creating ? 0.6 : 1 }}>
      {creating ? 'Creating' : 'New flow'}
    </button>
  );

  return (
    <section aria-labelledby={`${ids}-heading`} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, flex: '1 1 260px' }}>
          <h2 id={`${ids}-heading`} style={{ margin: 0, fontSize: 18, color: '#f3f4f6' }}>All flows</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#9ca3af', maxWidth: 720 }}>
            {/* Wave 6: a starter flow can be turned off for one account (Wave 2), so this no longer says they always run. */}
            A starter flow takes every new lead or checkout until you turn it off. Built-in flows stay off until you turn them on. Choose a flow to open it in the editor with its first email.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => { read(); onRefresh?.(); }}
            style={{ ...ghostBtn, minHeight: 44, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={13} aria-hidden="true" className={reading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Wave 8: under the heading, where the row just switched is, never at the foot of a 16-row list.
          Always mounted, so the outcome of Turn on and Turn off is heard as well as seen. */}
      <p role="status" data-flows-notice="" style={{ margin: 0, fontSize: 13, color: '#d1d5db' }}>{notice}</p>

      {/* Wave 8: the line every other studio list draws (StudioListLine): a bordered alert, Retrying while
          the read runs, and a failure said again when Retry fails again. */}
      <StudioListLine
        line={load.state === 'loading' ? { kind: 'loading', text: 'Loading the flows.' } : load.state === 'failed' ? { kind: 'failed', text: load.text, retry: load.retry } : { kind: 'none', text: '' }}
        onRetry={read}
        busy={reading}
      />
      {load.state === 'loaded' && !hubConnected && (
        <p role="status" style={{ margin: 0, fontSize: 13, color: '#fbbf24' }}>{FLOWS_NOT_CONNECTED}</p>
      )}
      {/* Open list: once per list, never per row, why a row shows no Enrolled or revenue figure. */}
      {load.state === 'loaded' && figuresLeftOut(rows, revenueOf) && (
        <p data-flows-figures="" style={{ margin: 0, fontSize: 12, color: '#9ca3af', maxWidth: 720 }}>{FLOWS_FIGURES_UNCOUNTED}</p>
      )}

      {/* Open list: four groups in a fixed order, each a list named by its heading. Your flows is drawn
          whatever the read did, so New flow is always there; the others only when they hold a row. */}
      {groups.map((group) => {
        if (group.kind !== 'flow' && group.rows.length === 0) return null;
        return (
          <div key={group.kind} data-flow-group={group.kind} style={{ ...groupStyle, marginTop: group.kind === 'flow' ? 0 : 8 }}>
            {group.kind === 'flow' ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <h3 id={headingOf(group.kind)} style={groupHeading}>{group.heading}</h3>
                  {newFlow}
                </div>
                {/* D6: said only of a list that loaded; a failed read says its failure above and never this. */}
                {load.state === 'loaded' && noOwnFlows(rows) && (
                  <p data-studio-state="empty" style={{ margin: 0, fontSize: 13, color: '#9ca3af' }}>{FLOWS_EMPTY}</p>
                )}
              </>
            ) : (
              <h3 id={headingOf(group.kind)} style={groupHeading}>{group.heading}</h3>
            )}
            {group.kind === 'order' && (
              <p style={{ margin: 0, fontSize: 13, color: '#9ca3af', maxWidth: 720 }}>
                The emails a customer gets for an order, a fulfillment, a cancellation and a refund. Each one stays off until you turn it on. Shopify keeps sending its own copy until you turn that notification off in Shopify admin. Jourvance does not change those Shopify settings.
              </p>
            )}
            {group.rows.length > 0 && <ul aria-labelledby={headingOf(group.kind)} style={listStyle}>{group.rows.map(renderRow)}</ul>}
          </div>
        );
      })}

    </section>
  );
};
