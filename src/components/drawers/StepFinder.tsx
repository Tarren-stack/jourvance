import React, { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { JourneyNode } from '../../types/journey';
import {
  neighbourStep,
  pathGroup,
  revealsHiddenStep,
  stepKindLabel,
  stepList,
  stepName,
  type PathFilter
} from '../../lib/stepNavigation';

// The top of the docked step panel: search, an optional path filter, a grouped Step list and
// Previous/Next. Every rule (order, groups, search, the walk) lives in stepNavigation.ts.
//
// It is one row (R11): search beside the Step list, with Previous and Next as arrow buttons on
// either side of the list and the position on the list's label line. Stacked as four rows it took
// about 200px, which pushed a page's Button text and Page address below the fold at 1280x720. The
// Show filter and the match count share one more row, and only when there is something to show.

interface Props {
  nodes: JourneyNode[];
  selectedId: string | null;
  showRetentionBranches: boolean;
  onSelectStep: (nodeId: string) => void;
  searchRef?: React.Ref<HTMLInputElement>;
  /** The empty-journey message. It takes focus (tabIndex -1) when the last step is deleted,
   *  because the search field is not rendered once the journey has no steps. */
  emptyRef?: React.Ref<HTMLParagraphElement>;
}

const FILTER_LABELS: Record<PathFilter, string> = {
  all: 'All paths',
  'Main path': 'Main path',
  'Retention flows': 'Retention flows'
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '11px',
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  marginBottom: '4px'
};

const fieldStyle: React.CSSProperties = {
  width: '100%',
  minHeight: '32px',
  boxSizing: 'border-box',
  padding: '6px 10px',
  background: 'var(--color-surface-2)',
  border: '1px solid var(--color-border)',
  borderRadius: '8px',
  color: 'var(--color-text-main)',
  fontSize: '13px'
};

const navButtonStyle = (inactive: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '4px',
  minHeight: '32px',
  minWidth: '32px',
  flex: 'none',
  padding: '4px 6px',
  background: 'var(--color-surface-2)',
  border: '1px solid var(--color-border)',
  borderRadius: '8px',
  color: inactive ? 'var(--color-text-dim)' : 'var(--color-text-main)',
  fontSize: '12px',
  fontWeight: 600,
  cursor: inactive ? 'default' : 'pointer'
});

export const StepFinder: React.FC<Props> = ({ nodes, selectedId, showRetentionBranches, onSelectStep, searchRef, emptyRef }) => {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PathFilter>('all');
  const inputRef = useRef<HTMLInputElement | null>(null);
  // The dock also needs the field (focus lands here after a delete), so the ref is shared.
  const setInputRef = (el: HTMLInputElement | null) => {
    inputRef.current = el;
    if (typeof searchRef === 'function') searchRef(el);
    else if (searchRef) (searchRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
  };

  const list = stepList(nodes, { query, filter, selectedId });
  // A filter whose group has gone (its last step was deleted) falls back to all paths.
  if (!list.filters.includes(filter)) {
    setFilter('all');
  }

  if (nodes.length === 0) {
    return (
      <section aria-label="Find a step" style={{ padding: '14px 16px', flex: 'none', borderBottom: '1px solid var(--color-border)' }}>
        <p ref={emptyRef} tabIndex={-1} style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-muted)' }}>
          This journey has no steps yet. Add one with Add Step in the toolbar.
        </p>
      </section>
    );
  }

  const byId = new Map(list.ordered.map(n => [n.id, n]));
  const matchSet = new Set(list.matchIds);
  const orderedIds = list.ordered.map(n => n.id);
  const selectedIndex = selectedId ? list.matchIds.indexOf(selectedId) : -1;
  const position = !selectedId || !byId.has(selectedId)
    ? 'No step selected'
    : selectedIndex === -1
      ? 'Not in this list'
      : `Step ${selectedIndex + 1} of ${list.matchIds.length}`;

  const prevId = neighbourStep(orderedIds, list.matchIds, selectedId, -1);
  const nextId = neighbourStep(orderedIds, list.matchIds, selectedId, 1);
  const narrowed = query.trim() !== '' || filter !== 'all';
  const count = list.matchIds.length;

  const optionText = (n: JourneyNode) => {
    const hidden = revealsHiddenStep(n, showRetentionBranches) ? ', hidden' : '';
    const onlySelected = !matchSet.has(n.id) && n.id === selectedId ? ', selected' : '';
    return `${stepName(n)} (${stepKindLabel(n.data)}${hidden}${onlySelected})`;
  };

  const navButton = (dir: -1 | 1, targetId: string | null) => {
    const word = dir === -1 ? 'Previous' : 'Next';
    const target = targetId ? byId.get(targetId) : undefined;
    // An arrow with no visible word, so the name is always set, and the title shows it on hover.
    const label = target ? `${word}: ${stepName(target)}` : word;
    return (
      <button
        type="button"
        aria-disabled={target ? undefined : 'true'}
        aria-label={label}
        title={label}
        onClick={() => {
          if (target) onSelectStep(target.id);
        }}
        // 28px wide, still past the 24px target size, so the Step list gets 8px more of the row.
        style={{ ...navButtonStyle(!target), minWidth: '28px', padding: '4px 5px' }}
      >
        {dir === -1 ? <ChevronLeft size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
      </button>
    );
  };

  const showFilter = list.filters.length > 1;

  return (
    <section
      aria-label="Find a step"
      style={{ padding: '8px 16px', flex: 'none', borderBottom: '1px solid var(--color-border)' }}
    >
      {/* The search column is as wide as its hint needs and no wider: a share of the row gave it
          106px on a 360px dock (every window from 768 to 1200px), where type=search's cancel button
          clipped "Name or type". The field's font is Arial (form fields do not inherit the page font),
          and the hint needs 113px in it; 116 keeps a margin. Everything else goes to the Step list,
          whose names are what people read. */}
      <div style={{ display: 'grid', gridTemplateColumns: '116px minmax(0, 1fr)', gap: '8px', alignItems: 'end' }}>
        <div style={{ minWidth: 0 }}>
          <label htmlFor="jv-step-search" style={labelStyle}>Search steps</label>
          <input
            id="jv-step-search"
            type="search"
            ref={setInputRef}
            value={query}
            placeholder="Name or type"
            autoComplete="off"
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && list.matchIds.length > 0) {
                e.preventDefault();
                onSelectStep(list.matchIds[0]);
              }
            }}
            style={fieldStyle}
          />
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
            <label htmlFor="jv-step-select" style={{ ...labelStyle, marginBottom: 0 }}>Step</label>
            <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{position}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {navButton(-1, prevId)}
            <select
              id="jv-step-select"
              value={selectedId && byId.has(selectedId) ? selectedId : ''}
              onChange={e => {
                if (e.target.value) onSelectStep(e.target.value);
              }}
              // Less right padding: Chrome draws the list's own arrow inside it, with its own margin.
              style={{ ...fieldStyle, flex: 1, minWidth: 0, width: 'auto', padding: '6px 4px 6px 8px' }}
            >
              <option value="">Choose a step</option>
              {list.groups.map(group => (
                <optgroup key={group} label={group}>
                  {list.ordered
                    .filter(n => pathGroup(n.data) === group && (matchSet.has(n.id) || n.id === selectedId))
                    .map(n => (
                      <option key={n.id} value={n.id}>{optionText(n)}</option>
                    ))}
                </optgroup>
              ))}
            </select>
            {navButton(1, nextId)}
          </div>
        </div>
      </div>

      {/* The Show filter, the match count and Clear filters share one row. The status region stays
          mounted so a screen reader hears the count change. With no filter to show and no search,
          the row is empty and takes no space: a margin, not a grid gap, because a gap stays even
          under an empty row (the old finder carried 8px of nothing). */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '8px',
          marginTop: narrowed || showFilter ? '6px' : 0
        }}
      >
        {showFilter && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <label htmlFor="jv-step-filter" style={{ ...labelStyle, marginBottom: 0 }}>Show</label>
            <select
              id="jv-step-filter"
              value={filter}
              onChange={e => setFilter(e.target.value as PathFilter)}
              style={{ ...fieldStyle, width: 'auto' }}
            >
              {list.filters.map(f => (
                <option key={f} value={f}>{FILTER_LABELS[f]}</option>
              ))}
            </select>
          </div>
        )}
        <p role="status" style={{ margin: 0, flex: '1 1 auto', fontSize: '12px', color: 'var(--color-text-muted)' }}>
          {!narrowed ? '' : count === 0 ? 'No step matches.' : `${count} matching ${count === 1 ? 'step' : 'steps'}.`}
        </p>
        {narrowed && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setFilter('all');
              // The button goes away with the filters, so focus moves back to the search field.
              inputRef.current?.focus();
            }}
            style={{ ...navButtonStyle(false), fontWeight: 600 }}
          >
            Clear filters
          </button>
        )}
      </div>
    </section>
  );
};
