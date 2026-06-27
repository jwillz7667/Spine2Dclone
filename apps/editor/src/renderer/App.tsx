import { DockviewReact, type DockviewReadyEvent } from 'dockview';
import { useEffect, type ReactElement } from 'react';
import { DopesheetPanel, HierarchyPanel, InspectorPanel, ViewportPanel } from './panels';
import { attachKeybindings } from './viewport/keybindings';
import 'dockview/dist/styles/dockview.css';

const components = {
  hierarchy: HierarchyPanel,
  viewport: ViewportPanel,
  inspector: InspectorPanel,
  dopesheet: DopesheetPanel,
};

// Default layout: hierarchy left, viewport center, inspector right, dopesheet docked across the bottom.
// The viewport is added first as the layout anchor; the side panels dock against it and the dopesheet
// docks below it (WP-1.6).
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
  event.api.addPanel({
    id: 'dopesheet',
    component: 'dopesheet',
    title: 'Dopesheet',
    position: { referencePanel: viewport, direction: 'below' },
    initialHeight: 240,
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
