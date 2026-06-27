import { Container } from 'pixi.js';

// The viewport's container tree (handoff 8.3). A single camera-transformed `world` container holds
// both the content layer (the runtime-web SkeletonView, exactly what the web runtime shows) and the
// overlay layer (editor-only chrome: grid, gizmos, selection, drawn in WP-0.7). Both pan and zoom
// together because the camera transform is applied to `world`; the overlay is never part of the
// exported scene. The content sits under the overlay so editor chrome stays visible over the art.
export interface ViewportLayers {
  // Camera-transformed root: position = camera translation, scale = camera zoom.
  readonly world: Container;
  // Holds SkeletonView.root.
  readonly content: Container;
  // Editor-only chrome (gizmos land here in WP-0.7).
  readonly overlay: Container;
}

export function createViewportLayers(): ViewportLayers {
  const world = new Container();
  const content = new Container();
  const overlay = new Container();
  world.addChild(content, overlay);
  return { world, content, overlay };
}
