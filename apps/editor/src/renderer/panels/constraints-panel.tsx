import type { IDockviewPanelProps } from 'dockview';
import { useEffect, useMemo, type CSSProperties, type ReactElement } from 'react';
import {
  ReorderConstraintsCommand,
  SetIkBendPositiveCommand,
  SetIkDepthParamsCommand,
  SetIkMixCommand,
  SetTransformConstraintVariantsCommand,
  documentHost,
  type IkConstraintEntity,
  type IkConstraintId,
  type TransformConstraintEntity,
  type TransformConstraintId,
} from '../document';
import { useDocumentRevision } from '../editor-state/use-document-revision';
import {
  useConstraintSelectionStore,
  type ConstraintSelection,
} from '../editor-state/constraint-selection-store';
import {
  moveInOrder,
  parseSoftnessInput,
  reconcileConstraintSelection,
  solveOrderView,
  type OrderedConstraint,
} from './constraints-logic';

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
  const ikIds = useMemo(() => ikConstraints.map((c) => c.id), [ikConstraints]);
  const transformIds = useMemo(() => transformConstraints.map((c) => c.id), [transformConstraints]);

  // Clear a dangling selection when its constraint no longer resolves (a delete/undo the panel did not drive).
  useEffect(() => {
    const next = reconcileConstraintSelection(selection, ikIds, transformIds);
    if (next !== selection) useConstraintSelectionStore.getState().select(next);
  }, [selection, ikIds, transformIds]);

  const selectedIk = useMemo(
    () =>
      selection?.kind === 'ik' ? ikConstraints.find((c) => c.id === selection.id) : undefined,
    [selection, ikConstraints],
  );
  const selectedTransform = useMemo(
    () =>
      selection?.kind === 'transform'
        ? transformConstraints.find((c) => c.id === selection.id)
        : undefined,
    [selection, transformConstraints],
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
      ),
    [ikConstraints, transformConstraints],
  );
  const hasExplicitOrder = useMemo(
    () => solveOrder.some((c) => c.order !== undefined),
    [solveOrder],
  );

  const total = ikConstraints.length + transformConstraints.length;

  return (
    <div style={rootStyle}>
      <div style={toolbarStyle}>
        <span style={headerStyle}>Constraints</span>
        <span style={countStyle}>
          {total} {total === 1 ? 'constraint' : 'constraints'}
        </span>
      </div>

      <div style={listStyle}>
        {total === 0 && (
          <div style={emptyStyle}>
            No constraints. Create one from the viewport IK tool or the MCP surface.
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
      </div>

      <div style={detailStyle}>
        {selectedIk !== undefined ? (
          <IkConstraintDetail constraint={selectedIk} />
        ) : selectedTransform !== undefined ? (
          <TransformConstraintDetail constraint={selectedTransform} />
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
                  title="Clear the explicit order and restore the default (all IK, then all transform)"
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
                <span style={badgeStyle}>{c.kind === 'ik' ? 'IK' : 'TR'}</span>
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

const rowActiveStyle: CSSProperties = { background: '#26354a', boxShadow: `inset 2px 0 0 ${ACCENT}` };

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

const checkRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  color: '#cccccc',
  cursor: 'pointer',
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
