import type { IDockviewPanelProps } from 'dockview';
import type { ReactElement } from 'react';
import { ViewportPanelContent } from '../viewport/viewport-panel-content';

// The viewport panel hosts the shared runtime-web PixiJS scene plus the editor overlay (WP-0.6). The
// panel props are required by the dockview component signature but unused here; the content component
// owns the PixiJS Application lifecycle.
export function ViewportPanel(_props: IDockviewPanelProps): ReactElement {
  return <ViewportPanelContent />;
}
