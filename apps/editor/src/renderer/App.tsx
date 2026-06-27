import { DockviewReact, type DockviewReadyEvent } from 'dockview';
import { useEffect, type ReactElement } from 'react';
import {
  AnimationPanel,
  CurveEditorPanel,
  DopesheetPanel,
  HierarchyPanel,
  InspectorPanel,
  ViewportPanel,
} from './panels';
import { attachKeybindings } from './viewport/keybindings';
import 'dockview/dist/styles/dockview.css';

const components = {
  hierarchy: HierarchyPanel,
  viewport: ViewportPanel,
  inspector: InspectorPanel,
  animations: AnimationPanel,
  dopesheet: DopesheetPanel,
  curveeditor: CurveEditorPanel,
};

// Default layout: hierarchy left, viewport center, inspector right, and an animation-authoring strip
// across the bottom (animations list, dopesheet, curve editor). The viewport is added first as the layout
// anchor; the side panels dock against it and the bottom strip docks below it (WP-1.6, WP-1.9).
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
  // The animation manager (WP-1.9) anchors the bottom strip: it manages the named animations the dopesheet
  // and curve editor then author. The dopesheet docks to its right and the curve editor to the dopesheet's.
  const animations = event.api.addPanel({
    id: 'animations',
    component: 'animations',
    title: 'Animations',
    position: { referencePanel: viewport, direction: 'below' },
    initialHeight: 240,
    initialWidth: 240,
  });
  const dopesheet = event.api.addPanel({
    id: 'dopesheet',
    component: 'dopesheet',
    title: 'Dopesheet',
    position: { referencePanel: animations, direction: 'right' },
  });
  event.api.addPanel({
    id: 'curveeditor',
    component: 'curveeditor',
    title: 'Curve Editor',
    position: { referencePanel: dopesheet, direction: 'right' },
    initialWidth: 280,
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
