import { useEffect, useState } from 'react';
import { documentHost } from '../document';

// Re-render a panel when the live document's revision changes. The document is deliberately NOT in Zustand
// (the editor/document wall, handoff 8.2), so panels learn it mutated by polling model.revision once per
// animation frame. State updates only on an actual change, so an idle document costs no React churn.
// Shared by the dopesheet and curve-editor panels.
export function useDocumentRevision(): number {
  const [revision, setRevision] = useState(() => documentHost.current().model.revision);
  useEffect(() => {
    let raf = 0;
    let disposed = false;
    const poll = (): void => {
      if (disposed) return;
      const current = documentHost.current().model.revision;
      setRevision((prev) => (prev === current ? prev : current));
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
    };
  }, []);
  return revision;
}
