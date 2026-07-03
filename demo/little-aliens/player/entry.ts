import { Application, Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
import {
  clearTrack,
  crossfadeTo,
  DEG_TO_RAD,
  EffectSystem,
  makeAnimationState,
  setAnimation,
  updateAnimationState,
  type ReadonlyEmitterView,
} from '@marionette/runtime-core';
import { parseDocument } from '@marionette/format';
import { parseEffectsDocument } from '@marionette/format/effects';
import {
  blendModeToPixi,
  buildRegionTextures,
  fillEmitterBatch,
  makeParticleRenderBatch,
  makeRegionTextureResolver,
  SkeletonView,
} from '@marionette/runtime-web';

// The Little Aliens standalone player: a PLAYABLE spin loop on top of the REAL @marionette/runtime-web
// renderer. Presentation only, ZERO document mutation (Law 1/2). The SkeletonView renders the MCP-authored
// document -- its setup pose IS the crafted landing board, and the two per-part rigged mascots perched atop
// the frame idle continuously (their idle keys live in the shared 'idle' animation). The spin is layered on
// with pieces the player owns: a per-column strip of region sprites that scrolls + wraps procedurally while
// a reel is spinning, and AnimationState tracks that play the authored spin-loop animations live. When a
// reel stops the player hides that column's strip, revealing the skeleton cells beneath (already the
// outcome), and plays the bounce. Particles are the runtime-core EffectSystem solved live and drawn through
// fillEmitterBatch into pooled sprites. Everything is inlined in one HTML file; it runs from file://.

declare const GAME_DOCUMENT: unknown;
declare const EFFECTS_DOCUMENT: unknown;
declare const ATLAS_PAGES: Record<string, string>; // page file -> PNG data URL

// The authored scene geometry, mirrored from author-game.mts (the saved rig carries the skeleton, not the
// slot grid, so the reel geometry is restated here). reelStopStaggerMs is the authored 280ms cadence.
const SCENE = { x: -500, y: -900, w: 1000, h: 1660 };
const CELL = 118;
const COL_PITCH = 120;
const ROW_PITCH = 178;
const COLS = [-2, -1, 0, 1, 2].map((i) => i * COL_PITCH);
const ROWS = [-1, 0, 1].map((i) => i * ROW_PITCH);
const REEL_STOP_STAGGER_MS = 280;
const GRID_CENTER = { x: 0, y: 0 };
// The full symbol vocabulary the scrolling strips cycle through (mirrors author-game.mts; a symbol id IS
// its atlas region name).
const SYMBOLS = [
  'alien-green-slime',
  'alien-blue-horned',
  'alien-orange-sun',
  'alien-pink-blob',
  'crystal',
  'potion',
  'raygun',
  'royal-a',
  'royal-k',
  'royal-q',
  'royal-j',
  'royal-10',
  'alien-yellow-trieye',
];

// Spin timing (player presentation clock).
const SPIN_BASE_MS = 650;
const ANTICIPATION_EXTRA_MS = 2200; // reels 4 and 5 keep spinning this much longer once 2 scatters arm
const SCATTER_LAND_MS = 500;
const BONUS_INTRO_MS = 2500; // matches the authored bonus_intro duration
const SPIN_SPEED = 1700; // world units/second the strips scroll while spinning
const SPIN_STRETCH = 1.18; // vertical motion-stretch on the strip symbols at full speed (eases back at stop)
const REEL_SETTLE_MS = 150;
const STRIP_COUNT = 5;
const WINDOW_TOP = ROWS[0]! - CELL / 2;
const WINDOW_BOTTOM = ROWS[2]! + CELL / 2;
const STRIP_TOP = ROWS[0]! - ROW_PITCH;
const WRAP_LIMIT = ROWS[2]! + ROW_PITCH;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

const randomSymbol = (): string => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]!;

interface Reel {
  readonly container: Container;
  readonly sprites: readonly Sprite[];
  scrolling: boolean;
  stretch: number;
}

async function main(): Promise<void> {
  const document = parseDocument(GAME_DOCUMENT, { verifyHash: false });
  const effectsDocument = parseEffectsDocument(EFFECTS_DOCUMENT, { verifyHash: false });

  const app = new Application();
  await app.init({ background: 0x0a0e22, resizeTo: window, antialias: true });
  window.document.body.appendChild(app.canvas);

  // Decode the inlined atlas pages and slice per-region textures through the SAME seam the editor uses.
  const pageTextures = new Map<string, Texture>();
  for (const [file, dataUrl] of Object.entries(ATLAS_PAGES)) {
    pageTextures.set(
      file,
      (await Assets.load({ src: dataUrl, loadParser: 'loadTextures' })) as Texture,
    );
  }
  const regionTextures = buildRegionTextures(document.atlas, pageTextures);
  const resolver = makeRegionTextureResolver(regionTextures);
  // Particles draw from the SEPARATE effects atlas (glow/spark/goo/ring), sliced from the same inlined page
  // textures (build-player inlines both atlases into ATLAS_PAGES keyed by page path).
  const fxRegionTextures = buildRegionTextures(effectsDocument.atlas, pageTextures);

  const view = new SkeletonView();
  view.setTextureResolver(resolver);

  // Three world-space layers sharing one SCENE->screen transform: the skeleton (board + mascots), the reel
  // strips (opaque, on top, revealed away as reels stop), and the particles (topmost, the celebration).
  const worldLayers: Container[] = [];
  app.stage.addChild(view.root);
  const reelsLayer = new Container();
  const particlesLayer = new Container();
  app.stage.addChild(reelsLayer, particlesLayer);
  worldLayers.push(view.root, reelsLayer, particlesLayer);
  // Bone chrome off for playback: the player shows the game, not the rig.
  (view.root.children[1] ?? view.root.children[0])!.visible = false;

  // One scrolling strip per reel column: a masked container at the column's world x with a dark backing
  // (hides the static cells while spinning) plus STRIP_COUNT symbol sprites. The strips live only within
  // the frame window, so they never cover the mascots perched above.
  const reels: Reel[] = [];
  for (let c = 0; c < COLS.length; c += 1) {
    const container = new Container();
    container.position.set(COLS[c]!, 0);
    container.visible = false;

    const backing = new Graphics();
    backing
      .rect(-CELL / 2 - 4, WINDOW_TOP, CELL + 8, WINDOW_BOTTOM - WINDOW_TOP)
      .fill({ color: 0x0a0e22, alpha: 1 });
    container.addChild(backing);

    const sprites: Sprite[] = [];
    for (let i = 0; i < STRIP_COUNT; i += 1) {
      const sprite = new Sprite(regionTextures.get(randomSymbol()) ?? Texture.EMPTY);
      sprite.anchor.set(0.5);
      sprite.position.set(0, STRIP_TOP + i * ROW_PITCH);
      fitSprite(sprite);
      container.addChild(sprite);
      sprites.push(sprite);
    }

    const mask = new Graphics();
    mask.rect(-CELL / 2 - 4, WINDOW_TOP, CELL + 8, WINDOW_BOTTOM - WINDOW_TOP).fill(0xffffff);
    container.addChild(mask);
    container.mask = mask;

    reelsLayer.addChild(container);
    reels.push({ container, sprites, scrolling: false, stretch: 1 });
  }

  // The green anticipation vignette over the two remaining reels (cols 3 and 4), pulsing while armed.
  const vignette = new Graphics();
  vignette
    .rect(
      COLS[3]! - CELL / 2 - 4,
      WINDOW_TOP,
      COLS[4]! - COLS[3]! + CELL + 8,
      WINDOW_BOTTOM - WINDOW_TOP,
    )
    .fill({ color: 0x8dff5a, alpha: 1 });
  vignette.blendMode = 'add';
  vignette.visible = false;
  reelsLayer.addChild(vignette);
  let vignetteTime = 0;

  // Particles: the runtime-core EffectSystem solved live; a pooled set of sprites draws the emitter views.
  const system = new EffectSystem(effectsDocument);
  const particleBatch = makeParticleRenderBatch(256);
  const particlePool: Sprite[] = [];
  const acquireParticle = (index: number): Sprite => {
    let sprite = particlePool[index];
    if (sprite === undefined) {
      sprite = new Sprite();
      sprite.anchor.set(0.5);
      particlesLayer.addChild(sprite);
      particlePool[index] = sprite;
    }
    return sprite;
  };

  const drawParticles = (): void => {
    const frame = system.readState();
    let used = 0;
    for (const instance of frame.instances) {
      for (const emitter of instance.emitters) {
        const texture = fxRegionTextures.get(emitterRegion(emitter));
        if (texture === undefined) continue;
        const blend = blendModeToPixi(emitter.layer.blendMode);
        const count = fillEmitterBatch(particleBatch, emitter);
        for (let k = 0; k < count; k += 1) {
          const sprite = acquireParticle(used);
          used += 1;
          sprite.visible = true;
          sprite.texture = texture;
          sprite.position.set(particleBatch.x[k]!, particleBatch.y[k]!);
          sprite.rotation = particleBatch.rotationDeg[k]! * DEG_TO_RAD;
          sprite.scale.set(particleBatch.scale[k]!);
          sprite.tint = particleBatch.tint[k]!;
          sprite.alpha = particleBatch.alpha[k]!;
          sprite.blendMode = blend;
        }
      }
    }
    for (let i = used; i < particlePool.length; i += 1) particlePool[i]!.visible = false;
  };

  // Fit the authored scene rect to the window; every world layer gets the same transform.
  const layout = (): void => {
    const scale = Math.min(app.screen.width / SCENE.w, app.screen.height / SCENE.h);
    const px = app.screen.width / 2 - (SCENE.x + SCENE.w / 2) * scale;
    const py = app.screen.height / 2 - (SCENE.y + SCENE.h / 2) * scale;
    for (const l of worldLayers) {
      l.scale.set(scale);
      l.position.set(px, py);
    }
  };
  layout();
  window.addEventListener('resize', layout);

  // AnimationState tracks: 0 = base (idle / win / scatter_land / bonus_intro; the mascots idle/win here
  // too), 1 = additive reel bounce, 2 = replace anticipation glow on the landed scatter cells.
  const state = makeAnimationState(document);
  setAnimation(state, 0, 'idle', true);

  const freespins = window.document.getElementById('freespins') as HTMLDivElement;

  const playReelBounce = (): void => {
    const entry = setAnimation(state, 1, 'reel_stop_bounce', false);
    entry.additive = true;
    entry.alpha = 1;
  };
  const armAnticipation = (): void => {
    const entry = setAnimation(state, 2, 'anticipation_glow', true);
    entry.additive = false;
    entry.alpha = 1;
    vignette.visible = true;
  };
  const clearAnticipation = (): void => {
    clearTrack(state, 2);
    vignette.visible = false;
  };

  const stopReel = (c: number): void => {
    const reel = reels[c]!;
    reel.scrolling = false;
    window.setTimeout(() => {
      reel.container.visible = false;
      playReelBounce();
    }, REEL_SETTLE_MS);
  };

  const buttons = {
    spin: window.document.getElementById('spin') as HTMLButtonElement,
    celebrate: window.document.getElementById('celebrate') as HTMLButtonElement,
  };
  let busy = false;

  // The spin cycle: reels scroll and stop left to right at the authored stagger; the 2nd scatter (reel 3)
  // arms the anticipation and extends reels 4-5; the 3rd trigger (reel 5) fires scatter_land -> bonus_intro
  // with the alienCelebration particles and the FREE SPINS! overlay while both mascots celebrate, then
  // everything settles back to idle. Story-fixed to the crafted board.
  const runSpin = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    buttons.spin.disabled = true;
    buttons.celebrate.disabled = true;
    buttons.spin.textContent = 'SPINNING...';

    for (const reel of reels) {
      reel.scrolling = true;
      reel.container.visible = true;
    }

    await sleep(SPIN_BASE_MS);
    stopReel(0); // reel 1: 1st scatter (r0c0)
    await sleep(REEL_STOP_STAGGER_MS);
    stopReel(1);
    await sleep(REEL_STOP_STAGGER_MS);
    stopReel(2); // reel 3: 2nd scatter (r1c2) -> anticipation
    armAnticipation();

    await sleep(ANTICIPATION_EXTRA_MS);
    stopReel(3);
    await sleep(REEL_STOP_STAGGER_MS);
    stopReel(4); // reel 5: the bonus (r1c4), the 3rd trigger

    clearAnticipation();
    crossfadeTo(state, 0, 'scatter_land', false, 0.15);
    await sleep(SCATTER_LAND_MS);

    crossfadeTo(state, 0, 'bonus_intro', false, 0.3);
    system.triggerBundle(
      'alienCelebration',
      Math.floor(Math.random() * 0xffffff),
      { gridCenter: { space: 'world', x: GRID_CENTER.x, y: GRID_CENTER.y, rotation: 0 } },
      0,
    );
    freespins.classList.add('show');
    await sleep(BONUS_INTRO_MS);
    freespins.classList.remove('show');

    crossfadeTo(state, 0, 'idle', true, 0.5);
    buttons.spin.textContent = 'SPIN';
    buttons.spin.disabled = false;
    buttons.celebrate.disabled = false;
    busy = false;
  };
  buttons.spin.addEventListener('click', () => void runSpin());

  // Celebrate: a standalone crossfade to the win animation (board + both mascots) and back, with a burst.
  buttons.celebrate.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    buttons.spin.disabled = true;
    buttons.celebrate.textContent = 'MEGA WIN!';
    crossfadeTo(state, 0, 'win_celebration', false, 0.35);
    system.triggerBundle(
      'alienCelebration',
      Math.floor(Math.random() * 0xffffff),
      { gridCenter: { space: 'world', x: GRID_CENTER.x, y: GRID_CENTER.y, rotation: 0 } },
      0,
    );
    window.setTimeout(() => {
      crossfadeTo(state, 0, 'idle', true, 0.5);
      buttons.celebrate.textContent = 'CELEBRATE';
      buttons.spin.disabled = false;
      busy = false;
    }, 2100);
  });

  app.ticker.add((ticker) => {
    const dt = ticker.deltaMS / 1000;

    updateAnimationState(state, dt);
    view.syncState(document, state);

    // Scroll the spinning strips; wrap any sprite past the bottom back to the top with a fresh symbol. Each
    // strip carries a vertical motion-stretch that eases toward SPIN_STRETCH at speed and back to 1 as it
    // stops, so the reel reads as a real fast blur that settles.
    const advance = SPIN_SPEED * dt;
    const stretchLerp = Math.min(1, dt * 9);
    for (const reel of reels) {
      const target = reel.scrolling ? SPIN_STRETCH : 1;
      reel.stretch += (target - reel.stretch) * stretchLerp;
      for (const sprite of reel.sprites) {
        if (reel.scrolling) {
          sprite.position.y += advance;
          if (sprite.position.y > WRAP_LIMIT) {
            sprite.position.y -= STRIP_COUNT * ROW_PITCH;
            sprite.texture = regionTextures.get(randomSymbol()) ?? Texture.EMPTY;
            fitSprite(sprite);
          }
        }
        sprite.scale.y = sprite.scale.x * reel.stretch;
      }
    }

    if (vignette.visible) {
      vignetteTime += dt;
      vignette.alpha = 0.08 + 0.12 * Math.abs(Math.sin(vignetteTime * 3.2));
    }

    // Particles: advance the solve, then draw every live emitter particle through the shared batch.
    system.step(dt);
    drawParticles();
  });
}

// Size a symbol sprite to fill a cell at native aspect (region textures carry the region's pixel size).
function fitSprite(sprite: Sprite): void {
  const h = sprite.texture.height;
  sprite.scale.set(h > 0 ? (CELL * 0.92) / h : 1);
}

// The static atlas region a live emitter particle draws (an animated texture uses its first region here;
// the demo emitters are all static).
function emitterRegion(view: ReadonlyEmitterView): string {
  const texture = view.layer.texture;
  return texture.kind === 'static' ? texture.region : texture.regions[0]!;
}

void main();
