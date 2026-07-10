import { isSupportedVersion } from '../version';
import { SkelReader, SpineBinaryError, type StringTable } from './reader';

// Decode a Spine .skel byte buffer into the SAME plain-JS intermediate value the JSON importer's
// conversion core (src/convert/*) consumes, so binary and JSON converge to identical documents for
// equivalent content (PP-A5 slice 2). Every field order and encoding here is derived EXCLUSIVELY from the
// PUBLISHED Spine binary format reference (esotericsoftware.com/spine-binary-format); no Spine runtime or
// editor source was consulted (LAW 4 + PP-A5 clean-room guardrail). The binary format is index-based
// (bones/slots/constraints/skins/events are referenced by ordinal); this decoder resolves those indices
// back to the NAMES the name-based intermediate uses, using the ordered name lists it accumulates.
//
// A structural fault (truncation, out-of-range reference, unknown enum constant, absurd count) throws a
// typed SpineBinaryError; an unsupported or missing version throws with the version error code. The
// decoder never returns a partially-decoded value and never guesses past an undecodable point.

// Enum tables (published constants reference). An out-of-range constant is a hard fault, never a guess.
const TRANSFORM_MODES = [
  'normal',
  'onlyTranslation',
  'noRotationOrReflection',
  'noScale',
  'noScaleOrReflection',
] as const;
const BLEND_MODES = ['normal', 'additive', 'multiply', 'screen'] as const;
const ATTACHMENT_TYPES = [
  'region',
  'boundingbox',
  'mesh',
  'linkedmesh',
  'path',
  'point',
  'clipping',
] as const;
const POSITION_MODES = ['fixed', 'percent'] as const;
const SPACING_MODES = ['length', 'fixed', 'percent'] as const;
const ROTATE_MODES = ['tangent', 'chain', 'chainScale'] as const;
const SLOT_TIMELINE_TYPES = ['attachment', 'color', 'twoColor'] as const;
const BONE_TIMELINE_TYPES = ['rotate', 'translate', 'scale', 'shear'] as const;
const PATH_TIMELINE_TYPES = ['position', 'spacing', 'mix'] as const;

const CURVE_LINEAR = 0;
const CURVE_STEPPED = 1;
const CURVE_BEZIER = 2;

type JsonRecord = Record<string, unknown>;
type CurveFields = { curve?: string | number; c2?: number; c3?: number; c4?: number };

function enumName<T extends string>(
  table: readonly T[],
  index: number,
  path: string,
  what: string,
): T {
  const value = table[index];
  if (value === undefined) {
    throw new SpineBinaryError('SPINE_BINARY_INVALID', path, `unknown ${what} constant ${index}`, {
      value: index,
    });
  }
  return value;
}

// The ordered name lists resolved while decoding, so later index-based references (constraint targets,
// timeline owners, deform skins/slots, event keys) map back to names for the name-based intermediate.
interface DecodeContext {
  readonly table: StringTable;
  readonly nonessential: boolean;
  readonly boneNames: string[];
  readonly slotNames: string[];
  readonly ikNames: string[];
  readonly transformNames: string[];
  readonly pathNames: string[];
  readonly skinNames: string[];
  readonly eventNames: string[];
}

export function decodeSkel(bytes: Uint8Array): unknown {
  const reader = new SkelReader(bytes);

  // Metadata block. `hash` is informational (the intermediate stamps its own content hash); the AABB
  // bounds (x, y, width, height) have no counterpart in our format and are read only to advance the
  // cursor. The version gate matches the JSON path: an absent/empty version is missing, a non-4.x is
  // unsupported; both stop before any layout-dependent read.
  reader.string('/hash', 'hash');
  const version = reader.string('/skeleton/spine', 'version');
  if (version === null || version.length === 0) {
    throw new SpineBinaryError(
      'SPINE_VERSION_MISSING',
      '/skeleton/spine',
      'the .skel header carries no version string',
    );
  }
  if (!isSupportedVersion(version)) {
    throw new SpineBinaryError(
      'SPINE_VERSION_UNSUPPORTED',
      '/skeleton/spine',
      `Spine version "${version}" is not supported; the importer accepts the documented 4.x binary shape`,
      { version },
    );
  }

  reader.float('/skeleton', 'x');
  reader.float('/skeleton', 'y');
  reader.float('/skeleton', 'width');
  reader.float('/skeleton', 'height');
  const nonessential = reader.bool('/skeleton', 'nonessential flag');

  const skeleton: JsonRecord = { spine: version };
  if (nonessential) {
    skeleton['fps'] = reader.float('/skeleton/fps', 'fps');
    const images = reader.string('/skeleton/images', 'images path');
    if (images !== null && images.length > 0) skeleton['images'] = images;
    const audio = reader.string('/skeleton/audio', 'audio path');
    if (audio !== null && audio.length > 0) skeleton['audio'] = audio;
  }

  const table = readStringTable(reader);
  const ctx: DecodeContext = {
    table,
    nonessential,
    boneNames: [],
    slotNames: [],
    ikNames: [],
    transformNames: [],
    pathNames: [],
    skinNames: [],
    eventNames: [],
  };

  const bones = readBones(reader, ctx);
  const slots = readSlots(reader, ctx);
  const ik = readIkConstraints(reader, ctx);
  const transform = readTransformConstraints(reader, ctx);
  const path = readPathConstraints(reader, ctx);
  const skins = readSkins(reader, ctx);
  const events = readEvents(reader, ctx);
  const animations = readAnimations(reader, ctx);

  return { skeleton, bones, slots, ik, transform, path, skins, events, animations };
}

function readStringTable(reader: SkelReader): StringTable {
  const count = reader.count('/strings', 'shared string count');
  const table: (string | null)[] = [];
  for (let i = 0; i < count; i += 1) {
    table.push(reader.string(`/strings/${i}`, 'shared string'));
  }
  return table;
}

function requiredName(value: string | null, path: string, what: string): string {
  if (value === null) {
    throw new SpineBinaryError('SPINE_BINARY_INVALID', path, `missing required ${what}`);
  }
  return value;
}

function boneName(ctx: DecodeContext, index: number, path: string): string {
  const name = ctx.boneNames[index];
  if (name === undefined) {
    throw new SpineBinaryError(
      'SPINE_BINARY_INVALID',
      path,
      `bone index ${index} is out of range`,
      {
        index,
      },
    );
  }
  return name;
}

function slotName(ctx: DecodeContext, index: number, path: string): string {
  const name = ctx.slotNames[index];
  if (name === undefined) {
    throw new SpineBinaryError(
      'SPINE_BINARY_INVALID',
      path,
      `slot index ${index} is out of range`,
      {
        index,
      },
    );
  }
  return name;
}

function readBones(reader: SkelReader, ctx: DecodeContext): JsonRecord[] {
  const count = reader.count('/bones', 'bone count');
  const bones: JsonRecord[] = [];
  for (let i = 0; i < count; i += 1) {
    const base = `/bones/${i}`;
    const name = requiredName(reader.string(base, 'bone name'), base, 'bone name');
    // The root bone (index 0) has no parent; every other bone stores a parent bone index.
    const bone: JsonRecord = { name };
    if (i > 0) {
      const parentIndex = reader.count(base, 'parent index');
      bone['parent'] = boneName(ctx, parentIndex, base);
    }
    bone['rotation'] = reader.float(base, 'rotation');
    bone['x'] = reader.float(base, 'x');
    bone['y'] = reader.float(base, 'y');
    bone['scaleX'] = reader.float(base, 'scaleX');
    bone['scaleY'] = reader.float(base, 'scaleY');
    bone['shearX'] = reader.float(base, 'shearX');
    bone['shearY'] = reader.float(base, 'shearY');
    bone['length'] = reader.float(base, 'length');
    bone['transform'] = enumName(
      TRANSFORM_MODES,
      reader.byte(base, 'transform mode'),
      base,
      'transform mode',
    );
    reader.bool(base, 'skin required'); // scoping lives on the skin's bone list; not carried onto the bone
    if (ctx.nonessential) reader.int32(base, 'bone color');
    ctx.boneNames.push(name);
    bones.push(bone);
  }
  return bones;
}

function readSlots(reader: SkelReader, ctx: DecodeContext): JsonRecord[] {
  const count = reader.count('/slots', 'slot count');
  const slots: JsonRecord[] = [];
  for (let i = 0; i < count; i += 1) {
    const base = `/slots/${i}`;
    const name = requiredName(reader.string(base, 'slot name'), base, 'slot name');
    const bone = boneName(ctx, reader.count(base, 'slot bone index'), base);
    const slot: JsonRecord = { name, bone, color: reader.colorRgba(base, 'slot color') };
    const dark = reader.colorDark(base, 'slot dark color');
    if (dark !== null) slot['dark'] = dark;
    const attachment = reader.stringRef(ctx.table, base, 'slot attachment');
    if (attachment !== null) slot['attachment'] = attachment;
    slot['blend'] = enumName(BLEND_MODES, reader.byte(base, 'blend mode'), base, 'blend mode');
    ctx.slotNames.push(name);
    slots.push(slot);
  }
  return slots;
}

function readBoneIndexList(reader: SkelReader, ctx: DecodeContext, base: string): string[] {
  const count = reader.count(base, 'constraint bone count');
  const names: string[] = [];
  for (let i = 0; i < count; i += 1) {
    names.push(boneName(ctx, reader.count(base, 'constraint bone index'), base));
  }
  return names;
}

function readIkConstraints(reader: SkelReader, ctx: DecodeContext): JsonRecord[] {
  const count = reader.count('/ik', 'ik constraint count');
  const out: JsonRecord[] = [];
  for (let i = 0; i < count; i += 1) {
    const base = `/ik/${i}`;
    const name = requiredName(reader.string(base, 'ik name'), base, 'ik constraint name');
    const order = reader.count(base, 'order index');
    reader.bool(base, 'skin required');
    const bones = readBoneIndexList(reader, ctx, base);
    const target = boneName(ctx, reader.count(base, 'ik target index'), base);
    const mix = reader.float(base, 'mix');
    const softness = reader.float(base, 'softness');
    const bendPositive = reader.sbyte(base, 'bend direction') > 0;
    const compress = reader.bool(base, 'compress');
    const stretch = reader.bool(base, 'stretch');
    const uniform = reader.bool(base, 'uniform');
    ctx.ikNames.push(name);
    out.push({
      name,
      order,
      bones,
      target,
      mix,
      softness,
      bendPositive,
      compress,
      stretch,
      uniform,
    });
  }
  return out;
}

function readTransformConstraints(reader: SkelReader, ctx: DecodeContext): JsonRecord[] {
  const count = reader.count('/transform', 'transform constraint count');
  const out: JsonRecord[] = [];
  for (let i = 0; i < count; i += 1) {
    const base = `/transform/${i}`;
    const name = requiredName(
      reader.string(base, 'transform name'),
      base,
      'transform constraint name',
    );
    const order = reader.count(base, 'order index');
    reader.bool(base, 'skin required');
    // The published transform-constraint entry stores a single bone index; the name-based intermediate
    // carries a bones LIST (our format allows several), so the single bone becomes a one-element list.
    const bones = [boneName(ctx, reader.count(base, 'transform bone index'), base)];
    const target = boneName(ctx, reader.count(base, 'transform target index'), base);
    const local = reader.bool(base, 'local');
    const relative = reader.bool(base, 'relative');
    const rotation = reader.float(base, 'offset rotation');
    const x = reader.float(base, 'offset x');
    const y = reader.float(base, 'offset y');
    const scaleX = reader.float(base, 'offset scaleX');
    const scaleY = reader.float(base, 'offset scaleY');
    const shearY = reader.float(base, 'offset shearY');
    const rotateMix = reader.float(base, 'rotate mix');
    const translateMix = reader.float(base, 'translate mix');
    const scaleMix = reader.float(base, 'scale mix');
    const shearMix = reader.float(base, 'shear mix');
    ctx.transformNames.push(name);
    out.push({
      name,
      order,
      bones,
      target,
      local,
      relative,
      rotation,
      x,
      y,
      scaleX,
      scaleY,
      shearY,
      rotateMix,
      translateMix,
      scaleMix,
      shearMix,
    });
  }
  return out;
}

function readPathConstraints(reader: SkelReader, ctx: DecodeContext): JsonRecord[] {
  const count = reader.count('/path', 'path constraint count');
  const out: JsonRecord[] = [];
  for (let i = 0; i < count; i += 1) {
    const base = `/path/${i}`;
    const name = requiredName(reader.string(base, 'path name'), base, 'path constraint name');
    const order = reader.count(base, 'order index');
    reader.bool(base, 'skin required');
    const bones = readBoneIndexList(reader, ctx, base);
    // A path constraint targets a SLOT (whose attachment is the path).
    const target = slotName(ctx, reader.count(base, 'path target slot index'), base);
    const positionMode = enumName(
      POSITION_MODES,
      reader.byte(base, 'position mode'),
      base,
      'position mode',
    );
    const spacingMode = enumName(
      SPACING_MODES,
      reader.byte(base, 'spacing mode'),
      base,
      'spacing mode',
    );
    const rotateMode = enumName(
      ROTATE_MODES,
      reader.byte(base, 'rotate mode'),
      base,
      'rotate mode',
    );
    const rotation = reader.float(base, 'offset rotation');
    const position = reader.float(base, 'position');
    const spacing = reader.float(base, 'spacing');
    const rotateMix = reader.float(base, 'rotate mix');
    const translateMix = reader.float(base, 'translate mix');
    ctx.pathNames.push(name);
    out.push({
      name,
      order,
      bones,
      target,
      positionMode,
      spacingMode,
      rotateMode,
      rotation,
      position,
      spacing,
      rotateMix,
      translateMix,
    });
  }
  return out;
}

// A weighted vertex stream is emitted in the SAME self-delimiting layout the JSON path and our format
// share: [boneCount, (boneIndex, bindX, bindY, weight) * boneCount, ...]. An unweighted stream is a flat
// [x, y, ...] of 2 * vertexCount floats. `vertexCount` is the logical-vertex count already read (uv count
// for meshes, explicit vertex count for polygons/paths).
function readVertices(reader: SkelReader, vertexCount: number, base: string): number[] {
  const weighted = reader.bool(base, 'vertices weighted flag');
  const out: number[] = [];
  if (!weighted) {
    for (let i = 0; i < vertexCount * 2; i += 1) out.push(reader.float(base, 'vertex position'));
    return out;
  }
  for (let v = 0; v < vertexCount; v += 1) {
    const boneCount = reader.count(base, 'vertex bone count');
    out.push(boneCount);
    for (let b = 0; b < boneCount; b += 1) {
      out.push(reader.count(base, 'vertex bone index'));
      out.push(reader.float(base, 'vertex bind x'));
      out.push(reader.float(base, 'vertex bind y'));
      out.push(reader.float(base, 'vertex weight'));
    }
  }
  return out;
}

function readSkins(reader: SkelReader, ctx: DecodeContext): JsonRecord[] {
  const skins: JsonRecord[] = [];
  // The default skin is stored first with only its attachments (no name, no scoping lists). It is always
  // present in the intermediate under the reserved name "default"; slot indices resolve to slot names.
  const defaultAttachments = readSkinAttachments(reader, ctx, '/skins/default');
  ctx.skinNames.push('default');
  skins.push({ name: 'default', attachments: defaultAttachments });

  const count = reader.count('/skins', 'skin count');
  for (let i = 0; i < count; i += 1) {
    const base = `/skins/${i}`;
    const name = requiredName(reader.stringRef(ctx.table, base, 'skin name'), base, 'skin name');
    const bones = readBoneIndexList(reader, ctx, base);
    const ik = readNameIndexList(reader, ctx.ikNames, base, 'skin ik index');
    const transform = readNameIndexList(reader, ctx.transformNames, base, 'skin transform index');
    const path = readNameIndexList(reader, ctx.pathNames, base, 'skin path index');
    const attachments = readSkinAttachments(reader, ctx, base);
    ctx.skinNames.push(name);
    const skin: JsonRecord = { name, attachments };
    if (bones.length > 0) skin['bones'] = bones;
    if (ik.length > 0) skin['ik'] = ik;
    if (transform.length > 0) skin['transform'] = transform;
    if (path.length > 0) skin['path'] = path;
    skins.push(skin);
  }
  return skins;
}

function readNameIndexList(
  reader: SkelReader,
  names: readonly string[],
  base: string,
  what: string,
): string[] {
  const count = reader.count(base, `${what} count`);
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const index = reader.count(base, what);
    const name = names[index];
    if (name === undefined) {
      throw new SpineBinaryError('SPINE_BINARY_INVALID', base, `${what} ${index} is out of range`, {
        index,
      });
    }
    out.push(name);
  }
  return out;
}

function readSkinAttachments(
  reader: SkelReader,
  ctx: DecodeContext,
  base: string,
): Record<string, Record<string, JsonRecord>> {
  const attachments: Record<string, Record<string, JsonRecord>> = {};
  const slotCount = reader.count(base, 'skin slot count');
  for (let s = 0; s < slotCount; s += 1) {
    const slot = slotName(ctx, reader.count(base, 'skin slot index'), base);
    const slotPath = `${base}/${slot}`;
    const attachmentCount = reader.count(slotPath, 'attachment count');
    const bySlot: Record<string, JsonRecord> = {};
    for (let a = 0; a < attachmentCount; a += 1) {
      const placeholder = requiredName(
        reader.stringRef(ctx.table, slotPath, 'attachment placeholder'),
        slotPath,
        'attachment placeholder name',
      );
      const attachment = readAttachment(reader, ctx, placeholder, `${slotPath}/${placeholder}`);
      bySlot[placeholder] = attachment;
    }
    attachments[slot] = bySlot;
  }
  return attachments;
}

function readAttachment(
  reader: SkelReader,
  ctx: DecodeContext,
  placeholder: string,
  base: string,
): JsonRecord {
  // The attachment's own name (null => reuse the placeholder). It seeds the texture-path fallback so the
  // resolution precedence (explicit path > attachment name > placeholder) matches the JSON path.
  const attachmentName = reader.stringRef(ctx.table, base, 'attachment name');
  const type = enumName(
    ATTACHMENT_TYPES,
    reader.byte(base, 'attachment type'),
    base,
    'attachment type',
  );
  const nameFallback =
    attachmentName !== null && attachmentName !== placeholder ? attachmentName : undefined;

  switch (type) {
    case 'region': {
      const path = resolvePath(reader.stringRef(ctx.table, base, 'region path'), nameFallback);
      const rec: JsonRecord = { type };
      if (path !== undefined) rec['path'] = path;
      rec['rotation'] = reader.float(base, 'rotation');
      rec['x'] = reader.float(base, 'x');
      rec['y'] = reader.float(base, 'y');
      rec['scaleX'] = reader.float(base, 'scaleX');
      rec['scaleY'] = reader.float(base, 'scaleY');
      rec['width'] = reader.float(base, 'width');
      rec['height'] = reader.float(base, 'height');
      rec['color'] = reader.colorRgba(base, 'color');
      return rec;
    }
    case 'boundingbox': {
      const vertexCount = reader.count(base, 'vertex count');
      const vertices = readVertices(reader, vertexCount, base);
      if (ctx.nonessential) reader.int32(base, 'color');
      return { type, vertexCount, vertices };
    }
    case 'mesh': {
      const path = resolvePath(reader.stringRef(ctx.table, base, 'mesh path'), nameFallback);
      const color = reader.colorRgba(base, 'color');
      const uvCount = reader.count(base, 'uv count');
      const uvs: number[] = [];
      for (let i = 0; i < uvCount * 2; i += 1) uvs.push(reader.float(base, 'uv'));
      const triangleCount = reader.count(base, 'triangle count');
      const triangles: number[] = [];
      for (let i = 0; i < triangleCount; i += 1)
        triangles.push(reader.short(base, 'triangle index'));
      const vertices = readVertices(reader, uvCount, base);
      const hull = reader.count(base, 'hull count');
      const rec: JsonRecord = { type, color, uvs, triangles, hull, vertices };
      if (path !== undefined) rec['path'] = path;
      const edgeCount = reader.count(base, 'edge count');
      const edges: number[] = [];
      for (let i = 0; i < edgeCount; i += 1) edges.push(reader.short(base, 'edge index'));
      if (ctx.nonessential) {
        rec['edges'] = edges;
        rec['width'] = reader.float(base, 'width');
        rec['height'] = reader.float(base, 'height');
      }
      return rec;
    }
    case 'linkedmesh': {
      const path = resolvePath(reader.stringRef(ctx.table, base, 'linked mesh path'), nameFallback);
      const color = reader.colorRgba(base, 'color');
      const skin = reader.stringRef(ctx.table, base, 'linked mesh skin');
      const parent = requiredName(
        reader.stringRef(ctx.table, base, 'linked mesh parent'),
        base,
        'linked mesh parent',
      );
      const deform = reader.bool(base, 'deform');
      const rec: JsonRecord = { type, color, parent, deform };
      if (path !== undefined) rec['path'] = path;
      if (skin !== null) rec['skin'] = skin;
      if (ctx.nonessential) {
        rec['width'] = reader.float(base, 'width');
        rec['height'] = reader.float(base, 'height');
      }
      return rec;
    }
    case 'path': {
      const closed = reader.bool(base, 'closed');
      const constantSpeed = reader.bool(base, 'constant speed');
      const vertexCount = reader.count(base, 'vertex count');
      const vertices = readVertices(reader, vertexCount, base);
      const lengths: number[] = [];
      for (let i = 0; i < Math.floor(vertexCount / 3); i += 1) {
        lengths.push(reader.float(base, 'path length'));
      }
      if (ctx.nonessential) reader.int32(base, 'color');
      return { type, closed, constantSpeed, vertexCount, vertices, lengths };
    }
    case 'point': {
      const rotation = reader.float(base, 'rotation');
      const x = reader.float(base, 'x');
      const y = reader.float(base, 'y');
      if (ctx.nonessential) reader.int32(base, 'color');
      return { type, x, y, rotation };
    }
    case 'clipping': {
      const endIndex = reader.int32(base, 'clipping end slot index');
      const end = slotName(ctx, endIndex, base);
      const vertexCount = reader.count(base, 'vertex count');
      const vertices = readVertices(reader, vertexCount, base);
      if (ctx.nonessential) reader.int32(base, 'color');
      return { type, end, vertexCount, vertices };
    }
    default:
      // enumName already rejects unknown constants; this is unreachable but keeps the switch exhaustive.
      throw new SpineBinaryError(
        'SPINE_BINARY_INVALID',
        base,
        `unhandled attachment type "${type}"`,
      );
  }
}

function resolvePath(
  pathField: string | null,
  nameFallback: string | undefined,
): string | undefined {
  if (pathField !== null) return pathField;
  return nameFallback;
}

function readEvents(reader: SkelReader, ctx: DecodeContext): JsonRecord {
  const count = reader.count('/events', 'event count');
  const events: JsonRecord = {};
  for (let i = 0; i < count; i += 1) {
    const base = `/events/${i}`;
    const name = requiredName(reader.stringRef(ctx.table, base, 'event name'), base, 'event name');
    const intValue = reader.varint(base, false, 'event int');
    const floatValue = reader.float(base, 'event float');
    const stringValue = reader.string(base, 'event string');
    const audioPath = reader.string(base, 'event audio path');
    const volume = reader.float(base, 'event volume');
    const balance = reader.float(base, 'event balance');
    const rec: JsonRecord = {};
    if (intValue !== 0) rec['int'] = intValue;
    if (floatValue !== 0) rec['float'] = floatValue;
    if (stringValue !== null && stringValue.length > 0) rec['string'] = stringValue;
    if (audioPath !== null && audioPath.length > 0) {
      rec['audio'] = audioPath;
      rec['volume'] = volume;
      rec['balance'] = balance;
    }
    ctx.eventNames.push(name);
    events[name] = rec;
  }
  return events;
}

// A keyframe curve: type byte, then (for bezier) four control floats. Emitted as the JSON flat curve
// form (a `curve` number plus c2/c3/c4) the shared parseCurve consumes. The outgoing curve is omitted on
// the last keyframe of a timeline (a documented deform rule generalized to every continuous timeline: the
// final key has no outgoing segment); such a key defaults to linear, which the converter attaches anyway.
function readCurve(reader: SkelReader, base: string): CurveFields {
  const type = reader.byte(base, 'curve type');
  if (type === CURVE_LINEAR) return {};
  if (type === CURVE_STEPPED) return { curve: 'stepped' };
  if (type === CURVE_BEZIER) {
    return {
      curve: reader.float(base, 'bezier c1'),
      c2: reader.float(base, 'bezier c2'),
      c3: reader.float(base, 'bezier c3'),
      c4: reader.float(base, 'bezier c4'),
    };
  }
  throw new SpineBinaryError('SPINE_BINARY_INVALID', base, `unknown curve type ${type}`, {
    value: type,
  });
}

// Read a continuous timeline's frames: per frame a time, a caller-supplied typed value, and an outgoing
// curve for every frame except the last.
function readCurvedFrames(
  reader: SkelReader,
  base: string,
  frameCount: number,
  readValue: (frameBase: string) => JsonRecord,
): JsonRecord[] {
  const frames: JsonRecord[] = [];
  for (let i = 0; i < frameCount; i += 1) {
    const frameBase = `${base}/${i}`;
    const time = reader.float(frameBase, 'time');
    const value = readValue(frameBase);
    const curve = i < frameCount - 1 ? readCurve(reader, frameBase) : {};
    frames.push({ time, ...value, ...curve });
  }
  return frames;
}

function readAnimations(reader: SkelReader, ctx: DecodeContext): JsonRecord {
  const count = reader.count('/animations', 'animation count');
  const animations: JsonRecord = {};
  for (let i = 0; i < count; i += 1) {
    const name = requiredName(
      reader.stringRef(ctx.table, '/animations', 'animation name'),
      '/animations',
      'animation name',
    );
    animations[name] = readAnimation(reader, ctx, `/animations/${name}`);
  }
  return animations;
}

function readAnimation(reader: SkelReader, ctx: DecodeContext, base: string): JsonRecord {
  const slots = readSlotTimelines(reader, ctx, `${base}/slots`);
  const bones = readBoneTimelines(reader, ctx, `${base}/bones`);
  const ik = readIkTimelines(reader, ctx, `${base}/ik`);
  const transform = readTransformTimelines(reader, ctx, `${base}/transform`);
  const path = readPathTimelines(reader, ctx, `${base}/path`);
  const deform = readDeformTimelines(reader, ctx, `${base}/deform`);
  const draworder = readDrawOrderTimeline(reader, ctx, `${base}/draworder`);
  const events = readEventTimeline(reader, ctx, `${base}/events`);
  return { slots, bones, ik, transform, path, deform, draworder, events };
}

function readSlotTimelines(reader: SkelReader, ctx: DecodeContext, base: string): JsonRecord {
  const slotCount = reader.count(base, 'slot timeline count');
  const out: JsonRecord = {};
  for (let s = 0; s < slotCount; s += 1) {
    const slot = slotName(ctx, reader.count(base, 'slot index'), base);
    const slotPath = `${base}/${slot}`;
    const timelineCount = reader.count(slotPath, 'timeline count');
    const timelines: JsonRecord = {};
    for (let t = 0; t < timelineCount; t += 1) {
      const type = enumName(
        SLOT_TIMELINE_TYPES,
        reader.byte(slotPath, 'slot timeline type'),
        slotPath,
        'slot timeline type',
      );
      const frameCount = reader.count(slotPath, 'frame count');
      const timelinePath = `${slotPath}/${type}`;
      if (type === 'attachment') {
        const frames: JsonRecord[] = [];
        for (let f = 0; f < frameCount; f += 1) {
          const frameBase = `${timelinePath}/${f}`;
          const time = reader.float(frameBase, 'time');
          const attachmentName = reader.stringRef(ctx.table, frameBase, 'attachment name');
          frames.push({ time, name: attachmentName });
        }
        timelines['attachment'] = frames;
      } else if (type === 'color') {
        timelines['color'] = readCurvedFrames(reader, timelinePath, frameCount, (fb) => ({
          color: reader.colorRgba(fb, 'slot color'),
        }));
      } else {
        timelines['twoColor'] = readCurvedFrames(reader, timelinePath, frameCount, (fb) => ({
          light: reader.colorRgba(fb, 'light color'),
          dark: requireDark(reader.colorDark(fb, 'dark color')),
        }));
      }
    }
    out[slot] = timelines;
  }
  return out;
}

// A two-color timeline's dark channel is always present (it is the whole point of the timeline); a -1
// sentinel there is malformed, surfaced rather than silently treated as absent.
function requireDark(dark: string | null): string {
  if (dark === null) {
    throw new SpineBinaryError(
      'SPINE_BINARY_INVALID',
      '/animations',
      'two-color timeline frame is missing its dark color',
    );
  }
  return dark;
}

function readBoneTimelines(reader: SkelReader, ctx: DecodeContext, base: string): JsonRecord {
  const boneCount = reader.count(base, 'bone timeline count');
  const out: JsonRecord = {};
  for (let b = 0; b < boneCount; b += 1) {
    const bone = boneName(ctx, reader.count(base, 'bone index'), base);
    const bonePath = `${base}/${bone}`;
    const timelineCount = reader.count(bonePath, 'timeline count');
    const timelines: JsonRecord = {};
    for (let t = 0; t < timelineCount; t += 1) {
      const type = enumName(
        BONE_TIMELINE_TYPES,
        reader.byte(bonePath, 'bone timeline type'),
        bonePath,
        'bone timeline type',
      );
      const frameCount = reader.count(bonePath, 'frame count');
      const timelinePath = `${bonePath}/${type}`;
      if (type === 'rotate') {
        timelines['rotate'] = readCurvedFrames(reader, timelinePath, frameCount, (fb) => ({
          angle: reader.float(fb, 'angle'),
        }));
      } else {
        timelines[type] = readCurvedFrames(reader, timelinePath, frameCount, (fb) => ({
          x: reader.float(fb, 'x'),
          y: reader.float(fb, 'y'),
        }));
      }
    }
    out[bone] = timelines;
  }
  return out;
}

function readIkTimelines(reader: SkelReader, ctx: DecodeContext, base: string): JsonRecord {
  const count = reader.count(base, 'ik timeline count');
  const out: JsonRecord = {};
  for (let i = 0; i < count; i += 1) {
    const index = reader.count(base, 'ik index');
    const name = ctx.ikNames[index];
    if (name === undefined) {
      throw new SpineBinaryError(
        'SPINE_BINARY_INVALID',
        base,
        `ik timeline index ${index} is out of range`,
        { index },
      );
    }
    const frameCount = reader.count(base, 'frame count');
    out[name] = readCurvedFrames(reader, `${base}/${name}`, frameCount, (fb) => ({
      mix: reader.float(fb, 'mix'),
      bendPositive: reader.sbyte(fb, 'bend direction') > 0,
    }));
  }
  return out;
}

function readTransformTimelines(reader: SkelReader, ctx: DecodeContext, base: string): JsonRecord {
  const count = reader.count(base, 'transform timeline count');
  const out: JsonRecord = {};
  for (let i = 0; i < count; i += 1) {
    const index = reader.count(base, 'transform index');
    const name = ctx.transformNames[index];
    if (name === undefined) {
      throw new SpineBinaryError(
        'SPINE_BINARY_INVALID',
        base,
        `transform timeline index ${index} is out of range`,
        { index },
      );
    }
    const frameCount = reader.count(base, 'frame count');
    out[name] = readCurvedFrames(reader, `${base}/${name}`, frameCount, (fb) => ({
      rotateMix: reader.float(fb, 'rotate mix'),
      translateMix: reader.float(fb, 'translate mix'),
      scaleMix: reader.float(fb, 'scale mix'),
      shearMix: reader.float(fb, 'shear mix'),
    }));
  }
  return out;
}

// Path constraint animations: the binary keeps a SEPARATE position, spacing, and mix timeline per
// constraint; the name-based intermediate keeps ONE flat frame list per constraint (each frame carrying
// whichever channels are keyed at that time). The three timelines are merged by time and re-sorted, so a
// JSON author's single per-constraint frame list and the binary's split timelines converge. When two
// sub-timelines share a time, the later one's curve wins (a rare, documented lossy edge).
function readPathTimelines(reader: SkelReader, ctx: DecodeContext, base: string): JsonRecord {
  const count = reader.count(base, 'path timeline entry count');
  const out: JsonRecord = {};
  for (let i = 0; i < count; i += 1) {
    const index = reader.count(base, 'path constraint index');
    const name = ctx.pathNames[index];
    if (name === undefined) {
      throw new SpineBinaryError(
        'SPINE_BINARY_INVALID',
        base,
        `path timeline index ${index} is out of range`,
        { index },
      );
    }
    const timelineCount = reader.count(base, 'path timeline count');
    const byTime = new Map<number, JsonRecord>();
    for (let t = 0; t < timelineCount; t += 1) {
      const type = enumName(
        PATH_TIMELINE_TYPES,
        reader.byte(base, 'path timeline type'),
        base,
        'path timeline type',
      );
      const frameCount = reader.count(base, 'frame count');
      for (let f = 0; f < frameCount; f += 1) {
        const frameBase = `${base}/${name}/${type}/${f}`;
        const time = reader.float(frameBase, 'time');
        const frame = byTime.get(time) ?? { time };
        // The position and spacing timelines carry one value; the mix timeline carries rotate AND
        // translate mix (two floats), matching our format's independent path mix channels.
        if (type === 'position') frame['position'] = reader.float(frameBase, 'position');
        else if (type === 'spacing') frame['spacing'] = reader.float(frameBase, 'spacing');
        else {
          frame['rotateMix'] = reader.float(frameBase, 'rotate mix');
          frame['translateMix'] = reader.float(frameBase, 'translate mix');
        }
        const curve = f < frameCount - 1 ? readCurve(reader, frameBase) : {};
        Object.assign(frame, curve);
        byTime.set(time, frame);
      }
    }
    out[name] = [...byTime.values()].sort((a, b) => (a['time'] as number) - (b['time'] as number));
  }
  return out;
}

function readDeformTimelines(reader: SkelReader, ctx: DecodeContext, base: string): JsonRecord {
  const skinCount = reader.count(base, 'deform skin count');
  const out: JsonRecord = {};
  for (let s = 0; s < skinCount; s += 1) {
    const skinIndex = reader.count(base, 'deform skin index');
    const skin = ctx.skinNames[skinIndex];
    if (skin === undefined) {
      throw new SpineBinaryError(
        'SPINE_BINARY_INVALID',
        base,
        `deform skin index ${skinIndex} is out of range`,
        { index: skinIndex },
      );
    }
    const skinPath = `${base}/${skin}`;
    const slotCount = reader.count(skinPath, 'deform slot count');
    const bySlot: JsonRecord = {};
    for (let sl = 0; sl < slotCount; sl += 1) {
      const slot = slotName(ctx, reader.count(skinPath, 'deform slot index'), skinPath);
      const slotPath = `${skinPath}/${slot}`;
      const timelineCount = reader.count(slotPath, 'deform timeline count');
      const byAttachment: JsonRecord = {};
      for (let t = 0; t < timelineCount; t += 1) {
        const attachment = requiredName(
          reader.stringRef(ctx.table, slotPath, 'deform attachment name'),
          slotPath,
          'deform attachment name',
        );
        const frameCount = reader.count(slotPath, 'frame count');
        byAttachment[attachment] = readDeformFrames(
          reader,
          `${slotPath}/${attachment}`,
          frameCount,
        );
      }
      bySlot[slot] = byAttachment;
    }
    out[skin] = bySlot;
  }
  return out;
}

function readDeformFrames(reader: SkelReader, base: string, frameCount: number): JsonRecord[] {
  const frames: JsonRecord[] = [];
  for (let f = 0; f < frameCount; f += 1) {
    const frameBase = `${base}/${f}`;
    const time = reader.float(frameBase, 'time');
    const end = reader.count(frameBase, 'deform end vertex');
    let offset = 0;
    const vertices: number[] = [];
    if (end !== 0) {
      offset = reader.count(frameBase, 'deform start vertex');
      for (let v = offset; v < end; v += 1) vertices.push(reader.float(frameBase, 'deform value'));
    }
    const curve = f < frameCount - 1 ? readCurve(reader, frameBase) : {};
    frames.push({ time, offset, vertices, ...curve });
  }
  return frames;
}

// The draw-order timeline is not re-encoded into our offset model (the offset-shift permutation is not in
// the published documentation, surfaced as a warning by the converter). It is decoded only to advance the
// cursor and to report the keyframe count so the converter's warn fires; a placeholder array of that
// length carries the count.
function readDrawOrderTimeline(reader: SkelReader, ctx: DecodeContext, base: string): unknown[] {
  const frameCount = reader.count(base, 'draw order frame count');
  const placeholder: unknown[] = [];
  for (let f = 0; f < frameCount; f += 1) {
    reader.float(base, 'time');
    const changeCount = reader.count(base, 'draw order change count');
    for (let c = 0; c < changeCount; c += 1) {
      slotName(ctx, reader.count(base, 'draw order slot index'), base);
      reader.count(base, 'draw order amount');
    }
    placeholder.push({});
  }
  return placeholder;
}

function readEventTimeline(reader: SkelReader, ctx: DecodeContext, base: string): JsonRecord[] {
  const frameCount = reader.count(base, 'event frame count');
  const frames: JsonRecord[] = [];
  for (let f = 0; f < frameCount; f += 1) {
    const frameBase = `${base}/${f}`;
    const time = reader.float(frameBase, 'time');
    const eventIndex = reader.count(frameBase, 'event index');
    const name = ctx.eventNames[eventIndex];
    if (name === undefined) {
      throw new SpineBinaryError(
        'SPINE_BINARY_INVALID',
        frameBase,
        `event index ${eventIndex} is out of range`,
        { index: eventIndex },
      );
    }
    const intValue = reader.varint(frameBase, false, 'event int');
    const floatValue = reader.float(frameBase, 'event float');
    const hasString = reader.bool(frameBase, 'has string');
    const stringValue = hasString ? reader.string(frameBase, 'event string') : null;
    const volume = reader.float(frameBase, 'event volume');
    const balance = reader.float(frameBase, 'event balance');
    const rec: JsonRecord = { time, name };
    if (intValue !== 0) rec['int'] = intValue;
    if (floatValue !== 0) rec['float'] = floatValue;
    if (stringValue !== null && stringValue.length > 0) rec['string'] = stringValue;
    // A per-key audio override (non-default volume/balance) is surfaced by the converter as unsupported;
    // default values are omitted so a plain event key produces no spurious warning.
    if (volume !== 1) rec['volume'] = volume;
    if (balance !== 0) rec['balance'] = balance;
    frames.push(rec);
  }
  return frames;
}
