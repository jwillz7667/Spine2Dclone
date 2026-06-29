import { jsonPointer } from '../../validate/structural';
import type { SlotSceneDocument } from '../scene-document';
import type { GridConfig } from '../grid-config';
import type { SceneRefs } from '../scene-document';
import { slotSceneError } from './errors';
import type { SlotSceneError } from './errors';
import type { SceneResolver } from './resolver';

// Semantic (graph) layer for the slot scene format (format-contract section 15.4, phase-4 section 6.2).
// The cross-field invariants and referential-integrity checks Zod cannot express, collected in one pass.
// Each family is independent and never short-circuits another, so one document surfaces every distinct
// fault at once (mirroring the skeletal and effects validators' collect-all posture). The resolver
// reaches OUTSIDE the document (referenced skeletons / VFX presets) and is injected by the caller.

// Per-topology dimension rules (format-contract section 15.4): reelStrip rows in [2, 6], scatterPay
// cols in [5, 7], cluster is square (cols === rows). Each violation is gridDimsInconsistent at the
// offending dimension's path.
function checkGridDims(grid: GridConfig, errors: SlotSceneError[]): void {
  const base = ['scene', 'grid'] as const;
  if (grid.topology === 'reelStrip') {
    if (grid.rows < 2 || grid.rows > 6) {
      errors.push(
        slotSceneError(
          'gridDimsInconsistent',
          jsonPointer([...base, 'rows']),
          `reelStrip rows must be in [2, 6], received ${grid.rows}`,
          { topology: grid.topology, rows: grid.rows },
        ),
      );
    }
    return;
  }
  if (grid.topology === 'scatterPay') {
    if (grid.cols < 5 || grid.cols > 7) {
      errors.push(
        slotSceneError(
          'gridDimsInconsistent',
          jsonPointer([...base, 'cols']),
          `scatterPay cols must be in [5, 7], received ${grid.cols}`,
          { topology: grid.topology, cols: grid.cols },
        ),
      );
    }
    return;
  }
  // cluster
  if (grid.cols !== grid.rows) {
    errors.push(
      slotSceneError(
        'gridDimsInconsistent',
        jsonPointer([...base, 'rows']),
        `cluster grid must be square, received ${grid.cols}x${grid.rows}`,
        { topology: grid.topology, cols: grid.cols, rows: grid.rows },
      ),
    );
  }
}

// Gravity / topology consistency (format-contract section 15.4): a cluster requires `cluster-down`.
// (reelStrip and scatterPay use `column-down`; that is not re-asserted here because the cluster rule is
// the only documented gravity/topology coupling, but a cluster with column-down is the rejected case.)
function checkGridGravity(grid: GridConfig, errors: SlotSceneError[]): void {
  if (grid.topology === 'cluster' && grid.gravity !== 'cluster-down') {
    errors.push(
      slotSceneError(
        'gridGravityInconsistent',
        jsonPointer(['scene', 'grid', 'gravity']),
        `cluster topology requires gravity "cluster-down", received "${grid.gravity}"`,
        { topology: grid.topology, gravity: grid.gravity },
      ),
    );
  }
}

// Anticipation bounds (format-contract section 15.4): triggerSymbols non-empty, thresholdCount >= 1,
// maxAnticipatingCols in [1, cols]. Each violation carries its own code and path.
function checkAnticipation(grid: GridConfig, errors: SlotSceneError[]): void {
  const base = ['scene', 'grid', 'anticipation'] as const;
  const anticipation = grid.anticipation;
  if (anticipation.triggerSymbols.length === 0) {
    errors.push(
      slotSceneError(
        'anticipationEmptyTriggers',
        jsonPointer([...base, 'triggerSymbols']),
        'anticipation.triggerSymbols must be non-empty',
      ),
    );
  }
  if (anticipation.thresholdCount < 1) {
    errors.push(
      slotSceneError(
        'anticipationThreshold',
        jsonPointer([...base, 'thresholdCount']),
        `anticipation.thresholdCount must be >= 1, received ${anticipation.thresholdCount}`,
        { thresholdCount: anticipation.thresholdCount },
      ),
    );
  }
  if (anticipation.maxAnticipatingCols < 1 || anticipation.maxAnticipatingCols > grid.cols) {
    errors.push(
      slotSceneError(
        'anticipationColsOutOfRange',
        jsonPointer([...base, 'maxAnticipatingCols']),
        `anticipation.maxAnticipatingCols must be in [1, ${grid.cols}], received ${anticipation.maxAnticipatingCols}`,
        { maxAnticipatingCols: anticipation.maxAnticipatingCols, cols: grid.cols },
      ),
    );
  }
}

// Index refs.skeletons / refs.vfxPresets by name to their declared hash. A duplicate name keeps the
// first; duplicate ref names are not a documented fault here (the resolver resolves by name).
function indexRefs(refs: SceneRefs): {
  skeletonHashes: ReadonlyMap<string, string>;
  vfxHashes: ReadonlyMap<string, string>;
} {
  const skeletonHashes = new Map<string, string>();
  for (const entry of refs.skeletons) {
    if (!skeletonHashes.has(entry.name)) skeletonHashes.set(entry.name, entry.hash);
  }
  const vfxHashes = new Map<string, string>();
  for (const entry of refs.vfxPresets) {
    if (!vfxHashes.has(entry.name)) vfxHashes.set(entry.name, entry.hash);
  }
  return { skeletonHashes, vfxHashes };
}

// Symbol animation references: every SymbolAnimSet.skeletonRef resolves to a refs.skeletons name; that
// skeleton (via the resolver) contains the referenced idle/land/win/anticipation animation names; and
// the referenced skeleton's declared hash matches the resolver's on-disk hash.
function checkSymbolRefs(
  doc: SlotSceneDocument,
  skeletonHashes: ReadonlyMap<string, string>,
  resolver: SceneResolver,
  errors: SlotSceneError[],
): void {
  // Keyed iteration only (phase-4 section 5.4.1): we collect errors, never produce ordered output, so
  // iterating the symbols record here does not affect any emitted ordering.
  for (const [symbolKey, animSet] of Object.entries(doc.scene.symbols)) {
    // noUncheckedIndexedAccess widens the record value to `SymbolAnimSet | undefined`; a real entry is
    // never undefined, so skip the impossible case to keep the body sound without a cast.
    if (animSet === undefined) continue;
    const symbolBase = ['scene', 'symbols', symbolKey] as const;
    const declaredHash = skeletonHashes.get(animSet.skeletonRef);
    if (declaredHash === undefined) {
      errors.push(
        slotSceneError(
          'skeletonRefMissing',
          jsonPointer([...symbolBase, 'skeletonRef']),
          `symbol "${symbolKey}" references skeleton "${animSet.skeletonRef}", which is not in refs.skeletons`,
          { symbol: symbolKey, skeletonRef: animSet.skeletonRef },
        ),
      );
      continue;
    }
    const resolved = resolver.skeleton(animSet.skeletonRef);
    if (resolved === null) {
      errors.push(
        slotSceneError(
          'skeletonRefMissing',
          jsonPointer([...symbolBase, 'skeletonRef']),
          `symbol "${symbolKey}" references skeleton "${animSet.skeletonRef}", which could not be resolved`,
          { symbol: symbolKey, skeletonRef: animSet.skeletonRef },
        ),
      );
      continue;
    }
    if (resolved.hash !== declaredHash) {
      errors.push(
        slotSceneError(
          'refHashMismatch',
          jsonPointer([...symbolBase, 'skeletonRef']),
          `skeleton "${animSet.skeletonRef}" on-disk hash does not match the hash declared in refs.skeletons`,
          { skeletonRef: animSet.skeletonRef, declared: declaredHash, actual: resolved.hash },
        ),
      );
    }
    const animationNames = new Set(resolved.animations);
    // win is reused for anticipation when anticipation is absent, so an absent anticipation is never a
    // missing-animation fault; a PRESENT anticipation naming an unknown animation is.
    const requiredAnimations: ReadonlyArray<{ field: 'idle' | 'land' | 'win'; name: string }> = [
      { field: 'idle', name: animSet.idle },
      { field: 'land', name: animSet.land },
      { field: 'win', name: animSet.win },
    ];
    for (const { field, name } of requiredAnimations) {
      if (!animationNames.has(name)) {
        errors.push(
          slotSceneError(
            'animationRefMissing',
            jsonPointer([...symbolBase, field]),
            `symbol "${symbolKey}" ${field} animation "${name}" does not exist in skeleton "${animSet.skeletonRef}"`,
            { symbol: symbolKey, field, animation: name, skeletonRef: animSet.skeletonRef },
          ),
        );
      }
    }
    if (animSet.anticipation !== undefined && !animationNames.has(animSet.anticipation)) {
      errors.push(
        slotSceneError(
          'animationRefMissing',
          jsonPointer([...symbolBase, 'anticipation']),
          `symbol "${symbolKey}" anticipation animation "${animSet.anticipation}" does not exist in skeleton "${animSet.skeletonRef}"`,
          {
            symbol: symbolKey,
            field: 'anticipation',
            animation: animSet.anticipation,
            skeletonRef: animSet.skeletonRef,
          },
        ),
      );
    }
  }
}

// VFX preset references used by win-sequence steps and feature-flow nodes resolve to refs.vfxPresets,
// and the referenced preset's declared hash matches the resolver's on-disk hash.
function checkVfxRefs(
  doc: SlotSceneDocument,
  vfxHashes: ReadonlyMap<string, string>,
  resolver: SceneResolver,
  errors: SlotSceneError[],
): void {
  const checkPreset = (name: string, path: string): void => {
    const declaredHash = vfxHashes.get(name);
    if (declaredHash === undefined) {
      errors.push(
        slotSceneError(
          'vfxPresetMissing',
          path,
          `VFX preset "${name}" is referenced but is not in refs.vfxPresets`,
          { vfxPreset: name },
        ),
      );
      return;
    }
    const resolved = resolver.vfxPreset(name);
    if (resolved === null) {
      errors.push(
        slotSceneError(
          'vfxPresetMissing',
          path,
          `VFX preset "${name}" is referenced but could not be resolved`,
          { vfxPreset: name },
        ),
      );
      return;
    }
    if (resolved.hash !== declaredHash) {
      errors.push(
        slotSceneError(
          'refHashMismatch',
          path,
          `VFX preset "${name}" on-disk hash does not match the hash declared in refs.vfxPresets`,
          { vfxPreset: name, declared: declaredHash, actual: resolved.hash },
        ),
      );
    }
  };

  // Win-sequence steps. Keyed iteration over the sequences record (no ordered output is produced).
  for (const [sequenceKey, sequence] of Object.entries(doc.scene.winSequencer.sequences)) {
    if (sequence === undefined) continue;
    sequence.steps.forEach((step, stepIndex) => {
      if (step.vfxPreset !== undefined) {
        checkPreset(
          step.vfxPreset,
          jsonPointer([
            'scene',
            'winSequencer',
            'sequences',
            sequenceKey,
            'steps',
            stepIndex,
            'vfxPreset',
          ]),
        );
      }
    });
  }

  // Feature-flow nodes. Keyed iteration over the states record.
  for (const [stateKey, node] of Object.entries(doc.scene.featureFlows.states)) {
    if (node === undefined) continue;
    const preset = node.cinematic?.vfxPreset;
    if (preset !== undefined) {
      checkPreset(
        preset,
        jsonPointer(['scene', 'featureFlows', 'states', stateKey, 'cinematic', 'vfxPreset']),
      );
    }
  }
}

// Run every slot semantic family over a structurally valid document and collect all errors.
export function validateSlotSceneSemantic(
  doc: SlotSceneDocument,
  resolver: SceneResolver,
): SlotSceneError[] {
  const errors: SlotSceneError[] = [];
  checkGridDims(doc.scene.grid, errors);
  checkGridGravity(doc.scene.grid, errors);
  checkAnticipation(doc.scene.grid, errors);
  const { skeletonHashes, vfxHashes } = indexRefs(doc.refs);
  checkSymbolRefs(doc, skeletonHashes, resolver, errors);
  checkVfxRefs(doc, vfxHashes, resolver, errors);
  return errors;
}
