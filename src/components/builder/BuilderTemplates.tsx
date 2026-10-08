// The page builder's templates view (LANDING_BUILDER_PLAN.md, Wave 3): a card for each starting
// page in lib/pageBuilder/templates.mjs, with a thumbnail drawn by the SAME renderer the canvas and
// the published page use, into a small scaled shadow root.
//
// "Use this template" replaces the whole document. The shell makes that one undoable step. When the
// current page already has something on it, the first press asks (inline, in words, with Replace and
// Cancel) instead of replacing at once. A template that fails the model's check is shown with its
// problems and cannot be used; none does, and a test says so.

import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { render } from '../../lib/pageBuilder/render.mjs';
import { validateBuilderDoc } from '../../lib/pageBuilder/model.mjs';
import { TEMPLATES } from '../../lib/pageBuilder/templates.mjs';
import type { BuilderDoc, BuilderProblem } from '../../types/pageBuilder';
import { writeShadow } from './BuilderCanvas';
import { hintStyle, smallButton } from './BuilderFields';

const groupHeading: React.CSSProperties = {
  margin: '10px 0 6px',
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#A5B4FC'
};

/** The page is drawn this wide, then scaled down to the thumbnail. */
const THUMB_DESIGN_WIDTH = 1280;
const THUMB_WIDTH = 236;
const THUMB_HEIGHT = 150;
const THUMB_SCALE = THUMB_WIDTH / THUMB_DESIGN_WIDTH;

/** One template drawn small. Decorative: the card's name and description carry the meaning. */
const TemplateThumb: React.FC<{ doc: BuilderDoc }> = ({ doc }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const result = useMemo(() => render(doc, { device: 'desktop' }), [doc]);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    writeShadow(root, result.problems.length ? '' : result.html, result.css, doc, 'desktop');
  }, [result, doc]);
  return (
    <div
      aria-hidden="true"
      data-template-thumb=""
      style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT, overflow: 'hidden', position: 'relative', borderRadius: '6px', border: '1px solid rgba(255, 255, 255, 0.12)', backgroundColor: '#0B0F19', pointerEvents: 'none' }}
    >
      <div ref={hostRef} style={{ width: THUMB_DESIGN_WIDTH, transform: `scale(${THUMB_SCALE})`, transformOrigin: 'top left', position: 'absolute', left: 0, top: 0 }} />
    </div>
  );
};

export interface BuilderTemplatesProps {
  /** True when the current page has any section: using a template then asks first. */
  hasContent: boolean;
  /** Replaces the whole document with `doc`; `name` is for the live region. */
  onUse: (doc: BuilderDoc, name: string) => void;
}

interface Built {
  id: string;
  name: string;
  group: string;
  description: string;
  doc: BuilderDoc;
  problems: BuilderProblem[];
}

export const BuilderTemplates: React.FC<BuilderTemplatesProps> = ({ hasContent, onUse }) => {
  // Each template is built once for its thumbnail. Using one builds it again, so a page never
  // shares ids with another page made from the same template.
  const built = useMemo<Built[]>(
    () => TEMPLATES.map(t => {
      const doc = t.build();
      return { id: t.id, name: t.name, group: t.group, description: t.description, doc, problems: validateBuilderDoc(doc).problems };
    }),
    []
  );
  const [asking, setAsking] = useState<string | null>(null);
  // The groups in the order the templates first name them (Sell, Capture, Proof, Launch).
  const groups = useMemo(() => [...new Set(built.map(t => t.group))], [built]);

  const use = (t: Built) => {
    const fresh = TEMPLATES.find(x => x.id === t.id)?.build();
    if (!fresh) return;
    setAsking(null);
    onUse(fresh, t.name);
    // The confirm that held focus is gone; put it on the card's own button, as Cancel does.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-template-use="${CSS.escape(t.id)}"]`)?.focus());
  };

  // Cancel puts focus back on the card's own "Use this template", which the confirm replaced.
  const cancel = (id: string) => {
    setAsking(null);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-template-use="${CSS.escape(id)}"]`)?.focus());
  };

  return (
    <section aria-labelledby="jvb-templates-title" style={{ display: 'flex', flexDirection: 'column' }}>
      <h3 id="jvb-templates-title" style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: '#F8FAFC' }}>Page templates</h3>
      <p style={{ ...hintStyle, marginBottom: '8px' }}>
        A template is a page layout with no words on it. Using one replaces the whole page, and Undo brings your page back.
      </p>
      {groups.map(group => (
      <React.Fragment key={group}>
      <h4 id={`jvb-templates-${group}`} style={groupHeading}>{group}</h4>
      <ul aria-labelledby={`jvb-templates-${group}`} style={{ margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {built.filter(t => t.group === group).map(t => {
          const bad = t.problems.length > 0;
          return (
            <li key={t.id} data-template-card={t.id} style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.1)', backgroundColor: 'rgba(255, 255, 255, 0.03)' }}>
              <TemplateThumb doc={t.doc} />
              <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: '#F8FAFC' }}>{t.name}</p>
              <p style={{ ...hintStyle, margin: 0 }}>{t.description}</p>
              {bad && (
                <div role="alert" style={{ fontSize: '11px', color: '#FCA5A5' }}>
                  <p style={{ margin: 0 }}>This template cannot be used right now. Choose another one.</p>
                </div>
              )}
              {asking === t.id ? (
                <div role="group" aria-label={`Replace the page with ${t.name}?`} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <p style={{ ...hintStyle, margin: 0, color: '#FDE68A' }}>This replaces everything on your page. Undo brings it back.</p>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button type="button" autoFocus data-template-confirm={t.id} onClick={() => use(t)} style={{ ...smallButton, backgroundColor: '#4338CA', borderColor: '#4338CA', color: '#FFFFFF' }}>Replace my page</button>
                    <button type="button" onClick={() => cancel(t.id)} style={smallButton}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  data-template-use={t.id}
                  disabled={bad}
                  aria-label={`Use this template: ${t.name}`}
                  onClick={() => (hasContent ? setAsking(t.id) : use(t))}
                  style={{ ...smallButton, alignSelf: 'flex-start', opacity: bad ? 0.5 : 1 }}
                >
                  Use this template
                </button>
              )}
            </li>
          );
        })}
      </ul>
      </React.Fragment>
      ))}
    </section>
  );
};
