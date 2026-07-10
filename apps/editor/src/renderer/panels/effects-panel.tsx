import type { IDockviewPanelProps } from 'dockview';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import type { BlendMode } from '@marionette/format/types';
import {
  mountEffectPreview,
  type EffectPreviewHandle,
  type EffectPreviewStats,
} from './effect-preview/effect-preview-view';
import { makePreviewTransport, type PreviewTransport } from './preview/preview-transport';
import {
  AddLayerCommand,
  CreateEffectCommand,
  DeleteEffectCommand,
  RemoveLayerCommand,
  RenameEffectCommand,
  SetEffectMetaCommand,
  SetLayerBlendModeCommand,
  documentHost,
  type EffectEntity,
  type EffectId,
  type EffectLayerEntity,
  type EffectLayerId,
  type NewLayerKind,
} from '../document';
import { useDocumentRevision } from '../editor-state/use-document-revision';

const ACCENT = '#5aa0ff';
const BLEND_MODES: readonly BlendMode[] = ['normal', 'additive', 'multiply', 'screen'];
const LAYER_KINDS: readonly NewLayerKind[] = ['emitter', 'spriteAnimator', 'ribbonTrail'];

// The default per-frame simulation step for a fresh effect: 60Hz, the value CreateEffect's fixture and the
// effects-command docstrings pin as the call-site default (1/60). SetEffectMeta rejects a non-positive dt.
const DEFAULT_SIMULATION_DT = 1 / 60;
const DEFAULT_EFFECT_BASENAME = 'effect';

// The Effects (VFX designer) panel: the editor surface for the Phase 3 effects library that already lives in
// the document (Document.effects, sharing the ONE project History with the skeleton). The LEFT list shows the
// library's effects (name, layer count, a deterministic/ambient badge from the deterministic flag); the DETAIL
// edits the selected effect's name, meta (duration / deterministic / simulationDt / blendMode), and layers
// (add of the three kinds, per-layer blend mode, remove). Every mutation routes through a document-core
// command on the live History (LAW 2); the "current effect" is EPHEMERAL React state (the document/editor
// wall, LAW 1) tracked by minted EffectId, never the skeletal selection store (that store is for bones). The
// panel polls model.revision (like the other panels) so the list refreshes after any command and after
// undo/redo, and reads live state through documentHost.current() inside handlers so no handler closes over a
// stale model. The EffectId is minted by CreateEffect in its `do`, so the new effect is selected by reading
// the command's createdId AFTER execute (never written into the document).
export function EffectsPanel(_props: IDockviewPanelProps): ReactElement {
  const revision = useDocumentRevision();
  const doc = documentHost.current();
  const effects = useMemo(() => doc.effects.effects(), [doc, revision]);

  // The current effect id is ephemeral editor state (kept out of the document and out of the bone selection
  // store). It is resolved against the LIVE library below so a deleted/undone effect clears the selection.
  const [selectedEffectId, setSelectedEffectId] = useState<EffectId | null>(null);

  const selectedEffect = useMemo(
    () => (selectedEffectId !== null ? doc.effects.getEffect(selectedEffectId) : undefined),
    [doc, revision, selectedEffectId],
  );

  // Prune a selection that no longer resolves (an external delete, or an undo of the CreateEffect that made
  // it). EffectIds are minted monotonically and never reused, so a stale id never aliases a different effect.
  useEffect(() => {
    if (selectedEffectId !== null && doc.effects.getEffect(selectedEffectId) === undefined) {
      setSelectedEffectId(null);
    }
  }, [doc, revision, selectedEffectId]);

  // Create a fresh, layer-less effect through History (LAW 2) and select it. The id is minted by the command
  // in its `do`, so it is read off createdId AFTER execute; the default name is uniquified against the live
  // names so a fresh effect does not collide on export. duration null is endless emission; deterministic
  // true is the reproducible default; blendMode additive is the common VFX default (glows/sparks add light).
  function createEffect(): void {
    const host = documentHost.current();
    const existingNames = host.effects.effects().map((effect) => effect.name);
    const command = new CreateEffectCommand({
      name: uniqueEffectName(existingNames, DEFAULT_EFFECT_BASENAME),
      duration: null,
      deterministic: true,
      simulationDt: DEFAULT_SIMULATION_DT,
      blendMode: 'additive',
    });
    host.history.execute(command);
    if (command.createdId !== undefined) setSelectedEffectId(command.createdId);
  }

  return (
    <div style={rootStyle}>
      <div style={sectionStyle}>
        <div style={toolbarStyle}>
          <button type="button" style={buttonStyle} onClick={createEffect}>
            New Effect
          </button>
          <span style={countStyle}>
            {effects.length} {effects.length === 1 ? 'effect' : 'effects'}
          </span>
        </div>

        <div style={listStyle}>
          {effects.length === 0 ? (
            <div style={emptyStyle}>No effects yet. New Effect to author a particle effect.</div>
          ) : (
            effects.map((effect) => (
              <EffectListRow
                key={effect.id}
                effect={effect}
                isSelected={effect.id === selectedEffectId}
                onSelect={setSelectedEffectId}
              />
            ))
          )}
        </div>
      </div>

      <div style={detailSectionStyle}>
        {selectedEffect === undefined ? (
          <div style={emptyStyle}>Select an effect to edit its meta and layers.</div>
        ) : (
          <EffectDetail effect={selectedEffect} onDeleted={() => setSelectedEffectId(null)} />
        )}
      </div>

      <EffectPreviewPane effectName={selectedEffect?.name ?? null} revision={revision} />
    </div>
  );
}

interface EffectPreviewPaneProps {
  readonly effectName: string | null;
  readonly revision: number;
}

// The live GL preview region (PP-D8): mounts a PixiJS preview of the SELECTED effect, playing its emitter
// config through the shared runtime-web ParticleLayerView, and re-syncing from the document on every
// revision (edits flow through the effects commands elsewhere; this pane only reads). The preview lives
// INSIDE the effects panel rather than a separate dockview panel so the edited effect and its playback sit
// together with no extra layout/menu wiring; the panel already stacks list + detail, and the GL host owns
// its own Application lifecycle exactly like the viewport panel does.
function EffectPreviewPane(props: EffectPreviewPaneProps): ReactElement {
  const { effectName, revision } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<EffectPreviewHandle | null>(null);
  const [transport, setTransport] = useState<PreviewTransport>(() => makePreviewTransport());
  const [notice, setNotice] = useState<string | null>(null);
  const [stats, setStats] = useState<EffectPreviewStats>({ liveInstances: 0, liveParticles: 0 });

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const handle = mountEffectPreview(host, {
      onTransport: setTransport,
      onNotice: setNotice,
      onStats: setStats,
    });
    handleRef.current = handle;
    return () => {
      handle.destroy();
      handleRef.current = null;
    };
  }, []);

  // Push the selected effect name and re-sync on document revision. Both are no-ops before the async GL init
  // completes (the handle queues them); after init the view rebuilds against the live library.
  useEffect(() => {
    handleRef.current?.setEffectName(effectName);
  }, [effectName]);
  useEffect(() => {
    handleRef.current?.resyncFromDocument();
  }, [revision]);

  return (
    <div style={previewSectionStyle}>
      <div style={previewToolbarStyle}>
        <button
          type="button"
          style={smallButtonStyle}
          title={transport.isPlaying ? 'Pause' : 'Play'}
          onClick={() => handleRef.current?.togglePlay()}
        >
          {transport.isPlaying ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          style={smallButtonStyle}
          title="Restart the effect"
          onClick={() => handleRef.current?.restart()}
        >
          Restart
        </button>
        <button
          type="button"
          style={smallButtonStyle}
          title="Cycle the preview background (dark / light / checker)"
          onClick={() => handleRef.current?.cycleBackground()}
        >
          BG: {transport.background}
        </button>
        <span style={previewStatsStyle} title="Live particle instances / particles">
          {stats.liveParticles} particles
        </span>
      </div>
      <div style={previewHostWrapStyle}>
        <div ref={hostRef} style={previewHostStyle} />
        {notice !== null && <div style={previewNoticeStyle}>{notice}</div>}
      </div>
    </div>
  );
}

// Generate a unique default effect name (basename_N) not colliding with the live names. Effect-name
// uniqueness is an export-only contract, but a fresh default that already validates keeps the library clean.
function uniqueEffectName(existing: readonly string[], basename: string): string {
  const taken = new Set(existing);
  for (let index = 1; ; index += 1) {
    const candidate = `${basename}_${index}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// Module-scope command dispatch. Each reads the LIVE document through documentHost.current() so nothing closes
// over a stale model, and routes every change through History (LAW 2). Selecting is the caller's ephemeral
// React state and never reaches these.

function renameEffect(id: EffectId, name: string): void {
  documentHost.current().history.execute(new RenameEffectCommand(id, name));
}

function deleteEffect(id: EffectId): void {
  documentHost.current().history.execute(new DeleteEffectCommand(id));
}

function setEffectDuration(id: EffectId, duration: number | null): void {
  documentHost.current().history.execute(new SetEffectMetaCommand(id, { duration }));
}

function setEffectDeterministic(id: EffectId, deterministic: boolean): void {
  documentHost.current().history.execute(new SetEffectMetaCommand(id, { deterministic }));
}

function setEffectSimulationDt(id: EffectId, simulationDt: number): void {
  documentHost.current().history.execute(new SetEffectMetaCommand(id, { simulationDt }));
}

// Add a default layer of the given kind through History. The layer references an atlas region so it can
// export; a freshly created effect has an empty atlas, so the region defaults to the first effects-atlas
// region when one exists, or an empty placeholder otherwise (the command accepts it at author time; export
// enforces resolvability). The blend mode defaults to the effect's own default blend mode.
function addLayer(id: EffectId, kind: NewLayerKind, blendMode: BlendMode, region: string): void {
  documentHost.current().history.execute(new AddLayerCommand(id, kind, blendMode, region));
}

function removeLayer(effectId: EffectId, layerId: EffectLayerId): void {
  documentHost.current().history.execute(new RemoveLayerCommand(effectId, layerId));
}

function setLayerBlend(effectId: EffectId, layerId: EffectLayerId, blendMode: BlendMode): void {
  documentHost
    .current()
    .history.execute(new SetLayerBlendModeCommand(effectId, layerId, blendMode));
}

// Resolve a select value to a BlendMode without an unsafe cast (the options are exactly BLEND_MODES).
function toBlendMode(value: string): BlendMode | null {
  return BLEND_MODES.find((mode) => mode === value) ?? null;
}

function toLayerKind(value: string): NewLayerKind | null {
  return LAYER_KINDS.find((kind) => kind === value) ?? null;
}

interface EffectListRowProps {
  readonly effect: EffectEntity;
  readonly isSelected: boolean;
  readonly onSelect: (id: EffectId) => void;
}

function EffectListRow(props: EffectListRowProps): ReactElement {
  const { effect, isSelected } = props;
  const layerCount = effect.layerOrder.length;
  return (
    <div
      style={isSelected ? { ...rowStyle, ...rowActiveStyle } : rowStyle}
      onClick={() => props.onSelect(effect.id)}
    >
      <span style={rowNameStyle}>{effect.name}</span>
      <span style={rowMetaStyle}>
        {layerCount} {layerCount === 1 ? 'layer' : 'layers'}
      </span>
      <span
        style={effect.deterministic ? badgeDeterministicStyle : badgeAmbientStyle}
        title={
          effect.deterministic
            ? 'Deterministic: the same seed replays identically.'
            : 'Ambient: free-running, not seed-locked.'
        }
      >
        {effect.deterministic ? 'deterministic' : 'ambient'}
      </span>
    </div>
  );
}

interface EffectDetailProps {
  readonly effect: EffectEntity;
  readonly onDeleted: () => void;
}

function EffectDetail(props: EffectDetailProps): ReactElement {
  const { effect } = props;
  const layers = useMemo(
    () => effect.layerOrder.map((layerId) => effect.layers.get(layerId)),
    [effect],
  );
  const atlasRegions = useMemo(
    () =>
      documentHost
        .current()
        .effects.atlas()
        .pages.flatMap((page) => page.regions),
    // The atlas is read live per render; the parent re-renders on every revision, so no extra dep is needed.
    [effect],
  );
  const [pendingKind, setPendingKind] = useState<NewLayerKind>('emitter');

  function commitName(raw: string): boolean {
    const next = raw.trim();
    if (next === '' || next === effect.name) return false;
    renameEffect(effect.id, next);
    return true;
  }

  function commitDuration(raw: string): boolean {
    const trimmed = raw.trim();
    // An empty duration means endless emission (null). A finite non-negative number sets a fixed duration.
    if (trimmed === '') {
      if (effect.duration === null) return false;
      setEffectDuration(effect.id, null);
      return true;
    }
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds === effect.duration) return false;
    setEffectDuration(effect.id, seconds);
    return true;
  }

  function commitSimulationDt(raw: string): boolean {
    const seconds = Number(raw.trim());
    // SetEffectMeta rejects a non-positive dt; guard here so a bad entry reverts the field instead of throwing.
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds === effect.simulationDt) return false;
    setEffectSimulationDt(effect.id, seconds);
    return true;
  }

  // A freshly added layer must reference a resolvable region to export; default to the first effects-atlas
  // region when the atlas has one, otherwise an empty placeholder (author-time legal; export enforces it).
  const defaultRegion = atlasRegions[0]?.name ?? '';

  return (
    <div style={detailBodyStyle}>
      <div style={detailRowStyle}>
        <span style={labelStyle}>Name</span>
        <NameField value={effect.name} onCommit={commitName} />
        <button
          type="button"
          style={smallButtonStyle}
          title="Delete effect"
          onClick={() => {
            deleteEffect(effect.id);
            props.onDeleted();
          }}
        >
          Delete
        </button>
      </div>

      <div style={detailRowStyle}>
        <span style={labelStyle}>Duration</span>
        <NumberField
          value={effect.duration}
          placeholder="endless"
          step={0.1}
          min={0}
          width={80}
          title="Effect duration in seconds; empty for endless emission"
          onCommit={commitDuration}
        />
        <span style={unitStyle}>s</span>
      </div>

      <div style={detailRowStyle}>
        <span style={labelStyle}>Deterministic</span>
        <input
          type="checkbox"
          checked={effect.deterministic}
          title="Deterministic effects replay identically for the same seed"
          onChange={(event) => setEffectDeterministic(effect.id, event.currentTarget.checked)}
        />
      </div>

      <div style={detailRowStyle}>
        <span style={labelStyle}>Sim dt</span>
        <NumberField
          value={effect.simulationDt}
          step={0.001}
          min={0.0001}
          width={80}
          title="Fixed simulation step in seconds (must be greater than 0)"
          onCommit={commitSimulationDt}
        />
        <span style={unitStyle}>s</span>
      </div>

      <div style={detailRowStyle}>
        <span style={labelStyle}>Blend</span>
        <span
          style={readonlyValueStyle}
          title="The effect-level default blend mode (set at create time)"
        >
          {effect.blendMode}
        </span>
      </div>

      <div style={subHeaderStyle}>
        <span>Layers</span>
        <span style={countStyle}>
          {layers.length} {layers.length === 1 ? 'layer' : 'layers'}
        </span>
      </div>

      {layers.length === 0 && (
        <div style={emptyStyle}>
          No layers. Add an emitter, sprite animator, or ribbon trail below.
        </div>
      )}
      {layers.map((layer) =>
        layer === undefined ? null : <LayerRow key={layer.id} effectId={effect.id} layer={layer} />,
      )}

      <div style={detailRowStyle}>
        <span style={labelStyle}>Add layer</span>
        <select
          style={selectStyle}
          value={pendingKind}
          onChange={(event) => {
            const kind = toLayerKind(event.target.value);
            if (kind !== null) setPendingKind(kind);
          }}
        >
          {LAYER_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
        <button
          type="button"
          style={smallButtonStyle}
          title="Add a default layer of the chosen kind"
          onClick={() => addLayer(effect.id, pendingKind, effect.blendMode, defaultRegion)}
        >
          Add
        </button>
      </div>
    </div>
  );
}

interface LayerRowProps {
  readonly effectId: EffectId;
  readonly layer: EffectLayerEntity;
}

function LayerRow(props: LayerRowProps): ReactElement {
  const { effectId, layer } = props;
  return (
    <div style={layerBlockStyle}>
      <div style={layerRowStyle}>
        <span style={rowNameStyle}>{layer.body.name}</span>
        <span style={rowMetaStyle}>{layer.body.type}</span>
        <button
          type="button"
          style={smallButtonStyle}
          title="Remove layer"
          onClick={() => removeLayer(effectId, layer.id)}
        >
          Remove
        </button>
      </div>
      <div style={layerRowStyle}>
        <span style={subLabelStyle}>Blend</span>
        <select
          style={selectStyle}
          value={layer.blendMode}
          onChange={(event) => {
            const mode = toBlendMode(event.target.value);
            if (mode !== null) setLayerBlend(effectId, layer.id, mode);
          }}
        >
          {BLEND_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

interface NameFieldProps {
  readonly value: string;
  readonly onCommit: (raw: string) => boolean;
}

// Uncontrolled text input keyed by its committed value plus a reset nonce (the established panel pattern): a
// committed command changes the prop, remounting to the live value (which also reflects undo/redo/load);
// bumping the nonce remounts to discard an in-progress edit on Escape or a rejected commit.
function NameField(props: NameFieldProps): ReactElement {
  const { value } = props;
  const [resetNonce, setResetNonce] = useState(0);
  const revert = (): void => setResetNonce((nonce) => nonce + 1);
  return (
    <input
      key={`${value}:${resetNonce}`}
      type="text"
      defaultValue={value}
      spellCheck={false}
      style={nameInputStyle}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          event.currentTarget.value = value;
          event.currentTarget.blur();
        }
      }}
      onBlur={(event) => {
        if (!props.onCommit(event.currentTarget.value)) revert();
      }}
    />
  );
}

interface NumberFieldProps {
  readonly value: number | null;
  readonly step: number;
  readonly width: number;
  readonly min?: number;
  readonly placeholder?: string;
  readonly title: string;
  readonly onCommit: (raw: string) => boolean;
}

// Uncontrolled number input with the same keyed-by-committed-value remount pattern as NameField. A null value
// renders empty (used for the endless duration). onCommit returns whether it accepted a real change; a
// rejected or unchanged commit reverts the field to the live value.
function NumberField(props: NumberFieldProps): ReactElement {
  const { value, step, width, min, placeholder, title } = props;
  const [resetNonce, setResetNonce] = useState(0);
  const revert = (): void => setResetNonce((nonce) => nonce + 1);
  const shown = value === null ? '' : String(value);
  return (
    <input
      key={`${shown}:${resetNonce}`}
      type="number"
      defaultValue={shown}
      step={step}
      min={min}
      placeholder={placeholder}
      title={title}
      style={{ ...numberInputStyle, width }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          event.currentTarget.value = shown;
          event.currentTarget.blur();
        }
      }}
      onBlur={(event) => {
        if (!props.onCommit(event.currentTarget.value)) revert();
      }}
    />
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

const sectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 26%',
  minHeight: 0,
  borderBottom: '1px solid #333333',
};

const detailSectionStyle: CSSProperties = {
  flex: '1 1 34%',
  minHeight: 0,
  overflowY: 'auto',
  borderBottom: '1px solid #333333',
};

const previewSectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 40%',
  minHeight: 180,
};

const previewToolbarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 8px',
  borderBottom: '1px solid #333333',
  flex: '0 0 auto',
};

const previewStatsStyle: CSSProperties = {
  marginLeft: 'auto',
  color: '#888888',
  fontVariantNumeric: 'tabular-nums',
};

const previewHostWrapStyle: CSSProperties = {
  position: 'relative',
  flex: '1 1 auto',
  minHeight: 0,
};

const previewHostStyle: CSSProperties = { width: '100%', height: '100%' };

const previewNoticeStyle: CSSProperties = {
  position: 'absolute',
  top: 8,
  left: 8,
  right: 8,
  padding: '4px 8px',
  borderRadius: 4,
  background: 'rgba(40, 30, 18, 0.9)',
  border: '1px solid #6a5a2a',
  color: '#e0c98a',
  pointerEvents: 'none',
};

const toolbarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 8px',
  borderBottom: '1px solid #333333',
  flex: '0 0 auto',
};

const countStyle: CSSProperties = { marginLeft: 'auto', color: '#888888' };

const listStyle: CSSProperties = { flex: '1 1 auto', minHeight: 0, overflowY: 'auto' };

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

const rowNameStyle: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: '#eeeeee',
};

const rowMetaStyle: CSSProperties = {
  flex: '0 0 auto',
  color: '#888888',
};

const badgeBaseStyle: CSSProperties = {
  flex: '0 0 auto',
  padding: '0 6px',
  borderRadius: 8,
  fontSize: 10,
  fontWeight: 700,
  color: '#1b1b1b',
};

const badgeDeterministicStyle: CSSProperties = { ...badgeBaseStyle, background: '#5aa0ff' };

const badgeAmbientStyle: CSSProperties = { ...badgeBaseStyle, background: '#e0a93b' };

const detailBodyStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '8px',
};

const detailRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
};

const labelStyle: CSSProperties = {
  flex: '0 0 auto',
  width: 90,
  color: '#999999',
};

const subLabelStyle: CSSProperties = {
  flex: '0 0 auto',
  width: 44,
  color: '#888888',
};

const unitStyle: CSSProperties = { color: '#888888' };

const readonlyValueStyle: CSSProperties = {
  flex: '0 0 auto',
  color: '#cccccc',
  fontVariantNumeric: 'tabular-nums',
};

const subHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginTop: 4,
  paddingTop: 6,
  borderTop: '1px solid #2c2c2c',
  color: '#cccccc',
  fontWeight: 600,
};

const layerBlockStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '6px',
  border: '1px solid #2c2c2c',
  borderRadius: 4,
  background: '#1f1f1f',
};

const layerRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
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

const numberInputStyle: CSSProperties = {
  flex: '0 0 auto',
  fontSize: 12,
  color: '#dddddd',
  background: '#222222',
  border: '1px solid #3a3a3a',
  borderRadius: 3,
  padding: '2px 6px',
  fontVariantNumeric: 'tabular-nums',
};

const selectStyle: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  fontSize: 12,
  color: '#dddddd',
  background: '#222222',
  border: '1px solid #3a3a3a',
  borderRadius: 3,
  padding: '2px 6px',
};

const buttonStyle: CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  color: '#dddddd',
  background: '#2d2d2d',
  border: `1px solid ${ACCENT}`,
  borderRadius: 4,
  cursor: 'pointer',
};

const smallButtonStyle: CSSProperties = {
  flex: '0 0 auto',
  padding: '3px 8px',
  fontSize: 11,
  color: '#dddddd',
  background: '#2d2d2d',
  border: '1px solid #444444',
  borderRadius: 4,
  cursor: 'pointer',
};
