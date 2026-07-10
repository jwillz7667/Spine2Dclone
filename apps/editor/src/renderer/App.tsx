import { DockviewReact, type DockviewReadyEvent } from 'dockview';
import { useEffect, type ReactElement } from 'react';
import {
  AnimationPanel,
  AssetsPanel,
  ConstraintsPanel,
  CurveEditorPanel,
  DopesheetPanel,
  DrawOrderPanel,
  EffectsPanel,
  EventsPanel,
  HierarchyPanel,
  InspectorPanel,
  SkinsPanel,
  SlotPanel,
  ValueGraphPanel,
  ViewportPanel,
} from './panels';
import { attachKeybindings } from './viewport/keybindings';
import { attachMenuActions } from './menu-actions';
import { SpineImportResults } from './spine-import-results';
import { ExportDialog } from './export/export-dialog';
import { GridSliceDialog } from './grid-slice-dialog';
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
  valuegraph: ValueGraphPanel,
  events: EventsPanel,
  draworder: DrawOrderPanel,
  skins: SkinsPanel,
  constraints: ConstraintsPanel,
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
  // The Skins panel (PP-D4) tabs alongside the Inspector/Effects group on the right: it is an entity editor
  // over the same document + undo stack, and its per-slot overrides read the attachments the inspector sets.
  event.api.addPanel({
    id: 'skins',
    component: 'skins',
    title: 'Skins',
    position: { referencePanel: inspector, direction: 'within' },
  });
  // The Constraints panel (PP-D10) tabs alongside the Inspector group on the right: it edits IK (and, in the
  // following slices, transform) constraints over the same document + single undo stack as the skeleton.
  event.api.addPanel({
    id: 'constraints',
    component: 'constraints',
    title: 'Constraints',
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
  // The Events panel (Stage F1 event definitions + firing) and the Draw Order panel (reorder-and-key at the
  // playhead) tab alongside the Animations panel in the bottom strip: both author animation data the
  // dopesheet then shows, on the same document + single undo stack.
  event.api.addPanel({
    id: 'events',
    component: 'events',
    title: 'Events',
    position: { referencePanel: animations, direction: 'within' },
  });
  event.api.addPanel({
    id: 'draworder',
    component: 'draworder',
    title: 'Draw Order',
    position: { referencePanel: animations, direction: 'within' },
  });
  const dopesheet = event.api.addPanel({
    id: 'dopesheet',
    component: 'dopesheet',
    title: 'Dopesheet',
    position: { referencePanel: animations, direction: 'right' },
  });
  const curveeditor = event.api.addPanel({
    id: 'curveeditor',
    component: 'curveeditor',
    title: 'Curve Editor',
    position: { referencePanel: dopesheet, direction: 'right' },
    initialWidth: 280,
  });
  // The Value Graph editor (PP-D3) tabs alongside the Curve Editor: both author keyframe interpolation, the
  // curve editor as a normalized easing square and the graph as value-vs-time. It shares the dopesheet's time
  // view and key selection, so switching tabs keeps the same frame and selection.
  event.api.addPanel({
    id: 'valuegraph',
    component: 'valuegraph',
    title: 'Value Graph',
    position: { referencePanel: curveeditor, direction: 'within' },
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
    <>
      <DockviewReact components={components} onReady={onReady} className="dockview-theme-abyss" />
      <SpineImportResults />
      <ExportDialog />
      <GridSliceDialog />
    </>
  );
}
