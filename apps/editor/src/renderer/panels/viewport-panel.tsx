import type { IDockviewPanelProps } from 'dockview';
import type { ReactElement } from 'react';

// Placeholder. WP-0.6 mounts the runtime-web PixiJS viewport here.
export function ViewportPanel(_props: IDockviewPanelProps): ReactElement {
  return <div className="panel-placeholder">Viewport</div>;
}
