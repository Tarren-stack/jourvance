import React, { useEffect, useId, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';

// Shown under the header while Email Studio was opened from a step on the map. Back to funnel
// lands on that step. Dismiss ends the trip and leaves the user in Email Studio.
export const FunnelReturnBanner: React.FC<{ text: string; onBack: () => void; onDismiss: () => void }> = ({ text, onBack, onDismiss }) => {
  const ref = useRef<HTMLElement>(null);
  const textId = useId();

  // Focus moves here when the banner appears, so a keyboard user hears where they came from
  // and is one Tab from the way back.
  useEffect(() => { ref.current?.focus(); }, []);

  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-labelledby={textId}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '8px 12px',
        padding: '8px 20px',
        background: 'rgba(79, 70, 229, 0.14)',
        borderBottom: '1px solid rgba(129, 140, 248, 0.35)',
        position: 'relative',
        zIndex: 18
      }}
    >
      <p id={textId} style={{ fontSize: '13px', color: '#E0E7FF', flex: '1 1 280px', minWidth: 0, margin: 0, lineHeight: 1.45 }}>{text}</p>
      <button
        type="button"
        onClick={onBack}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 12px',
          borderRadius: '8px',
          border: '1px solid #4F46E5',
          background: '#4F46E5',
          color: '#FFFFFF',
          fontSize: '12px',
          fontWeight: 700,
          cursor: 'pointer'
        }}
      >
        <ArrowLeft size={14} aria-hidden="true" />
        Back to funnel
      </button>
      <button
        type="button"
        onClick={onDismiss}
        style={{
          padding: '6px 12px',
          borderRadius: '8px',
          border: '1px solid rgba(224, 231, 255, 0.35)',
          background: 'transparent',
          color: '#E0E7FF',
          fontSize: '12px',
          fontWeight: 600,
          cursor: 'pointer'
        }}
      >
        Dismiss
      </button>
    </section>
  );
};
