import { Application, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import {
  clearTrack,
  crossfadeTo,
  makeAnimationState,
  setAnimation,
  updateAnimationState,
  type AnimationState,
} from '@marionette/runtime-core';
import { parseDocument, type SkeletonDocument } from '@marionette/format';
import { buildRegionTextures, makeRegionTextureResolver, SkeletonView } from '@marionette/runtime-web';
import {
  ACTOR_SCALE,
  GROUND_Y,
  MOUTH_MAP,
  NATIVE_FACES_RIGHT,
  RIG_OF_ACTOR,
  SHOTS,
  STAGE_H,
  STAGE_W,
  type ActorPlacement,
  type PropPlacement,
  type Shot,
} from './cartoon-data';

// GUNNER! Episode 1 player: a 5-minute cartoon interpreter on the REAL @marionette/runtime-web
// renderer. Presentation only, zero document mutation. The sequencer walks the SHOTS timeline:
// backgrounds, per-shot actor spawns with animation tracks (0 base / 1 blink / 2 mouth), prop
// behaviors, a camera container, iris and fade transitions, WebAudio scheduling for dialogue,
// SFX, loops, and the procedural score, and amplitude-driven lip sync (an AnalyserNode gates each
// speaking actor's mouth micro-animations).

declare const RIGS: Record<string, unknown>;
declare const ATLAS_PAGES: Record<string, string>; // page path -> data URL
declare const BACKGROUNDS: Record<string, string>; // bg id -> data URL
declare const AUDIO: Record<string, string>; // cue id -> data URL (mp3/wav)
declare const AUDIO_DURATIONS: Record<string, number>; // cue id -> seconds
declare const PROPS_ATLAS: {
  pages: Array<{
    file: string;
    width: number;
    height: number;
    regions: Array<{ name: string; x: number; y: number; w: number; h: number; offsetX: number; offsetY: number; originalW: number; originalH: number }>;
  }>;
};

const TOTAL = 300;
const DIALOGUE_GAP = 0.3;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const easeFns = {
  linear: (u: number) => u,
  inout: (u: number) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2),
  out: (u: number) => 1 - (1 - u) ** 3,
};

interface CharacterKit {
  document: SkeletonDocument;
  resolver: ReturnType<typeof makeRegionTextureResolver>;
}

interface LiveActor {
  placement: ActorPlacement;
  view: SkeletonView;
  state: AnimationState;
  doc: SkeletonDocument;
  holder: Container;
  baseX: number;
  baseY: number;
  nextBlink: number;
  rng: () => number;
  spawned: boolean;
  mouthState: string;
}

interface LiveProp {
  placement: PropPlacement;
  sprite: Sprite;
  baseX: number;
  baseY: number;
  spawned: boolean;
}

interface ScheduledAudio {
  cue: { id: string; at: number; kind: string; actor?: string; loop?: boolean; volume?: number };
  started: boolean;
  source?: AudioBufferSourceNode;
  gain?: GainNode;
  analyser?: AnalyserNode;
  endsAt: number; // absolute cartoon seconds
  startedAt: number;
}

async function main(): Promise<void> {
  document.title = 'boot';
  // ---- pixi stage ------------------------------------------------------------------------------
  const app = new Application();
  await app.init({ background: 0x000000, resizeTo: window, antialias: true });
  document.title = 'pixi-init';
  document.body.appendChild(app.canvas);
  document.body.style.margin = '0';
  document.body.style.background = '#000';

  const stageRoot = new Container(); // scaled letterbox root (1920x1080 design space)
  app.stage.addChild(stageRoot);
  const world = new Container(); // camera applies here
  const bgLayer = new Container();
  const playLayer = new Container();
  world.addChild(bgLayer, playLayer);
  const fxLayer = new Container(); // transitions (iris/fade), stage space
  const uiLayer = new Container();
  stageRoot.addChild(world, fxLayer, uiLayer);

  function layout(): void {
    const s = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
    stageRoot.scale.set(s);
    stageRoot.x = (window.innerWidth - STAGE_W * s) / 2;
    stageRoot.y = (window.innerHeight - STAGE_H * s) / 2;
  }
  layout();
  window.addEventListener('resize', layout);

  // ---- load atlases + rigs ---------------------------------------------------------------------
  async function textureFromDataUrl(dataUrl: string): Promise<Texture> {
    const res = await fetch(dataUrl);
    const bitmap = await createImageBitmap(await res.blob());
    return Texture.from(bitmap);
  }
  const pageTextures = new Map<string, Texture>();
  let pageN = 0;
  for (const [file, dataUrl] of Object.entries(ATLAS_PAGES)) {
    document.title = 'atlas-' + pageN + '-' + file.slice(6, 16);
    pageTextures.set(file, await textureFromDataUrl(dataUrl));
    pageN += 1;
  }
  document.title = 'atlas-loaded';
  const kits = new Map<string, CharacterKit>();
  for (const [name, raw] of Object.entries(RIGS)) {
    const doc = parseDocument(raw, { verifyHash: false });
    const regionTextures = buildRegionTextures(doc.atlas, pageTextures);
    kits.set(name, { document: doc, resolver: makeRegionTextureResolver(regionTextures) });
  }

  // ---- backgrounds -----------------------------------------------------------------------------
  const bgTextures = new Map<string, Texture>();
  for (const [id, dataUrl] of Object.entries(BACKGROUNDS)) {
    bgTextures.set(id, await textureFromDataUrl(dataUrl));
  }

  document.title = 'bg-loaded';
  // ---- props -----------------------------------------------------------------------------------
  const propTextures = new Map<string, Texture>();
  for (const page of PROPS_ATLAS.pages) {
    const pageTex = pageTextures.get(page.file);
    if (pageTex === undefined) continue;
    for (const r of page.regions) {
      propTextures.set(
        r.name,
        new Texture({ source: pageTex.source, frame: new Rectangle(r.x, r.y, r.w, r.h) }),
      );
    }
  }

  // ---- audio -----------------------------------------------------------------------------------
  const actx = new AudioContext();
  const masterGain = actx.createGain();
  masterGain.connect(actx.destination);
  const musicGain = actx.createGain();
  musicGain.gain.value = 0.55;
  musicGain.connect(masterGain);
  const sfxGain = actx.createGain();
  sfxGain.gain.value = 0.9;
  sfxGain.connect(masterGain);
  const ambGain = actx.createGain();
  ambGain.gain.value = 1;
  ambGain.connect(sfxGain);
  const dlgGain = actx.createGain();
  dlgGain.gain.value = 1.0;
  dlgGain.connect(masterGain);

  const buffers = new Map<string, AudioBuffer>();
  async function loadAudio(): Promise<void> {
    const jobs = Object.entries(AUDIO).map(async ([id, dataUrl]) => {
      const res = await fetch(dataUrl);
      const bytes = await res.arrayBuffer();
      buffers.set(id, await actx.decodeAudioData(bytes));
    });
    await Promise.all(jobs);
  }
  // ?noaudio=1 skips the decode for headless visual QA
  if (new URLSearchParams(window.location.search).get('noaudio') === null) {
    await loadAudio();
  }

  // ---- timeline state --------------------------------------------------------------------------
  let t = 0; // cartoon clock seconds
  let playing = false;
  let currentShotIndex = -1;
  let liveActors: LiveActor[] = [];
  let liveProps: LiveProp[] = [];
  let scheduled: ScheduledAudio[] = [];
  let currentMusic: { cue: string; source: AudioBufferSourceNode; gain: GainNode; startT: number } | null = null;
  let shotMusicStarted = new Set<string>();
  let bgSpriteA: Sprite | null = null;
  let bgSpriteB: Sprite | null = null;
  let bgSpriteC: Sprite | null = null;
  let ropeGfx: Graphics | null = null;

  const shotFor = (time: number): number => {
    for (let i = SHOTS.length - 1; i >= 0; i -= 1) if (time >= SHOTS[i]!.start) return i;
    return 0;
  };

  // ---- audio helpers ---------------------------------------------------------------------------
  function stopAllAudio(): void {
    for (const s of scheduled) {
      try {
        s.source?.stop();
      } catch {
        /* already stopped */
      }
    }
    scheduled = [];
    if (currentMusic !== null) {
      try {
        currentMusic.source.stop();
      } catch {
        /* noop */
      }
      currentMusic = null;
    }
  }

  function startMusic(cue: string, loop: boolean, fade: number, offset = 0): void {
    const buf = buffers.get(cue);
    if (buf === undefined) return;
    const gain = actx.createGain();
    gain.connect(musicGain);
    const source = actx.createBufferSource();
    source.buffer = buf;
    source.loop = loop;
    source.connect(gain);
    if (currentMusic !== null) {
      const old = currentMusic;
      old.gain.gain.setValueAtTime(old.gain.gain.value, actx.currentTime);
      old.gain.gain.linearRampToValueAtTime(0, actx.currentTime + Math.max(0.05, fade));
      const oldSource = old.source;
      window.setTimeout(() => {
        try {
          oldSource.stop();
        } catch {
          /* noop */
        }
      }, fade * 1000 + 100);
    }
    gain.gain.setValueAtTime(fade > 0 ? 0 : 1, actx.currentTime);
    gain.gain.linearRampToValueAtTime(1, actx.currentTime + Math.max(0.02, fade));
    source.start(0, loop ? offset % buf.duration : Math.min(offset, Math.max(0, buf.duration - 0.01)));
    currentMusic = { cue, source, gain, startT: t - offset };
  }

  // ---- actor helpers ---------------------------------------------------------------------------
  function playMicro(actor: LiveActor, track: number, name: string): void {
    const anims = actor.doc.animations as Record<string, unknown>;
    if (anims[name] === undefined) return;
    setAnimation(actor.state, track, name, false);
  }

  function spawnShot(index: number, localT: number): void {
    // tear down
    for (const a of liveActors) a.holder.destroy({ children: true });
    for (const p of liveProps) p.sprite.destroy();
    if (ropeGfx !== null) {
      ropeGfx.destroy();
      ropeGfx = null;
    }
    playLayer.removeChildren();
    bgLayer.removeChildren();
    liveActors = [];
    liveProps = [];
    shotMusicStarted = new Set();

    const shot = SHOTS[index]!;

    // background (doubled when scrolling)
    const bgTex = bgTextures.get(shot.bg);
    if (bgTex !== undefined) {
      bgSpriteA = new Sprite(bgTex);
      bgSpriteA.width = STAGE_W;
      bgSpriteA.height = STAGE_H;
      if (shot.bgTint !== undefined) bgSpriteA.tint = shot.bgTint;
      bgLayer.addChild(bgSpriteA);
      if (shot.bgScroll !== undefined) {
        // wrap-scroll tiles as [normal | mirrored | normal] over a 2-stage period: the mirrored
        // middle makes both joins edge-continuous, so no hard seam sweeps across the frame
        bgSpriteB = new Sprite(bgTex);
        bgSpriteB.width = STAGE_W;
        bgSpriteB.height = STAGE_H;
        bgSpriteB.scale.x = -bgSpriteB.scale.x;
        bgSpriteB.x = 2 * STAGE_W;
        if (shot.bgTint !== undefined) bgSpriteB.tint = shot.bgTint;
        bgLayer.addChild(bgSpriteB);
        bgSpriteC = new Sprite(bgTex);
        bgSpriteC.width = STAGE_W;
        bgSpriteC.height = STAGE_H;
        bgSpriteC.x = 2 * STAGE_W;
        if (shot.bgTint !== undefined) bgSpriteC.tint = shot.bgTint;
        bgLayer.addChild(bgSpriteC);
      } else {
        bgSpriteB = null;
        bgSpriteC = null;
      }
    }

    // props under/over actors: simple heuristic, blanket/basket/wagon behind actors, rest above
    const behind = new Set(['blanket', 'basket', 'wagon-catapult', 'boulder', 'log', 'sun', 'cloud']);
    const propLayerBack = new Container();
    const actorLayer = new Container();
    const propLayerFront = new Container();
    playLayer.addChild(propLayerBack, actorLayer, propLayerFront);

    for (const placement of shot.props ?? []) {
      const tex = propTextures.get(placement.prop);
      if (tex === undefined) continue;
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5);
      const sc = placement.scale ?? 1;
      sprite.scale.set(sc * 0.5); // props atlas is 4K-scale art; halve to stage scale
      if (placement.rotation !== undefined) sprite.rotation = placement.rotation;
      if (placement.flip === true) sprite.scale.x *= -1;
      sprite.x = placement.x;
      sprite.y = placement.y;
      const live: LiveProp = { placement, sprite, baseX: placement.x, baseY: placement.y, spawned: false };
      const wantFront = placement.behavior === 'float-bob' || placement.prop === 'float-donut' || placement.prop === 'branch' || placement.prop === 'logo' || placement.prop === 'leaf-hat';
      (behind.has(placement.prop) && !wantFront ? propLayerBack : propLayerFront).addChild(sprite);
      sprite.visible = false;
      liveProps.push(live);
    }

    for (const placement of shot.actors) {
      const rigName = RIG_OF_ACTOR[placement.actor]!;
      const kit = kits.get(rigName);
      if (kit === undefined) continue;
      const view = new SkeletonView();
      view.setTextureResolver(kit.resolver);
      // hide the editor's bone-gizmo layer (root children: [attachments, bones])
      const boneLayer = view.root.children[1];
      if (boneLayer !== undefined) boneLayer.visible = false;
      const state = makeAnimationState(kit.document);
      setAnimation(state, 0, placement.anim, placement.loop !== false);
      const holder = new Container();
      const scale = (placement.scale ?? 1) * (ACTOR_SCALE[placement.actor] ?? 0.85);
      holder.scale.set(scale);
      const facesRight = NATIVE_FACES_RIGHT[placement.actor] === true;
      const wantRight = placement.flip === true;
      if (wantRight !== facesRight) holder.scale.x = -holder.scale.x;
      holder.addChild(view.root);
      holder.x = placement.x;
      holder.y = placement.y;
      actorLayer.addChild(holder);
      holder.visible = false;
      const rng = mulberry32(placement.actor.length * 7919 + index * 104729 + 13);
      liveActors.push({
        placement,
        view,
        state,
        doc: kit.document,
        holder,
        baseX: placement.x,
        baseY: placement.y,
        nextBlink: localT + 1 + rng() * 3,
        rng,
        spawned: false,
        mouthState: 'closed',
      });
    }

    if (shot.rope !== undefined) {
      ropeGfx = new Graphics();
      propLayerFront.addChild(ropeGfx);
    }

    // audio cues become pending
    scheduled = shot.audio.map((cue) => ({
      cue,
      started: false,
      endsAt: 0,
      startedAt: 0,
    }));

    // auto-space dialogue: never overlap lines within a shot
    let prevDlgEnd = -1;
    for (const s of scheduled) {
      if (s.cue.kind !== 'dlg') continue;
      const dur = AUDIO_DURATIONS[s.cue.id] ?? 2;
      let at = s.cue.at;
      if (prevDlgEnd >= 0 && at < prevDlgEnd + DIALOGUE_GAP) at = prevDlgEnd + DIALOGUE_GAP;
      (s.cue as { at: number }).at = at;
      prevDlgEnd = at + dur;
    }
  }

  function seek(newT: number, resume: boolean): void {
    stopAllAudio();
    t = Math.max(0, Math.min(TOTAL - 0.01, newT));
    const idx = shotFor(t);
    currentShotIndex = idx;
    spawnShot(idx, t - SHOTS[idx]!.start);
    // restart music: find the most recent music cue at or before t across shots
    let found: { cue: string; absAt: number; loop: boolean; fade: number } | null = null;
    for (const shot of SHOTS) {
      for (const m of shot.music ?? []) {
        const absAt = shot.start + m.at;
        if (absAt <= t && (found === null || absAt > found.absAt)) {
          found = { cue: m.cue, absAt, loop: m.loop, fade: 0 };
        }
      }
    }
    if (found !== null) {
      const offset = t - found.absAt;
      const buf = buffers.get(found.cue);
      if (buf !== undefined && (found.loop || offset < buf.duration)) {
        startMusic(found.cue, found.loop, 0.05, offset);
        shotMusicStarted.add(`${currentShotIndex}:${found.cue}:${found.absAt}`);
      }
    }
    // mark music cues in the current shot that already fired
    for (const m of SHOTS[idx]!.music ?? []) {
      if (SHOTS[idx]!.start + m.at <= t) shotMusicStarted.add(`${idx}:${m.cue}:${SHOTS[idx]!.start + m.at}`);
    }
    playing = resume;
  }

  // ---- lip sync --------------------------------------------------------------------------------
  const analyserData = new Float32Array(1024);
  function mouthFor(actorName: string, level: number): 'closed' | 'small' | 'big' {
    if (level > 0.09) return 'big';
    if (level > 0.03) return 'small';
    return 'closed';
  }

  // ---- per-frame update ------------------------------------------------------------------------
  function update(dt: number): void {
    if (!playing) return;
    t += dt;
    if (t >= TOTAL) {
      t = TOTAL - 0.001;
      playing = false;
    }
    const idx = shotFor(t);
    if (idx !== currentShotIndex) {
      // natural shot advance: keep audio that outlives its shot (music handled separately)
      for (const s of scheduled) {
        if (s.cue.loop === true && s.source !== undefined) {
          try {
            s.source.stop();
          } catch {
            /* noop */
          }
        }
      }
      currentShotIndex = idx;
      spawnShot(idx, 0);
    }
    const shot = SHOTS[idx]!;
    const localT = t - shot.start;

    // background scroll (period 2*STAGE_W: A normal, B mirrored, C normal)
    if (shot.bgScroll !== undefined && bgSpriteA !== null && bgSpriteB !== null && bgSpriteC !== null) {
      const off = (localT * shot.bgScroll) % (2 * STAGE_W);
      bgSpriteA.x = -off;
      bgSpriteB.x = 2 * STAGE_W - off; // mirrored: covers [STAGE_W - off, 2*STAGE_W - off)
      bgSpriteC.x = 2 * STAGE_W - off;
    }

    // camera
    if (shot.camera !== undefined) {
      const u = Math.max(0, Math.min(1, localT / (shot.end - shot.start)));
      const e = easeFns[shot.camera.ease ?? 'inout'](u);
      let cx = shot.camera.from.x + (shot.camera.to.x - shot.camera.from.x) * e;
      let cy = shot.camera.from.y + (shot.camera.to.y - shot.camera.from.y) * e;
      const cz = shot.camera.from.zoom + (shot.camera.to.zoom - shot.camera.from.zoom) * e;
      // clamp the view inside the stage: a camera target near an edge otherwise shows black bars
      const halfW = STAGE_W / (2 * cz);
      const halfH = STAGE_H / (2 * cz);
      cx = halfW >= STAGE_W / 2 ? STAGE_W / 2 : Math.max(halfW, Math.min(STAGE_W - halfW, cx));
      cy = halfH >= STAGE_H / 2 ? STAGE_H / 2 : Math.max(halfH, Math.min(STAGE_H - halfH, cy));
      world.scale.set(cz);
      world.x = STAGE_W / 2 - cx * cz;
      world.y = STAGE_H / 2 - cy * cz;
    } else {
      world.scale.set(1);
      world.x = 0;
      world.y = 0;
    }

    // audio scheduling
    for (const s of scheduled) {
      if (!s.started && localT >= s.cue.at) {
        s.started = true;
        const buf = buffers.get(s.cue.id);
        if (buf !== undefined) {
          const source = actx.createBufferSource();
          source.buffer = buf;
          source.loop = s.cue.loop === true;
          const gain = actx.createGain();
          gain.gain.value = s.cue.volume ?? 1;
          source.connect(gain);
          if (s.cue.kind === 'dlg') {
            const analyser = actx.createAnalyser();
            analyser.fftSize = 1024;
            gain.connect(analyser);
            analyser.connect(dlgGain);
            s.analyser = analyser;
          } else {
            gain.connect(s.cue.loop === true ? ambGain : sfxGain);
          }
          const offset = Math.max(0, localT - s.cue.at);
          source.start(0, s.cue.loop === true ? offset % buf.duration : Math.min(offset, buf.duration - 0.01));
          s.source = source;
          s.gain = gain;
          s.startedAt = t;
          s.endsAt = s.cue.loop === true ? shot.end : t + buf.duration;
        }
      }
    }
    // ambience ducking under dialogue
    const dialogueActive = scheduled.some(
      (s) => s.cue.kind === 'dlg' && s.started && t < s.endsAt,
    );
    ambGain.gain.setTargetAtTime(dialogueActive ? 0.45 : 1, actx.currentTime, 0.15);

    // music cues for this shot
    for (const m of shot.music ?? []) {
      const key = `${idx}:${m.cue}:${shot.start + m.at}`;
      if (!shotMusicStarted.has(key) && localT >= m.at) {
        shotMusicStarted.add(key);
        startMusic(m.cue, m.loop, m.fade ?? 1.0);
      }
    }

    // actors
    for (const a of liveActors) {
      const appearAt = a.placement.at ?? 0;
      if (!a.spawned && localT >= appearAt) {
        a.spawned = true;
        a.holder.visible = true;
        if (a.placement.eyes !== undefined) playMicro(a, 1, a.placement.eyes);
      }
      if (!a.spawned) continue;

      // tweens
      let x = a.baseX;
      let y = a.baseY;
      for (const tw of a.placement.tweens ?? []) {
        if (localT < tw.t0) continue;
        const u = Math.max(0, Math.min(1, (localT - tw.t0) / Math.max(0.001, tw.t1 - tw.t0)));
        const e = easeFns[tw.ease ?? 'inout'](u);
        const fromX = x;
        const fromY = y;
        x = fromX + (tw.to.x - fromX) * e;
        y = fromY + (tw.to.y - fromY) * e;
        if (tw.arc !== undefined) y -= tw.arc * 4 * u * (1 - u);
        if (u < 1 && tw.animDuring !== undefined && a.state.tracks[0]?.animationId !== tw.animDuring) {
          crossfadeTo(a.state, 0, tw.animDuring, true, 0.12);
        }
        if (u >= 1 && tw.animAfter !== undefined && a.state.tracks[0]?.animationId !== tw.animAfter) {
          crossfadeTo(a.state, 0, tw.animAfter, true, 0.15);
        }
      }
      a.holder.x = x;
      a.holder.y = y;

      // a completed non-looping base anim holds its final pose for a beat, then returns to life;
      // a fully frozen actor (no breathing, only blinks) reads as a stalled player
      const base = a.state.tracks[0];
      if (base !== null && !base.loop && base.trackTime >= base.duration + 0.9) {
        const fallback = a.placement.after ?? 'idle';
        const anims = a.doc.animations as Record<string, unknown>;
        if (base.animationId !== fallback && anims[fallback] !== undefined) {
          crossfadeTo(a.state, 0, fallback, true, 0.45);
        }
      }

      // blink
      if (localT >= a.nextBlink) {
        playMicro(a, 1, 'blink');
        a.nextBlink = localT + 1.6 + a.rng() * 3.2;
      }

      // lip sync
      const line = scheduled.find(
        (s) => s.cue.kind === 'dlg' && s.cue.actor === a.placement.actor && s.started && t < s.endsAt,
      );
      if (line?.analyser !== undefined) {
        line.analyser.getFloatTimeDomainData(analyserData);
        let sum = 0;
        for (let i = 0; i < analyserData.length; i += 1) sum += analyserData[i]! * analyserData[i]!;
        const rms = Math.sqrt(sum / analyserData.length);
        const want = mouthFor(a.placement.actor, rms);
        if (want !== a.mouthState) {
          a.mouthState = want;
          const map = MOUTH_MAP[a.placement.actor]!;
          playMicro(a, 2, map[want]);
        }
      } else if (a.mouthState !== 'closed') {
        a.mouthState = 'closed';
        playMicro(a, 2, MOUTH_MAP[a.placement.actor]!.closed);
      }

      updateAnimationState(a.state, dt);
      a.view.syncState(a.doc, a.state);
    }

    // props
    for (const p of liveProps) {
      const appearAt = p.placement.at ?? 0;
      if (!p.spawned && localT >= appearAt) {
        p.spawned = true;
        p.sprite.visible = true;
      }
      if (!p.spawned) continue;
      let x = p.baseX;
      let y = p.baseY;
      const propLocal = localT - appearAt;
      for (const tw of p.placement.tweens ?? []) {
        if (propLocal < tw.t0) continue;
        const u = Math.max(0, Math.min(1, (propLocal - tw.t0) / Math.max(0.001, tw.t1 - tw.t0)));
        const e = easeFns[tw.ease ?? 'inout'](u);
        x = x + (tw.to.x - x) * e;
        y = y + (tw.to.y - y) * e;
        if (tw.arc !== undefined) y -= tw.arc * 4 * u * (1 - u);
      }
      switch (p.placement.behavior) {
        case 'sun-rays':
          p.sprite.rotation = (p.placement.rotation ?? 0) + propLocal * 0.05;
          break;
        case 'logo-drop': {
          const u = Math.min(1, propLocal / 0.7);
          const e = u < 1 ? 1 - (1 - u) ** 2 : 1;
          y = -260 + (p.baseY + 260) * e;
          const wob = Math.max(0, 1 - propLocal * 1.4);
          p.sprite.scale.set((p.placement.scale ?? 1) * 0.5 * (1 + 0.08 * Math.sin(propLocal * 18) * wob));
          break;
        }
        case 'butterfly': {
          x += Math.sin(propLocal * 1.1) * 90;
          y += Math.sin(propLocal * 2.3) * 40 - propLocal * 6;
          p.sprite.scale.y = (p.placement.scale ?? 1) * 0.5 * (0.75 + 0.25 * Math.sin(propLocal * 18));
          break;
        }
        case 'float-bob':
          y += Math.sin(propLocal * 2.2) * 9;
          p.sprite.rotation = Math.sin(propLocal * 1.7) * 0.06;
          break;
        case 'branch-arc':
          p.sprite.rotation = (p.placement.rotation ?? 0) + Math.min(1, propLocal / 2.2) * 1.1 - 1.0;
          break;
        case 'branch-fall':
          p.sprite.rotation = (p.placement.rotation ?? 0) + Math.max(0, propLocal - 3.0) * 0.9;
          break;
        case 'bark-ring': {
          const u = Math.min(1, propLocal / 1.2);
          p.sprite.scale.set(0.05 + u * 2.4);
          p.sprite.alpha = Math.max(0, 0.55 * (1 - u));
          break;
        }
        default:
          break;
      }
      p.sprite.x = x;
      p.sprite.y = y;
    }

    // rope
    if (shot.rope !== undefined && ropeGfx !== null) {
      const from = liveActors.find((a) => a.placement.actor === shot.rope!.fromActor);
      let toX: number | null = null;
      let toY: number | null = null;
      if (shot.rope.toActor !== undefined) {
        const to = liveActors.find((a) => a.placement.actor === shot.rope!.toActor);
        if (to !== undefined && to.spawned) {
          toX = to.holder.x + shot.rope.toOffset.x;
          toY = to.holder.y + shot.rope.toOffset.y;
        }
      } else if (shot.rope.toProp !== undefined) {
        const to = liveProps.find((p) => p.placement.prop === shot.rope!.toProp);
        if (to !== undefined && to.spawned) {
          toX = to.sprite.x + shot.rope.toOffset.x;
          toY = to.sprite.y + shot.rope.toOffset.y;
        }
      }
      ropeGfx.clear();
      if (from !== undefined && from.spawned && toX !== null && toY !== null) {
        const fx = from.holder.x + shot.rope.fromOffset.x * Math.sign(from.holder.scale.x) * -1;
        const fy = from.holder.y + shot.rope.fromOffset.y;
        const midX = (fx + toX) / 2;
        const midY = (fy + toY) / 2 + (shot.rope.sag ?? 20);
        // twisted hemp rope: dark outline under a tan core, then diagonal strand ticks so the
        // braid reads at distance
        ropeGfx.moveTo(fx, fy);
        ropeGfx.quadraticCurveTo(midX, midY, toX, toY);
        ropeGfx.stroke({ width: 15, color: 0x5f3d1e, cap: 'round' });
        ropeGfx.moveTo(fx, fy);
        ropeGfx.quadraticCurveTo(midX, midY, toX, toY);
        ropeGfx.stroke({ width: 10, color: 0xd9a95f, cap: 'round' });
        const q = (t: number): { x: number; y: number } => ({
          x: (1 - t) * (1 - t) * fx + 2 * (1 - t) * t * midX + t * t * toX,
          y: (1 - t) * (1 - t) * fy + 2 * (1 - t) * t * midY + t * t * toY,
        });
        const span = Math.hypot(toX - fx, toY - fy);
        const ticks = Math.max(6, Math.round(span / 22));
        for (let i = 1; i < ticks; i += 1) {
          const t = i / ticks;
          const p = q(t);
          const ahead = q(Math.min(1, t + 0.02));
          const dx = ahead.x - p.x;
          const dy = ahead.y - p.y;
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          ropeGfx.moveTo(p.x - ux * 3 - uy * 4.5, p.y - uy * 3 + ux * 4.5);
          ropeGfx.lineTo(p.x + ux * 3 + uy * 4.5, p.y + uy * 3 - ux * 4.5);
        }
        ropeGfx.stroke({ width: 2.5, color: 0x8a5a30, cap: 'round' });
      }
    }

    // transitions
    transGfx.clear();
    const inT = shot.transitionIn;
    const outT = shot.transitionOut;
    if (inT !== undefined && localT < inT.duration) {
      const u = localT / inT.duration;
      if (inT.kind === 'fade') {
        transGfx.rect(0, 0, STAGE_W, STAGE_H).fill({ color: 0x000000, alpha: 1 - u });
      } else {
        drawIris(u);
      }
    }
    if (outT !== undefined && localT >= outT.at) {
      const u = Math.min(1, (localT - outT.at) / Math.max(0.05, shot.end - shot.start - outT.at));
      if (outT.kind === 'fade') {
        transGfx.rect(0, 0, STAGE_W, STAGE_H).fill({ color: 0x000000, alpha: u });
      } else {
        drawIris(1 - u);
      }
    }

    updateUi();
  }

  const transGfx = new Graphics();
  fxLayer.addChild(transGfx);
  function drawIris(openness: number): void {
    // openness 1 = fully open (no black), 0 = closed
    const maxR = Math.hypot(STAGE_W, STAGE_H) / 2;
    const r = Math.max(0.001, openness) * maxR;
    transGfx
      .rect(0, 0, STAGE_W, STAGE_H)
      .fill({ color: 0x000000 })
      .circle(STAGE_W / 2, STAGE_H / 2, r)
      .cut();
  }

  // ---- ui --------------------------------------------------------------------------------------
  const uiBar = new Graphics();
  uiLayer.addChild(uiBar);
  const BAR_Y = STAGE_H - 34;
  function updateUi(): void {
    uiBar.clear();
    uiBar.rect(40, BAR_Y, STAGE_W - 80, 10).fill({ color: 0xffffff, alpha: 0.25 });
    uiBar
      .rect(40, BAR_Y, (STAGE_W - 80) * (t / TOTAL), 10)
      .fill({ color: 0xf2b233, alpha: 0.95 });
  }
  updateUi();

  const overlay = new Graphics();
  overlay.rect(0, 0, STAGE_W, STAGE_H).fill({ color: 0x000000, alpha: 0.55 });
  overlay
    .circle(STAGE_W / 2, STAGE_H / 2, 110)
    .fill({ color: 0xf2b233, alpha: 0.95 })
    .poly([
      STAGE_W / 2 - 34, STAGE_H / 2 - 56,
      STAGE_W / 2 + 62, STAGE_H / 2,
      STAGE_W / 2 - 34, STAGE_H / 2 + 56,
    ])
    .fill({ color: 0x2b1a12 });
  uiLayer.addChild(overlay);
  overlay.eventMode = 'static';
  overlay.cursor = 'pointer';

  overlay.on('pointerdown', () => {
    void actx.resume();
    overlay.visible = false;
    playing = true;
    if (currentShotIndex === -1) seek(0, true);
  });

  app.canvas.addEventListener('pointerdown', (ev) => {
    if (overlay.visible) return;
    const rect = app.canvas.getBoundingClientRect();
    const sx = ((ev.clientX - rect.left) / rect.width) * window.innerWidth;
    const sy = ((ev.clientY - rect.top) / rect.height) * window.innerHeight;
    const local = stageRoot.toLocal({ x: sx, y: sy });
    if (local.y > BAR_Y - 30 && local.y < BAR_Y + 44 && local.x >= 40 && local.x <= STAGE_W - 40) {
      const frac = (local.x - 40) / (STAGE_W - 80);
      seek(frac * TOTAL, true);
    } else {
      playing = !playing;
      if (playing) void actx.resume();
    }
  });

  app.ticker.add((ticker) => {
    update(Math.min(0.1, ticker.deltaMS / 1000));
  });

  // Headless QA hook: ?t=NN renders a paused frame at NN seconds (no interaction needed).
  document.title = 'ready';
  // Headless QA hooks: ?t=NN renders a paused frame; window.__gunnerSeek re-seeks without reload.
  (window as unknown as { __gunnerSeek: (n: number) => void }).__gunnerSeek = (n: number) => {
    overlay.visible = false;
    seek(n, false);
    playing = true;
    update(0.001);
    playing = false;
  };
  const qaT = new URLSearchParams(window.location.search).get('t');
  if (qaT !== null) {
    overlay.visible = false;
    seek(Number(qaT), false);
    playing = true;
    update(0.001);
    playing = false;
    document.title = 'qa-rendered';
  }
}

main().catch((e) => { document.title = 'ERR:' + String(e).slice(0, 120); });
