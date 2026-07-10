import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CreateBoneCommand,
  CreatePathAttachmentCommand,
  CreateSlotCommand,
  SetActiveAttachmentCommand,
  documentHost,
  type SlotId,
} from '../../document';
import { usePathEditStore } from '../../editor-state/path-edit-store';
import { useSlotSelectionStore } from '../../editor-state/slot-selection-store';
import { useToolStore } from '../../editor-state/tool-store';
import { resolvePathEditTarget } from '../path-edit';
import { deleteSelectedPathControlPoint, isPathAnchorIndex } from './path-tool';

// The PP-D11 Lane D remainder: the path tool's Delete/Backspace gesture. isPathAnchorIndex is the pure guard
// (a control-point index is an anchor iff it is a non-negative multiple of 3). deleteSelectedPathControlPoint
// is exercised against the REAL documentHost singleton and the ephemeral stores, since it reads the live
// document and the tool/slot/point selection exactly as the keybinding drives it. Each file gets its own
// module registry under Vitest, so mutating the singleton here does not leak into other test files.

describe('isPathAnchorIndex', () => {
  it('is true only for a non-negative multiple of 3 (a curve anchor)', () => {
    expect(isPathAnchorIndex(0)).toBe(true);
    expect(isPathAnchorIndex(3)).toBe(true);
    expect(isPathAnchorIndex(6)).toBe(true);
  });

  it('is false for the Bezier handles (1 or 2 mod 3) and invalid indices', () => {
    expect(isPathAnchorIndex(1)).toBe(false);
    expect(isPathAnchorIndex(2)).toBe(false);
    expect(isPathAnchorIndex(4)).toBe(false);
    expect(isPathAnchorIndex(-3)).toBe(false);
    expect(isPathAnchorIndex(1.5)).toBe(false);
  });
});

// Build a fresh document in the host with one bone, one slot, and one active default path attachment 'rail'
// (7 control points, two open curves), then point the ephemeral stores at it with the path tool active.
function seedPathInHost(): SlotId {
  documentHost.newDocument();
  const doc = documentHost.current();
  const boneId = doc.ids.mint('bone');
  doc.history.execute(
    new CreateBoneCommand(boneId, null, {
      name: 'root',
      length: 10,
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      shearX: 0,
      shearY: 0,
      transformMode: 'normal',
    }),
  );
  const slotId = doc.ids.mint('slot');
  doc.history.execute(
    new CreateSlotCommand(slotId, {
      name: 'rail',
      bone: boneId,
      color: { r: 1, g: 1, b: 1, a: 1 },
      darkColor: null,
      attachment: null,
      blendMode: 'normal',
    }),
  );
  doc.history.execute(new CreatePathAttachmentCommand(slotId, 'rail'));
  doc.history.execute(new SetActiveAttachmentCommand(slotId, 'rail'));

  useToolStore.getState().setTool('path');
  useSlotSelectionStore.getState().selectSlot(slotId);
  return slotId;
}

function railVertexCount(slotId: SlotId): number {
  const target = resolvePathEditTarget(documentHost.current().model, slotId);
  return target === null ? 0 : target.path.vertices.length / 2;
}

describe('deleteSelectedPathControlPoint', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    documentHost.newDocument();
    usePathEditStore.getState().clearPoint();
    useSlotSelectionStore.getState().clearSlot();
    useToolStore.getState().setTool('select');
  });

  it('drops the curve at a selected anchor and clears the selection', () => {
    const slotId = seedPathInHost();
    expect(railVertexCount(slotId)).toBe(7); // two curves

    usePathEditStore.getState().selectPoint(3); // the mid anchor
    deleteSelectedPathControlPoint();

    expect(railVertexCount(slotId)).toBe(4); // one curve remains
    expect(usePathEditStore.getState().selectedPoint).toBeNull();
  });

  it('is a no-op on a handle index (never dispatches a delete)', () => {
    const slotId = seedPathInHost();

    usePathEditStore.getState().selectPoint(1); // a Bezier handle
    deleteSelectedPathControlPoint();

    expect(railVertexCount(slotId)).toBe(7); // unchanged
    expect(usePathEditStore.getState().selectedPoint).toBe(1); // selection kept
  });

  it('is inert unless the path tool is active', () => {
    const slotId = seedPathInHost();
    useToolStore.getState().setTool('select');

    usePathEditStore.getState().selectPoint(3);
    deleteSelectedPathControlPoint();

    expect(railVertexCount(slotId)).toBe(7); // unchanged
  });

  it('swallows the last-curve rejection (PathError) instead of throwing into the UI', () => {
    const slotId = seedPathInHost();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // Collapse to a single curve first (delete the mid anchor), then attempt to delete the last curve.
    usePathEditStore.getState().selectPoint(3);
    deleteSelectedPathControlPoint();
    expect(railVertexCount(slotId)).toBe(4);

    usePathEditStore.getState().selectPoint(0); // an anchor, but the LAST curve
    expect(() => deleteSelectedPathControlPoint()).not.toThrow();

    expect(railVertexCount(slotId)).toBe(4); // unchanged: the command rejected minCurves
    expect(error).toHaveBeenCalledOnce();
  });
});
