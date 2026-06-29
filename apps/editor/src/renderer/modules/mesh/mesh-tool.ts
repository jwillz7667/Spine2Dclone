import {
  AutoGridFillMeshCommand,
  AutoPerimeterTraceMeshCommand,
  GenerateMeshFromRegionCommand,
  type History,
  type MeshAutoFill,
  type MeshInit,
  type SlotId,
} from '../../document';

// THIN GLUE for the mesh authoring tool (WP-2.1): turn the pure-module geometry (region-to-mesh, grid-fill,
// perimeter-trace) into document mutations by executing the corresponding command on the live History
// (LAW 2: every mutation is a Command, the UI never mutates the document directly). The geometry is
// computed by the pure modules and handed in; this module only constructs and dispatches the command. No
// triangulation or bitmap work happens here (that is the pure modules' job and is unit-tested there); this
// is covered by typecheck + lint. Kept off dockview/App.tsx wiring (the lead owns panel wiring).

// Convert a region attachment to an unweighted mesh (GenerateMeshFromRegion). `init` comes from
// regionToMeshInit. One undoable step.
export function generateMeshFromRegion(
  history: History,
  slotId: SlotId,
  attachmentName: string,
  init: MeshInit,
): void {
  history.execute(new GenerateMeshFromRegionCommand(slotId, attachmentName, init));
}

// Replace a mesh's geometry with an auto grid-fill (AutoGridFillMesh). `fill` comes from gridFill mapped
// into MeshAutoFill by the caller. One undoable step (topology-locked: the command rejects a weighted /
// deformed mesh before mutating).
export function autoGridFillMesh(
  history: History,
  slotId: SlotId,
  attachmentName: string,
  fill: MeshAutoFill,
): void {
  history.execute(new AutoGridFillMeshCommand(slotId, attachmentName, fill));
}

// Replace a mesh's geometry with an auto perimeter-trace (AutoPerimeterTraceMesh). `fill` comes from
// perimeterTrace. One undoable step (topology-locked, same guard as grid-fill).
export function autoPerimeterTraceMesh(
  history: History,
  slotId: SlotId,
  attachmentName: string,
  fill: MeshAutoFill,
): void {
  history.execute(new AutoPerimeterTraceMeshCommand(slotId, attachmentName, fill));
}
