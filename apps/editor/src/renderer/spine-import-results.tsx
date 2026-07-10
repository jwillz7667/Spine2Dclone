import type { CSSProperties, ReactElement } from 'react';
import { useSpineImportStore } from './editor-state/spine-import-store';

// The Import Spine Project results dialog (PP-A5): a small modal overlay that lists what happened when a
// user-owned Spine project was imported. On success it shows the imported document name and every
// lossy-conversion warning (feature, reason, and the source path), so nothing that did not survive the
// migration is dropped silently. On failure it lists the typed importer errors. It renders nothing until
// an import populates the ephemeral report store, and the user dismisses it with the close control. It is a
// presentation-only overlay (no document mutation), mounted once at the app root alongside the panels.

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
  width: 'min(560px, 90vw)',
  maxHeight: '80vh',
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

const listStyle: CSSProperties = { margin: '8px 0 0', padding: 0, listStyle: 'none' };
const itemStyle: CSSProperties = {
  padding: '8px 10px',
  marginBottom: 6,
  background: '#26263440',
  border: '1px solid #33334422',
  borderRadius: 6,
};
const tagStyle: CSSProperties = {
  fontFamily: 'ui-monospace, monospace',
  fontSize: 12,
  color: '#9ecbff',
};
const errorTagStyle: CSSProperties = { ...tagStyle, color: '#ff9e9e' };
const pathStyle: CSSProperties = { color: '#8a8a9a', fontSize: 12 };
const closeButtonStyle: CSSProperties = {
  background: '#3a3a4a',
  color: '#e6e6ee',
  border: 'none',
  borderRadius: 6,
  padding: '6px 14px',
  cursor: 'pointer',
};

export function SpineImportResults(): ReactElement | null {
  const open = useSpineImportStore((state) => state.open);
  const report = useSpineImportStore((state) => state.report);
  const dismiss = useSpineImportStore((state) => state.dismiss);

  if (!open || report === null) return null;

  const succeeded = report.status === 'imported';
  const title = succeeded ? `Imported "${report.name ?? 'project'}"` : 'Spine import failed';

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="Spine import results">
      <div style={dialogStyle}>
        <div style={headerStyle}>
          <strong style={{ fontSize: 15 }}>{title}</strong>
          <button type="button" style={closeButtonStyle} onClick={dismiss}>
            Close
          </button>
        </div>

        {!succeeded && report.errors.length > 0 && (
          <section>
            <div style={{ fontWeight: 600 }}>Errors ({report.errors.length})</div>
            <ul style={listStyle}>
              {report.errors.map((error, index) => (
                <li key={`e-${index}`} style={itemStyle}>
                  <div>
                    <span style={errorTagStyle}>{error.code}</span> {error.message}
                  </div>
                  {error.path.length > 0 && <div style={pathStyle}>at {error.path}</div>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {report.warnings.length > 0 ? (
          <section style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 600 }}>Warnings ({report.warnings.length})</div>
            <ul style={listStyle}>
              {report.warnings.map((warning, index) => (
                <li key={`w-${index}`} style={itemStyle}>
                  <div>
                    <span style={tagStyle}>{warning.feature}</span> {warning.why}
                  </div>
                  {warning.path.length > 0 && <div style={pathStyle}>at {warning.path}</div>}
                </li>
              ))}
            </ul>
          </section>
        ) : (
          succeeded && (
            <div style={{ color: '#8a8a9a' }}>
              No lossy conversions. Everything imported cleanly.
            </div>
          )
        )}
      </div>
    </div>
  );
}
