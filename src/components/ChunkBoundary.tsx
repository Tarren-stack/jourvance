import React from 'react';
import { CHUNK_NOT_LOADED, isChunkLoadError } from '../lib/chunkLoad';

/**
 * Around App's lazy views and modals: when a lazy part's file does not arrive (an open tab after a
 * deploy), this part says so with a Reload button and the rest of the app stays mounted. React keeps a
 * failed lazy import failed, so a reload is the only way to try again. Any other error is passed on
 * to whatever is above, exactly as it was before this boundary.
 *
 * `floating` draws the sentence over the page (the modals, which have no place of their own on it);
 * without it, the sentence takes the part's own place.
 *
 * `each` puts every child in a boundary and a Suspense of its own (App's modals): one modal whose file
 * did not arrive takes only its own place, and every other modal still opens. One boundary around them
 * all hid every modal until a reload. A child's key is its place in the list, so opening or closing one
 * mounts nothing else again.
 */
type Props = { children: React.ReactNode; floating?: boolean; each?: boolean };
type State = { failed: boolean; error: unknown };

const box: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '12px',
  padding: '12px 16px',
  background: '#111827',
  color: '#f9fafb',
  border: '1px solid rgba(255, 255, 255, 0.18)',
  borderRadius: '10px',
  fontSize: '14px',
  lineHeight: 1.4,
  maxWidth: 'min(560px, calc(100vw - 32px))',
  boxSizing: 'border-box'
};

const floatingBox: React.CSSProperties = {
  ...box,
  position: 'fixed',
  left: '50%',
  bottom: '24px',
  transform: 'translateX(-50%)',
  zIndex: 10000,
  boxShadow: '0 10px 30px rgba(0, 0, 0, 0.45)'
};

const reloadBtn: React.CSSProperties = {
  minHeight: '44px',
  padding: '0 16px',
  background: 'transparent',
  color: '#f9fafb',
  border: '1px solid rgba(255, 255, 255, 0.45)',
  borderRadius: '8px',
  fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer'
};

export class ChunkBoundary extends React.Component<Props, State> {
  state: State = { failed: false, error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { failed: true, error };
  }

  render() {
    if (!this.state.failed && this.props.each) {
      return React.Children.map(this.props.children, (child) => (child == null || typeof child === 'boolean' ? null : (
        <ChunkBoundary floating={this.props.floating}>
          <React.Suspense fallback={null}>{child}</React.Suspense>
        </ChunkBoundary>
      )));
    }
    if (!this.state.failed) return this.props.children;
    if (!isChunkLoadError(this.state.error)) throw this.state.error;
    return (
      <div role="alert" data-chunk-boundary style={this.props.floating ? floatingBox : { ...box, margin: '24px auto' }}>
        <span>{CHUNK_NOT_LOADED}</span>
        <button type="button" style={reloadBtn} onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}
