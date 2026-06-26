# Cross-cutting: Command + History (document mutation spine)

> Plan of record. Owner: Editor Core. Status: PROPOSED (requires senior reviewer sign-off before WP-C.1 starts).
> Source of truth: `MARIONETTE_HANDOFF.md` sections 8.1 (command/history), 8.2 (state separation), 6 (format), 8.10 (slot layer), 9 (phases), 11 (conventions), 12 (Phase 0 steps).
> Format-owned cross-references (this document CONSUMES, never redefines, these): `docs/plan/cross-cutting/format-contract.md` (canonical form, `computeContentHash`/`verifyContentHash`, the golden corpus), `docs/plan/phase-4-slot-composer.md` (the `SlotSceneDocument` envelope, the `packages/format` vs `packages/math-bridge` type-ownership table, the `no-outcome-in-commands` lint amendment), `docs/plan/cross-cutting/conformance-and-ci.md` (Phase 0 CI, `packages/conformance` is a Phase 1 deliverable).
> This module lives at `apps/editor/src/renderer/document/`. It is built in Phase 0 and is a hard dependency of every later phase.

This document specifies the DocumentModel, the Command contract, the History engine, the coalescing strategy, snapshot/save/load, the canonical format round-trip, document ownership on load, the separation of transient state, the enforcement mechanism for "all mutations are commands", the mandatory do/undo round-trip harness, and the full per-phase command catalog. It closes with referenceable work packages (WP-C.1 onward), each independently verifiable.

This revision incorporates a senior sign-off review. It resolves the LAW 3 seam findings by DEFERRING every format decision to the documents that own the format: the content-hash domain and implementation now come from `packages/format` (Section 7.3), the slot scene serializes through its own `SlotSceneDocument` envelope owned by `packages/format` and the phase-4 plan (Section 7.5), and the relocation of the Phase 4 authoring-config types and `SymbolId` is recorded as a CONSUMED decision (Section 14, CD-1), not originated here. It removes the LAW 5 phase leak (the Phase 0 computed-result reference is now a bone-only command, not the Phase 2 `Retriangulate`, Section 4.3). It defines the previously undefined `SelectionHint` type together with its per-phase execute/undo/redo semantics (Section 4.1, Section 8). It sources Phase 0 harness seeds from `packages/format` fixtures and declares the Phase 1 `packages/conformance` dependency honestly (Section 10.3). It also leads LAW 1 enforcement with the structural guarantee rather than the lint denylist (Section 9.2), single-sources the History defaults (Section 5.1), adds a commit re-entrancy guard (Section 5.1), specifies batch mode for order-array drags (Section 3.1), and tightens the harness so an always-inapplicable command cannot pass with zero coverage (Section 10).

---

## 0. Why this is the spine

LAW 2 (ALL DOCUMENT MUTATIONS ARE COMMANDS) is the single most common reason editor codebases rot (handoff item 4, risk register row "Undo/redo retrofitted late = rewrite"). This module is built first, before any tool, so that no tool can be written that mutates the document any other way. If a single mutation path bypasses History, the architecture is already broken and the rest of the editor inherits the rot. Every acceptance criterion below exists to make that bypass impossible to merge, not merely discouraged.

This document touches the following NON-NEGOTIABLE LAWS directly:

| Law | How this module is bound by it |
|---|---|
| LAW 2 (mutations are commands) | This module IS the law. The Mutator capability (Section 3.3) makes "mutate outside a command" structurally impossible, not just lint-discouraged. |
| LAW 3 (format is the contract) | save/load (Section 7) validate against `packages/format` on import; malformed docs fail loudly. The internal model is NOT the format; export resolves internal IDs to format names. The content hash and canonical form are OWNED by `packages/format` and consumed here, never redefined (Section 7.3). The Phase 4 slot scene serializes through its own `SlotSceneDocument` envelope owned by `packages/format` and the phase-4 plan (Section 7.5). |
| LAW 1 (math/presentation boundary) | A command's only inputs are a `Mutator` and an `IdFactory` (Section 4.1); it has no runtime handle to a `SpinResult`, board, RNG state, or any outcome value, so it CANNOT read or influence an outcome (Section 9.2, structural). The outcome-symbol lint is the backstop. Phase 4 slot commands author presentation only. |
| LAW 5 (build in order) | Every command is owned by the phase whose entities it mutates. No Phase 0 command may reference an entity type (slot, attachment, animation, mesh) that Phase 0 has no shape for. The Phase 0 computed-result reference is a bone-only command (Section 4.3); the mesh computed-result commands (`Retriangulate` and friends) arrive in Phase 2 / WP-C.12. `DeleteBone` is split into a Phase 0 bone-only variant and a Phase 1 cascading variant (D8). |
| Invariant: round-trip test mandatory | Section 10 defines the generic harness every command auto-registers with. No command merges without passing it. |
| Invariant: no `any` / no unjustified `as` | All snippets below are strict. The Mutator brand uses a `unique symbol`, not an `as` cast. |

---

## 1. Design overview

The document is owned by a single aggregate, `Document`, that wires together three collaborators with strict, one-directional access:

```
                    UI (React panels, tools, gizmos, Zustand)
                                    |
                       reads via    |    issues commands via
                  DocumentReadModel  |   history.execute(cmd)
                                    v
   +------------------------------ Document -----------------------------+
   |                                                                     |
   |   History  --- hands the privileged Mutator only to --->  Command   |
   |     |                                                       (do/undo)|
   |     | owns past[]/future[], coalescing, sessions                |   |
   |     v                                                          v   |
   |   DocumentModel  <----- mutated ONLY through Mutator ----------+   |
   |     - read API: DocumentReadModel (public, given to UI)            |
   |     - write API: Mutator (private, given only to History)          |
   +---------------------------------------------------------------------+
```

Hard rules encoded by this shape:

1. UI holds a `DocumentReadModel` (read only) and a `History` handle (execute/undo/redo). UI never holds a `Mutator`.
2. A `Command` receives a `Mutator` only because `History` passes it during `do`/`undo`. There is no other source of a `Mutator` in the codebase.
3. `DocumentModel` is immutable to the outside world: its only mutation surface is the `Mutator`, and the `Mutator` is unreachable except from inside a command running under History.

We deliberately refine the handoff's illustrative signature `do(doc: DocumentModel): void` to `do(ctx: CommandContext): void`, where `CommandContext` carries the privileged `Mutator`. The handoff's intent ("mutation methods only ever called from inside Command.do/undo") is preserved and made structural rather than conventional. This refinement is decision D1; the reviewer pre-approved it, and it is recorded for sign-off completeness.

---

## 2. Identity model decision (stable internal IDs)

DECISION (D2): the internal model addresses every entity by a stable, opaque, branded ID assigned at creation. Names (`Bone.name`, `Slot.name`, animation names, event names) are mutable attributes, NOT identities. The format (handoff section 6) references entities by name (`Bone.parent: string`, `Slot.bone: string`); that is the on-disk contract. Internally we use IDs and resolve to names only at export, and mint IDs from names only at import.

Rationale (decision-bearing):

- `RenameBone` becomes a single-field change with zero cascade. If names were identities, a rename would have to rewrite every referencing bone/slot/timeline/constraint, and undo of a rename would be a multi-entity memento. With IDs, rename is one field and trivially reversible.
- Commands reference targets by ID, so a command captured during a drag is still valid after an unrelated rename or reorder in the redo stack.

Name uniqueness is an EXPORT-ONLY contract (D9), not an internal invariant. Internally, names may transiently collide (for example, midway through a rename) and the model stays correct because correctness depends on IDs, never on names. Export (Section 7.1) validates name uniqueness within each namespace and the bone-ordering invariant; a violation is surfaced there as a typed error. The editor-state layer MAY run a non-blocking advisory check that flags a duplicate name in the inspector, but that check never blocks a command and never throws inside History. The hard gate is export. See `findBoneByName` (Section 3.2) for the first-match contract this implies.

Branded ID types (no `any`, no structural collisions between id kinds):

```ts
declare const ID_BRAND: unique symbol;
export type Id<K extends string> = string & { readonly [ID_BRAND]: K };

export type BoneId = Id<'bone'>;
export type SlotId = Id<'slot'>;
export type SkinId = Id<'skin'>;
export type AttachmentId = Id<'attachment'>;
export type AnimationId = Id<'animation'>;
export type EventDefId = Id<'event'>;
export type IkId = Id<'ik'>;
export type TransformConstraintId = Id<'transform'>;
export type KeyframeId = Id<'keyframe'>;
// Phase-scoped ID brands (EmitterId in Phase 3) are declared by their phase, not pre-scaffolded
// here (LAW 5). See WP-C.13. Phase 4 needs no new internal ID brand: its authoring config is keyed
// by SymbolId, which is a packages/format type (CD-1), not an internal DocumentModel ID.

// IDs are minted by a single injected generator (no hidden global, DI per house rules).
export interface IdFactory { mint<K extends string>(kind: K): Id<K>; }
```

ID generation is deterministic-on-demand but unique: a monotonic counter seeded per `Document`, supplied by the injected environment (Section 7.2). IDs are NOT serialized into the format; they are an internal concern. (If a future binary format wants stable IDs across saves, that is a deliberate format version bump under LAW 3, owned by `packages/format`, out of scope here.)

This touches LAW 3 only at the seam: the round-trip property `exportDocument(loadDocument(x))` deep-equals canonical `x` (Section 7.3) must hold despite internal IDs being regenerated on import. Acceptance criteria in WP-C.6 pin this.

---

## 3. DocumentModel design

### 3.1 State shape

`DocumentModel` holds normalized, ID-keyed collections plus the ordered arrays the format requires (bone order, draw order). Entities are plain value structs (no methods, no class identity), which keeps snapshotting cheap and deep-equality meaningful.

```ts
// Internal entity shapes carry an `id` and otherwise mirror format fields by VALUE.
interface BoneEntity {
  id: BoneId;
  name: string;
  parent: BoneId | null;        // ID reference, not name
  length: number;
  x: number; y: number;
  rotation: number;
  scaleX: number; scaleY: number;
  shearX: number; shearY: number;
  transformMode: TransformMode;
}
// SlotEntity, SkinEntity, AttachmentEntity, IkEntity, TransformConstraintEntity,
// EventDefEntity follow the same id-plus-value convention.
//
// AnimationEntity (timelines, keyframes, deform offsets) is INTENTIONALLY left opaque
// here: its internal representation is owned by the timeline subsystem plan
// (docs/plan/modules/timeline.md). This document treats it as an id-bearing value struct
// and pins only three things for its commands: (1) the memento mandate (Section 4.2),
// (2) the coalescing contract per catalog row (Section 11), and (3) auto-registration plus
// the round-trip harness (Section 10). Keyframe/deform internal shape is NOT settled here
// and MUST NOT be assumed by reviewers as decided in this plan.

interface DocState {
  formatVersion: string;
  name: string;
  bones: ReadonlyMap<BoneId, BoneEntity>;
  boneOrder: readonly BoneId[];          // parents precede children (format invariant)
  slots: ReadonlyMap<SlotId, SlotEntity>;
  drawOrder: readonly SlotId[];
  skins: ReadonlyMap<SkinId, SkinEntity>;
  ik: ReadonlyMap<IkId, IkEntity>;
  transforms: ReadonlyMap<TransformConstraintId, TransformConstraintEntity>;
  animations: ReadonlyMap<AnimationId, AnimationEntity>;
  events: ReadonlyMap<EventDefId, EventDefEntity>;   // keyed by ID, not name (Section 2)
  atlas: AtlasRefValue;
  // Phase 4+: slotScene holds the IN-MEMORY SlotScene content plus SceneRefs (handoff 8.10,
  // phase-4 ownership table; format-contract section 15 is the system of record). SlotScene has
  // FIVE members: grid, symbols, winSequencer, featureFlows, and tumble. The tumble member is a
  // deliberate refinement of handoff 8.10, which omitted it (phase-4 section 6.1); SetTumbleChoreography
  // mutates slotScene.tumble. It is command-mutated and undoable. It is NOT a field of the skeleton
  // format root: on save it serializes through its OWN SlotSceneDocument envelope (own
  // slotSceneFormatVersion, own hash), owned by packages/format and the phase-4 plan (Section 7.5).
  // Added by Phase 4, not pre-scaffolded (LAW 5).
}
```

`DocState` is treated as immutable from the outside. Change detection for the whole module is REVISION-BASED, not reference-based: `model.revision` is the single source of truth that "something changed". Two mutation modes exist, and they differ only in allocation strategy, never in observable result:

- DISCRETE mode (the default, used by every standalone `execute`/`undo`/`redo`): a mutation produces a new entity value (or a new order array) and replaces the changed `Map` or array by copy-on-write (unchanged entities shared by reference), then bumps `revision`. This keeps `snapshot()` and undo cheap and allows reference-equality fast paths in selectors.
- BATCH mode (active only between `History.beginInteraction` and `endInteraction`, that is, only during a single user gesture): the model mutates in place and bumps `revision` per mutation. Exactly one copy-on-write boundary is taken at `commitBatch()` (called by `endInteraction`). Two in-place shapes are supported, because a gesture mutates either an entity field or an order array:
  - ENTITY-FIELD batch (bone drag, slider drag, color drag): patch the target entity's fields in place inside the existing `Map` (O(1) allocation per pointer-move, no per-move `Map` clone).
  - ORDER-ARRAY batch (`ReorderSlot`, `ReorderEmitter`, `MoveKeyframe` time, draw-order drag): splice a single mutable working array the model holds for the gesture, exposed outward as `readonly`, instead of allocating a fresh `readonly` array on every pointer-move (O(1) amortized per move, no per-move array realloc).
  Mementos are unaffected in both shapes because they are deep value copies captured by the command (Section 4.2), never references into the live `Map` or live working array.

This BATCH path is decision D10. It exists specifically to honor the 60fps / no-per-frame-allocation invariant during interactive drags, where the discrete path would clone the entire collection (O(n)) on every pointer-move. Structural sharing via a persistent map was considered and deferred: it adds a dependency or a custom HAMT for an O(log n) win that BATCH mode already reduces to O(1) for the only hot cases (single-gesture field and order drags). The viewport never reads entity reference identity; it subscribes to `revision` and redraws on the next `requestAnimationFrame`, so in-place patching is invisible to it.

`DocumentModelInternal` (write-capable, never exported through the barrel) exposes `beginBatch()` and `commitBatch()`; only `History` calls them, from `beginInteraction`/`endInteraction`.

### 3.2 Read model (public surface given to UI and to commands)

```ts
export interface DocumentReadModel {
  readonly revision: number;                 // bumps on every applied mutation (discrete or in-batch)
  getBone(id: BoneId): BoneEntity | undefined;
  bones(): readonly BoneEntity[];            // in boneOrder
  getSlot(id: SlotId): SlotEntity | undefined;
  slots(): readonly SlotEntity[];            // in drawOrder
  getAnimation(id: AnimationId): AnimationEntity | undefined;
  // ...query accessors only; NO method returns a mutable reference into DocState.
  findBoneByName(name: string): BoneEntity | undefined;  // for import/UI lookups
  snapshot(): DocSnapshot;                    // canonical, deep-equality comparable
}
```

`findBoneByName` contract (D9 consequence): returns the FIRST bone in `boneOrder` whose `name` equals the argument, or `undefined` if none matches. It never throws. Because names are not internally unique, callers that require a single match (import, where format names are guaranteed unique by validation) get a deterministic first-in-order result; callers in the UI (a name-typed lookup field) accept first-match semantics. It is never used for correctness-critical resolution inside a command; commands address targets by ID.

All accessors return frozen value copies or `readonly` views. No accessor leaks a handle that lets the caller mutate `DocState`. This is verified by a test that mutates a returned object and asserts the model snapshot is unchanged (WP-C.1 acceptance).

### 3.3 Mutator (privileged write surface)

The `Mutator` extends the read model with write methods and is reachable only through a brand that only `Document` can produce.

```ts
declare const MUTATOR_BRAND: unique symbol;

export interface Mutator extends DocumentReadModel {
  readonly [MUTATOR_BRAND]: true;            // unforgeable witness; no `as` can fabricate it
  insertBone(entity: BoneEntity, index: number): void;
  removeBone(id: BoneId): void;
  patchBone(id: BoneId, patch: Partial<Omit<BoneEntity, 'id'>>): void;
  setBoneOrder(order: readonly BoneId[]): void;
  // slot/skin/attachment/animation/keyframe/constraint mutators: one per primitive operation.
}

// Only this factory, internal to the `document` module, can produce a Mutator.
// `History` receives it at construction; nothing else imports it.
export function createMutator(model: DocumentModelInternal): Mutator { /* ... */ }
```

Why a `unique symbol` brand and not just convention: a `Mutator` cannot be produced by `someObject as Mutator` because TypeScript will not let you satisfy `[MUTATOR_BRAND]: true` without the symbol, which is not exported. UI code that tries to fabricate one fails to compile. This is the structural half of LAW 2 enforcement; the lint rule (Section 9.2) is the defensive second half.

### 3.4 snapshot() and canonical equality

`snapshot()` returns a `DocSnapshot`: a plain, JSON-serializable, deterministically-ordered projection of the full internal state INCLUDING internal IDs. It is the object the round-trip harness deep-compares.

Rules:
- Maps serialize as arrays sorted by ID. Order-significant arrays (`boneOrder`, `drawOrder`, keyframe lists) preserve their order.
- Numeric fields are emitted verbatim (no rounding). Because undo restores stored mementos (Section 4.2), the round-trip is bit-exact and needs no epsilon.
- `snapshot()` must be pure and allocation-bounded; it is called in tests, never in the 60fps solve/render loop.

`DocSnapshot` is distinct from the format projection (`SkeletonDocument`): the snapshot keeps internal IDs and exists for deep-equality in tests; the format projection resolves IDs to names (Section 7). They are different serialization contracts and never interchange.

### 3.5 Invariant guard

`assertInvariants(model)` (dev/test only, behind a flag, never in the render loop) checks: bone order has parents before children; no dangling ID references (every `parent`, `slot.bone`, timeline target, constraint target resolves to an existing entity); draw order is a permutation of the slot IDs. It does NOT check name uniqueness, because name uniqueness is an export-only contract (D9) and a transient name collision is a legal internal state. The round-trip harness runs `assertInvariants` after every do and every undo. A violated invariant is a typed error `DocumentInvariantError`, never a thrown string.

---

## 4. Command interface

### 4.1 Contract

```ts
export interface CommandContext {
  readonly mutate: Mutator;        // privileged; the ONLY mutation surface a command sees
  readonly ids: IdFactory;         // for commands that create entities
}

export interface Command {
  readonly kind: string;           // stable discriminant, e.g. 'bone.move' (used by registry + telemetry)
  readonly label: string;          // human label for the undo menu (no em-dashes)
  do(ctx: CommandContext): void;
  undo(ctx: CommandContext): void;
  // Coalescing: if THIS command can absorb `prev` into one undo step, return the merged
  // command; otherwise return null. Same kind + same target only. See Section 5.3.
  coalesceWith?(prev: Command): Command | null;
  // Optional read-only UX hint, resolved PER history phase. NEVER written into the document.
  // History calls this in commit() and puts the result on HistoryEvent.selectionHint (Section 5.1).
  // A delete returns its parent (or clear) on 'execute'/'redo' and the restored entity on 'undo';
  // a create does the reverse. See Section 8 for the full semantics.
  selectionHint?(phase: HistoryPhase): SelectionHint | undefined;
}

export type HistoryPhase = 'execute' | 'undo' | 'redo';
```

The selection hint type is small and explicit. It carries ENTITY REFERENCES (internal ID plus entity kind so the non-undoable selection store can route each one), never document data:

```ts
export type EntityRef =
  | { readonly type: 'bone'; readonly id: BoneId }
  | { readonly type: 'slot'; readonly id: SlotId }
  | { readonly type: 'keyframe'; readonly id: KeyframeId };
  // extended per phase as new selectable entity kinds land (constraints in Phase 2, etc.)

export type SelectionHint =
  | { readonly kind: 'select'; readonly entities: readonly EntityRef[] }  // select exactly these
  | { readonly kind: 'clear' }                                            // clear the selection
  | { readonly kind: 'preserve' };                                        // leave selection as-is
```

`'preserve'` and `undefined` are equivalent intent ("do not touch selection"); a command that omits `selectionHint` is treated as `'preserve'`. The distinction exists so a command can be explicit that it intends no selection change (for example, a slider drag), separating that from "feature not implemented".

### 4.2 Memento mandate (decision D3)

Commands are MEMENTO-BASED, not inverse-operation-based. A command captures the exact prior value(s) it will overwrite (its "before" memento) and the exact new value(s) (its "after" memento), both as deep value copies. `undo` writes the before memento back verbatim; `do` writes the after memento. Commands do NOT recompute the inverse by negating a delta.

Why: bit-exact reversibility is guaranteed without floating-point drift, which is what makes the round-trip deep-equal test (Section 10) achievable as an exact equality rather than an epsilon comparison. A `MoveBone` that stored `+dx` and undid with `-dx` would accumulate error across coalesced drags; storing absolute before/after does not. Because mementos are deep value copies (not references into the live `Map`), BATCH-mode in-place mutation (Section 3.1) cannot corrupt a captured memento.

Mementos are captured at the moment of first `do` (lazy capture from current state), not at construction, so a command authored before other edits still captures the correct prior state. Example primitive:

```ts
export class MoveBoneCommand implements Command {
  readonly kind = 'bone.move';
  readonly label = 'Move Bone';
  private before?: { x: number; y: number };
  constructor(
    private readonly target: BoneId,
    private readonly after: { x: number; y: number },
  ) {}

  do(ctx: CommandContext): void {
    if (!this.before) {
      const b = ctx.mutate.getBone(this.target);
      if (!b) throw new CommandTargetMissingError(this.kind, this.target);
      this.before = { x: b.x, y: b.y };            // deep value copy
    }
    ctx.mutate.patchBone(this.target, { x: this.after.x, y: this.after.y });
  }
  undo(ctx: CommandContext): void {
    if (!this.before) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.patchBone(this.target, { x: this.before.x, y: this.before.y });
  }
  coalesceWith(prev: Command): Command | null {
    if (prev instanceof MoveBoneCommand && prev.target === this.target) {
      const merged = new MoveBoneCommand(this.target, this.after);
      merged.before = prev.before;     // keep the ORIGINAL before (pre-gesture)
      return merged;                   // after = latest position
    }
    return null;
  }
}
```

Typed errors used above (`CommandTargetMissingError`, `CommandNotAppliedError`, `DocumentInvariantError`) are members of a `DocumentError` discriminated union; no bare strings, no `catch (e: any)`.

### 4.3 Computed-result commands (after-memento captured on first `do`)

Some commands cannot know their `after` value at construction because it is computed from current state (a recomputed local transform, a normalized rotation, re-triangulation output, normalized weights). For these, the `after` memento is COMPUTED ONCE during the first `do`, STORED, and REPLAYED on redo. Redo MUST replay the stored result, not recompute from current state, otherwise redo could diverge from the original do.

The Phase 0 reference for this pattern is a bone-only command (LAW 5: Phase 0 has no mesh, so the mesh computed-result commands cannot be the reference). `NormalizeBoneRotation` wraps a bone's rotation into a canonical range, computing its `after` from current state:

```ts
export class NormalizeBoneRotationCommand implements Command {
  readonly kind = 'bone.rotation.normalize';
  readonly label = 'Normalize Bone Rotation';
  coalesceWith = undefined;                        // structural, never coalesces
  private before?: number;
  private after?: number;                          // computed on first do, then replayed verbatim
  constructor(private readonly target: BoneId) {}

  do(ctx: CommandContext): void {
    const bone = ctx.mutate.getBone(this.target);
    if (!bone) throw new CommandTargetMissingError(this.kind, this.target);
    if (this.after === undefined) {
      this.before = bone.rotation;                 // value copy
      this.after = wrapDegrees(bone.rotation);     // compute ONCE from current state
    }
    ctx.mutate.patchBone(this.target, { rotation: this.after }); // do AND redo write the stored result
  }
  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.patchBone(this.target, { rotation: this.before });
  }
}

// Pure helper (no I/O, no clock): wraps degrees into [-180, 180).
function wrapDegrees(deg: number): number {
  const m = ((deg + 180) % 360 + 360) % 360;
  return m - 180;
}
```

The redo-replays-stored property is what the WP-C.3 acceptance pins: undo, then mutate the bone's rotation by an unrelated edit, then redo, and redo still writes the originally-computed `after`, not `wrapDegrees` of the new value.

The heavyweight production instances of this pattern (`Retriangulate`, `NormalizeWeights`, `SetMaxInfluences`, `BindMeshToBones`) all operate on mesh attachments, which do not exist until Phase 2; they are delivered in WP-C.12 and follow the exact same shape (`before` and `after` are full-array value copies; `after` computed once and replayed on redo). They are NOT implemented in Phase 0.

`ReparentBone` (Section 11, Phase 1) is a related but distinct case: it precomputes its `after` OUTSIDE the command. The reparent tool uses `runtime-core` affine math to compute the new local transform that keeps the world transform stable, and passes it to the command constructor as the absolute `after`. The command stores `before` = (old parent, old local) and `after` = (new parent, precomputed new local). `do` writes the stored `after`; it never recomputes. This keeps the command free of `runtime-core` if the tool precomputes, and it keeps redo deterministic.

### 4.4 Primitive vs composite

- PRIMITIVE command: mutates one entity along one logical channel (one bone's translation, one slot's color, one keyframe's value). A primitive may carry a multi-entity SET memento (for example, a subtree delete) and still be a single command; it is not a `CompositeCommand`. Primitives are the only commands that may coalesce.
- COMPOSITE command: an ordered list of children. `do` runs children forward; `undo` runs them in reverse. Composites never coalesce (they push exactly one undo entry). They are the composition primitive for multi-step operations.

```ts
export class CompositeCommand implements Command {
  readonly kind = 'composite';
  coalesceWith = undefined;
  constructor(
    readonly label: string,
    private readonly children: readonly Command[],
    private readonly hint?: (phase: HistoryPhase) => SelectionHint | undefined,
  ) {}
  do(ctx: CommandContext): void { for (const c of this.children) c.do(ctx); }
  undo(ctx: CommandContext): void { for (let i = this.children.length - 1; i >= 0; i--) this.children[i].undo(ctx); }
  // A macro provides its own hint (e.g. a riders-delete reselects the restored root bone on undo);
  // when omitted, the composite preserves selection.
  selectionHint(phase: HistoryPhase): SelectionHint | undefined { return this.hint?.(phase); }
}
```

Example composite, "Create bone with attachment" (handoff 8.1 "create bone with attachment is a composite of primitive ones"). NOTE: this macro is a PHASE 1 illustration, not a Phase 0 deliverable: it uses `CreateSlot`, `AddRegionAttachment`, and `SetActiveAttachment`, which act on slot and attachment entities that do not exist until Phase 1. It is shown here only to demonstrate composition.

```ts
// Phase 1 illustration (slots/attachments are Phase 1 entities).
function createBoneWithRegion(parent: BoneId, geom: BoneGeometry, region: RegionSpec, ids: IdFactory): CompositeCommand {
  const boneId = ids.mint('bone');
  const slotId = ids.mint('slot');
  const attId = ids.mint('attachment');
  return new CompositeCommand('Create Bone With Attachment', [
    new CreateBoneCommand(boneId, parent, geom),
    new CreateSlotCommand(slotId, boneId),
    new AddRegionAttachmentCommand(attId, slotId, region),
    new SetActiveAttachmentCommand(slotId, attId),
  ], (phase) => phase === 'undo'
      ? { kind: 'clear' }
      : { kind: 'select', entities: [{ type: 'bone', id: boneId }] });
}
```

The composite's round-trip test (Section 10) exercises the whole macro; each child also has its own primitive round-trip test. Both are required.

---

## 5. History

### 5.1 Class

The handoff's `History` is the starting point; we harden it with dependency-injected time (deterministic tests), explicit interaction sessions that coalesce mementos, bounded depth, change notification that carries the applied command, a single-source default policy, a commit re-entrancy guard, and a precise definition of "committed". No hidden globals: the clock is injected, never read from `performance.now` inside this module.

```ts
// Single source of truth for the two tunables. Both DocumentEnvironment and HistoryDeps
// FORWARD optional overrides; History is the ONLY place a default is applied.
export const HISTORY_DEFAULTS = { maxDepth: 500, coalesceWindowMs: 250 } as const;

export interface HistoryEvent {
  readonly phase: HistoryPhase;
  readonly kind: string;
  readonly label: string;
  readonly selectionHint?: SelectionHint;     // RESOLVED for this phase; the UI reads it to reselect
}

export interface HistoryDeps {
  readonly model: DocumentModelInternal;
  readonly now: () => number;                 // injected at the composition root; no default here
  readonly maxDepth?: number;                 // override only; default from HISTORY_DEFAULTS
  readonly coalesceWindowMs?: number;         // override only; default from HISTORY_DEFAULTS
}

export class History {
  private past: Command[] = [];
  private future: Command[] = [];
  private readonly mutator: Mutator;
  private readonly ctx: CommandContext;
  private readonly windowMs: number;
  private readonly maxDepth: number;
  private lastAt = 0;
  private session: Command[] | null = null;   // non-null while inside begin/endInteraction
  private notifying = false;                   // commit re-entrancy guard
  private listeners = new Set<(e: HistoryEvent) => void>();

  constructor(private readonly deps: HistoryDeps) {
    this.mutator = createMutator(deps.model);
    this.ctx = { mutate: this.mutator, ids: deps.model.ids };
    this.windowMs = deps.coalesceWindowMs ?? HISTORY_DEFAULTS.coalesceWindowMs;
    this.maxDepth = deps.maxDepth ?? HISTORY_DEFAULTS.maxDepth;
  }

  // COMMITTED is defined precisely: a call that mutates committed state and updates the
  // undo stacks. Discrete execute (push or window-merge), endInteraction (push), undo, and
  // redo are committed and fire exactly one HistoryEvent. In-session execute is NOT committed
  // (it only bumps model.revision for live feedback) and fires no HistoryEvent.
  execute(cmd: Command): HistoryEvent | null {
    cmd.do(this.ctx);                          // applies mutation; bumps model.revision
    if (this.session) { this.coalesceIntoSession(cmd); return null; }
    const now = this.deps.now();
    const prev = this.past[this.past.length - 1];
    if (prev && cmd.coalesceWith && now - this.lastAt < this.windowMs) {
      const merged = cmd.coalesceWith(prev);
      if (merged) this.past[this.past.length - 1] = merged;
      else this.past.push(cmd);
    } else {
      this.past.push(cmd);
    }
    this.future.length = 0;                    // new action clears redo
    this.lastAt = now;
    this.enforceDepth();
    return this.commit('execute', cmd);
  }

  beginInteraction(): void {
    this.session = [];
    this.deps.model.beginBatch();              // switch to in-place mutation for this gesture
  }
  endInteraction(label: string): HistoryEvent | null {
    const batch = this.session ?? [];
    this.session = null;
    this.deps.model.commitBatch();             // single copy-on-write boundary, exit batch mode
    if (batch.length === 0) return null;
    const entry = batch.length === 1 ? batch[0] : new CompositeCommand(label, batch);
    this.past.push(entry);                     // exactly ONE undo step for the whole gesture
    this.future.length = 0;
    this.lastAt = this.deps.now();
    this.enforceDepth();
    return this.commit('execute', entry);
  }

  undo(): HistoryEvent | null {
    const cmd = this.past.pop();
    if (!cmd) return null;
    cmd.undo(this.ctx);
    this.future.push(cmd);
    return this.commit('undo', cmd);
  }
  redo(): HistoryEvent | null {
    const cmd = this.future.pop();
    if (!cmd) return null;
    cmd.do(this.ctx);
    this.past.push(cmd);
    return this.commit('redo', cmd);
  }

  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  get undoLabel(): string | null { return this.past.at(-1)?.label ?? null; }
  get redoLabel(): string | null { return this.future.at(-1)?.label ?? null; }

  // Commit channel: fires exactly once per committed execute/undo/redo. Carries the applied
  // command's hint, resolved for this phase, so the UI can reselect after undo/redo (Section 8).
  subscribe(fn: (e: HistoryEvent) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  private coalesceIntoSession(cmd: Command): void {
    // Merge with the most recent same-kind/same-target command already in the session, so a
    // 1000-move single-target drag keeps ONE memento; a multi-target box-select keeps one per
    // distinct target. coalesceWith returns null on a different target, so the search is bounded
    // by the number of distinct targets in the gesture, not by pointer-move count.
    if (cmd.coalesceWith) {
      for (let i = this.session!.length - 1; i >= 0; i--) {
        const merged = cmd.coalesceWith(this.session![i]);
        if (merged) { this.session![i] = merged; return; }
      }
    }
    this.session!.push(cmd);
  }
  private commit(phase: HistoryPhase, cmd: Command): HistoryEvent {
    // Re-entrancy guard: a listener that triggers a nested mutation would corrupt the stacks.
    // Listeners MUST NOT call execute/undo/redo; doing so is a typed error, not undefined behavior.
    if (this.notifying) throw new HistoryReentrancyError(cmd.kind);
    const event: HistoryEvent = {
      phase, kind: cmd.kind, label: cmd.label, selectionHint: cmd.selectionHint?.(phase),
    };
    this.notifying = true;
    try { for (const l of this.listeners) l(event); }
    finally { this.notifying = false; }
    return event;
  }
  // O(n) on the rare drop at the bound (only when past exceeds maxDepth). Acceptable because
  // drops happen at most once per committed action past the cap, never in the render loop. A
  // ring buffer is the noted future optimization if profiling ever shows it matters.
  private enforceDepth(): void { while (this.past.length > this.maxDepth) this.past.shift(); }
}
```

Two notification channels exist, with non-overlapping consumers (this resolves the prior ambiguity):

| Channel | Fires on | Consumer | Purpose |
|---|---|---|---|
| `model.revision` | EVERY applied mutation (discrete and in-session) | Viewport renderer | Live redraw (batched to `requestAnimationFrame`). The drag must feel continuous, so this fires per pointer-move. |
| `history.subscribe(HistoryEvent)` | EXACTLY once per committed execute/undo/redo (never during a session) | editor-state (undo menu, selection reconciliation, selectionHint application) | Discrete commit events, one per logical undo step. |

In-session execute does not fire the commit channel, so a drag fires the commit channel exactly once (at `endInteraction`), satisfying "subscribe fires exactly once per committed execute/undo/redo" while still driving live feedback through `model.revision`.

### 5.2 Two coalescing mechanisms (decision D4)

We support BOTH, with explicit precedence:

1. PRIMARY: explicit interaction sessions (`beginInteraction` / `endInteraction`). Tools that have a clear gesture boundary (gizmo drag, weight-paint stroke, vertex drag, slider drag with `pointerdown`/`pointerup`) wrap the gesture in a session. Every command issued during the session is applied immediately (live feedback) and COALESCED into the session by same-kind/same-target merge (`coalesceIntoSession`), so the stored mementos collapse to one per distinct target regardless of move count. At `endInteraction` the session becomes exactly one undo step. This is deterministic and independent of timing.
2. FALLBACK: time-window coalescing (`coalesceWith` + the injected clock against `coalesceWindowMs`). For rapid edits without a clean gesture boundary (holding an arrow key to nudge, repeated mouse-wheel value steps), commands of the same `kind` + same target merge if they arrive inside the window.

Tools MUST prefer mechanism 1 when a gesture boundary exists. Mechanism 2 is a usability backstop, not the default. Reviewer rule: a drag tool that relies on the time window instead of a session is a review reject (timing-dependent undo granularity is a bug).

The session path is what makes the memory bound real: collapsing mementos in `coalesceIntoSession` is the fix for "1000 mementos inside one composite". The acceptance for this is WP-C.15 (memento count, not `past`-entry count).

### 5.3 The before/after memento rule under coalescing

When `B.coalesceWith(A)` produces a merged command, the merged command MUST keep `A`'s before memento and `B`'s after memento. Undo of the merged step returns to the state before `A` (the start of the gesture); redo reapplies `B`'s final state. The `MoveBoneCommand.coalesceWith` in Section 4.2 demonstrates this. This rule is verified by WP-C.5's coalescing test: N coalesced moves then one undo deep-equals the pre-first-move snapshot.

---

## 6. Coalescing strategy with worked examples

| Scenario | Mechanism | Commands fired | Stored mementos | Undo steps after | Verified by |
|---|---|---|---|---|---|
| Drag a bone across the viewport | Session (pointerdown -> begin, pointermove -> N x MoveBone, pointerup -> end "Move Bone") | N | 1 (single target) | 1 | WP-C.5 TASK-C5.1 |
| Rotate via gizmo | Session, N x RotateBone | N | 1 | 1 | WP-C.5 TASK-C5.2 |
| Weight-paint stroke | Session (brush down -> begin, each dab -> PaintWeights, brush up -> end "Paint Weights") | N dabs | 1 per painted vertex set, merged per stroke | 1 | WP-C.5 TASK-C5.3 |
| Timeline scrub then nudge a keyframe value | Session per drag of the value handle | N | 1 | 1 per handle drag | WP-C.5 TASK-C5.4 |
| Drag a keyframe in time (dopesheet) | Session, N x MoveKeyframe (order-array batch) | N | 1 | 1 | WP-C.5 TASK-C5.5 |
| Hold Up-arrow to nudge a numeric field +0.1 repeatedly | Time-window (no gesture boundary), same kind+target inside the window | N | 1 (merged) | 1 (while held within window) | WP-C.5 TASK-C5.6 |
| Type "45" into rotation field (3 keystrokes commit one value) | Single command on commit (blur/Enter), not per-keystroke | 1 | 1 | 1 | WP-C.5 TASK-C5.7 |
| Two different bones moved in one box-select drag | Session wrapping both, collapses to a CompositeCommand | 2N | 2 (one per target) | 1 | WP-C.5 TASK-C5.8 |
| Move bone, wait past the window, move same bone again | Time-window expired between gestures (and no session), two entries | 2 | 2 | 2 | WP-C.5 TASK-C5.9 |
| Slider drag for IK mix | Session, N x SetIkMix | N | 1 | 1 | WP-C.5 TASK-C5.10 |

Non-coalescing by mandate: structural commands (Create*, Delete*, Reparent*, Rename*, NormalizeBoneRotation, Retriangulate, BindMeshToBones, draw-order reorder add/remove, add/remove attachment) and all computed-result commands. These always push their own undo step. Coalescing structural creates would make undo unpredictable.

Cross-target guard: `coalesceWith` returns `null` whenever target ID or channel differs. A `MoveBone(A)` followed by `MoveBone(B)` does not merge. Verified by WP-C.5 TASK-C5.11.

---

## 7. Serialization, snapshot, save/load

### 7.1 Save (export to format)

- `exportDocument(model): SkeletonDocument` projects internal skeleton state to the format in handoff section 6: resolve `BoneId` references to bone names, emit `boneOrder` as the ordered `bones[]` array, emit `drawOrder` as setup-pose slot order, set `formatVersion`, and set `hash` LAST via `computeContentHash` from `packages/format` (Section 7.3). It does NOT serialize the slot scene; that is a separate envelope (Section 7.5).
- Export runs `validateDocument()` from `packages/format` (Zod / JSON Schema) on its own output before returning. Export that produces an invalid document throws `ExportValidationError` (LAW 3: fail loudly).
- Export asserts the bone-ordering invariant (parents precede children) and name uniqueness within each namespace (D9: this is THE place uniqueness is enforced). A violation is a bug in a command, surfaced here as a typed error, not silently shipped.

### 7.2 Load (import from format) with injected environment

Load and the `Document` factory take an injected environment so the clock and ID generator are never hidden globals (this is the most important seam; making it deterministic is required for testable load-path history).

```ts
export interface DocumentEnvironment {
  readonly now: () => number;          // injected clock for History
  readonly createIds: () => IdFactory; // fresh, per-Document monotonic counter
  readonly maxDepth?: number;          // forwarded to History (override only; default in HISTORY_DEFAULTS)
  readonly coalesceWindowMs?: number;  // forwarded to History (override only; default in HISTORY_DEFAULTS)
}

export function loadDocument(json: unknown, env: DocumentEnvironment): Document {
  // 1. validateDocument(json)          // Zod parse at the boundary; reject malformed loudly (LAW 3)
  // 2. const ids = env.createIds();    // fresh ID factory for this Document
  // 3. mint internal IDs for every entity; build name -> Id maps
  // 4. resolve name references (parent, slot.bone, targets) to IDs
  // 5. construct DocumentModelInternal from the resolved DocState, seeded with `ids`
  // 6. construct a FRESH History({ model, now: env.now, maxDepth, coalesceWindowMs }) (empty stacks)
  // 7. return Document { model, history }
}

export function createDocument(state: DocState, env: DocumentEnvironment): Document {
  // Same as loadDocument steps 5..7 for an already-resolved DocState (used by tests/new-doc).
}
```

The ONE place `performance.now` and the concrete counter `IdFactory` are constructed is the app composition root (`apps/editor/src/renderer/composition-root.ts`). It builds the single production `DocumentEnvironment` and passes it into `loadDocument`/`createDocument`. Tests inject a fake clock and a deterministic `IdFactory`, so load-path history is fully reproducible. No code inside `document/**` reads `performance.now`.

Load is NOT a command and is NOT undoable. It produces a fresh `Document` with empty history; after load, `history.canUndo === false`. This matches handoff 8.1 ("Loading rebuilds it and resets History").

### 7.3 Canonical form, hash domain, and the round-trip property (LAW 3 seam, consumed from packages/format)

The round-trip property is the LAW 3 fidelity guarantee. The canonical form and the content hash are OWNED by `packages/format` (`format-contract.md` section 9). This module CONSUMES them; it does NOT define or duplicate them. There is exactly one canonicalizer and one hash function in the repo, in `packages/format`, so the editor, `runtime-web`, and `packages/conformance` all produce byte-identical results. A second copy in the editor is precisely the cross-package drift LAW 3 exists to prevent.

CANONICAL FORM (owned by `packages/format`, restated for reference only): object keys sorted ascending; arrays preserve element order (order is semantic for `bones`, `slots`, keyframe lists, draw order); numbers serialized by the standard JS `JSON.stringify` rule with `-0` normalized to `0`; no insignificant whitespace; the `hash` field is REMOVED (the key is deleted, not set to a placeholder) before serialization. The optional-field policy (a field absent on valid input stays absent on output; any import-time default is applied once and then always present on export) is likewise owned and tested by `packages/format`.

HASH DOMAIN (consumed). The content hash is whatever `packages/format` computes. The editor calls the format package directly:

```ts
import { computeContentHash, verifyContentHash } from '@marionette/format';
// computeContentHash(doc): canonical JSON over the document with the `hash` key REMOVED,
//   SHA-256 (via @noble/hashes/sha256), lowercase hex (64 chars). Ignores any existing doc.hash.
// verifyContentHash(doc): doc.hash === computeContentHash(doc).
```

`exportDocument` sets `hash` last by calling `computeContentHash(doc)`. It never canonicalizes or hashes by its own rule. Because committed fixtures carry the hash produced by this same function, the round-trip holds.

ROUND-TRIP PROPERTY. For every committed canonical fixture R (the `packages/format` golden corpus, `minimal.json` and `rig.json` from WP-F.10):

```
exportDocument(loadDocument(R, env)) deep-equals R
```

This holds because load mints internal IDs and resolves names, export resolves IDs back to the same names (names are stable through the round-trip), arrays are re-emitted in the preserved `boneOrder`/`drawOrder`, no new defaults are introduced (R already canonical), key order is canonical on both sides (the format canonicalizer governs both), and `hash` is recomputed by `computeContentHash` (equal to R's stored hash). The WP-C.6 meta-test asserts, for every committed fixture, `verifyContentHash(R) === true` (the fixture carries the format's hash) so the round-trip acceptance is well founded. The editor does not assert canonical key order itself; that is `packages/format`'s own test (WP-F.7), consumed here.

### 7.4 Document ownership and load-time swap

A single `DocumentHost` owns the current `Document`. `loadDocument` produces a NEW `Document` (fresh model, fresh History); the host swaps it atomically and notifies subscribers so they can rebind their per-Document subscriptions. This makes the orphaning of old subscribers explicit and recoverable rather than accidental.

```ts
export interface DocumentHost {
  current(): Document;
  load(json: unknown): void;                         // validate -> build via env -> swap -> notify
  subscribe(fn: (doc: Document) => void): () => void; // fires on every swap with the new Document
}
```

Swap protocol (checklist, enforced by WP-C.6 and WP-C.8):
- [ ] The host holds the single mutable reference to the current `Document`. No other module caches a long-lived `Document`, `model`, or `History` reference across a load.
- [ ] On `load`, the host builds the new `Document` via the injected `DocumentEnvironment`, replaces `current()`, then fires its swap event.
- [ ] editor-state subscribes to the HOST. On swap it: clears the selection store (selection IDs from the old document do not resolve in the new one), disposes its old `history.subscribe` and `model.revision` subscriptions, and re-subscribes to the new `Document`'s channels.
- [ ] The viewport subscribes to the HOST and rebinds its `model.revision` redraw subscription on swap.

### 7.5 The slot scene serializes as its own envelope (Phase 4, format-owned)

The Phase 4 slot scene is held in memory at `DocState.slotScene` (a `SlotScene` plus `SceneRefs`) and is command-mutated and undoable like any other document content. It is NOT a field of the skeleton format root. On save it serializes through its OWN versioned envelope, `SlotSceneDocument`, with its own `slotSceneFormatVersion`, its own hash, and its own validator. That envelope, its canonical form, and its hash are OWNED by `packages/format` and specified by `docs/plan/phase-4-slot-composer.md` (section 6.1, the ownership table in its section about type placement, and WP-4.4). This module consumes them; it does not define them.

Concretely, the editor exposes a second projection alongside `exportDocument`:

```ts
// Phase 4. Projects the in-memory SlotScene to its on-disk envelope. The envelope shape,
// its canonicalizer, and computeSlotSceneHash live in packages/format (phase-4 WP-4.4),
// not here. This module only resolves internal IDs/refs and calls the format package.
export function exportSlotScene(model): SlotSceneDocument;   // own version + own hash (format-owned)
```

There are therefore TWO independent round-trip properties, both required from Phase 4 onward:
- SKELETON: `exportDocument(loadDocument(R, env))` deep-equals R (Section 7.3), over the `packages/format` skeleton corpus.
- SLOT SCENE: `exportSlotScene(loadSlotScene(S, env))` deep-equals S, over the `packages/format` / `packages/conformance` slot-scene corpus (`*.slotscene.json`, phase-4 WP-4.4 / conformance WP-V.5). The envelope hash is verified by the format package's own `SlotSceneDocument` validator (phase-4 section 6.1.1), not re-implemented here. No engine output (`SpinResult`, `initialGrid`, board contents) ever enters either envelope (phase-4 section 6.3); the slot commands store geometry and timing only (Section 11 LAW 1 callout).

WP-C.14 verifies the slot-scene round-trip and that no outcome value is serialized; the envelope contract itself is gated by phase-4 WP-4.4 / WP-4.12.

### 7.6 Autosave / crash recovery (explicitly out of Phase 0)

Autosave is REMOVED from this module's Phase 0 scope (D5). The prior plan shipped a write-only snapshot with deferred recovery, which is dead code and exactly the scaffolding-without-use LAW 5 warns against. When autosave is added (a later phase), it requires its own contract, separate from the format, because `snapshot()` includes internal IDs: a recovery file is a `DocSnapshot` serialization, which needs its own schema and its own version number, validated on recovery. That contract is specified at the time the feature lands, not pre-scaffolded now. The History stack is NOT persisted across restart regardless (undo history does not survive a restart; recorded here so it is not re-litigated).

---

## 8. Selection and transient state stay OUT of the document

Per handoff 8.2, the wall between document state and editor state is mandatory.

| State | Home | Undoable | Saved | Keyed by |
|---|---|---|---|---|
| bones, slots, skins, attachments, constraints, animations, events, atlas | DocumentModel / format | Yes (commands) | Yes (skeleton format) | internal IDs |
| slotScene (Phase 4) | DocumentModel | Yes (commands) | Yes, via the separate `SlotSceneDocument` envelope (Section 7.5), own version + hash | internal IDs |
| selection (bones/slots/keyframes selected) | Zustand | No | No (session only) | internal IDs |
| active tool, camera pan/zoom, playback position, which animation is open, panel layout | Zustand | No | layout prefs only | n/a |

Rules:
- Selecting a bone is NOT a command. Moving a bone IS. A command must never read or write Zustand; a Zustand store must never call a `Mutator`.
- Selection is keyed by internal ID, so it survives renames and reorders.
- RECONCILIATION channel: editor-state subscribes to `history.subscribe` (the commit channel, Section 5.1), and on each `HistoryEvent` prunes any selected ID that no longer resolves in `model`. This handles undo of a `CreateBone` that would otherwise leave a stale selection. Reconciliation lives in editor-state, never in the document.

SELECTION HINT and its per-phase semantics (the previously undefined load-bearing type, now pinned). A command may expose `selectionHint(phase)`. History resolves it in `commit()` for the actual phase and puts the result on the `HistoryEvent`. editor-state applies it through the non-undoable selection store. The hint is metadata on the command object, never written into `DocState`.

The phase argument is mandatory because a single static hint cannot serve both directions of a structural edit. The two canonical cases:

| Command | `selectionHint('execute')` and `('redo')` | `selectionHint('undo')` |
|---|---|---|
| `CreateBone` | `select` the new bone | `clear` (the new bone no longer exists; reconciliation also prunes it) |
| `DeleteBone` / `DeleteBoneAndRiders` | `select` the parent (or `clear` if it was a root) | `select` the restored bone (reselect what undo brought back) |

Reference implementation for a delete (it captured the deleted bone id and its parent id in its memento, so the hint resolves correctly per phase):

```ts
selectionHint(phase: HistoryPhase): SelectionHint | undefined {
  switch (phase) {
    case 'undo':
      return { kind: 'select', entities: [{ type: 'bone', id: this.deletedBoneId }] };
    case 'execute':
    case 'redo':
      return this.parentId
        ? { kind: 'select', entities: [{ type: 'bone', id: this.parentId }] }
        : { kind: 'clear' };
  }
}
```

This is what makes "undoing a delete reselects the restored bone" implementable and verifiable (WP-C.8). Without the applied command (and its phase-resolved hint) being surfaced on `HistoryEvent`, the undo of a `DeleteBone` could not reselect the restored bone.

---

## 9. Enforcement: "all mutations are commands"

Defense in depth, three layers, all required for merge.

### 9.1 Structural (compile-time, primary, for both LAW 2 and LAW 1)

LAW 2: the `Mutator` brand (`unique symbol`, Section 3.3) makes it impossible to call a mutation method without a `Mutator`, and impossible to obtain a `Mutator` except from `History`. UI code that imports the model gets `DocumentReadModel`, which has no write methods. Most bypass attempts fail to compile.

LAW 1: a command's `CommandContext` carries exactly two things, a `Mutator` and an `IdFactory` (Section 4.1). It has no parameter, field, or ambient handle that could carry a `SpinResult`, a board (`initialGrid`/`grid`), RNG state, or any outcome value. A command therefore CANNOT read or influence an outcome, because at runtime it never receives one. This structural absence is the real LAW 1 guarantee for the command layer, and it is stronger than any name-based check. The lint denylist below is the backstop against an import sneaking an outcome type into a command file for some other reason.

### 9.2 Lint boundary rule (static, secondary)

Add `eslint-plugin-boundaries` with these element types and the import allow/deny sets pinned below. The allow/deny sets are exhaustive so transform-dependent commands have a sanctioned math source and PixiJS can never leak in.

Element types:
- `document-model` (`document/model/**`)
- `command` (`document/commands/**`)
- `history` (`document/history/**`)
- `ui` (`renderer/panels/**`, `renderer/viewport/**`, `editor-state/**`)
- `format` (`packages/format`)
- `runtime-core` (`packages/runtime-core`)

Allowed imports (exhaustive per element type):
- `command` MAY import: `format` (document content types, including `SymbolId` and the Phase 4 authoring-config types, which live in `packages/format`, see CD-1), `runtime-core` (affine math for transform-dependent commands), `document-model` (read model + `CommandContext`), the `document` typed-error union. `command` MUST NOT import: `ui`/`editor-state`/Zustand, PixiJS (`pixi.js`, `@pixi/*`), `createMutator`/`DocumentModelInternal`, `packages/math-bridge` (the outcome boundary package), or any OUTCOME symbol (see the outcome rule below).
- `document-model` MAY import: `format`, `runtime-core`. MUST NOT import: `ui`, PixiJS, `history`, `command`.
- `history` MAY import: `document-model` (including `createMutator`, which only `history` may import), `command`. MUST NOT import: `ui`, PixiJS, `packages/math-bridge`.
- `ui` MAY import: `History`, `DocumentReadModel`, `Document`, `DocumentHost`, `format`, and (Phase 4 amendment, CD-1 / phase-4 sections 5.3 and 7) the `packages/math-bridge` VALUE types and engines: `SpinResult`, `SpinInput`, `SpinSeed`, `MathEngine`, `MockMathEngine`, and at host wiring only the `math-bridge/real` adapter. This permits `editor-state/**` to hold the EPHEMERAL `currentSpinResult` and the preview transport to construct an engine and call its non-transacting resolve. It does NOT relax the bans above: `command`, `document-model`, and `history` still MUST NOT import `packages/math-bridge`, so an outcome can live in ephemeral UI state but can never reach a command or the document (LAW 1). `ui` MUST NOT import: `createMutator`, `DocumentModelInternal`, `Mutator`.

Custom rules:
- `no-mutator-outside-command` (AST rule under `tools/eslint-rules/`): flags any call to a method on a value typed `Mutator` in a file NOT matching `document/commands/**`. Catches passing a `Mutator` reference into a non-command module.
- `no-outcome-in-commands` (LAW 1 backstop): inside `document/commands/**`, error on importing any binding in the OUTCOME denylist regardless of source module. The denylist is the exact certified-outcome surface, not the whole `math-bridge` package:
  - exact identifiers: `SpinResult`, `SpinInput`, `SpinSeed`, `WinLine`, `CascadeStep`, `FeatureEvent`, `MathEngine`, `RngProof`
  - identifier patterns: `/^rng/i`, `/spinresult/i`, `/totalwin/i`, `/initialgrid/i`
  The `initialGrid` pattern covers the board outcome concept (phase-4 section 5.5 names the board, `initialGrid` and `grid`, as engine output). This rule bans outcome and RNG types wherever they come from, while explicitly ALLOWING the Phase 4 presentation authoring-config types (`SlotScene`, `GridConfig`, `WinSequenceConfig`, `FeatureFlowGraph`, `SymbolAnimSet`, `SymbolId`) because they live in `packages/format` as document content under LAW 3 (CD-1). Banning the entire `math-bridge` package by name (boundary rule above) plus the outcome denylist (this rule) enforces LAW 1 without making the Phase 4 catalog uncompilable, since those commands read and write authoring config from `packages/format`, never outcomes from `math-bridge`.

These rules run in CI (`pnpm lint`) and block merge. WP-C.9 ships them with passing/failing fixture files.

### 9.3 PR reviewer rule (human, tertiary)

Add to the PR template checklist (enforced by the reviewer, documented in `CONTRIBUTING.md`):

- [ ] Every document change in this PR goes through a `Command` executed by `History`. (Reject if any code path mutates document state otherwise.)
- [ ] Every new command has a registered `CommandSpec` (Section 10) and passes the round-trip harness.
- [ ] No command reads or writes Zustand, an outcome (`SpinResult`/`WinLine`/`CascadeStep`/`FeatureEvent`/`initialGrid`/`rngProof`), RNG state, `packages/math-bridge`, or `performance.now` directly.
- [ ] Coalescing commands keep the original "before" memento (Section 5.3).
- [ ] No `any`, no unjustified `as`, no em-dashes, no en-dashes.

The handoff's standing reviewer rule ("a PR that mutates DocumentModel outside a Command is rejected", item 11) is hereby formalized as checklist line 1.

---

## 10. Mandatory do/undo round-trip harness

Every command auto-registers and the harness discovers it. No command merges without a passing round-trip.

### 10.1 CommandSpec and registry (auto-discovery)

```ts
export interface CommandSpec<P = unknown> {
  readonly kind: string;                       // unique; matches Command.kind
  readonly paramsSchema: ZodType<P>;           // validates params at the tool boundary
  readonly create: (params: P, ids: IdFactory) => Command;
  // The seed this command is GUARANTEED applicable on. The discovery guard runs assertApplied
  // against this seed and FAILS if the fixture is null here, so a command that is inapplicable
  // on every seed cannot pass with zero round-trip coverage (Section 10.2).
  readonly representativeSeedId: string;
  // Produces a VALID instance against a given model, AND sets the fixture up so the command
  // produces a real, representative delta even for idempotent-capable commands. For example,
  // a SetActiveAttachment fixture must point the slot at a DIFFERENT attachment than the
  // active one, so applying it actually changes state. Returns null if not applicable.
  readonly fixture: (model: DocumentReadModel, ids: IdFactory) => { command: Command; params: P } | null;
  // Asserts the SPECIFIC representative delta this command must produce: every field the
  // command mutates differs between before and after, and unrelated fields are unchanged.
  // This replaces a blanket `not.toEqual`, which a trivial fixture could satisfy without
  // exercising the command. Throws on a missing or wrong delta.
  readonly assertApplied: (before: DocSnapshot, after: DocSnapshot) => void;
}

// Single barrel; every command file appends its spec here. This is the discovery point.
export const commandRegistry: readonly CommandSpec[] = [
  moveBoneSpec, createBoneSpec, deleteBoneSpec, renameBoneSpec, normalizeBoneRotationSpec,
  // ...grows per phase
];
```

### 10.2 Discovery guard (forgotten-registration and zero-coverage are CI failures)

A meta-test globs `document/commands/**/*.command.ts`, extracts each exported `kind`, and asserts every one appears exactly once in `commandRegistry`. A command that exists but is not registered fails CI. A registry entry whose file is missing fails CI. This makes "auto-discovers them" enforceable rather than aspirational. (WP-C.7 TASK-C7.2.)

The same meta-test resolves each `spec.representativeSeedId`, requires `spec.fixture` to be NON-NULL on that seed (a spec that is inapplicable on its own designated seed fails CI), and requires the resulting `assertApplied` to pass with at least one mutated field. This closes the gap where `if (!made) return` could let a fixture that returns null on every seed pass with zero round-trip coverage. (WP-C.7 TASK-C7.7.)

### 10.3 The generic harness

Phase 0 harness seeds come from `packages/format` golden fixtures (`minimal.json`, `rig.json`, WP-F.10, which are Phase 0 deliverables); `packages/conformance` does NOT exist until Phase 1 (conformance WP-V.0). From Phase 1 onward the harness ALSO runs against the `packages/conformance` rig catalog (WP-V.1). The seed source is therefore phase-gated and declared, not assumed (LAW 5).

```ts
// Phase 0: seedDocuments are the packages/format fixtures (minimal.json, rig.json).
// Phase 1+: seedDocuments also include the packages/conformance rigs.
describe.each(commandRegistry)('round-trip: $kind', (spec) => {
  it.each(seedDocuments)('do/undo and do/undo/redo are exact on %s', (seed) => {
    const doc = loadDocument(seed, testEnv);    // testEnv injects a fake clock + deterministic ids
    const made = spec.fixture(doc.model, doc.model.ids);
    if (!made) return;                          // not applicable to THIS seed; the guard (10.2)
                                                // independently proves the spec is applicable on
                                                // its representativeSeedId, so this is not a silent skip.

    const pre = doc.model.snapshot();           // S0
    doc.history.execute(made.command);
    const postDo = doc.model.snapshot();        // S1
    assertInvariants(doc.model);                // model still valid after do (LAW 3 spirit)
    spec.assertApplied(pre, postDo);            // command produced its representative delta

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(pre);  // do->undo == S0 (bit-exact, mementos)
    assertInvariants(doc.model);

    doc.history.redo();
    expect(doc.model.snapshot()).toEqual(postDo); // do->undo->redo == S1
    assertInvariants(doc.model);
  });
});
```

### 10.4 Required property tests (beyond the basic round-trip)

- COALESCE COLLAPSE: for every coalescing command, fire N (>= 5) instances inside one session; assert exactly one undo entry, that the stored memento count equals the number of distinct targets (not N), and that a single undo returns to the pre-session snapshot. (WP-C.5.)
- RANDOM WALK: a fuzz test issues a bounded random sequence of execute/undo/redo across the registry; after every step `assertInvariants` holds and no typed error escapes unexpectedly. Bounded length (<= 200 ops) per house rules on bounded iteration. (WP-C.7 TASK-C7.4.)
- EMPTY-DOC SAFETY: undo/redo on an empty history returns null and is a no-op (no throw, no commit event). (WP-C.7 TASK-C7.5.)
- COMPOSITE REVERSAL: composite undo runs children in reverse and equals pre-do snapshot. (WP-C.7 TASK-C7.6.)

Coverage gate: `document/` carries the house 80%+ floor; commands and History are the highest-value targets and should land near 100% line coverage on do/undo paths because the harness exercises them by construction.

---

## 11. Command catalog

Coalescing legend:
- `Session` = wrapped in begin/endInteraction (gesture); collapses to one undo step with one memento per distinct target.
- `Window` = time-window fallback; merges same kind + same target inside `coalesceWindowMs`.
- `None` = always its own undo step; never coalesces. A `None` command is a SINGLE command even when it carries a multi-entity SET memento (for example, a subtree delete). It is not a `CompositeCommand`.
- `Composite` = the command IS a `CompositeCommand` that COMPOSES other commands; it pushes exactly one undo step and never coalesces. (A distinct value from `None`: `None` is a single command, `Composite` is a composed structure of children.)

| Command | kind | Phase | Coalescing | Notes / law touchpoints |
|---|---|---|---|---|
| CreateBone | `bone.create` | 0 | None | Mints BoneId, inserts in boneOrder maintaining parent-before-child. selectionHint selects the new bone on execute/redo, clears on undo. |
| MoveBone | `bone.move` | 0 | Session (drag) / Window (key-nudge) | Reference coalescing example (Section 4.2). |
| RotateBone | `bone.rotate` | 0 | Session (gizmo) | Stores before/after rotation in degrees. |
| ScaleBone | `bone.scale` | 0 | Session (gizmo) | before/after scaleX/scaleY. |
| SetBoneLength | `bone.length` | 0 | Session (handle drag) | Affects bone tip render only; no child cascade. |
| NormalizeBoneRotation | `bone.rotation.normalize` | 0 | None | Computed-result REFERENCE command (Section 4.3): before = current rotation, after = `wrapDegrees(rotation)` computed once on first do and replayed on redo. Bone-only (LAW 5: the Phase 0 computed-result reference). |
| RenameBone | `bone.rename` | 0 | None | Single-field; trivial because identity is the ID, not the name (Section 2). Transient name collisions are legal internally (D9); uniqueness is enforced only at export. |
| DeleteBone | `bone.delete` | 0 | None | Phase 0 variant: CASCADE-deletes the bone and its descendant BONES only (D8: cascade, not reparent-to-grandparent). SINGLE command with a SET memento = the removed BoneEntity set plus their boneOrder indices, captured child-first. Phase 0 has no slots/attachments/animations, so it touches none; the richer variant is DeleteBoneAndRiders (Phase 1). selectionHint reselects the restored bone on undo. |
| DeleteBoneAndRiders | `bone.delete.withRiders` | 1 | Composite | Phase 1 user-facing delete: COMPOSES the Phase 0 `DeleteBone` (bone subtree) with removal of every slot riding a deleted bone, those slots' attachments, and pruning of timelines targeting any deleted bone or slot. Memento captures all removed entities for exact restore. Supersedes `DeleteBone` as the bound UI action; `DeleteBone` remains the bone-only building block. selectionHint reselects the restored root bone on undo. |
| ReparentBone | `bone.reparent` | 1 | None | Cycle prevention. New local transform precomputed by the tool via `runtime-core` affine to keep world transform stable (Section 4.3, handoff 8.4); stored as absolute `after`. before = old parent + old local. |
| SetBoneTransformMode | `bone.transformMode` | 1 | None | Enum field. |
| CreateSlot | `slot.create` | 1 | None | Appends to drawOrder. |
| DeleteSlot | `slot.delete` | 1 | None | SINGLE command with a SET memento = slot + its attachments + slot timelines. |
| ReorderSlot | `slot.reorder` | 1 | Session (drag in hierarchy) | Mutates drawOrder array (order-array batch, Section 3.1). |
| SetSlotColor | `slot.color` | 1 | Session (color picker drag) | RGBA before/after. |
| SetSlotBlendMode | `slot.blend` | 1 | None | Enum. |
| AddRegionAttachment | `attach.region.add` | 1 | None | Into a skin (default unless named). |
| RemoveAttachment | `attach.remove` | 1 | None | Memento stores full attachment value. |
| SetActiveAttachment | `slot.activeAttachment` | 1 | None | Setup-pose active attachment. Idempotent if set to the current value; fixture must target a different attachment so the harness sees a real delta. |
| CreateSkin | `skin.create` | 1 | None | Named variant. |
| AddSkinAttachment | `skin.attach.add` | 2 | None | Per-skin attachment override. |
| CreateAnimation | `anim.create` | 1 | None | Named animation; selectionHint switches active animation via editor-state, not the doc. |
| RenameAnimation | `anim.rename` | 1 | None | Keyed by AnimationId internally. |
| DeleteAnimation | `anim.delete` | 1 | None | Memento = whole animation. |
| SetAnimationDuration | `anim.duration` | 1 | Window | Numeric field. |
| SetKeyframe | `kf.set` | 1 | None (insert) / Session (value-edit while scrubbing) | Insert-or-update at playhead time on a bone/slot channel. Insert is structural (None); editing an existing keyframe's value during a drag is Session. Internal keyframe representation owned by the timeline subsystem plan; this row pins only the memento mandate and coalescing contract. |
| MoveKeyframe | `kf.move` | 1 | Session (dopesheet drag) | Changes keyframe time; before/after time. Order-array batch (Section 3.1). Representation deferred to timeline plan. |
| DeleteKeyframe | `kf.delete` | 1 | None | Memento = keyframe value + time + curve. Representation deferred to timeline plan. |
| SetCurve | `kf.curve` | 1 | Session (bezier handle drag) | linear/stepped/bezier; bezier control-point drag is one session. Representation deferred to timeline plan. |
| SetDrawOrderKeyframe | `anim.drawOrder.set` | 1 | None | drawOrder override at a time. |
| SetEventKeyframe | `anim.event.set` | 1 | None | Fires a named event at a time; references an EventDefId. |
| DefineEvent | `event.define` | 1 | None | EventDef in document, addressed by EventDefId (Section 2). |
| CreateMeshFromRegion | `mesh.fromRegion` | 2 | Composite | Generates initial hull + grid mesh; triangulate via earcut. Composes attachment create with the initial triangulation. |
| AddMeshVertex | `mesh.vertex.add` | 2 | None | Structural. |
| MoveMeshVertex | `mesh.vertex.move` | 2 | Session (vertex drag) | before/after (x,y) in slot-bone space. |
| DeleteMeshVertex | `mesh.vertex.delete` | 2 | Composite | Re-triangulation follows as part of the composite. |
| Retriangulate | `mesh.retriangulate` | 2 | None | Computed-result command (Section 4.3): before = full triangle list, after computed once on first do and replayed on redo. First SHIPPING computed-result command (the Phase 0 reference is NormalizeBoneRotation). |
| SetMeshEdges | `mesh.edges.set` | 2 | None | Editor wireframe edges (display field per format). |
| BindMeshToBones | `mesh.bind` | 2 | None | Computed-result command: converts unweighted to weighted encoding (handoff section 6). before = full vertices+bones arrays; after captured on first do. |
| PaintWeights | `mesh.weights.paint` | 2 | Session (stroke) | One brush stroke = one undo step (handoff 8.5). Captures before-weights of touched vertices at stroke start; in-stroke dabs coalesce per touched-vertex set. |
| NormalizeWeights | `mesh.weights.normalize` | 2 | None | Computed-result command: per-vertex sum-to-1; after computed once and replayed on redo. |
| SmoothWeights | `mesh.weights.smooth` | 2 | Session (smooth stroke) | Same stroke semantics as paint. |
| SetMaxInfluences | `mesh.weights.maxInfluence` | 2 | None | Computed-result command: cap (4 standard); prunes lowest weights and renormalizes; after captured on first do. |
| SetDeformKeyframe | `anim.deform.set` | 2 | None (insert) / Session (offset drag) | Per-vertex offset keyframe (deform timeline). Representation deferred to timeline plan. |
| MoveDeformVertex | `anim.deform.move` | 2 | Session (drag in animation mode) | Edits offsets at the playhead keyframe. Representation deferred to timeline plan. |
| CreateIkConstraint | `ik.create` | 2 | None | 1 or 2 bone chain + target. |
| SetIkMix | `ik.mix` | 2 | Session (slider) | 0..1. |
| SetIkBendPositive | `ik.bend` | 2 | None | Boolean. |
| DeleteIkConstraint | `ik.delete` | 2 | None | SINGLE command with a SET memento = constraint + its ik timeline. |
| SetIkKeyframe | `anim.ik.set` | 2 | None / Session | Animatable mix/bend (ik timeline). |
| CreateTransformConstraint | `tc.create` | 2 | None | Per handoff section 6 fields. |
| SetTransformConstraintMix | `tc.mix` | 2 | Session (slider) | Per-channel mix factor. |
| SetTransformConstraintOffset | `tc.offset` | 2 | Session (slider) | Per-channel offset. |
| DeleteTransformConstraint | `tc.delete` | 2 | None | SINGLE command with a SET memento = constraint + transform timeline. |
| SetTransformKeyframe | `anim.tc.set` | 2 | None / Session | transform timeline. |
| CreateEmitter | `emitter.create` | 3 | None | Particle emitter config (Layer B). Declares `EmitterId` brand (Phase 3). |
| DeleteEmitter | `emitter.delete` | 3 | None | Memento = full emitter config. |
| SetEmitterParam | `emitter.param` | 3 | Session (slider) / Window | Spawn rate, lifetime, velocity, gravity, scale/color over life. before/after per param. |
| SetEmitterShape | `emitter.shape` | 3 | None | point/line/circle/rect. |
| SetEmitterBlendMode | `emitter.blend` | 3 | None | Enum. |
| SetEmitterTexture | `emitter.texture` | 3 | None | Atlas region/frames. |
| ReorderEmitter | `emitter.reorder` | 3 | Session (drag) | Draw order among emitters (order-array batch, Section 3.1). |
| CreateVfxPreset | `vfx.preset.create` | 3 | None | Named bundle (coinShowerLarge, rayBurst). |
| SetGridConfig | `slot.grid.set` | 4 | Session (metric drags) | Edits `GridConfig` (FORMAT type, CD-1): topology, cols/rows, cell metrics, `reelStopStaggerMs`, `gravity`, and the `AnticipationConfig`. LAW 1: there is NO symbol-placement and NO symbol-source field; the board is RNG-driven by the engine at runtime (`SpinResult`), never authored here (phase-4 section 6.1, format-contract section 15.3). |
| MapSymbolAnimSet | `slot.symbol.map` | 4 | None | Edits `SymbolAnimSet` (FORMAT type): SymbolId -> {idle, win, land} animation references. |
| CreateWinSequence | `slot.winseq.create` | 4 | None | Named `WinSequenceConfig` (FORMAT type) presentation sequence. |
| SetWinSequenceStep | `slot.winseq.step` | 4 | Session (timeline drag) / None | Choreography step. Step predicates reference SpinResult FIELD NAMES (authored strings) only; the command stores authoring config, never an outcome value. |
| ReorderWinSequenceStep | `slot.winseq.reorder` | 4 | Session (drag) | Order of steps (order-array batch). |
| SetEscalationThreshold | `slot.winseq.threshold` | 4 | Window | big/mega/epic thresholds (authoring config). |
| CreateFeatureFlowState | `slot.flow.state.create` | 4 | None | Free-spin/feature flow node in `FeatureFlowGraph` (FORMAT type). |
| AddFeatureFlowTransition | `slot.flow.transition.add` | 4 | None | Transition predicate references feature TYPE NAMES (authored strings), never a SpinResult value. |
| SetTumbleChoreography | `slot.tumble.set` | 4 | Session / None | Cascade explode/drop/refill timing. Consumes ordered cascades at runtime; authoring only here, no outcome stored. |
| DeleteFeatureFlowState | `slot.flow.state.delete` | 4 | None | Removes a node from `FeatureFlowGraph` plus its incident transitions; the memento restores node and edges on undo. Rejected if it would delete the sole `base` node. |
| RenameFeatureFlowState | `slot.flow.state.rename` | 4 | None | Renames a flow node id/label and rewrites referencing transitions. Authoring metadata only, never an outcome. |
| RemoveFeatureFlowTransition | `slot.flow.transition.remove` | 4 | None | Removes a single transition edge; the memento restores it on undo. |

LAW 1 callout for all Phase 4 commands: not one of them may read, embed, derive, or influence a `SpinResult`, RNG state, win amount, board (`initialGrid`/`grid`), or symbol placement. They author the deterministic presentation function. Their config types (`GridConfig`, `SymbolAnimSet`, `WinSequenceConfig`, `FeatureFlowGraph`, `SlotScene`, `SymbolId`) live in `packages/format` (CD-1, owned by `format-contract.md` and the phase-4 plan), are saved/versioned/validated as document content under LAW 3 (via the separate `SlotSceneDocument` envelope, Section 7.5), and contain authored field NAMES and references only, never outcome VALUES. Structurally, a command has no `SpinResult` handle (Section 9.1). The `no-outcome-in-commands` lint (Section 9.2) is the backstop; reviewer line 3 (Section 9.3) backs it.

Phase 5 (production hardening) introduces no new document commands. Binary export and atlas optimization operate on the exported format, not the live document; conformance and migration are out of this module's command surface.

---

## 12. Public API (single barrel per house rules)

`apps/editor/src/renderer/document/index.ts` is the only legal import surface for this module:

```ts
export type {
  Command, CommandContext, CommandSpec, SelectionHint, EntityRef, HistoryPhase, HistoryEvent,
} from './command';
export type {
  DocumentReadModel, DocumentEnvironment, BoneId, SlotId, EventDefId /* ...branded ids */,
} from './model';
export { HISTORY_DEFAULTS } from './history';
export { Document, DocumentHost, loadDocument, createDocument, exportDocument } from './document';
export { History } from './history';
export { commandRegistry } from './commands';      // for the harness only
// NOT exported: Mutator, createMutator, DocumentModelInternal (privileged; structural LAW 2 guard)
// Phase 4 only: exportSlotScene is exported when the slot module lands (it consumes packages/format).
```

Deep imports into `document/model/internal` or `document/commands/*` from outside the module are forbidden by the boundary rule (Section 9.2). The harness imports `commandRegistry` through the barrel.

---

## 13. Work packages

Each WP is independently verifiable. IDs are stable for cross-reference from the master plan. Build order is C.1 -> C.10 within Phase 0; C.11 onward roll out per phase.

### Out-of-module prerequisites (declared so WP ordering is honest)

- WP-C.6 and WP-C.7 depend on `packages/format` v0 types, `validateDocument`, `computeContentHash`/`verifyContentHash`, and the golden fixtures `minimal.json`/`rig.json` (format-contract WP-F.1, WP-F.3, WP-F.7, WP-F.10, all Phase 0). Those are `packages/format` deliverables, not part of this module. The Phase 0 harness seeds and the round-trip fixtures come from there.
- From Phase 1 onward the harness ALSO consumes the `packages/conformance` rig catalog (conformance WP-V.0 / WP-V.1, Phase 1). `packages/conformance` does NOT exist in Phase 0 (LAW 5), so no Phase 0 acceptance below sources seeds from it.
- WP-C.9's "CI marks `lint` as required and a violating PR cannot merge" depends on a repo-admin branch-protection setting. That is a repository configuration action outside this module's source. WP-C.9 ships the lint rules and CI job; enabling the required-check gate is tracked as a repo-admin task and noted in the WP as an external dependency.
- The Phase 4 authoring-config types (`SlotScene`, `GridConfig`, `WinSequenceConfig`, `FeatureFlowGraph`, `SymbolAnimSet`, `SymbolId`) and the `SlotSceneDocument` envelope live in `packages/format`. This is OWNED and decided by `format-contract.md` and the phase-4 plan (CD-1), not by this document. WP-C.14 is blocked until that relocation lands.

### WP-C.1 - DocumentModel core and read model
TASKS: define branded IDs and `IdFactory` (TASK-C1.1); define `DocState` and entity structs mirroring format by value, `events` keyed by `EventDefId` (TASK-C1.2); implement `DocumentReadModel` accessors returning frozen copies, including `findBoneByName` first-match contract (TASK-C1.3); implement `snapshot()` canonical projection (TASK-C1.4); implement discrete copy-on-write replacement, batch in-place mode for both entity-field and order-array drags (`beginBatch`/`commitBatch`), and `revision` bump (TASK-C1.5).
LAW TOUCH: LAW 2 (read/write split), LAW 3 (model mirrors but is not the format).
ACCEPTANCE:
- [ ] Mutating any object returned by a read accessor leaves `model.snapshot()` unchanged (frozen-copy test passes).
- [ ] `snapshot()` of two models built from the same `DocState` is `toEqual`, and field order is deterministic across runs.
- [ ] `revision` strictly increases on each applied mutation (discrete and in-batch) and is unchanged by pure reads.
- [ ] In batch mode, a single-target entity-field mutation does not clone the bones `Map`, and an order-array drag does not realloc the order array per move (allocation probe shows one COW boundary at `commitBatch`, not one per mutation).
- [ ] `findBoneByName` returns the first bone in `boneOrder` matching the name, or `undefined`, and never throws.
- [ ] No `any`, no `as` (except documented brand construction) in the module; `tsc --strict` clean.

### WP-C.2 - Mutator capability and structural LAW 2 guard
TASKS: define `MUTATOR_BRAND` unique symbol and `Mutator` interface (TASK-C2.1); implement `createMutator` and `DocumentModelInternal` write methods, one per primitive op (TASK-C2.2); ensure barrel does not export `Mutator`/`createMutator`/internal (TASK-C2.3).
LAW TOUCH: LAW 2 (primary structural enforcement).
ACCEPTANCE:
- [ ] A UI fixture file attempting `model as Mutator` or constructing a `Mutator` literal fails `tsc` (compile-error snapshot test via `tsd` or `expect-type`).
- [ ] No file outside `document/history/**` imports `createMutator` (grep + boundary lint both green).
- [ ] Every read method on `Mutator` matches `DocumentReadModel` (interface extension verified by type test).

### WP-C.3 - Command interface, memento base, composite, computed-result, selection-hint
TASKS: define `Command`, `CommandContext`, `HistoryPhase`, `SelectionHint`, `EntityRef`, `HistoryEvent` (TASK-C3.1); implement `CompositeCommand` with its optional per-phase hint (TASK-C3.2); implement `DocumentError` discriminated union (`CommandTargetMissingError`, `CommandNotAppliedError`, `DocumentInvariantError`, `ExportValidationError`, `HistoryReentrancyError`) (TASK-C3.3); implement the bone-only computed-result REFERENCE command `NormalizeBoneRotation` demonstrating after-capture-on-first-do (TASK-C3.4). LAW 5: the reference is bone-only; the mesh computed-result commands (`Retriangulate` and friends) are Phase 2 / WP-C.12 and are NOT implemented here.
LAW TOUCH: invariant (typed errors), invariant (round-trip via mementos), LAW 5 (no mesh entities in Phase 0).
ACCEPTANCE:
- [ ] Composite `undo` runs children in strict reverse order (asserted by an ordered-spy test).
- [ ] All error types are members of `DocumentError` and carry context fields; no thrown bare strings anywhere in the module (lint `no-throw-literal` + custom check green).
- [ ] A primitive without a captured before-memento that is asked to `undo` throws `CommandNotAppliedError`.
- [ ] `NormalizeBoneRotation`'s redo writes the value captured on first do, verified by mutating the bone's rotation between undo and redo and asserting redo still yields the original `after`.
- [ ] `selectionHint` resolves per phase: a delete reference returns the restored entity on `'undo'` and the parent (or `clear`) on `'execute'`/`'redo'`.

### WP-C.4 - History engine
TASKS: implement `History` with injected `now` and the single-source `HISTORY_DEFAULTS` for `maxDepth`/`coalesceWindowMs` (TASK-C4.1); past/future stacks, redo-clear on new action (TASK-C4.2); `beginInteraction`/`endInteraction` with batch mode and in-session memento coalescing (TASK-C4.3); `subscribe`/`commit` returning `HistoryEvent` with the per-phase resolved hint and the re-entrancy guard, plus `canUndo/canRedo/undoLabel/redoLabel` (TASK-C4.4); depth bounding (TASK-C4.5).
LAW TOUCH: LAW 2 (only History holds the Mutator).
ACCEPTANCE:
- [ ] With injected clock, executing a new command clears `future` (redo unavailable after a fresh action).
- [ ] `endInteraction` with 1 stored command pushes that command; with >1 pushes a single `CompositeCommand`; with 0 pushes nothing and returns null.
- [ ] `undo`/`redo` on empty stacks return null and are no-ops (no throw, no commit event).
- [ ] After `maxDepth+10` distinct commands, `past.length === maxDepth` and the oldest are dropped.
- [ ] `subscribe` fires exactly once per committed execute/undo/redo and not at all during an in-session execute; each call delivers a `HistoryEvent` carrying the applied command's `kind`, `label`, and the per-phase resolved `selectionHint`.
- [ ] A listener that calls `execute`/`undo`/`redo` triggers `HistoryReentrancyError` (re-entrancy guard), not silent stack corruption.
- [ ] `maxDepth` and `coalesceWindowMs` defaults come from `HISTORY_DEFAULTS` only; there is no second default literal in the module (grep proves single source).
- [ ] `execute`/`undo`/`redo` return the same `HistoryEvent` they deliver to subscribers (null on no-op).

### WP-C.5 - Coalescing protocol and tests
TASKS: implement `coalesceWith` on all coalescing commands with the before/after memento rule (TASK-C5.1); the time-window fallback path in `execute` and the in-session `coalesceIntoSession` path (TASK-C5.2); the worked-example test matrix from Section 6, including the order-array drag rows (TASK-C5.3).
LAW TOUCH: invariant (one undo step per gesture), invariant (bounded per-gesture memory).
ACCEPTANCE:
- [ ] For each Session row in the Section 6 table: N>=5 commands in one session yield exactly 1 undo entry, the stored memento count equals the number of distinct targets (not N), and a single undo deep-equals the pre-session snapshot.
- [ ] `MoveBone(A)` then `MoveBone(B)` produce 2 entries (cross-target guard).
- [ ] Merged command's undo returns to the ORIGINAL before state, not the second-to-last (before-memento-preservation test).
- [ ] An order-array drag (`ReorderSlot`) coalesces to one undo step with one memento (before/after order copies) and does not realloc the order array per move.
- [ ] Time-window test uses the injected clock: same kind+target within `coalesceWindowMs` (250ms) merges; at 251ms it does not.

### WP-C.6 - Document aggregate, save/load, canonical round-trip, ownership
PREREQUISITE: `packages/format` v0 types, `validateDocument`, `computeContentHash`/`verifyContentHash`, and the `minimal.json`/`rig.json` fixtures (format-contract WP-F.1/F.3/F.7/F.10; all Phase 0; out of module).
TASKS: `Document { model, history }` and `createDocument(state, env)` factory taking an injected `DocumentEnvironment` (TASK-C6.1); `exportDocument` with format validation, invariant assert, name-uniqueness check, and `hash` set via `computeContentHash` from `packages/format` (TASK-C6.2); `loadDocument(json, env)` with `validateDocument`, env-supplied `IdFactory`, reference resolution, fresh History (TASK-C6.3); `DocumentHost` ownership and swap protocol (TASK-C6.4); the round-trip meta-test that consumes `verifyContentHash` over the committed fixtures (TASK-C6.5). NOTE (LAW 3): this WP MUST NOT define or duplicate a canonicalizer or a hash function; it imports them from `packages/format`.
LAW TOUCH: LAW 3 (validate on import, fail loudly; canonical round-trip consumed from the format owner), Section 2 ID seam, DI (injected clock + ids).
ACCEPTANCE:
- [ ] `loadDocument(malformedJson, env)` throws a typed validation error and constructs no `Document` (loud failure).
- [ ] After `loadDocument`, `history.canUndo === false`.
- [ ] `loadDocument` and `createDocument` take a `DocumentEnvironment`; no code in `document/**` references `performance.now`. With an injected fake clock and deterministic `IdFactory`, load-path history is reproducible across runs.
- [ ] For every committed format fixture R (`minimal.json`, `rig.json`): `verifyContentHash(R) === true` (the fixture carries the format package's hash; this module does not recompute by its own rule).
- [ ] `exportDocument(loadDocument(R, env))` deep-equals R for every committed fixture, including the `hash` field (export recomputes it via `computeContentHash`).
- [ ] No `canonicalize`/`computeHash` implementation exists under `document/**` (grep + boundary check); the only hash/canonical calls are imports from `packages/format`.
- [ ] `exportDocument` of a model whose bone order violates parent-before-child, or whose names collide within a namespace, throws `ExportValidationError`.
- [ ] After `DocumentHost.load`, the old `Document`'s subscribers are disposed and editor-state plus viewport are re-subscribed to the new `Document` (swap-protocol test).

### WP-C.7 - Round-trip harness and discovery guard
PREREQUISITE: the `packages/format` golden fixtures (Phase 0 seeds). From Phase 1, also the `packages/conformance` rigs.
TASKS: `CommandSpec` (with `representativeSeedId` and `assertApplied`) + `commandRegistry` barrel (TASK-C7.1); glob-vs-registry discovery meta-test (TASK-C7.2); generic do/undo/redo harness over registry x seed docs (TASK-C7.3); bounded random-walk fuzz (TASK-C7.4); empty-doc safety + composite reversal tests (TASK-C7.5, TASK-C7.6); applicability-and-non-trivial-delta meta-test on each spec's `representativeSeedId` (TASK-C7.7).
LAW TOUCH: invariant (round-trip mandatory for every command), LAW 5 (Phase 0 seeds from `packages/format`, conformance from Phase 1).
ACCEPTANCE:
- [ ] Phase 0 seeds are the `packages/format` fixtures; the harness does not import from `packages/conformance` in Phase 0.
- [ ] Adding a `*.command.ts` file without registering its spec fails the discovery meta-test in CI.
- [ ] The generic harness runs for every registry entry against every seed doc; do/undo == pre, do/undo/redo == post-do, both bit-exact, and `spec.assertApplied` passes for each applicable seed.
- [ ] Each spec's `fixture` is non-null on its `representativeSeedId` and produces a real delta there; a spec inapplicable on its own designated seed (or that produces no delta) fails CI.
- [ ] `assertInvariants` holds after every step of the random walk (<=200 ops, bounded).
- [ ] Coverage on `document/commands/**` and `document/history/**` line-coverage >= 90 percent (harness-driven), module overall >= 80 percent.

### WP-C.8 - Selection separation, reconciliation, selection hints
TASKS: define `SelectionHint` application path in editor-state driven by the per-phase `HistoryEvent.selectionHint` (TASK-C8.1); revision-and-commit-driven selection pruning (TASK-C8.2); enforce zero coupling (commands never touch Zustand, stores never call Mutator) (TASK-C8.3).
LAW TOUCH: handoff 8.2 wall.
ACCEPTANCE:
- [ ] Undoing a `CreateBone` prunes the now-dangling selection (no stale ID remains selected), driven by the `history.subscribe` commit event.
- [ ] Renaming a bone does not change which bone is selected (selection keyed by ID).
- [ ] Boundary lint: no import of `editor-state`/Zustand inside `document/commands/**`; no `Mutator` reference inside `editor-state/**`. Both green.
- [ ] A `DeleteBone` (or `DeleteBoneAndRiders`) `do` delivers a hint that does NOT select the deleted bone, and its `undo` delivers a `HistoryEvent` whose `selectionHint` reselects the restored bone via the non-undoable store (the per-phase hint is what makes both directions correct).

### WP-C.9 - Enforcement: lint boundaries, custom rules, PR template
EXTERNAL DEPENDENCY: enabling the required-check branch protection is a repo-admin action outside this module.
TASKS: configure `eslint-plugin-boundaries` element types + the pinned allow/deny import sets, including the `math-bridge` package ban inside `document/commands/**` (TASK-C9.1); custom `no-mutator-outside-command` rule with fixtures (TASK-C9.2); custom `no-outcome-in-commands` rule with the outcome denylist (including `initialGrid`) and fixtures (TASK-C9.3); add PR checklist to `CONTRIBUTING.md` and PR template (TASK-C9.4); wire `pnpm lint` into CI as a job (TASK-C9.5).
LAW TOUCH: LAW 2 (secondary enforcement), LAW 1 (outcome guard, backstop to the structural guarantee).
ACCEPTANCE:
- [ ] A fixture importing `createMutator` from `ui` fails lint; a fixture importing it from `history` passes.
- [ ] A fixture calling a `Mutator` method in a non-command file fails `no-mutator-outside-command`.
- [ ] A fixture importing `SpinResult`/`WinLine`/`CascadeStep`/`FeatureEvent`/`initialGrid`/`rngProof` (from any source) inside `document/commands/**` fails `no-outcome-in-commands`.
- [ ] A fixture importing anything from `packages/math-bridge` inside `document/commands/**` fails the boundary rule.
- [ ] A fixture importing `GridConfig`/`SymbolAnimSet`/`WinSequenceConfig`/`SymbolId` from `packages/format` inside `document/commands/**` PASSES lint (CD-1 honored; authoring config is allowed, outcomes are not).
- [ ] A fixture importing PixiJS inside `document/commands/**` or `document/model/**` fails lint.
- [ ] The `lint` CI job runs on every PR. (Marking it a required check is the tracked repo-admin action.)

### WP-C.10 - Phase 0 command set and vertical slice
TASKS: implement and register `CreateBone`, `MoveBone`, `DeleteBone` (bone-subtree-only variant), `RenameBone`, `RotateBone`, `ScaleBone`, `SetBoneLength`, and `NormalizeBoneRotation` (the Phase 0 computed-result reference, implemented in WP-C.3) (TASK-C10.1..8); wire "create bone by drag" (session) and "select + move" gizmo (session) to History (TASK-C10.9); undo/redo keybindings reading `History` and applying `HistoryEvent.selectionHint` (TASK-C10.10).
LAW TOUCH: LAW 2, LAW 5 (Phase 0 artifact; no slot/attachment/animation/mesh entities referenced).
ACCEPTANCE (matches handoff Phase 0 milestone):
- [ ] Create a bone by drag, move it with the gizmo, undo and redo cleanly, save and reload through the format to an identical `snapshot()`.
- [ ] A bone drag produces exactly one undo step regardless of pointer-move count, and exactly one stored memento for a single-bone drag.
- [ ] All Phase 0 commands pass the generic harness and are present in `commandRegistry`; the Phase 0 CI round-trip for `CreateBone`/`MoveBone` (conformance plan, Phase 0) is green.
- [ ] `DeleteBone` of a parent restores the parent and its descendant BONES exactly on undo (bone-subtree memento completeness test). No slot/attachment/timeline logic appears in the Phase 0 command, since those entities do not exist until Phase 1.
- [ ] `NormalizeBoneRotation` redo replays the stored `after` after an intervening rotation edit.

### WP-C.11 - Phase 1 command rollout
SCOPE: `DeleteBoneAndRiders` (cascading delete, D8), `ReparentBone`, slot CRUD, attachments, skins, animation CRUD, keyframe set/move/delete, curves, draw-order/event keyframes (Section 11 Phase 1 rows). Each ships with its `CommandSpec`, harness pass, and coalescing per the catalog. The harness also begins consuming `packages/conformance` rigs (Phase 1). Internal keyframe representation is supplied by the timeline subsystem plan, which must land before the keyframe rows.
ACCEPTANCE: every Phase 1 command in `commandRegistry`; every Session-row command yields one undo step per gesture (extends WP-C.5 matrix); `DeleteBoneAndRiders` undo restores riding slots, attachments, and pruned timelines exactly and reselects the restored root bone via its per-phase hint; `ReparentBone` keeps world transform stable and is exactly reversible (the precomputed `after` local transform is replayed on redo); CI green.

### WP-C.12 - Phase 2 command rollout (mesh / weight / IK / transform / deform)
SCOPE: all Phase 2 rows. Weight-paint and smooth strokes coalesce to one undo step; `BindMeshToBones`, `Retriangulate`, `NormalizeWeights`, and `SetMaxInfluences` are the SHIPPING computed-result commands (the Phase 0 reference was `NormalizeBoneRotation`), each capturing full-array `after` mementos on first do and replaying on redo.
ACCEPTANCE: stroke = one undo step (extends WP-C.5); `BindMeshToBones` undo restores exact unweighted vertices; computed-result redo replays the stored `after` (verified after intervening edits); all Phase 2 commands pass the harness; CI green.

### WP-C.13 - Phase 3 command rollout (particles / VFX)
SCOPE: emitter CRUD, param/shape/texture/blend, preset create (Section 11 Phase 3 rows). Declares the `EmitterId` brand.
ACCEPTANCE: emitter param slider drags coalesce to one step; emitter reorder is an order-array batch drag with one memento; all registered and harness-green; CI green.

### WP-C.14 - Phase 4 command rollout (slot composer) with LAW 1 guard
PREREQUISITE: CD-1 (the authoring-config types and the `SlotSceneDocument` envelope live in `packages/format`, owned by `format-contract.md` section 15 and the phase-4 plan; out of module). No new internal ID brand: Phase 4 authoring config is keyed by `SymbolId`, a `packages/format` type.
SCOPE: grid, symbol map, win sequencer, feature flows, tumble (Section 11 Phase 4 rows), editing FORMAT-defined authoring config; plus `exportSlotScene` projecting the in-memory `SlotScene` to the format-owned envelope (Section 7.5).
LAW TOUCH: LAW 1 (presentation only; structural absence of any `SpinResult` handle), LAW 3 (config is format content; the slot-scene envelope round-trips).
ACCEPTANCE: `no-outcome-in-commands` passes for the whole `document/commands/slot/**` tree; no Phase 4 command imports an outcome symbol or `packages/math-bridge`; a review-time grep for `SpinResult`/`rng`/`totalWin`/`initialGrid` in command sources returns zero hits; Phase 4 commands import their config types from `packages/format`; `exportSlotScene(loadSlotScene(S, env))` deep-equals S over the committed slot-scene fixtures (the envelope hash verified by the format package, not re-implemented here); the saved envelope contains no outcome value (phase-4 WP-4.12 cross-check); all registered and harness-green; CI green.

### WP-C.15 - Performance budget
TASKS: micro-benchmark single command execute and snapshot (TASK-C15.1); assert no allocation in the solve/render loop attributable to History, which is touched only on user actions, never per frame (TASK-C15.2); assert per-gesture memento bound (TASK-C15.3).
LAW TOUCH: invariant (60fps, no per-frame allocation; bounded per-gesture memory).
ACCEPTANCE:
- [ ] A typical command execute completes in < 1ms p95 on a mid laptop for the largest committed rig.
- [ ] `snapshot()` is not called inside the per-frame loop (static check + a render-loop allocation profile shows zero History/Command allocations per frame).
- [ ] A 1000-pointer-move single-target drag stores exactly ONE memento and produces exactly one `past` entry; total stored mementos for a gesture equals the number of distinct targets, independent of pointer-move count (the real memory bound, not just `past`-entry count).
- [ ] During a drag (batch mode), per-pointer-move allocation is O(1) for both entity-field and order-array drags (no per-move `Map` or order-array realloc), confirmed by an allocation probe.

---

## 14. Decisions: originated here vs consumed from the format owners

This document may originate decisions about the COMMAND and HISTORY mechanism. It may NOT originate decisions about the format contract; those belong to `format-contract.md` and the phase-4 plan and are recorded here as CONSUMED dependencies (CD), per LAW 3.

### 14.1 Consumed dependencies (owned elsewhere; this doc references, does not decide)

| # | Consumed decision | Owner / source of record | Why it is not decided here |
|---|---|---|---|
| CD-1 | The Phase 4 authoring-config types (`SlotScene`, `GridConfig`, `WinSequenceConfig`, `FeatureFlowGraph`, `SymbolAnimSet`) and `SymbolId` live in `packages/format`; `packages/math-bridge` keeps only outcome/boundary types (`SpinResult`, `SpinInput`, `SpinSeed`, `WinLine`, `CascadeStep`, `FeatureEvent`, `MathEngine`, `rngProof`). The slot scene serializes as its own `SlotSceneDocument` envelope (`slotSceneFormatVersion`, own hash). | `format-contract.md` (format surface) and `phase-4-slot-composer.md` (type-ownership table, section about `SlotScene`/`SlotSceneDocument`, the lint amendment) | It changes THE format contract and a package public surface. LAW 3 makes the format owner the decider; this module consumes it (lint allow-sets in Section 9.2, catalog notes in Section 11, Section 7.5). |
| CD-2 | The content hash domain, canonicalizer, and `computeContentHash`/`verifyContentHash` (canonical JSON with the `hash` key removed, SHA-256 via `@noble/hashes`, lowercase hex). | `format-contract.md` section 9 (WP-F.7) | A second implementation in the editor is exactly the cross-package drift LAW 3 prevents. Section 7.3 imports and consumes it. |
| CD-3 | The `SlotSceneDocument` envelope canonical form and hash (`sha256` over canonical `{ slotSceneFormatVersion, name, scene, refs }`). | `phase-4-slot-composer.md` section 6.1.1 (WP-4.4) | Same reason as CD-2; Section 7.5 consumes it. |
| CD-4 | The golden corpus seeds (`minimal.json`, `rig.json` in `packages/format`; the `packages/conformance` rig catalog from Phase 1). | `format-contract.md` (WP-F.10) and `conformance-and-ci.md` (WP-V.0/V.1) | Fixtures are owned by the format and conformance packages; this module sources seeds from them with the correct phase gate (Section 10.3). |

### 14.2 Decisions originated here for reviewer sign-off

| # | Decision | Recommendation | Needs sign-off |
|---|---|---|---|
| D1 | Refine `do(doc)` to `do(ctx: CommandContext)` for the Mutator capability | Adopt (structural LAW 2; reviewer pre-approved) | Yes |
| D2 | Internal stable IDs vs format names as identity | Adopt internal IDs, resolve at the format seam | Yes |
| D3 | Memento-based commands (store before/after; computed-result commands capture `after` on first do) | Adopt (bit-exact reversibility) | Yes |
| D4 | Dual coalescing: sessions primary (with in-session memento coalescing), time-window fallback | Adopt both, sessions preferred | Yes |
| D5 | History not persisted across restart; autosave REMOVED from Phase 0 (needs its own versioned recovery contract when added) | Adopt; recovery deferred with an explicit contract requirement | Yes |
| D6 | `maxDepth` default 500 and `coalesceWindowMs` default 250, single-sourced in `HISTORY_DEFAULTS`; `DocumentEnvironment`/`HistoryDeps` forward overrides only | Adopt defaults; tunable; single source | No (tunable) |
| D7 | `SelectionHint` is a small `select`/`clear`/`preserve` union of `EntityRef`s, resolved PER history phase by `Command.selectionHint(phase)`; History puts the resolved value on `HistoryEvent`. (Replaces the previously undefined static hint; makes delete-undo reselection correct in both directions.) | Adopt phase-resolved hint | Yes |
| D8 | `DeleteBone` child policy = cascade-delete the entire subtree (not reparent-to-grandparent); Phase 0 bone-only variant (single command, set memento), Phase 1 `DeleteBoneAndRiders` cascading composite variant | Adopt cascade; split by phase (LAW 5) | Yes |
| D9 | Name uniqueness is an EXPORT-only contract, not an internal invariant; transient collisions are legal internally; `assertInvariants` does not check uniqueness | Adopt export-only uniqueness | Yes |
| D10 | In-session in-place batch mutation (`beginBatch`/`commitBatch`) for BOTH entity-field and order-array gestures: mutate in place during a gesture, single copy-on-write boundary at `endInteraction`, to bound per-gesture allocation | Adopt (60fps / no per-frame allocation) | Yes |

Sign-off here unblocks WP-C.1. None of D1..D5 or D7..D10 may be silently reversed later; reversing any is an architecture change requiring its own ADR under `docs/adr/`. Reversing or amending any CD requires a change in the OWNING document (`format-contract.md` or the phase-4 plan) under LAW 3, not here.
