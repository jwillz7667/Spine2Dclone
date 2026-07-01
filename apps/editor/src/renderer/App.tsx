import { DockviewReact, type DockviewReadyEvent } from 'dockview';
import { useEffect, type ReactElement } from 'react';
import {
  AnimationPanel,
  AssetsPanel,
  CurveEditorPanel,
  DopesheetPanel,
  EffectsPanel,
  HierarchyPanel,
  InspectorPanel,
  SlotPanel,
  ViewportPanel,
} from './panels';
import { attachKeybindings } from './viewport/keybindings';
import { attachMenuActions } from './menu-actions';
import 'dockview/dist/styles/dockview.css';

const components = {
  hierarchy: HierarchyPanel,
  assets: AssetsPanel,
  viewport: ViewportPanel,
  inspector: InspectorPanel,
  effects: EffectsPanel,
  slot: SlotPanel,
  animations: AnimationPanel,
  dopesheet: DopesheetPanel,
  curveeditor: CurveEditorPanel,
};

// Default layout: hierarchy left, viewport center, inspector right, and an animation-authoring strip
// across the bottom (animations list, dopesheet, curve editor). The viewport is added first as the layout
// anchor; the side panels dock against it and the bottom strip docks below it (WP-1.6, WP-1.9).
function onReady(event: DockviewReadyEvent): void {
  const viewport = event.api.addPanel({ id: 'viewport', component: 'viewport', title: 'Viewport' });
  const hierarchy = event.api.addPanel({
    id: 'hierarchy',
    component: 'hierarchy',
    title: 'Hierarchy',
    position: { referencePanel: viewport, direction: 'left' },
    initialWidth: 280,
  });
  // The Assets panel (atlas import + region list, WP-1.3) tabs alongside the hierarchy in the left group:
  // both are document-structure browsers, and the inspector reads the imported regions to attach them.
  event.api.addPanel({
    id: 'assets',
    component: 'assets',
    title: 'Assets',
    position: { referencePanel: hierarchy, direction: 'within' },
  });
  // The Slot panel (phase-4 slot composer authoring) tabs alongside the Hierarchy/Assets group on the left:
  // it drives the slotScene that is part of the same DocumentModel + single undo stack as the skeleton.
  event.api.addPanel({
    id: 'slot',
    component: 'slot',
    title: 'Slot',
    position: { referencePanel: hierarchy, direction: 'within' },
  });
  const inspector = event.api.addPanel({
    id: 'inspector',
    component: 'inspector',
    title: 'Inspector',
    position: { referencePanel: viewport, direction: 'right' },
    initialWidth: 320,
  });
  // The Effects panel (VFX designer, WP-3.7 editor surface) tabs alongside the Inspector in the right group:
  // both are entity editors, and the effects library shares the same document + undo stack as the skeleton.
  event.api.addPanel({
    id: 'effects',
    component: 'effects',
    title: 'Effects',
    position: { referencePanel: inspector, direction: 'within' },
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
  // work regardless of which panel has focus, routed to the live document's History. The native
  // application-menu clicks (File / Edit / View / Tools) are wired to the SAME actions here too, so the
  // menu is a discoverable surface over the keybindings rather than a second code path.
  useEffect(() => {
    const detachKeys = attachKeybindings();
    const detachMenu = attachMenuActions();
    return () => {
      detachKeys();
      detachMenu();
    };
  }, []);

  return (
    <DockviewReact components={components} onReady={onReady} className="dockview-theme-abyss" />
  );
}
