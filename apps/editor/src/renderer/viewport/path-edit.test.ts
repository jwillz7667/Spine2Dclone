import { describe, expect, it } from 'vitest';
import {
  AddPathCurveCommand,
  CreateBoneCommand,
  CreatePathAttachmentCommand,
  CreateSlotCommand,
  MovePathControlPointCommand,
  SetActiveAttachmentCommand,
  createDocument,
  makeIdFactory,
  newDocState,
  type Document,
  type DocumentEnvironment,
  type SlotId,
} from '../document';
import {
  hitTestPathControlPoint,
  pathLocalFromWorld,
  pathWorldVertices,
  resolvePathEditTarget,
} from './path-edit';
import type { Camera } from './camera';

// The PP-D11 path tool's pure logic against a REAL document built through the same commands the editor
// dispatches (no DOM, no Pixi): target resolution (active/first path attachment of the selected slot),
// zoom-independent control-point picking, world/local mapping, and the exact command flows the tool drives,
// including the merged-sequence undo the interaction group guarantees. Mirrors mesh-edit.test.ts.

const CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

interface Rig {
  readonly doc: Document;
  readonly slotId: SlotId;
}

// One bone at the origin, one slot, one default two-curve open path 'rail' (7 control points at
// (0,0),(30,0),...,(180,0)) set active on the slot.
function pathRig(): Rig {
  const env: DocumentEnvironment = { now: () => 0, createIds: makeIdFactory };
  const doc = createDocument(newDocState('path-edit-test'), env);
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
  return { doc, slotId };
}

describe('resolvePathEditTarget', () => {
  it('resolves the active path attachment of the selected slot', () => {
    const { doc, slotId } = pathRig();
    const target = resolvePathEditTarget(doc.model, slotId);
    expect(target).not.toBeNull();
    expect(target!.attachmentName).toBe('rail');
    expect(target!.path.closed).toBe(false);
    expect(target!.path.vertices).toHaveLength(14); // 7 control points, two open curves
  });

  it('returns null with no slot selected and null for a slot with no path', () => {
    const { doc } = pathRig();
    expect(resolvePathEditTarget(doc.model, null)).toBeNull();

    const env: DocumentEnvironment = { now: () => 0, createIds: makeIdFactory };
    const bare = createDocument(newDocState('bare'), env);
    const boneId = bare.ids.mint('bone');
    bare.history.execute(
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
    const slotId = bare.ids.mint('slot');
    bare.history.execute(
      new CreateSlotCommand(slotId, {
        name: 'empty',
        bone: boneId,
        color: { r: 1, g: 1, b: 1, a: 1 },
        darkColor: null,
        attachment: null,
        blendMode: 'normal',
      }),
    );
    expect(resolvePathEditTarget(bare.model, slotId)).toBeNull();
  });
});

describe('control-point picking and space mapping', () => {
  it('maps path locals through the slot bone world (identity bone: world equals local)', () => {
    const { doc, slotId } = pathRig();
    const target = resolvePathEditTarget(doc.model, slotId)!;
    expect(pathWorldVertices(target)).toEqual([...target.path.vertices]);
  });

  it('picks the control point within the pixel tolerance and misses outside it', () => {
    const { doc, slotId } = pathRig();
    const target = resolvePathEditTarget(doc.model, slotId)!;
    // Control point 3 is the mid anchor at (90, 0).
    expect(hitTestPathControlPoint(target, 92, 3, CAMERA)).toBe(3);
    expect(hitTestPathControlPoint(target, 105, 0, CAMERA)).toBeNull();
  });

  it('keeps the pick tolerance in screen pixels at any zoom', () => {
    const { doc, slotId } = pathRig();
    const target = resolvePathEditTarget(doc.model, slotId)!;
    const zoomed: Camera = { x: 0, y: 0, zoom: 10 };
    // Control point 3 at world (90, 0) is at screen (900, 0) under zoom 10. 5 screen px is a hit.
    expect(hitTestPathControlPoint(target, 905, 0, zoomed)).toBe(3);
    // 2 world units (20 px at zoom 10) misses.
    expect(hitTestPathControlPoint(target, 920, 0, zoomed)).toBeNull();
  });

  it('pathLocalFromWorld inverts the bone world', () => {
    const { doc, slotId } = pathRig();
    const target = resolvePathEditTarget(doc.model, slotId)!;
    const [lx, ly] = pathLocalFromWorld(target, 12, -7);
    expect(lx).toBeCloseTo(12, 12);
    expect(ly).toBeCloseTo(-7, 12);
  });
});

describe('the path tool command flows (Law 2, merged-sequence undo)', () => {
  it('a control-point drag session commits as ONE undo step restoring the pre-drag geometry', () => {
    const { doc, slotId } = pathRig();
    const before = doc.model.snapshot();

    doc.history.beginInteraction();
    doc.history.execute(new MovePathControlPointCommand(slotId, 'rail', 3, 90, 20));
    doc.history.execute(new MovePathControlPointCommand(slotId, 'rail', 3, 92, 30));
    doc.history.execute(new MovePathControlPointCommand(slotId, 'rail', 3, 95, 40));
    doc.history.endInteraction('Move Path Point');

    const moved = resolvePathEditTarget(doc.model, slotId)!;
    expect([moved.path.vertices[6], moved.path.vertices[7]]).toEqual([95, 40]);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('shift-append executes one AddPathCurve; a single undo removes the curve', () => {
    const { doc, slotId } = pathRig();
    doc.history.execute(new AddPathCurveCommand(slotId, 'rail'));
    expect(resolvePathEditTarget(doc.model, slotId)!.path.vertices).toHaveLength(20); // +3 control points

    doc.history.undo();
    expect(resolvePathEditTarget(doc.model, slotId)!.path.vertices).toHaveLength(14);
  });
});
