import type { RGBA } from '@marionette/format/types';
import type { Command, CommandContext } from '../command/command';
import {
  CommandNotAppliedError,
  CommandTargetMissingError,
  LinkedMeshError,
} from '../command/errors';
import { makeLinkedMeshAttachment } from '../model/doc-state';
import type { SlotId } from '../model/ids';
import { DEFAULT_SKIN_NAME, resolveGeometrySource } from './linked-mesh-support';
import { findAttachmentSnapshot, type CommandSpec } from './spec';

// The fields a CreateLinkedMesh supplies. `parent` is the parent attachment NAME on the SAME slot; `skin`
// (default: the default skin) is the skin that HOLDS the parent; `timelines` selects whether this linked mesh
// shares the parent's deform timelines. `path` is this linked mesh's OWN atlas region.
export interface LinkedMeshInit {
  readonly name: string;
  readonly path: string;
  readonly parent: string;
  readonly skin?: string;
  readonly timelines: boolean;
  readonly width: number;
  readonly height: number;
  readonly color: RGBA;
}

// Add a linked mesh to a slot's DEFAULT-skin attachment map (`attach.linkedmesh.create`, PP-D10). The parent
// chain is resolved and cycle-checked at the command boundary BEFORE any mutation, mirroring the format's
// LINKED_MESH_* validators: the parent must resolve (through any linked-mesh hops) to a real mesh on the same
// slot, else a typed LinkedMeshError (parentMissing / parentInvalid / cycle). A name already used on the slot
// is duplicateName. Never coalesces; undo removes exactly what was added.
export class CreateLinkedMeshCommand implements Command {
  readonly kind = 'attach.linkedmesh.create';
  readonly label = 'Create Linked Mesh';
  private added = false;

  constructor(
    private readonly slotId: SlotId,
    private readonly init: LinkedMeshInit,
  ) {}

  do(ctx: CommandContext): void {
    if (ctx.mutate.getSlot(this.slotId) === undefined) {
      throw new CommandTargetMissingError(this.kind, this.slotId);
    }
    if (ctx.mutate.getAttachment(this.slotId, this.init.name) !== undefined) {
      throw new LinkedMeshError(this.slotId, this.init.name, 'duplicateName');
    }
    // Resolve the parent (the new linked mesh is not in the model yet, so start at the parent directly). The
    // parent lives in `skin ?? default`; it must reach a real mesh on this slot.
    const parentSkin = this.init.skin ?? DEFAULT_SKIN_NAME;
    const source = resolveGeometrySource(ctx.mutate, parentSkin, this.slotId, this.init.parent);
    if (source.kind === 'missing') {
      throw new LinkedMeshError(this.slotId, this.init.name, 'parentMissing', this.init.parent);
    }
    if (source.kind === 'invalid') {
      throw new LinkedMeshError(this.slotId, this.init.name, 'parentInvalid', this.init.parent);
    }
    if (source.kind === 'cycle') {
      throw new LinkedMeshError(this.slotId, this.init.name, 'cycle', this.init.parent);
    }
    ctx.mutate.addAttachment(
      this.slotId,
      makeLinkedMeshAttachment({
        name: this.init.name,
        path: this.init.path,
        parent: this.init.parent,
        skin: this.init.skin,
        timelines: this.init.timelines,
        width: this.init.width,
        height: this.init.height,
        color: this.init.color,
      }),
    );
    this.added = true;
  }

  undo(ctx: CommandContext): void {
    if (!this.added) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.removeAttachment(this.slotId, this.init.name);
  }
}

export const createLinkedMeshSpec: CommandSpec = {
  kind: 'attach.linkedmesh.create',
  // 'rigged' carries a real mesh 'panel' on 'mesh_slot'; a linked mesh referencing it resolves to that mesh.
  representativeSeedId: 'rigged',
  fixture: (model) => {
    for (const slot of model.slots()) {
      const mesh = model.attachments(slot.id).find((a) => a.kind === 'mesh');
      if (mesh === undefined) continue;
      return {
        command: new CreateLinkedMeshCommand(slot.id, {
          name: 'panel_linked',
          path: mesh.path,
          parent: mesh.name,
          timelines: true,
          width: 32,
          height: 32,
          color: { r: 1, g: 1, b: 1, a: 1 },
        }),
      };
    }
    return null;
  },
  assertApplied: (before, after) => {
    for (const slot of before.slots) {
      const added = findAttachmentSnapshot(after, slot.id, 'panel_linked');
      if (added === undefined) continue;
      if (added.kind !== 'linkedmesh') {
        throw new Error('attach.linkedmesh.create did not add a linked mesh');
      }
      if (added.parent !== 'panel' || added.timelines !== true) {
        throw new Error('attach.linkedmesh.create did not store the fixture fields');
      }
      return;
    }
    throw new Error('attach.linkedmesh.create added no linked mesh');
  },
};
