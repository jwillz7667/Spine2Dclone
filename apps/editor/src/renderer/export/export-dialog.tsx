import type { CSSProperties, ReactElement } from 'react';
import { COMPRESSION_TARGETS, type ExportProfile } from '../../shared';
import { useExportStore } from '../editor-state/export-store';
import {
  cancelActiveExport,
  loadExportProfile,
  runMediaExport,
  runProjectExport,
  saveExportProfile,
} from '../actions/export';
import {
  defaultExportProfile,
  EXPORT_SECTIONS,
  isVideoFormat,
  MEDIA_FORMATS,
  toggleCompressionTarget,
  validateExportProfile,
  type ExportSection,
  type MediaFormat,
} from './export-options';

// The Export dialog (PP-D6): a modal overlay with three sections. Project writes .mrnt / format JSON; Media
// renders + encodes a PNG sequence / GIF / APNG / WebM / MP4 clip; Profile loads, edits, and saves the
// export profile (atlas repack settings, texture-variant selection, and the device budgets). It is
// presentation only: exporting READS the model and never mutates the document (the math/document boundary).
// Ephemeral state lives in the export store; every filesystem action goes through the main-process bridge.

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};
const dialogStyle: CSSProperties = {
  width: 'min(620px, 92vw)',
  maxHeight: '86vh',
  overflow: 'auto',
  background: '#1e1e28',
  color: '#e6e6ee',
  border: '1px solid #3a3a4a',
  borderRadius: 8,
  padding: 20,
  boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5)',
  font: '13px/1.5 system-ui, sans-serif',
};
const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 12,
};
const tabsStyle: CSSProperties = { display: 'flex', gap: 6, marginBottom: 16 };
const buttonStyle: CSSProperties = {
  background: '#3a3a4a',
  color: '#e6e6ee',
  border: 'none',
  borderRadius: 6,
  padding: '6px 14px',
  cursor: 'pointer',
};
const primaryButtonStyle: CSSProperties = { ...buttonStyle, background: '#4864c8' };
const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  marginBottom: 10,
};
const labelStyle: CSSProperties = { width: 150, color: '#b8b8c8' };
const inputStyle: CSSProperties = {
  background: '#12121a',
  color: '#e6e6ee',
  border: '1px solid #33334a',
  borderRadius: 4,
  padding: '4px 8px',
};
const statusStyle: CSSProperties = { marginTop: 14, color: '#9ecbff', minHeight: 18 };

function tabButtonStyle(active: boolean): CSSProperties {
  return { ...buttonStyle, background: active ? '#4864c8' : '#2a2a38' };
}

const SECTION_LABELS: Record<ExportSection, string> = {
  project: 'Project',
  media: 'Media',
  profile: 'Profile',
};

const MEDIA_LABELS: Record<MediaFormat, string> = {
  'png-sequence': 'PNG sequence',
  gif: 'GIF',
  apng: 'Animated PNG',
  webm: 'WebM (VP9)',
  mp4: 'MP4 (H.264)',
};

export function ExportDialog(): ReactElement | null {
  const open = useExportStore((state) => state.open);
  const section = useExportStore((state) => state.section);
  const status = useExportStore((state) => state.status);
  const dismiss = useExportStore((state) => state.dismiss);
  const setSection = useExportStore((state) => state.setSection);

  if (!open) return null;

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="Export">
      <div style={dialogStyle}>
        <div style={headerStyle}>
          <strong style={{ fontSize: 15 }}>Export</strong>
          <button type="button" style={buttonStyle} onClick={dismiss}>
            Close
          </button>
        </div>

        <div style={tabsStyle}>
          {EXPORT_SECTIONS.map((id) => (
            <button
              key={id}
              type="button"
              style={tabButtonStyle(section === id)}
              onClick={() => setSection(id)}
            >
              {SECTION_LABELS[id]}
            </button>
          ))}
        </div>

        {section === 'project' && <ProjectSection />}
        {section === 'media' && <MediaSection />}
        {section === 'profile' && <ProfileSection />}

        <div style={statusStyle}>{status}</div>
      </div>
    </div>
  );
}

function ProjectSection(): ReactElement {
  const projectFormat = useExportStore((state) => state.projectFormat);
  const setProjectFormat = useExportStore((state) => state.setProjectFormat);

  return (
    <section>
      <div style={rowStyle}>
        <span style={labelStyle}>Format</span>
        <label>
          <input
            type="radio"
            name="project-format"
            checked={projectFormat === 'mrnt'}
            onChange={() => setProjectFormat('mrnt')}
          />{' '}
          Binary (.mrnt)
        </label>
        <label>
          <input
            type="radio"
            name="project-format"
            checked={projectFormat === 'json'}
            onChange={() => setProjectFormat('json')}
          />{' '}
          Format JSON
        </label>
      </div>
      <button
        type="button"
        style={primaryButtonStyle}
        onClick={() => void runProjectExport(projectFormat)}
      >
        Export project
      </button>
    </section>
  );
}

function MediaSection(): ReactElement {
  const media = useExportStore((state) => state.media);
  const animations = useExportStore((state) => state.animations);
  const busy = useExportStore((state) => state.busy);
  const progress = useExportStore((state) => state.progress);
  const update = useExportStore((state) => state.updateMedia);

  const isVideo = isVideoFormat(media.format);

  return (
    <section>
      <div style={rowStyle}>
        <span style={labelStyle}>Format</span>
        <select
          style={inputStyle}
          value={media.format}
          onChange={(e) => update({ format: e.target.value as MediaFormat })}
        >
          {MEDIA_FORMATS.map((format) => (
            <option key={format} value={format}>
              {MEDIA_LABELS[format]}
            </option>
          ))}
        </select>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>Animation</span>
        <select
          style={inputStyle}
          value={media.animation ?? ''}
          onChange={(e) => update({ animation: e.target.value === '' ? null : e.target.value })}
        >
          <option value="">Setup pose</option>
          {animations.map((animation) => (
            <option key={animation.name} value={animation.name}>
              {animation.name}
            </option>
          ))}
        </select>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>Frame rate</span>
        <input
          style={{ ...inputStyle, width: 70 }}
          type="number"
          min={1}
          max={120}
          value={media.fps}
          onChange={(e) => update({ fps: Math.round(Number(e.target.value)) })}
        />
        <span style={{ color: '#8a8a9a' }}>fps</span>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>Size</span>
        <input
          style={{ ...inputStyle, width: 70 }}
          type="number"
          min={1}
          max={4096}
          value={media.width}
          onChange={(e) => update({ width: Math.round(Number(e.target.value)) })}
        />
        <span style={{ color: '#8a8a9a' }}>x</span>
        <input
          style={{ ...inputStyle, width: 70 }}
          type="number"
          min={1}
          max={4096}
          value={media.height}
          onChange={(e) => update({ height: Math.round(Number(e.target.value)) })}
        />
        {isVideo && <span style={{ color: '#8a8a9a' }}>(even numbers)</span>}
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>Range</span>
        <label>
          <input
            type="checkbox"
            checked={media.useFullRange}
            disabled={media.animation === null}
            onChange={(e) => update({ useFullRange: e.target.checked })}
          />{' '}
          Full animation
        </label>
        {(!media.useFullRange || media.animation === null) && (
          <>
            <input
              style={{ ...inputStyle, width: 64 }}
              type="number"
              min={0}
              value={media.startFrame}
              onChange={(e) => update({ startFrame: Math.round(Number(e.target.value)) })}
            />
            <span style={{ color: '#8a8a9a' }}>to</span>
            <input
              style={{ ...inputStyle, width: 64 }}
              type="number"
              min={1}
              value={media.endFrame}
              onChange={(e) => update({ endFrame: Math.round(Number(e.target.value)) })}
            />
          </>
        )}
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>Background</span>
        <label>
          <input
            type="checkbox"
            checked={media.transparent}
            disabled={isVideo}
            onChange={(e) => update({ transparent: e.target.checked })}
          />{' '}
          Transparent
        </label>
        {(!media.transparent || isVideo) && (
          <input
            type="color"
            value={rgbToHex(media.background)}
            onChange={(e) => update({ background: hexToRgb(e.target.value) })}
          />
        )}
      </div>

      {media.format === 'gif' && (
        <div style={rowStyle}>
          <span style={labelStyle}>GIF palette</span>
          <select
            style={inputStyle}
            value={media.gifPalette}
            onChange={(e) => update({ gifPalette: e.target.value as 'global' | 'per-frame' })}
          >
            <option value="global">Global</option>
            <option value="per-frame">Per frame</option>
          </select>
        </div>
      )}

      {(media.format === 'gif' || media.format === 'apng' || isVideo) && (
        <div style={rowStyle}>
          <span style={labelStyle}>Loop</span>
          <label>
            <input
              type="checkbox"
              checked={media.loopForever}
              onChange={(e) => update({ loopForever: e.target.checked })}
            />{' '}
            Loop forever
          </label>
        </div>
      )}

      {busy ? (
        <div style={rowStyle}>
          <span style={{ color: '#8a8a9a' }}>
            {progress === null
              ? 'Working...'
              : `Rendered ${progress.completed} / ${progress.total} frames`}
          </span>
          <button type="button" style={buttonStyle} onClick={() => cancelActiveExport()}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" style={primaryButtonStyle} onClick={() => void runMediaExport()}>
          Export {MEDIA_LABELS[media.format]}
        </button>
      )}
    </section>
  );
}

function ProfileSection(): ReactElement {
  const profile = useExportStore((state) => state.profile);
  const setProfile = useExportStore((state) => state.setProfile);

  if (profile === null) {
    return (
      <section>
        <p style={{ color: '#b8b8c8' }}>
          Load an export profile to edit its atlas repack settings and texture variants, or start
          from the defaults.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" style={buttonStyle} onClick={() => void loadExportProfile()}>
            Load profile...
          </button>
          <button
            type="button"
            style={primaryButtonStyle}
            onClick={() => setProfile(defaultExportProfile())}
          >
            Start from default
          </button>
        </div>
      </section>
    );
  }

  const atlas = profile.atlasExport;
  const setAtlas = (patch: Partial<ExportProfile['atlasExport']>): void =>
    setProfile({ ...profile, atlasExport: { ...atlas, ...patch } });
  const invalid = validateExportProfile(profile);

  return (
    <section>
      <div style={rowStyle}>
        <span style={labelStyle}>Atlas page size</span>
        <select
          style={inputStyle}
          value={atlas.maxPageSize}
          onChange={(e) => setAtlas({ maxPageSize: Number(e.target.value) === 4096 ? 4096 : 2048 })}
        >
          <option value={2048}>2048</option>
          <option value={4096}>4096</option>
        </select>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>Padding</span>
        <input
          style={{ ...inputStyle, width: 64 }}
          type="number"
          min={0}
          max={8}
          value={atlas.padding}
          onChange={(e) => setAtlas({ padding: Math.round(Number(e.target.value)) })}
        />
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>Packing</span>
        <label>
          <input
            type="checkbox"
            checked={atlas.allowRotation}
            onChange={(e) => setAtlas({ allowRotation: e.target.checked })}
          />{' '}
          Allow rotation
        </label>
        <label>
          <input
            type="checkbox"
            checked={atlas.blendBinning}
            onChange={(e) => setAtlas({ blendBinning: e.target.checked })}
          />{' '}
          Blend binning
        </label>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>Texture transport</span>
        <select
          style={inputStyle}
          value={atlas.textureTransport}
          onChange={(e) =>
            setAtlas({
              textureTransport:
                e.target.value === 'per-target-sidecar' ? 'per-target-sidecar' : 'uastc-ktx2',
            })
          }
        >
          <option value="uastc-ktx2">UASTC KTX2</option>
          <option value="per-target-sidecar">Per-target sidecar</option>
        </select>
      </div>

      <div style={{ ...rowStyle, alignItems: 'flex-start' }}>
        <span style={labelStyle}>Texture variants</span>
        <div style={{ display: 'flex', gap: 12 }}>
          {COMPRESSION_TARGETS.map((target) => (
            <label key={target}>
              <input
                type="checkbox"
                checked={atlas.compressionTargets.includes(target)}
                onChange={() => setProfile(toggleCompressionTarget(profile, target))}
              />{' '}
              {target}
            </label>
          ))}
        </div>
      </div>

      {!invalid.ok && (
        <div style={{ color: '#ff9e9e', marginBottom: 10 }}>{invalid.errors.join('; ')}</div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" style={buttonStyle} onClick={() => void loadExportProfile()}>
          Load...
        </button>
        <button
          type="button"
          style={primaryButtonStyle}
          disabled={!invalid.ok}
          onClick={() => void saveExportProfile()}
        >
          Save profile...
        </button>
      </div>
    </section>
  );
}

// A straight-alpha color to a #rrggbb hex for the <input type="color"> control (alpha is dropped there).
function rgbToHex(color: { r: number; g: number; b: number }): string {
  const channel = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number; a: number } {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  return { r, g, b, a: 1 };
}
