import { z } from 'zod';
import { symbolIdSchema } from './symbol-id';
import { gridConfigSchema } from './grid-config';
import { symbolAnimSetSchema } from './symbol-anim-set';
import { winSequenceConfigSchema } from './win-sequence-config';
import { featureFlowGraphSchema } from './feature-flow-graph';
import { tumbleChoreographySchema } from './tumble-choreography';

// The SlotSceneDocument envelope, the SlotScene aggregate, and SceneRefs (format-contract section 15.3,
// phase-4 WP-4.4). WP-4.4 is the ENVELOPE ASSEMBLER: it composes the sub-schema modules (owned by
// WP-4.5/4.6/4.8/4.9/4.10) into the aggregate and the on-disk envelope. Every object is closed
// (.strict()) so an unknown key fails as SLOT_SCHEMA_SHAPE; in particular there is NO symbol-placement
// and NO symbol-source field anywhere (LAW 1), which the field-enumeration test asserts structurally.

// A referenced artifact (a SkeletonDocument or a Phase 3 VFX preset) by name + content hash. The hash
// is a 64-char lowercase hex digest, validated against the on-disk artifact by the semantic layer
// (cache-bust plus tamper detection).
export const sceneRefEntrySchema = z
  .object({
    name: z.string().min(1),
    hash: z.string().regex(/^[0-9a-f]{64}$/, 'ref hash must be 64 lowercase hex chars'),
  })
  .strict();

export type SceneRefEntry = z.infer<typeof sceneRefEntrySchema>;

// SceneRefs (format-contract section 15.3): the referenced skeletons and VFX presets, by name + hash.
export const sceneRefsSchema = z
  .object({
    skeletons: z.array(sceneRefEntrySchema),
    vfxPresets: z.array(sceneRefEntrySchema),
  })
  .strict();

export type SceneRefs = z.infer<typeof sceneRefsSchema>;

// SlotScene (format-contract section 15.3): the scene content the sequencer consumes (the value, not
// the on-disk envelope). `symbols` is keyed by SymbolId; the inferred key type is the SymbolId brand
// because the record key schema brands it. The sequencer reads `symbols` by keyed lookup only (phase-4
// section 5.4.1 iteration guard); the format does not order it.
export const slotSceneSchema = z
  .object({
    grid: gridConfigSchema,
    symbols: z.record(symbolIdSchema, symbolAnimSetSchema),
    winSequencer: winSequenceConfigSchema,
    featureFlows: featureFlowGraphSchema,
    tumble: tumbleChoreographySchema,
  })
  .strict();

export type SlotScene = z.infer<typeof slotSceneSchema>;

// SlotSceneDocument (format-contract section 15.3): the serialized envelope, validated on import.
// `hash` is the content hash for runtime cache busting: a 64-char lowercase hex digest or the empty
// string (an unhashed draft), mirroring the skeletal and effects formats. A non-empty hash that does
// not match the recomputed content hash is caught by the hash layer as `hashMismatch`, not here.
// `slotSceneFormatVersion` is routed by the version gate (a non-equal version is `versionMismatch`).
export const slotSceneDocumentSchema = z
  .object({
    slotSceneFormatVersion: z.string(),
    name: z.string().min(1),
    hash: z.string().regex(/^([0-9a-f]{64})?$/, 'hash must be 64 lowercase hex chars or empty'),
    scene: slotSceneSchema,
    refs: sceneRefsSchema,
  })
  .strict();

export type SlotSceneDocument = z.infer<typeof slotSceneDocumentSchema>;
