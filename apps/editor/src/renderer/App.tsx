import { DockviewReact, type DockviewReadyEvent } from 'dockview';
import { useEffect, type ReactElement } from 'react';
import { HierarchyPanel, InspectorPanel, ViewportPanel } from './panels';
import { attachKeybindings } from './viewport/keybindings';
import 'dockview/dist/styles/dockview.css';

const components = {
  hierarchy: HierarchyPanel,
  viewport: ViewportPanel,
  inspector: InspectorPanel,
};

// Default layout: hierarchy left, viewport center, inspector right. The viewport is added first as
// the layout anchor; the side panels dock against it.
function onReady(event: DockviewReadyEvent): void {
  const viewport = event.api.addPanel({ id: 'viewport', component: 'viewport', title: 'Viewport' });
  event.api.addPanel({
    id: 'hierarchy',
    component: 'hierarchy',
    title: 'Hierarchy',
    position: { referencePanel: viewport, direction: 'left' },
    initialWidth: 280,
  });
  event.api.addPanel({
    id: 'inspector',
    component: 'inspector',
    title: 'Inspector',
    position: { referencePanel: viewport, direction: 'right' },
    initialWidth: 320,
  });
}

export function App(): ReactElement {
  // Undo/redo and tool-switch keybindings are global (handoff 8.1): bound at the renderer root so they
  // work regardless of which panel has focus, routed to the live document's History.
  useEffect(() => attachKeybindings(), []);

  return (
    <DockviewReact components={components} onReady={onReady} className="dockview-theme-abyss" />
  );
}
