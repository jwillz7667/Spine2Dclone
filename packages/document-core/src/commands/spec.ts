import type { Command } from '../command/command';
import type { IdFactory } from '../model/ids';
import type {
  AttachmentSnapshot,
  BoneSnapshot,
  DocSnapshot,
  DocumentReadModel,
  SlotSnapshot,
} from '../model/read-model';

// Find a bone projection by internal id within a snapshot (used by assertApplied delta checks).
export function findBoneSnapshot(snapshot: DocSnapshot, id: string): BoneSnapshot | undefined {
  return snapshot.bones.find((bone) => bone.id === id);
}

// Find a slot projection by internal id within a snapshot.
export function findSlotSnapshot(snapshot: DocSnapshot, id: string): SlotSnapshot | undefined {
  return snapshot.slots.find((slot) => slot.id === id);
}

// Find an attachment projection by its (slotId, name) address within a snapshot.
export function findAttachmentSnapshot(
  snapshot: DocSnapshot,
  slotId: string,
  name: string,
): AttachmentSnapshot | undefined {
  return snapshot.attachments.find((att) => att.slotId === slotId && att.name === name);
}

// A representative, ready-to-apply command plus the seed it was built against.
export interface CommandFixture {
  readonly command: Command;
}

// The registration record every command file exports and appends to commandRegistry (command-history
// Section 10.1). The generic round-trip harness discovers commands through this. The MCP tool layer
// (WP-M.1) adds Zod input schemas separately; they are not needed by the harness, so document-core
// stays free of a direct zod dependency.
export interface CommandSpec {
  readonly kind: string; // unique; matches Command.kind
  // The seed (a packages/format fixture name, e.g. 'minimal' or 'rig') this command is GUARANTEED
  // applicable on. The discovery guard requires fixture() to be non-null here, so a command that is
  // inapplicable on every seed cannot pass with zero round-trip coverage.
  readonly representativeSeedId: string;
  // Produce a valid, representative command against a model (one that yields a real delta), or null
  // when not applicable to that seed.
  readonly fixture: (model: DocumentReadModel, ids: IdFactory) => CommandFixture | null;
  // Assert the SPECIFIC delta this command must produce (the mutated fields differ, unrelated fields
  // are unchanged). Throws on a missing or wrong delta, so a trivial fixture cannot pass.
  readonly assertApplied: (before: DocSnapshot, after: DocSnapshot) => void;
}
