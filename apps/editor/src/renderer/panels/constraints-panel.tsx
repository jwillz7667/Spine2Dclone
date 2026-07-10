import type { IDockviewPanelProps } from 'dockview';
import { useEffect, useMemo, type CSSProperties, type ReactElement } from 'react';
import {
  ConstraintError,
  CreatePhysicsConstraintCommand,
  DeletePhysicsConstraintCommand,
  RenamePhysicsConstraintCommand,
  ReorderConstraintsCommand,
  SetIkBendPositiveCommand,
  SetIkDepthParamsCommand,
  SetIkMixCommand,
  SetPathConstraintParamsCommand,
  SetTransformConstraintVariantsCommand,
  documentHost,
  type IkConstraintEntity,
  type IkConstraintId,
  type PathConstraintEntity,
  type PathConstraintId,
  type PathConstraintParamPatch,
  type PhysicsConstraintEntity,
  type PhysicsConstraintId,
  type PhysicsConstraintParams,
  type TransformConstraintEntity,
  type TransformConstraintId,
} from '../document';
import type { PhysicsChannel } from '@marionette/format/types';
import { useDocumentRevision } from '../editor-state/use-document-revision';
import { useSelectionStore } from '../editor-state/selection-store';
import {
  useConstraintSelectionStore,
  type ConstraintSelection,
} from '../editor-state/constraint-selection-store';
import {
  moveInOrder,
  parseSoftnessInput,
  reconcileConstraintSelection,
  solveOrderView,
  uniquePhysicsName,
  type OrderedConstraint,
} from './constraints-logic';

// A fresh physics constraint's default parameters (ADR-0014 authoring defaults, matching the document-core
// create fixture): a 1/60s fixed step, a middle follow-through, a firm spring, near-undamped, unit mass, no
// world weather, full mix. The default channel set simulates the local rotation, the most common tail/rope
// setup. Both are plain values passed to CreatePhysicsConstraint (LAW 2); the command validates them.
const DEFAULT_PHYSICS_PARAMS: PhysicsConstraintParams = {
  step: 1 / 60,
  inertia: 0.5,
  strength: 40,
  damping: 0.9,
  mass: 1,
  wind: 0,
  gravity: 0,
  mix: 1,
};
const DEFAULT_PHYSICS_CHANNELS: readonly PhysicsChannel[] = ['rotation'];

const ACCENT = '#5aa0ff';

// The Constraints panel (PP-D10). Edits IK constraints (mix, signed-via-boolean bend, and the Stage F2 depth
// fields softness/stretch/compress/uniform) over their document-core commands on the live History (LAW 2);
// the panel never mutates the document. The EDITED constraint is ephemeral EDITOR state (the
// constraint-selection store, the document/editor wall, LAW 1), reconciled through the pure reconciler when an
// undo removes the selected constraint. The panel polls model.revision (like the other panels) so it refreshes
// after any command, undo/redo, or external change. Transform-constraint editing (local/relative variants and
// the cross-array solve order) extends this same panel in the following PP-D10 slices.
export function ConstraintsPanel(_props: IDockviewPanelProps): ReactElement {
  const revision = useDocumentRevision();
  const model = documentHost.current().model;
  const selection = useConstraintSelectionStore((state) => state.selection);

  const ikConstraints = useMemo(() => model.ikConstraints(), [model, revision]);
  const transformConstraints = useMemo(() => model.transformConstraints(), [model, revision]);
  const pathConstraints = useMemo(() => model.pathConstraints(), [model, revision]);
  const physicsConstraints = useMemo(() => model.physicsConstraints(), [model, revision]);
  const boneCount = useMemo(() => model.bones().length, [model, revision]);
  const ikIds = useMemo(() => ikConstraints.map((c) => c.id), [ikConstraints]);
  const transformIds = useMemo(() => transformConstraints.map((c) => c.id), [transformConstraints]);
  const pathIds = useMemo(() => pathConstraints.map((c) => c.id), [pathConstraints]);
  const physicsIds = useMemo(() => physicsConstraints.map((c) => c.id), [physicsConstraints]);

  // Clear a dangling selection when its constraint no longer resolves (a delete/undo the panel did not drive).
  useEffect(() => {
    const next = reconcileConstraintSelection(selection, ikIds, transformIds, pathIds, physicsIds);
    if (next !== selection) useConstraintSelectionStore.getState().select(next);
  }, [selection, ikIds, transformIds, pathIds, physicsIds]);

  const selectedIk = useMemo(
    () => (selection?.kind === 'ik' ? ikConstraints.find((c) => c.id === selection.id) : undefined),
    [selection, ikConstraints],
  );
  const selectedTransform = useMemo(
    () =>
      selection?.kind === 'transform'
        ? transformConstraints.find((c) => c.id === selection.id)
        : undefined,
    [selection, transformConstraints],
  );
  const selectedPath = useMemo(
    () =>
      selection?.kind === 'path' ? pathConstraints.find((c) => c.id === selection.id) : undefined,
    [selection, pathConstraints],
  );
  const selectedPhysics = useMemo(
    () =>
      selection?.kind === 'physics'
        ? physicsConstraints.find((c) => c.id === selection.id)
        : undefined,
    [selection, physicsConstraints],
  );

  const solveOrder = useMemo<OrderedConstraint[]>(
    () =>
      solveOrderView(
        ikConstraints.map((c) => ({
          kind: 'ik',
          id: c.id,
          name: c.name,
          order: c.order,
        })),
        transformConstraints.map((c) => ({
          kind: 'transform',
          id: c.id,
          name: c.name,
          order: c.order,
        })),
        pathConstraints.map((c) => ({
          kind: 'path',
          id: c.id,
          name: c.name,
          order: c.order,
        })),
        physicsConstraints.map((c) => ({
          kind: 'physics',
          id: c.id,
          name: c.name,
          order: c.order,
        })),
      ),
    [ikConstraints, transformConstraints, pathConstraints, physicsConstraints],
  );
  const hasExplicitOrder = useMemo(
    () => solveOrder.some((c) => c.order !== undefined),
    [solveOrder],
  );

  const total =
    ikConstraints.length +
    transformConstraints.length +
    pathConstraints.length +
    physicsConstraints.length;

  return (
    <div style={rootStyle}>
      <div style={toolbarStyle}>
        <span style={headerStyle}>Constraints</span>
        <button
          type="button"
          style={boneCount > 0 ? smallButtonStyle : { ...smallButtonStyle, ...buttonDisabledStyle }}
          disabled={boneCount === 0}
          title={
            boneCount === 0
              ? 'Add a bone first: a physics constraint drives one bone.'
              : 'Create a physics constraint on the selected bone (or the first bone)'
          }
          onClick={createPhysicsConstraint}
        >
          New Physics
        </button>
        <span style={countStyle}>
          {total} {total === 1 ? 'constraint' : 'constraints'}
        </span>
      </div>

      <div style={listStyle}>
        {total === 0 && (
          <div style={emptyStyle}>
            No constraints. Create a physics constraint above, or an IK/transform/path constraint
            from the viewport tools or the MCP surface.
          </div>
        )}
        {ikConstraints.map((c) => (
          <div
            key={c.id}
            style={
              selection?.kind === 'ik' && selection.id === c.id
                ? { ...rowStyle, ...rowActiveStyle }
                : rowStyle
            }
            onClick={() => selectConstraint({ kind: 'ik', id: c.id })}
          >
            <span style={nameStyle}>{c.name}</span>
            <span style={badgeStyle}>IK</span>
          </div>
        ))}
        {transformConstraints.map((c) => (
          <div
            key={c.id}
            style={
              selection?.kind === 'transform' && selection.id === c.id
                ? { ...rowStyle, ...rowActiveStyle }
                : rowStyle
            }
            onClick={() => selectConstraint({ kind: 'transform', id: c.id })}
          >
            <span style={nameStyle}>{c.name}</span>
            <span style={badgeStyle}>TR</span>
          </div>
        ))}
        {pathConstraints.map((c) => (
          <div
            key={c.id}
            style={
              selection?.kind === 'path' && selection.id === c.id
                ? { ...rowStyle, ...rowActiveStyle }
                : rowStyle
            }
            onClick={() => selectConstraint({ kind: 'path', id: c.id })}
          >
            <span style={nameStyle}>{c.name}</span>
            <span style={badgeStyle}>PA</span>
          </div>
        ))}
        {physicsConstraints.map((c) => (
          <div
            key={c.id}
            style={
              selection?.kind === 'physics' && selection.id === c.id
                ? { ...rowStyle, ...rowActiveStyle }
                : rowStyle
            }
            onClick={() => selectConstraint({ kind: 'physics', id: c.id })}
          >
            <span style={nameStyle}>{c.name}</span>
            <span style={badgeStyle}>PH</span>
          </div>
        ))}
      </div>

      <div style={detailStyle}>
        {selectedIk !== undefined ? (
          <IkConstraintDetail constraint={selectedIk} />
        ) : selectedTransform !== undefined ? (
          <TransformConstraintDetail constraint={selectedTransform} />
        ) : selectedPath !== undefined ? (
          <PathConstraintDetail constraint={selectedPath} />
        ) : selectedPhysics !== undefined ? (
          <PhysicsConstraintManage constraint={selectedPhysics} />
        ) : (
          <div style={emptyStyle}>Select a constraint to edit it.</div>
        )}

        {solveOrder.length > 1 && (
          <div style={orderSectionStyle}>
            <div style={fieldRowStyle}>
              <span style={sectionLabelStyle}>Solve order</span>
              {hasExplicitOrder && (
                <button
                  type="button"
                  style={smallButtonStyle}
                  title="Clear the explicit order and restore the default (all IK, then transform, then path)"
                  onClick={() => clearConstraintOrder()}
                >
                  Reset
                </button>
              )}
            </div>
            {solveOrder.map((c, index) => (
              <div key={c.id} style={orderRowStyle}>
                <span style={orderIndexStyle}>{index + 1}</span>
                <span style={nameStyle}>{c.name}</span>
                <span style={badgeStyle}>
                  {c.kind === 'ik'
                    ? 'IK'
                    : c.kind === 'transform'
                      ? 'TR'
                      : c.kind === 'path'
                        ? 'PA'
                        : 'PH'}
                </span>
                <button
                  type="button"
                  style={arrowButtonStyle}
                  disabled={index === 0}
                  title="Move earlier in the solve order"
                  onClick={() => reorderBy(solveOrder, index, -1)}
                >
                  Up
                </button>
                <button
                  type="button"
                  style={arrowButtonStyle}
                  disabled={index === solveOrder.length - 1}
                  title="Move later in the solve order"
                  onClick={() => reorderBy(solveOrder, index, 1)}
                >
                  Down
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Module-scope command dispatch (mirrors skins-panel / inspector-panel). Each reads the LIVE document through
// documentHost.current() so nothing closes over a stale model, and routes every change through History (LAW 2).

function selectConstraint(selection: ConstraintSelection): void {
  useConstraintSelectionStore.getState().select(selection);
}

// Move the constraint at `index` by `delta` and commit the whole new permutation as one ReorderConstraints
// (LAW 2). An out-of-bounds move returns the same list, so no command is issued.
function reorderBy(order: readonly OrderedConstraint[], index: number, delta: number): void {
  const ids = order.map((c) => c.id);
  const next = moveInOrder(ids, index, delta);
  if (next === ids) return;
  documentHost.current().history.execute(new ReorderConstraintsCommand([...next]));
}

// Clear the explicit order on every constraint, restoring the default (all IK, then all transform).
function clearConstraintOrder(): void {
  documentHost.current().history.execute(new ReorderConstraintsCommand(null));
}

function setIkMix(id: IkConstraintId, mix: number): void {
  documentHost.current().history.execute(new SetIkMixCommand(id, mix));
}

function setIkBend(id: IkConstraintId, bendPositive: boolean): void {
  documentHost.current().history.execute(new SetIkBendPositiveCommand(id, bendPositive));
}

function setIkSoftness(id: IkConstraintId, softness: number): void {
  documentHost.current().history.execute(new SetIkDepthParamsCommand(id, { softness }));
}

function setIkStretch(id: IkConstraintId, stretch: boolean): void {
  documentHost.current().history.execute(new SetIkDepthParamsCommand(id, { stretch }));
}

function setIkCompress(id: IkConstraintId, compress: boolean): void {
  documentHost.current().history.execute(new SetIkDepthParamsCommand(id, { compress }));
}

function setIkUniform(id: IkConstraintId, uniform: boolean): void {
  documentHost.current().history.execute(new SetIkDepthParamsCommand(id, { uniform }));
}

function setTransformLocal(id: TransformConstraintId, local: boolean): void {
  documentHost.current().history.execute(new SetTransformConstraintVariantsCommand(id, { local }));
}

function setTransformRelative(id: TransformConstraintId, relative: boolean): void {
  documentHost
    .current()
    .history.execute(new SetTransformConstraintVariantsCommand(id, { relative }));
}

// Patch one or more path-constraint parameters (PP-D11) through SetPathConstraintParams on the live History
// (LAW 2). The panel dropdowns and number fields each pass a single-key patch.
function setPathParams(id: PathConstraintId, patch: PathConstraintParamPatch): void {
  documentHost.current().history.execute(new SetPathConstraintParamsCommand(id, patch));
}

// Create a physics constraint on the selected bone (or the first bone when none is selected) through
// CreatePhysicsConstraint on the live History (LAW 2). The button is disabled with no bones; this returns
// defensively in that case. The id is minted here so redo reuses it, the name is uniquified against ALL
// constraint names (the shared namespace, ADR-0014) so the command's duplicate guard never fires on the
// default, and the new constraint is selected so the Inspector opens on it immediately.
function createPhysicsConstraint(): void {
  const doc = documentHost.current();
  const first = doc.model.bones()[0];
  if (first === undefined) return;
  const selectedBone = useSelectionStore.getState().selectedBoneIds[0];
  const bone = selectedBone ?? first.id;
  const existingNames = [
    ...doc.model.ikConstraints(),
    ...doc.model.transformConstraints(),
    ...doc.model.pathConstraints(),
    ...doc.model.physicsConstraints(),
  ].map((c) => c.name);
  const id = doc.ids.mint('physicsConstraint');
  doc.history.execute(
    new CreatePhysicsConstraintCommand(
      id,
      uniquePhysicsName(existingNames),
      bone,
      [...DEFAULT_PHYSICS_CHANNELS],
      DEFAULT_PHYSICS_PARAMS,
    ),
  );
  useConstraintSelectionStore.getState().select({ kind: 'physics', id });
}

// Rename a physics constraint through RenamePhysicsConstraint (LAW 2). A blank or unchanged name is dropped
// (no command). A duplicate name is rejected by the command with a typed ConstraintError; that is swallowed
// at this UI edge (the field reverts on the panel re-render) rather than surfaced as an uncaught throw.
function renamePhysicsConstraint(id: PhysicsConstraintId, name: string): void {
  try {
    documentHost.current().history.execute(new RenamePhysicsConstraintCommand(id, name));
  } catch (error) {
    if (!(error instanceof ConstraintError)) throw error;
  }
}

// Delete a physics constraint through DeletePhysicsConstraint (LAW 2), cascading its timeline tracks and its
// slot in the combined solve order in ONE undo step. The reconcile effect clears the now-dangling selection.
function deletePhysicsConstraint(id: PhysicsConstraintId): void {
  documentHost.current().history.execute(new DeletePhysicsConstraintCommand(id));
}

function IkConstraintDetail(props: { readonly constraint: IkConstraintEntity }): ReactElement {
  const c = props.constraint;
  return (
    <div style={detailBodyStyle}>
      <div style={subHeaderStyle}>{c.name}</div>

      <label style={fieldRowStyle}>
        <span style={labelStyle}>Mix</span>
        <input
          type="number"
          min={0}
          max={1}
          step={0.05}
          defaultValue={c.mix}
          key={`mix-${c.id}-${c.mix}`}
          style={numberInputStyle}
          onBlur={(event) => {
            const v = Number(event.currentTarget.value);
            if (Number.isFinite(v) && v >= 0 && v <= 1 && v !== c.mix) setIkMix(c.id, v);
            else event.currentTarget.value = String(c.mix);
          }}
        />
      </label>

      <label style={checkRowStyle}>
        <input
          type="checkbox"
          checked={c.bendPositive}
          onChange={(event) => setIkBend(c.id, event.currentTarget.checked)}
        />
        <span>Bend positive</span>
      </label>

      <div style={sectionLabelStyle}>Depth (Stage F2)</div>

      <label style={fieldRowStyle}>
        <span style={labelStyle}>Softness</span>
        <input
          type="number"
          min={0}
          step={0.5}
          defaultValue={c.softness}
          key={`soft-${c.id}-${c.softness}`}
          style={numberInputStyle}
          title="World-unit distance from full extension where the two-bone solve eases in (>= 0)"
          onBlur={(event) => {
            const parsed = parseSoftnessInput(event.currentTarget.value);
            if (parsed !== null && parsed !== c.softness) setIkSoftness(c.id, parsed);
            else event.currentTarget.value = String(c.softness);
          }}
        />
      </label>

      <label style={checkRowStyle}>
        <input
          type="checkbox"
          checked={c.stretch}
          onChange={(event) => setIkStretch(c.id, event.currentTarget.checked)}
        />
        <span>Stretch (chain may lengthen to reach)</span>
      </label>

      <label style={checkRowStyle}>
        <input
          type="checkbox"
          checked={c.compress}
          onChange={(event) => setIkCompress(c.id, event.currentTarget.checked)}
        />
        <span>Compress (chain may shorten)</span>
      </label>

      <label style={checkRowStyle}>
        <input
          type="checkbox"
          checked={c.uniform}
          onChange={(event) => setIkUniform(c.id, event.currentTarget.checked)}
        />
        <span>Uniform (scale both bones when stretching)</span>
      </label>
    </div>
  );
}

function TransformConstraintDetail(props: {
  readonly constraint: TransformConstraintEntity;
}): ReactElement {
  const c = props.constraint;
  return (
    <div style={detailBodyStyle}>
      <div style={subHeaderStyle}>{c.name}</div>

      <div style={sectionLabelStyle}>Variants (Stage F2)</div>

      <label style={checkRowStyle}>
        <input
          type="checkbox"
          checked={c.local}
          onChange={(event) => setTransformLocal(c.id, event.currentTarget.checked)}
        />
        <span>Local (local-space read/write)</span>
      </label>

      <label style={checkRowStyle}>
        <input
          type="checkbox"
          checked={c.relative}
          onChange={(event) => setTransformRelative(c.id, event.currentTarget.checked)}
        />
        <span>Relative (offset from the bone current value)</span>
      </label>

      <div style={noteStyle}>
        Mix and offset channels are authored over the MCP transform.setParams surface.
      </div>
    </div>
  );
}

const POSITION_MODES = ['fixed', 'percent'] as const;
const SPACING_MODES = ['length', 'fixed', 'percent', 'proportional'] as const;
const ROTATE_MODES = ['tangent', 'chain', 'chainScale'] as const;

// A number field that commits on blur when the parsed value is finite and changed, else reverts. Shared by
// the path scalar/mix rows. `clamp01` bounds a mix channel to [0, 1].
function PathNumberField(props: {
  readonly label: string;
  readonly value: number;
  readonly step: number;
  readonly clamp01?: boolean;
  readonly commit: (value: number) => void;
}): ReactElement {
  const { label, value, step, clamp01, commit } = props;
  return (
    <label style={fieldRowStyle}>
      <span style={labelStyle}>{label}</span>
      <input
        type="number"
        step={step}
        {...(clamp01 ? { min: 0, max: 1 } : {})}
        defaultValue={value}
        key={`${label}-${value}`}
        style={numberInputStyle}
        onBlur={(event) => {
          const v = Number(event.currentTarget.value);
          const ok = Number.isFinite(v) && (!clamp01 || (v >= 0 && v <= 1));
          if (ok && v !== value) commit(v);
          else event.currentTarget.value = String(value);
        }}
      />
    </label>
  );
}

// The path-constraint detail editor (PP-D11): the three mode dropdowns, the position/spacing/offsetRotation
// scalars, and the three mix channels, each committing a single-field SetPathConstraintParams (LAW 2). The
// target slot and bones are structural (authored at create); this panel edits the animatable parameters.
function PathConstraintDetail(props: { readonly constraint: PathConstraintEntity }): ReactElement {
  const c = props.constraint;
  return (
    <div style={detailBodyStyle}>
      <div style={subHeaderStyle}>{c.name}</div>

      <div style={sectionLabelStyle}>Modes</div>

      <label style={fieldRowStyle}>
        <span style={labelStyle}>Position</span>
        <select
          style={selectStyle}
          value={c.positionMode}
          onChange={(event) =>
            setPathParams(c.id, { positionMode: readPositionMode(event.target.value) })
          }
        >
          {POSITION_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>
      </label>

      <label style={fieldRowStyle}>
        <span style={labelStyle}>Spacing</span>
        <select
          style={selectStyle}
          value={c.spacingMode}
          onChange={(event) =>
            setPathParams(c.id, { spacingMode: readSpacingMode(event.target.value) })
          }
        >
          {SPACING_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>
      </label>

      <label style={fieldRowStyle}>
        <span style={labelStyle}>Rotate</span>
        <select
          style={selectStyle}
          value={c.rotateMode}
          onChange={(event) =>
            setPathParams(c.id, { rotateMode: readRotateMode(event.target.value) })
          }
        >
          {ROTATE_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>
      </label>

      <div style={sectionLabelStyle}>Scalars</div>
      <PathNumberField
        label="Position"
        value={c.position}
        step={0.05}
        commit={(v) => setPathParams(c.id, { position: v })}
      />
      <PathNumberField
        label="Spacing"
        value={c.spacing}
        step={0.05}
        commit={(v) => setPathParams(c.id, { spacing: v })}
      />
      <PathNumberField
        label="Offset Rot"
        value={c.offsetRotation}
        step={1}
        commit={(v) => setPathParams(c.id, { offsetRotation: v })}
      />

      <div style={sectionLabelStyle}>Mix</div>
      <PathNumberField
        label="Rotate"
        value={c.mixRotate}
        step={0.05}
        clamp01
        commit={(v) => setPathParams(c.id, { mixRotate: v })}
      />
      <PathNumberField
        label="X"
        value={c.mixX}
        step={0.05}
        clamp01
        commit={(v) => setPathParams(c.id, { mixX: v })}
      />
      <PathNumberField
        label="Y"
        value={c.mixY}
        step={0.05}
        clamp01
        commit={(v) => setPathParams(c.id, { mixY: v })}
      />

      <div style={noteStyle}>
        Path timeline keys are authored in the dopesheet and the MCP path.* surface.
      </div>
    </div>
  );
}

// Narrow a select value back to its mode literal; the options only ever emit valid members, so a mismatch is
// impossible in practice, but the guard keeps the type sound without an `as` cast.
function readPositionMode(value: string): PathConstraintEntity['positionMode'] {
  return value === 'fixed' ? 'fixed' : 'percent';
}
function readSpacingMode(value: string): PathConstraintEntity['spacingMode'] {
  return value === 'fixed' || value === 'percent' || value === 'proportional' ? value : 'length';
}
function readRotateMode(value: string): PathConstraintEntity['rotateMode'] {
  return value === 'chain' || value === 'chainScale' ? value : 'tangent';
}

// The physics-constraint management block (PP-D12): rename and delete only. The parameter editing (target
// bone, simulated channels, the model/force knobs, and the skeleton settings block) lives in the Inspector,
// which the selection drives, so this block stays a compact list-management surface mirroring the create/
// delete verbs the other three constraint kinds get from the viewport tools. The rename field remounts on
// its committed value (a committed command, an undo/redo, or a rejected duplicate all re-sync it).
function PhysicsConstraintManage(props: {
  readonly constraint: PhysicsConstraintEntity;
}): ReactElement {
  const c = props.constraint;
  return (
    <div style={detailBodyStyle}>
      <div style={subHeaderStyle}>{c.name}</div>

      <label style={fieldRowStyle}>
        <span style={labelStyle}>Name</span>
        <input
          type="text"
          defaultValue={c.name}
          key={`ph-name-${c.id}-${c.name}`}
          spellCheck={false}
          style={nameInputStyle}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            else if (event.key === 'Escape') {
              event.currentTarget.value = c.name;
              event.currentTarget.blur();
            }
          }}
          onBlur={(event) => {
            const next = event.currentTarget.value.trim();
            if (next !== '' && next !== c.name) renamePhysicsConstraint(c.id, next);
            else event.currentTarget.value = c.name;
          }}
        />
        <button
          type="button"
          style={smallButtonStyle}
          title="Delete this physics constraint (removes its timeline keys in one undo step)"
          onClick={() => deletePhysicsConstraint(c.id)}
        >
          Delete
        </button>
      </label>

      <div style={noteStyle}>
        Physics parameters (target bone, simulated channels, model and force knobs, and the skeleton
        physics settings) are edited in the Inspector.
      </div>
    </div>
  );
}

const rootStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100%',
  background: '#1b1b1b',
  color: '#dddddd',
  fontSize: 12,
};

const toolbarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 8px',
  borderBottom: '1px solid #333333',
  flex: '0 0 auto',
};

const headerStyle: CSSProperties = { color: '#cccccc', fontWeight: 600 };
const countStyle: CSSProperties = { marginLeft: 'auto', color: '#888888' };
const listStyle: CSSProperties = { flex: '0 0 auto', maxHeight: '40%', overflowY: 'auto' };

const detailStyle: CSSProperties = {
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  borderTop: '1px solid #333333',
};

const emptyStyle: CSSProperties = { color: '#777777', padding: 12 };

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 8px',
  borderBottom: '1px solid #262626',
  cursor: 'pointer',
  userSelect: 'none',
};

const rowActiveStyle: CSSProperties = {
  background: '#26354a',
  boxShadow: `inset 2px 0 0 ${ACCENT}`,
};

const nameStyle: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: '#eeeeee',
};

const badgeStyle: CSSProperties = {
  fontSize: 10,
  color: '#8899aa',
  border: '1px solid #3a4a5a',
  borderRadius: 3,
  padding: '0 4px',
};

const detailBodyStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 10,
};

const subHeaderStyle: CSSProperties = {
  color: '#cccccc',
  fontWeight: 600,
  paddingBottom: 4,
  borderBottom: '1px solid #2c2c2c',
};

const sectionLabelStyle: CSSProperties = {
  color: '#8899aa',
  fontSize: 11,
  paddingTop: 6,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const fieldRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };
const labelStyle: CSSProperties = { flex: '0 0 72px', color: '#bbbbbb' };

const numberInputStyle: CSSProperties = {
  flex: '0 0 96px',
  fontSize: 12,
  color: '#dddddd',
  background: '#222222',
  border: '1px solid #3a3a3a',
  borderRadius: 3,
  padding: '2px 6px',
};

const nameInputStyle: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  fontSize: 12,
  color: '#eeeeee',
  background: '#222222',
  border: '1px solid #3a3a3a',
  borderRadius: 3,
  padding: '2px 6px',
};

const buttonDisabledStyle: CSSProperties = {
  opacity: 0.45,
  cursor: 'not-allowed',
};

const checkRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  color: '#cccccc',
  cursor: 'pointer',
};

const selectStyle: CSSProperties = {
  flex: '1 1 auto',
  color: '#dddddd',
  background: '#222222',
  border: '1px solid #3a3a3a',
  borderRadius: 3,
  padding: '2px 6px',
};

const noteStyle: CSSProperties = { color: '#777777', fontSize: 11, paddingTop: 6 };

const orderSectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: 10,
  borderTop: '1px solid #2c2c2c',
};

const orderRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const orderIndexStyle: CSSProperties = {
  flex: '0 0 18px',
  color: '#8899aa',
  textAlign: 'right',
};

const smallButtonStyle: CSSProperties = {
  flex: '0 0 auto',
  padding: '2px 8px',
  fontSize: 11,
  color: '#dddddd',
  background: '#2d2d2d',
  border: '1px solid #444444',
  borderRadius: 4,
  cursor: 'pointer',
};

const arrowButtonStyle: CSSProperties = {
  flex: '0 0 auto',
  padding: '1px 8px',
  fontSize: 11,
  color: '#dddddd',
  background: '#2d2d2d',
  border: '1px solid #444444',
  borderRadius: 4,
  cursor: 'pointer',
};
