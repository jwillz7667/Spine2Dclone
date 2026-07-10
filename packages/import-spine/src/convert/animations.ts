import type {
  Animation,
  BoneTimelines,
  DeformTimelines,
  EventKeyframe,
  IkFrame,
  Keyframe,
  PathFrame,
  RGBA,
  Skin,
  SlotTimelines,
  TransformFrame,
} from '@marionette/format';
import { parseHexColor } from '../color';
import { parseCurve } from '../curve';
import type { Diagnostics } from '../diagnostics';
import {
  asArray,
  asRecord,
  ptr,
  readNumber,
  readOptionalNumber,
  readOptionalString,
  type JsonRecord,
} from '../read';

// The mutable duration accumulator: an animation carries no explicit duration in Spine JSON (the runtime
// derives it as the maximum keyframe time), so the converter tracks the largest time it sees per
// animation and emits it as `duration`.
class Duration {
  private max = 0;
  note(time: number): void {
    if (time > this.max) this.max = time;
  }
  get value(): number {
    return this.max;
  }
}

// Everything the animation converter needs from the rest of the document: skins (to resolve a deform
// target mesh's logical-vertex count) and which slots already carry a setup dark color (a two-color
// timeline on a slot without one triggers synthesis, recorded in `needsDark`).
export interface AnimationContext {
  readonly skinsByName: ReadonlyMap<string, Skin>;
  readonly slotsWithDark: ReadonlySet<string>;
  readonly needsDark: Set<string>;
}

export function convertAnimations(
  animationsValue: unknown,
  base: string,
  diag: Diagnostics,
  ctx: AnimationContext,
): Record<string, Animation> {
  const out: Record<string, Animation> = {};
  if (animationsValue === undefined) return out;
  const rec = asRecord(animationsValue, base, diag);
  if (rec === undefined) return out;

  for (const [name, raw] of Object.entries(rec)) {
    const path = ptr(base, name);
    const animRec = asRecord(raw, path, diag);
    if (animRec === undefined) continue;
    out[name] = convertAnimation(animRec, path, diag, ctx);
  }
  return out;
}

function convertAnimation(
  rec: JsonRecord,
  base: string,
  diag: Diagnostics,
  ctx: AnimationContext,
): Animation {
  const duration = new Duration();
  const bones = convertBoneAnimations(rec['bones'], ptr(base, 'bones'), diag, duration);
  const slots = convertSlotAnimations(rec['slots'], ptr(base, 'slots'), diag, duration, ctx);
  const ik = convertIkTimelines(rec['ik'], ptr(base, 'ik'), diag, duration);
  const transform = convertTransformTimelines(
    rec['transform'],
    ptr(base, 'transform'),
    diag,
    duration,
  );
  const pathTimelines = convertPathTimelines(rec['path'], ptr(base, 'path'), diag, duration);
  const deform = convertDeform(rec['deform'], ptr(base, 'deform'), diag, duration, ctx);
  const events = convertEventTimeline(rec['events'], ptr(base, 'events'), diag, duration);
  warnDrawOrder(rec['draworder'], ptr(base, 'draworder'), diag);
  warnPhysicsTimeline(rec['physics'], ptr(base, 'physics'), diag);

  return {
    duration: duration.value,
    bones,
    slots,
    ik,
    transform,
    path: pathTimelines,
    physics: {},
    deform,
    drawOrder: [],
    events,
  };
}

// A generic keyframe mapper: reads `time` and the outgoing `curve`, notes the time for the duration, and
// delegates the typed value to `valueOf`. Used by the bone and joint-color tracks that carry a curve.
function mapCurvedKeyframes<V>(
  value: unknown,
  base: string,
  diag: Diagnostics,
  duration: Duration,
  valueOf: (rec: JsonRecord, path: string) => V,
): Array<Keyframe<V>> {
  const array = asArray(value, base, diag);
  if (array === undefined) return [];
  const out: Array<Keyframe<V>> = [];
  for (const [index, raw] of array.entries()) {
    const path = ptr(base, index);
    const rec = asRecord(raw, path, diag);
    if (rec === undefined) continue;
    const time = readNumber(rec, 'time', path, diag, 0);
    duration.note(time);
    out.push({ time, value: valueOf(rec, path), curve: parseCurve(rec, path, diag) });
  }
  return out;
}

function convertBoneAnimations(
  value: unknown,
  base: string,
  diag: Diagnostics,
  duration: Duration,
): Record<string, BoneTimelines> {
  const out: Record<string, BoneTimelines> = {};
  if (value === undefined) return out;
  const rec = asRecord(value, base, diag);
  if (rec === undefined) return out;

  for (const [boneName, raw] of Object.entries(rec)) {
    const path = ptr(base, boneName);
    const boneRec = asRecord(raw, path, diag);
    if (boneRec === undefined) continue;

    const timelines: {
      rotate?: Array<Keyframe<{ angle: number }>>;
      translate?: Array<Keyframe<{ x: number; y: number }>>;
      scale?: Array<Keyframe<{ x: number; y: number }>>;
      shear?: Array<Keyframe<{ x: number; y: number }>>;
    } = {};

    if (boneRec['rotate'] !== undefined) {
      timelines.rotate = mapCurvedKeyframes(
        boneRec['rotate'],
        ptr(path, 'rotate'),
        diag,
        duration,
        (r, p) => ({
          angle: readNumber(r, 'angle', p, diag, 0),
        }),
      );
    }
    if (boneRec['translate'] !== undefined) {
      timelines.translate = mapCurvedKeyframes(
        boneRec['translate'],
        ptr(path, 'translate'),
        diag,
        duration,
        (r, p) => ({
          x: readNumber(r, 'x', p, diag, 0),
          y: readNumber(r, 'y', p, diag, 0),
        }),
      );
    }
    if (boneRec['scale'] !== undefined) {
      timelines.scale = mapCurvedKeyframes(
        boneRec['scale'],
        ptr(path, 'scale'),
        diag,
        duration,
        (r, p) => ({
          x: readNumber(r, 'x', p, diag, 1),
          y: readNumber(r, 'y', p, diag, 1),
        }),
      );
    }
    if (boneRec['shear'] !== undefined) {
      timelines.shear = mapCurvedKeyframes(
        boneRec['shear'],
        ptr(path, 'shear'),
        diag,
        duration,
        (r, p) => ({
          x: readNumber(r, 'x', p, diag, 0),
          y: readNumber(r, 'y', p, diag, 0),
        }),
      );
    }
    out[boneName] = timelines;
  }
  return out;
}

function convertSlotAnimations(
  value: unknown,
  base: string,
  diag: Diagnostics,
  duration: Duration,
  ctx: AnimationContext,
): Record<string, SlotTimelines> {
  const out: Record<string, SlotTimelines> = {};
  if (value === undefined) return out;
  const rec = asRecord(value, base, diag);
  if (rec === undefined) return out;

  for (const [slotName, raw] of Object.entries(rec)) {
    const path = ptr(base, slotName);
    const slotRec = asRecord(raw, path, diag);
    if (slotRec === undefined) continue;

    const timelines: {
      attachment?: Array<{ time: number; name: string | null }>;
      color?: Array<Keyframe<{ color: RGBA }>>;
      dark?: Array<Keyframe<{ color: RGBA }>>;
    } = {};

    if (slotRec['attachment'] !== undefined) {
      timelines.attachment = convertAttachmentTimeline(
        slotRec['attachment'],
        ptr(path, 'attachment'),
        diag,
        duration,
      );
    }
    if (slotRec['color'] !== undefined) {
      timelines.color = mapCurvedKeyframes(
        slotRec['color'],
        ptr(path, 'color'),
        diag,
        duration,
        (r, p) => ({
          color: readTimelineColor(r, 'color', p, diag),
        }),
      );
    }
    if (slotRec['twoColor'] !== undefined) {
      convertTwoColorTimeline(
        slotRec['twoColor'],
        ptr(path, 'twoColor'),
        diag,
        duration,
        slotName,
        ctx,
        timelines,
      );
    }
    out[slotName] = timelines;
  }
  return out;
}

// The attachment timeline is stepped (no curve). A null `name` clears the slot's attachment.
function convertAttachmentTimeline(
  value: unknown,
  base: string,
  diag: Diagnostics,
  duration: Duration,
): Array<{ time: number; name: string | null }> {
  const array = asArray(value, base, diag);
  if (array === undefined) return [];
  const out: Array<{ time: number; name: string | null }> = [];
  for (const [index, raw] of array.entries()) {
    const path = ptr(base, index);
    const rec = asRecord(raw, path, diag);
    if (rec === undefined) continue;
    const time = readNumber(rec, 'time', path, diag, 0);
    duration.note(time);
    out.push({ time, name: readOptionalString(rec, 'name', path, diag) ?? null });
  }
  return out;
}

// A two-color timeline supplies a light and a dark RGBA per key. Our format splits these across the
// joint `color` track (from light) and the `dark` track (from dark). A dark track requires the slot to
// carry a setup dark color; when it does not, the slot is registered for synthesis (a black setup dark
// color) so the animation stays representable, and a warning is emitted.
function convertTwoColorTimeline(
  value: unknown,
  base: string,
  diag: Diagnostics,
  duration: Duration,
  slotName: string,
  ctx: AnimationContext,
  timelines: {
    color?: Array<Keyframe<{ color: RGBA }>>;
    dark?: Array<Keyframe<{ color: RGBA }>>;
  },
): void {
  const array = asArray(value, base, diag);
  if (array === undefined) return;
  const light: Array<Keyframe<{ color: RGBA }>> = [];
  const dark: Array<Keyframe<{ color: RGBA }>> = [];
  for (const [index, raw] of array.entries()) {
    const path = ptr(base, index);
    const rec = asRecord(raw, path, diag);
    if (rec === undefined) continue;
    const time = readNumber(rec, 'time', path, diag, 0);
    duration.note(time);
    const curve = parseCurve(rec, path, diag);
    light.push({ time, value: { color: readTimelineColor(rec, 'light', path, diag) }, curve });
    dark.push({ time, value: { color: readTimelineColor(rec, 'dark', path, diag) }, curve });
  }
  // The light track merges into the joint color track; if a `color` timeline already exists (a slot
  // does not carry both), the two-color light wins nothing and simply provides the color track.
  timelines.color = light;
  timelines.dark = dark;
  if (!ctx.slotsWithDark.has(slotName)) {
    ctx.needsDark.add(slotName);
    diag.warn(
      'two-color-synthesized-dark',
      base,
      `slot "${slotName}" has a two-color timeline but no setup dark color; a black setup dark color is synthesized`,
      { slot: slotName },
    );
  }
}

// A timeline color is an 8 (or 6) digit hex string. An invalid one records SPINE_COLOR_INVALID and falls
// back to opaque white so the conversion continues; validateDocument still gates the final document.
function readTimelineColor(rec: JsonRecord, key: string, base: string, diag: Diagnostics): RGBA {
  const value = rec[key];
  if (typeof value === 'string') {
    const parsed = parseHexColor(value);
    if (parsed !== null) return parsed;
    diag.error(
      'SPINE_COLOR_INVALID',
      ptr(base, key),
      `color "${value}" is not a 6 or 8 digit hex string`,
      {
        value,
      },
    );
  } else {
    diag.error(
      'SPINE_COLOR_INVALID',
      ptr(base, key),
      `timeline color "${key}" must be a hex string`,
    );
  }
  return { r: 1, g: 1, b: 1, a: 1 };
}

function convertIkTimelines(
  value: unknown,
  base: string,
  diag: Diagnostics,
  duration: Duration,
): Record<string, Array<Keyframe<IkFrame>>> {
  const out: Record<string, Array<Keyframe<IkFrame>>> = {};
  if (value === undefined) return out;
  const rec = asRecord(value, base, diag);
  if (rec === undefined) return out;

  for (const [name, raw] of Object.entries(rec)) {
    const path = ptr(base, name);
    const array = asArray(raw, path, diag);
    if (array === undefined) continue;
    const frames: Array<Keyframe<IkFrame>> = [];
    for (const [index, frameRaw] of array.entries()) {
      const framePath = ptr(path, index);
      const frameRec = asRecord(frameRaw, framePath, diag);
      if (frameRec === undefined) continue;
      const time = readNumber(frameRec, 'time', framePath, diag, 0);
      duration.note(time);
      const bendPositive =
        frameRec['bendPositive'] === undefined ? true : frameRec['bendPositive'] === true;
      const softness = readOptionalNumber(frameRec, 'softness', framePath, diag);
      const frame: IkFrame = {
        mix: readNumber(frameRec, 'mix', framePath, diag, 1),
        bend: bendPositive ? 1 : -1,
        ...(softness === undefined ? {} : { softness }),
        ...(frameRec['stretch'] === undefined ? {} : { stretch: frameRec['stretch'] === true }),
        ...(frameRec['compress'] === undefined ? {} : { compress: frameRec['compress'] === true }),
      };
      frames.push({ time, value: frame, curve: parseCurve(frameRec, framePath, diag) });
    }
    out[name] = frames;
  }
  return out;
}

function convertTransformTimelines(
  value: unknown,
  base: string,
  diag: Diagnostics,
  duration: Duration,
): Record<string, Array<Keyframe<TransformFrame>>> {
  const out: Record<string, Array<Keyframe<TransformFrame>>> = {};
  if (value === undefined) return out;
  const rec = asRecord(value, base, diag);
  if (rec === undefined) return out;

  for (const [name, raw] of Object.entries(rec)) {
    const path = ptr(base, name);
    const array = asArray(raw, path, diag);
    if (array === undefined) continue;
    const frames: Array<Keyframe<TransformFrame>> = [];
    for (const [index, frameRaw] of array.entries()) {
      const framePath = ptr(path, index);
      const frameRec = asRecord(frameRaw, framePath, diag);
      if (frameRec === undefined) continue;
      const time = readNumber(frameRec, 'time', framePath, diag, 0);
      duration.note(time);
      const translateMix = readOptionalNumber(frameRec, 'translateMix', framePath, diag);
      const scaleMix = readOptionalNumber(frameRec, 'scaleMix', framePath, diag);
      const rotateMix = readOptionalNumber(frameRec, 'rotateMix', framePath, diag);
      const shearMix = readOptionalNumber(frameRec, 'shearMix', framePath, diag);
      const frame: TransformFrame = {
        ...(rotateMix === undefined ? {} : { mixRotate: rotateMix }),
        ...(translateMix === undefined ? {} : { mixX: translateMix, mixY: translateMix }),
        ...(scaleMix === undefined ? {} : { mixScaleX: scaleMix, mixScaleY: scaleMix }),
        ...(shearMix === undefined ? {} : { mixShearY: shearMix }),
      };
      frames.push({ time, value: frame, curve: parseCurve(frameRec, framePath, diag) });
    }
    out[name] = frames;
  }
  return out;
}

function convertPathTimelines(
  value: unknown,
  base: string,
  diag: Diagnostics,
  duration: Duration,
): Record<string, Array<Keyframe<PathFrame>>> {
  const out: Record<string, Array<Keyframe<PathFrame>>> = {};
  if (value === undefined) return out;
  const rec = asRecord(value, base, diag);
  if (rec === undefined) return out;

  for (const [name, raw] of Object.entries(rec)) {
    const path = ptr(base, name);
    const array = asArray(raw, path, diag);
    if (array === undefined) continue;
    const frames: Array<Keyframe<PathFrame>> = [];
    for (const [index, frameRaw] of array.entries()) {
      const framePath = ptr(path, index);
      const frameRec = asRecord(frameRaw, framePath, diag);
      if (frameRec === undefined) continue;
      const time = readNumber(frameRec, 'time', framePath, diag, 0);
      duration.note(time);
      const position = readOptionalNumber(frameRec, 'position', framePath, diag);
      const spacing = readOptionalNumber(frameRec, 'spacing', framePath, diag);
      const rotateMix = readOptionalNumber(frameRec, 'rotateMix', framePath, diag);
      const translateMix = readOptionalNumber(frameRec, 'translateMix', framePath, diag);
      const frame: PathFrame = {
        ...(position === undefined ? {} : { position }),
        ...(spacing === undefined ? {} : { spacing }),
        ...(rotateMix === undefined ? {} : { mixRotate: rotateMix }),
        ...(translateMix === undefined ? {} : { mixX: translateMix, mixY: translateMix }),
      };
      frames.push({ time, value: frame, curve: parseCurve(frameRec, framePath, diag) });
    }
    out[name] = frames;
  }
  return out;
}

// Deform: Spine stores per-key a starting `offset` (floats to skip) and a `vertices` delta list; our
// format stores the FULL flat offsets array of length 2 * V (V = target mesh logical-vertex count), with
// the deltas placed at `offset` and every other position zero. V is resolved from the converted skins
// (walking a linked mesh to its parent). When V cannot be resolved the raw deltas are emitted and the
// format deform validator (DEFORM_*) fails the import loudly rather than the importer guessing a length.
function convertDeform(
  value: unknown,
  base: string,
  diag: Diagnostics,
  duration: Duration,
  ctx: AnimationContext,
): DeformTimelines {
  const out: DeformTimelines = {};
  if (value === undefined) return out;
  const rec = asRecord(value, base, diag);
  if (rec === undefined) return out;

  for (const [skinName, skinRaw] of Object.entries(rec)) {
    const skinPath = ptr(base, skinName);
    const skinRec = asRecord(skinRaw, skinPath, diag);
    if (skinRec === undefined) continue;
    const bySlot: Record<string, Record<string, Array<Keyframe<{ offsets: number[] }>>>> = {};

    for (const [slotName, slotRaw] of Object.entries(skinRec)) {
      const slotPath = ptr(skinPath, slotName);
      const slotRec = asRecord(slotRaw, slotPath, diag);
      if (slotRec === undefined) continue;
      const byAttachment: Record<string, Array<Keyframe<{ offsets: number[] }>>> = {};

      for (const [attachmentName, framesRaw] of Object.entries(slotRec)) {
        const attachmentPath = ptr(slotPath, attachmentName);
        const vertexCount = resolveVertexCount(
          ctx.skinsByName,
          skinName,
          slotName,
          attachmentName,
          new Set(),
        );
        byAttachment[attachmentName] = convertDeformFrames(
          framesRaw,
          attachmentPath,
          diag,
          duration,
          vertexCount,
        );
      }
      bySlot[slotName] = byAttachment;
    }
    out[skinName] = bySlot;
  }
  return out;
}

function convertDeformFrames(
  value: unknown,
  base: string,
  diag: Diagnostics,
  duration: Duration,
  vertexCount: number | null,
): Array<Keyframe<{ offsets: number[] }>> {
  const array = asArray(value, base, diag);
  if (array === undefined) return [];
  const out: Array<Keyframe<{ offsets: number[] }>> = [];
  for (const [index, raw] of array.entries()) {
    const path = ptr(base, index);
    const rec = asRecord(raw, path, diag);
    if (rec === undefined) continue;
    const time = readNumber(rec, 'time', path, diag, 0);
    duration.note(time);
    const offset = readNumber(rec, 'offset', path, diag, 0);
    const deltas = readVertexDeltas(rec, path, diag);
    const offsets = vertexCount === null ? deltas : placeDeltas(deltas, offset, vertexCount * 2);
    out.push({ time, value: { offsets }, curve: parseCurve(rec, path, diag) });
  }
  return out;
}

function readVertexDeltas(rec: JsonRecord, base: string, diag: Diagnostics): number[] {
  const value = rec['vertices'];
  if (value === undefined) return [];
  const array = asArray(value, ptr(base, 'vertices'), diag);
  if (array === undefined) return [];
  const out: number[] = [];
  for (const [index, element] of array.entries()) {
    if (typeof element === 'number' && Number.isFinite(element)) out.push(element);
    else diag.error('SPINE_SCHEMA', ptr(ptr(base, 'vertices'), index), 'expected a finite number');
  }
  return out;
}

// Build the full flat offsets array: `length` zeros with `deltas` written starting at `offset`.
function placeDeltas(deltas: readonly number[], offset: number, length: number): number[] {
  const offsets = new Array<number>(Math.max(length, 0)).fill(0);
  for (let i = 0; i < deltas.length; i += 1) {
    const target = offset + i;
    if (target >= 0 && target < offsets.length) offsets[target] = deltas[i]!;
  }
  return offsets;
}

// Resolve a deform target's logical-vertex count (uvs.length / 2) from the converted skins, walking a
// linked mesh to its source mesh. Returns null when the target is missing or not a geometry attachment;
// `visited` guards a linked-mesh cycle. The default skin is the linked-mesh fallback source skin.
function resolveVertexCount(
  skinsByName: ReadonlyMap<string, Skin>,
  skinName: string,
  slotName: string,
  attachmentName: string,
  visited: Set<string>,
): number | null {
  const key = `${skinName} ${slotName} ${attachmentName}`;
  if (visited.has(key)) return null;
  visited.add(key);

  const attachment = skinsByName.get(skinName)?.attachments[slotName]?.[attachmentName];
  if (attachment === undefined) return null;
  if (attachment.type === 'mesh') return attachment.uvs.length / 2;
  if (attachment.type === 'linkedmesh') {
    return resolveVertexCount(
      skinsByName,
      attachment.skin ?? 'default',
      slotName,
      attachment.parent,
      visited,
    );
  }
  return null;
}

function convertEventTimeline(
  value: unknown,
  base: string,
  diag: Diagnostics,
  duration: Duration,
): EventKeyframe[] {
  const array = value === undefined ? undefined : asArray(value, base, diag);
  if (array === undefined) return [];
  const out: EventKeyframe[] = [];
  for (const [index, raw] of array.entries()) {
    const path = ptr(base, index);
    const rec = asRecord(raw, path, diag);
    if (rec === undefined) continue;
    const name = readOptionalString(rec, 'name', path, diag);
    if (name === undefined) {
      diag.error('SPINE_SCHEMA', ptr(path, 'name'), 'event timeline key requires a name');
      continue;
    }
    const time = readNumber(rec, 'time', path, diag, 0);
    duration.note(time);
    if (rec['volume'] !== undefined || rec['balance'] !== undefined) {
      diag.warn(
        'event-audio-override',
        path,
        'per-key event audio volume/balance overrides are not representable and are dropped',
      );
    }
    const int = readOptionalNumber(rec, 'int', path, diag);
    const float = readOptionalNumber(rec, 'float', path, diag);
    const string = readOptionalString(rec, 'string', path, diag);
    out.push({
      time,
      name,
      ...(int === undefined ? {} : { int }),
      ...(float === undefined ? {} : { float }),
      ...(string === undefined ? {} : { string }),
    });
  }
  return out;
}

function warnDrawOrder(value: unknown, base: string, diag: Diagnostics): void {
  if (Array.isArray(value) && value.length > 0) {
    diag.warn(
      'draw-order-timeline',
      base,
      'draw-order timelines are not converted (the offset-shift permutation is not specified in the published documentation)',
      { keys: value.length },
    );
  }
}

function warnPhysicsTimeline(value: unknown, base: string, diag: Diagnostics): void {
  if (value !== undefined) {
    diag.warn('physics-timeline', base, 'physics timelines are not converted');
  }
}
