import { describe, expect, it } from 'vitest';
import { Texture } from 'pixi.js';
import { encodeBinary } from '@marionette/format';
import type { Animation, EffectsDocument, SkeletonDocument } from '@marionette/format/types';
import {
  createPlayer,
  decodeEffectsDocument,
  decodeSkeletonDocument,
  PlayerLoadError,
  type AssetLoader,
} from '../src';
import { bone, makeDocument, region, slot } from './rig';
import { makeSolidTexture } from './texture-fixtures';

// PP-C5 packaged player API. The pure document loader (MRNT / JSON decode + validation with typed errors)
// and the player wiring (AnimationState playback, fired-event subscription, skin switching, atlas loading
// through an injected loader, optional effects) are exercised headlessly (no network, no WebGL context).

const flat = (v: number) => ({
  stops: [
    { t: 0, value: v, curve: 'linear' as const },
    { t: 1, value: v, curve: 'linear' as const },
  ],
});
const flatRgb = (r: number, g: number, b: number) => ({
  stops: [
    { t: 0, value: { r, g, b }, curve: 'linear' as const },
    { t: 1, value: { r, g, b }, curve: 'linear' as const },
  ],
});

function skeletonFixture(): SkeletonDocument {
  return makeDocument({
    bones: [bone('root', null)],
    slots: [slot('body', 'root', 'body')],
    skin: { body: { body: region('body') } },
  });
}

// A skeleton with an event-firing animation (an event keyframe at t = 0.5 naming a defined EventDef).
function eventFixture(): SkeletonDocument {
  const document = makeDocument({
    bones: [bone('root', null)],
    slots: [slot('body', 'root', 'body')],
    skin: { body: { body: region('body') } },
    animations: {
      clip: {
        duration: 1,
        bones: {},
        slots: {},
        ik: {},
        transform: {},
        deform: {},
        drawOrder: [],
        events: [{ time: 0.5, name: 'hit' }],
      } as unknown as Animation,
    },
  });
  return { ...document, events: [{ name: 'hit' }] };
}

function twoSkinFixture(): SkeletonDocument {
  return makeDocument({
    bones: [bone('root', null)],
    slots: [slot('body', 'root', 'body')],
    skin: { body: { body: region('bodyA', { width: 64 }) } },
    extraSkins: [{ name: 'alt', attachments: { body: { body: region('bodyB', { width: 40 }) } } }],
  });
}

function effectsFixture(): EffectsDocument {
  return {
    effectsFormatVersion: '1.0.0',
    name: 'fx',
    hash: '',
    atlas: {
      pages: [
        {
          file: 'fx.png',
          width: 64,
          height: 64,
          regions: [
            {
              name: 'spark',
              x: 0,
              y: 0,
              w: 16,
              h: 16,
              rotated: false,
              offsetX: 0,
              offsetY: 0,
              originalW: 16,
              originalH: 16,
            },
          ],
        },
      ],
    },
    effects: {
      burst: {
        name: 'burst',
        duration: null,
        deterministic: true,
        simulationDt: 1 / 60,
        blendMode: 'additive',
        layers: [
          {
            type: 'emitter',
            name: 'p',
            blendMode: 'additive',
            maxParticles: 16,
            spawn: { mode: 'burst', count: 8, atTime: 0 },
            shape: { kind: 'point' },
            lifetime: { min: 1, max: 2 },
            startSpeed: { min: 10, max: 20 },
            emissionAngle: { min: 0, max: 360 },
            startRotation: { min: 0, max: 0 },
            angularVelocity: { min: 0, max: 0 },
            startScale: { min: 1, max: 1 },
            gravity: { x: 0, y: 0 },
            acceleration: { x: 0, y: 0 },
            drag: 0,
            scaleOverLife: flat(1),
            colorOverLife: flatRgb(1, 1, 1),
            alphaOverLife: flat(1),
            texture: { kind: 'static', region: 'spark' },
            particleTrail: null,
          },
        ],
      },
    },
    bundles: {},
  };
}

const nullAtlas = { resolver: null } as const;

describe('PP-C5 document loader', () => {
  it('validates a parsed skeleton object', () => {
    const doc = decodeSkeletonDocument(skeletonFixture());
    expect(doc.bones[0]!.name).toBe('root');
  });

  it('round-trips a skeleton through JSON text and JSON bytes', () => {
    const json = JSON.stringify(skeletonFixture());
    expect(decodeSkeletonDocument(json).bones).toHaveLength(1);
    expect(decodeSkeletonDocument(new TextEncoder().encode(json)).bones).toHaveLength(1);
  });

  it('decodes an MRNT binary skeleton container', () => {
    const bytes = encodeBinary(decodeSkeletonDocument(skeletonFixture()));
    const decoded = decodeSkeletonDocument(bytes);
    expect(decoded.bones[0]!.name).toBe('root');
  });

  it('fails with skeletonDecode on a corrupt MRNT container', () => {
    const bytes = encodeBinary(decodeSkeletonDocument(skeletonFixture()));
    bytes[10] = (bytes[10]! ^ 0xff) & 0xff; // corrupt the body: valid magic, bad CRC
    let error: unknown;
    try {
      decodeSkeletonDocument(bytes);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(PlayerLoadError);
    expect((error as PlayerLoadError).code).toBe('skeletonDecode');
  });

  it('fails with jsonParse on malformed JSON', () => {
    expect(() => decodeSkeletonDocument('{ not json')).toThrow(PlayerLoadError);
    try {
      decodeSkeletonDocument('{ not json');
    } catch (e) {
      expect((e as PlayerLoadError).code).toBe('jsonParse');
    }
  });

  it('fails with skeletonValidate on a structurally invalid document', () => {
    try {
      decodeSkeletonDocument({ formatVersion: '0.1.0', name: 'broken' });
      throw new Error('expected a PlayerLoadError');
    } catch (e) {
      expect(e).toBeInstanceOf(PlayerLoadError);
      expect((e as PlayerLoadError).code).toBe('skeletonValidate');
    }
  });

  it('validates an effects document and rejects an invalid one', () => {
    expect(decodeEffectsDocument(effectsFixture()).name).toBe('fx');
    try {
      decodeEffectsDocument({ effectsFormatVersion: '1.0.0' });
      throw new Error('expected a PlayerLoadError');
    } catch (e) {
      expect((e as PlayerLoadError).code).toBe('effectsValidate');
    }
  });
});

describe('PP-C5 player', () => {
  it('renders the setup pose with no animation set', async () => {
    const player = await createPlayer({ document: skeletonFixture(), atlas: nullAtlas });
    expect(player.skeletonView.describe().attachments).toHaveLength(1);
    player.destroy();
  });

  it('loads atlas pages through the injected loader and binds the sliced texture', async () => {
    const texture = makeSolidTexture(64, 64);
    const loader: AssetLoader = {
      loadBytes: async () => new Uint8Array(),
      loadTexture: async () => texture,
    };
    const player = await createPlayer({
      document: skeletonFixture(),
      atlas: { pages: [{ file: 'atlas.png', url: 'atlas.png' }] },
      loader,
    });
    // The region resolved to a sub-texture over the loaded page (not the WHITE placeholder).
    const layer = player.skeletonView.root.children[0]!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sprite = layer.children[0] as any;
    expect(sprite.texture).not.toBe(Texture.WHITE);
    expect(sprite.texture.source).toBe(texture.source);
    player.destroy();
  });

  it('advances animation state and dispatches fired events to subscribers', async () => {
    const player = await createPlayer({
      document: eventFixture(),
      atlas: nullAtlas,
      animation: 'clip',
      loop: false,
      autoPlay: true,
    });
    const fired: string[] = [];
    const unsubscribe = player.onEvent((e) => fired.push(e.name));

    player.update(0.6); // crosses the event key at t = 0.5
    expect(fired).toContain('hit');

    // Unsubscribe stops delivery; re-arming and re-crossing fires nothing new.
    unsubscribe();
    player.setAnimation('clip', false);
    player.update(0.6);
    expect(fired).toEqual(['hit']);
    player.destroy();
  });

  it('respects pause (no advance) and play', async () => {
    const player = await createPlayer({
      document: eventFixture(),
      atlas: nullAtlas,
      animation: 'clip',
      loop: false,
      autoPlay: false,
    });
    const fired: string[] = [];
    player.onEvent((e) => fired.push(e.name));

    player.update(0.6); // paused: no advance, no event
    expect(fired).toHaveLength(0);

    player.play();
    player.update(0.6);
    expect(fired).toContain('hit');
    player.destroy();
  });

  it('switches the active skin at runtime', async () => {
    const player = await createPlayer({ document: twoSkinFixture(), atlas: nullAtlas });
    expect([...player.getSkinNames()].sort()).toEqual(['alt', 'default']);
    expect(player.skeletonView.describe().attachments[0]!.width).toBe(64);

    player.setActiveSkin('alt');
    expect(player.skeletonView.describe().attachments[0]!.width).toBe(40);
    player.destroy();
  });

  it('wires an effects subsystem and steps it', async () => {
    const player = await createPlayer({
      document: skeletonFixture(),
      atlas: nullAtlas,
      effects: { document: effectsFixture(), atlas: nullAtlas },
    });
    expect(player.particleView).not.toBeNull();

    const id = player.triggerEffect('burst', { space: 'world', x: 0, y: 0, rotation: 0 });
    expect(id).not.toBeNull();
    for (let i = 0; i < 5; i += 1) player.update(1 / 60);
    // The particle view mounted the triggered instance.
    expect(player.particleView!.describe().instances).toHaveLength(1);
    player.destroy();
  });

  it('propagates a typed load error from createPlayer', async () => {
    await expect(
      createPlayer({ document: { formatVersion: '0.1.0', name: 'nope' }, atlas: nullAtlas }),
    ).rejects.toBeInstanceOf(PlayerLoadError);
  });
});
