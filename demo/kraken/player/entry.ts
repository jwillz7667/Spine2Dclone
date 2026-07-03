import { Application, Assets, Texture } from 'pixi.js';
import {
  crossfadeTo,
  makeAnimationState,
  setAnimation,
  updateAnimationState,
} from '@marionette/runtime-core';
import { parseDocument } from '@marionette/format';
import {
  buildRegionTextures,
  makeRegionTextureResolver,
  SkeletonView,
} from '@marionette/runtime-web';

// The Kraken's Hoard standalone player: the REAL @marionette/runtime-web renderer (the same SkeletonView
// the editor viewport uses) playing the MCP-authored document at 60fps, with LIVE AnimationState mixing:
// the base track loops 'idle'; the Celebrate button crossfades to 'win_celebration' and back, so the
// blend the anim-state conformance fixtures lock is what you are watching. Everything is inlined in this
// single HTML file (document JSON, atlas pages as data URLs, this bundle); it runs from file:// offline.

declare const GAME_DOCUMENT: unknown;
declare const ATLAS_PAGES: Record<string, string>; // page file -> PNG data URL

async function main(): Promise<void> {
  const document = parseDocument(GAME_DOCUMENT, { verifyHash: false });

  const app = new Application();
  await app.init({ background: 0x04121a, resizeTo: window, antialias: true });
  window.document.body.appendChild(app.canvas);

  // Decode the inlined atlas pages and slice per-region textures through the SAME seam the editor uses.
  const pageTextures = new Map<string, Texture>();
  for (const [file, dataUrl] of Object.entries(ATLAS_PAGES)) {
    pageTextures.set(
      file,
      (await Assets.load({ src: dataUrl, loadParser: 'loadTextures' })) as Texture,
    );
  }
  const resolver = makeRegionTextureResolver(buildRegionTextures(document.atlas, pageTextures));

  const view = new SkeletonView();
  view.setTextureResolver(resolver);
  app.stage.addChild(view.root);
  // Bone chrome off for playback: the player shows the game, not the rig.
  (view.root.children[1] ?? view.root.children[0])!.visible = false;

  // Fit the authored scene rect to the window.
  const SCENE = { x: -820, y: -700, w: 1640, h: 1400 };
  const layout = (): void => {
    const scale = Math.min(app.screen.width / SCENE.w, app.screen.height / SCENE.h);
    view.root.scale.set(scale);
    view.root.position.set(
      app.screen.width / 2 - (SCENE.x + SCENE.w / 2) * scale,
      app.screen.height / 2 - (SCENE.y + SCENE.h / 2) * scale,
    );
  };
  layout();
  window.addEventListener('resize', layout);

  // AnimationState: idle loops on track 0; Celebrate crossfades in and back out.
  const state = makeAnimationState(document);
  setAnimation(state, 0, 'idle', true);
  let celebrating = false;

  const button = window.document.getElementById('celebrate') as HTMLButtonElement;
  button.addEventListener('click', () => {
    if (celebrating) return;
    celebrating = true;
    button.textContent = 'MEGA WIN!';
    crossfadeTo(state, 0, 'win_celebration', false, 0.35);
    window.setTimeout(() => {
      crossfadeTo(state, 0, 'idle', true, 0.5);
      celebrating = false;
      button.textContent = 'Celebrate';
    }, 2100);
  });

  app.ticker.add((ticker) => {
    updateAnimationState(state, ticker.deltaMS / 1000);
    view.syncState(document, state);
  });
}

void main();
