import { useEffect, useState } from 'react';
import { ASK_READY_ATTR, askAssistantReady } from '../../lib/assistant';

/** True while Ask Jourvance is mounted (it sets an attribute on <html>), so "Ask about this" buttons show only then. */
export function useAskReady(): boolean {
  const [ready, setReady] = useState(askAssistantReady);
  useEffect(() => {
    setReady(askAssistantReady());
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(() => setReady(askAssistantReady()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: [ASK_READY_ATTR] });
    return () => observer.disconnect();
  }, []);
  return ready;
}
