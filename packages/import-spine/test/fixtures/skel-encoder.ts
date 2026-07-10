// A hand-written Spine .skel BYTE encoder for tests (PP-A5 slice 2). It writes bytes per the PUBLISHED
// Spine binary format reference (esotericsoftware.com/spine-binary-format), mirroring exactly what
// src/binary/reader.ts + decode-skel.ts read, so tests can build .skel buffers BY HAND from the published
// spec rather than downloading or exporting any real Spine file (clean-room legal posture, LAW 4 / PP-A5).
// It is a test helper only: the shipped package never writes any Spine format (import only).

// ---- Logical model (an ergonomic description the encoder serializes) -------------------------------

export interface SkelBone {
  name: string;
  parent?: string; // omitted for the root bone (index 0)
  rotation?: number;
  x?: number;
  y?: number;
  scaleX?: number;
  scaleY?: number;
  shearX?: number;
  shearY?: number;
  length?: number;
  transform?: number; // TRANSFORM_* constant, default 0 (normal)
}

export interface SkelSlot {
  name: string;
  bone: string;
  color?: string; // 8-digit RRGGBBAA, default 'ffffffff'
  dark?: string; // 6-digit RRGGBB, absent => no dark tint
  attachment?: string;
  blend?: number; // BLEND_* constant, default 0 (normal)
}

export interface SkelIk {
  name: string;
  order?: number;
  bones: string[];
  target: string;
  mix?: number;
  softness?: number;
  bendPositive?: boolean;
  compress?: boolean;
  stretch?: boolean;
  uniform?: boolean;
}

export interface SkelTransform {
  name: string;
  order?: number;
  bone: string; // the published entry stores a single bone
  target: string;
  local?: boolean;
  relative?: boolean;
  rotation?: number;
  x?: number;
  y?: number;
  scaleX?: number;
  scaleY?: number;
  shearY?: number;
  rotateMix?: number;
  translateMix?: number;
  scaleMix?: number;
  shearMix?: number;
}

export interface SkelPath {
  name: string;
  order?: number;
  bones: string[];
  target: string; // a slot name
  positionMode?: number;
  spacingMode?: number;
  rotateMode?: number;
  rotation?: number;
  position?: number;
  spacing?: number;
  rotateMix?: number;
  translateMix?: number;
}

export type SkelAttachment =
  | {
      placeholder: string;
      name?: string;
      type: 'region';
      path?: string;
      rotation?: number;
      x?: number;
      y?: number;
      scaleX?: number;
      scaleY?: number;
      width?: number;
      height?: number;
      color?: string;
    }
  | {
      placeholder: string;
      name?: string;
      type: 'mesh';
      path?: string;
      color?: string;
      uvs: number[];
      triangles: number[];
      vertices: number[];
      hull?: number;
      edges?: number[];
      width?: number;
      height?: number;
    }
  | {
      placeholder: string;
      name?: string;
      type: 'linkedmesh';
      path?: string;
      color?: string;
      skin?: string;
      parent: string;
      deform?: boolean;
      width?: number;
      height?: number;
    }
  | {
      placeholder: string;
      name?: string;
      type: 'boundingbox';
      vertexCount: number;
      vertices: number[];
    }
  | {
      placeholder: string;
      name?: string;
      type: 'path';
      closed?: boolean;
      constantSpeed?: boolean;
      vertexCount: number;
      vertices: number[];
      lengths: number[];
    }
  | { placeholder: string; name?: string; type: 'point'; rotation?: number; x?: number; y?: number }
  | {
      placeholder: string;
      name?: string;
      type: 'clipping';
      end: string; // end slot name
      vertexCount: number;
      vertices: number[];
    };

export interface SkelSkinSlot {
  slot: string;
  attachments: SkelAttachment[];
}

export interface SkelSkin {
  name: string; // 'default' for the default skin
  bones?: string[];
  ik?: string[];
  transform?: string[];
  path?: string[];
  slots: SkelSkinSlot[];
}

export interface SkelEvent {
  name: string;
  int?: number;
  float?: number;
  string?: string;
  audio?: string;
  volume?: number;
  balance?: number;
}

export type SkelCurve = 'linear' | 'stepped' | { bezier: [number, number, number, number] };

export interface SkelSlotTimelines {
  slot: string;
  attachment?: Array<{ time: number; name: string | null }>;
  color?: Array<{ time: number; color: string; curve?: SkelCurve }>;
  twoColor?: Array<{ time: number; light: string; dark: string; curve?: SkelCurve }>;
}

export interface SkelBoneTimelines {
  bone: string;
  rotate?: Array<{ time: number; angle: number; curve?: SkelCurve }>;
  translate?: Array<{ time: number; x: number; y: number; curve?: SkelCurve }>;
  scale?: Array<{ time: number; x: number; y: number; curve?: SkelCurve }>;
  shear?: Array<{ time: number; x: number; y: number; curve?: SkelCurve }>;
}

export interface SkelIkTimeline {
  ik: string;
  frames: Array<{ time: number; mix: number; bendPositive: boolean; curve?: SkelCurve }>;
}

export interface SkelTransformTimeline {
  transform: string;
  frames: Array<{
    time: number;
    rotateMix: number;
    translateMix: number;
    scaleMix: number;
    shearMix: number;
    curve?: SkelCurve;
  }>;
}

export interface SkelPathTimeline {
  path: string;
  position?: Array<{ time: number; value: number; curve?: SkelCurve }>;
  spacing?: Array<{ time: number; value: number; curve?: SkelCurve }>;
  mix?: Array<{ time: number; rotateMix: number; translateMix: number; curve?: SkelCurve }>;
}

export interface SkelDeformTimeline {
  skin: string;
  slot: string;
  attachment: string;
  frames: Array<{ time: number; offset: number; vertices: number[]; curve?: SkelCurve }>;
}

export interface SkelDrawOrderKey {
  time: number;
  changes: Array<{ slot: string; amount: number }>;
}

export interface SkelEventKey {
  time: number;
  event: string;
  int?: number;
  float?: number;
  string?: string;
  volume?: number;
  balance?: number;
}

export interface SkelAnimation {
  name: string;
  slots?: SkelSlotTimelines[];
  bones?: SkelBoneTimelines[];
  ik?: SkelIkTimeline[];
  transform?: SkelTransformTimeline[];
  path?: SkelPathTimeline[];
  deform?: SkelDeformTimeline[];
  draworder?: SkelDrawOrderKey[];
  events?: SkelEventKey[];
}

export interface SkelModel {
  version: string;
  nonessential?: boolean;
  fps?: number;
  images?: string;
  audio?: string;
  bones: SkelBone[];
  slots?: SkelSlot[];
  ik?: SkelIk[];
  transform?: SkelTransform[];
  path?: SkelPath[];
  skins?: SkelSkin[];
  events?: SkelEvent[];
  animations?: SkelAnimation[];
}

// ---- Byte writer -----------------------------------------------------------------------------------

const TRANSFORM_TYPES = {
  region: 0,
  boundingbox: 1,
  mesh: 2,
  linkedmesh: 3,
  path: 4,
  point: 5,
  clipping: 6,
};
const SLOT_TL = { attachment: 0, color: 1, twoColor: 2 };
const BONE_TL = { rotate: 0, translate: 1, scale: 2, shear: 3 };
const PATH_TL = { position: 0, spacing: 1, mix: 2 };

export class SkelWriter {
  private readonly out: number[] = [];
  private readonly encoder = new TextEncoder();
  private readonly f32 = new DataView(new ArrayBuffer(4));

  byte(v: number): void {
    this.out.push(v & 0xff);
  }
  bool(v: boolean): void {
    this.byte(v ? 1 : 0);
  }
  sbyte(v: number): void {
    this.byte(v < 0 ? v + 0x100 : v);
  }
  short(v: number): void {
    this.byte((v >>> 8) & 0xff);
    this.byte(v & 0xff);
  }
  int32(v: number): void {
    this.byte((v >>> 24) & 0xff);
    this.byte((v >>> 16) & 0xff);
    this.byte((v >>> 8) & 0xff);
    this.byte(v & 0xff);
  }
  float(v: number): void {
    this.f32.setFloat32(0, v, false);
    this.byte(this.f32.getUint8(0));
    this.byte(this.f32.getUint8(1));
    this.byte(this.f32.getUint8(2));
    this.byte(this.f32.getUint8(3));
  }
  varint(value: number, optimizePositive: boolean): void {
    let v = optimizePositive ? value >>> 0 : ((value << 1) ^ (value >> 31)) >>> 0;
    for (;;) {
      const b = v & 0x7f;
      v >>>= 7;
      if (v === 0) {
        this.byte(b);
        return;
      }
      this.byte(b | 0x80);
    }
  }
  string(value: string | null): void {
    if (value === null) {
      this.varint(0, true);
      return;
    }
    if (value.length === 0) {
      this.varint(1, true);
      return;
    }
    const bytes = this.encoder.encode(value);
    this.varint(bytes.length + 1, true);
    for (const b of bytes) this.byte(b);
  }
  colorRgba(hex8: string): void {
    this.int32(parseInt(hex8, 16) | 0);
  }
  colorDark(hex6: string | null): void {
    if (hex6 === null) {
      this.int32(-1);
      return;
    }
    this.int32((parseInt(hex6, 16) << 8) | 0);
  }
  raw(bytes: number[]): void {
    for (const b of bytes) this.out.push(b & 0xff);
  }
  toBytes(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}

// The shared string table is written between the metadata and the sections. Section-body ref-strings are
// collected here so the encoder can assemble [meta][table][body] with indices that match the reader.
class RefTable {
  private readonly list: string[] = [];
  private readonly index = new Map<string, number>();

  ref(value: string | null): number {
    if (value === null) return 0;
    const existing = this.index.get(value);
    if (existing !== undefined) return existing;
    this.list.push(value);
    const id = this.list.length; // 1-based
    this.index.set(value, id);
    return id;
  }

  writeTable(writer: SkelWriter): void {
    writer.varint(this.list.length, true);
    for (const s of this.list) writer.string(s);
  }
}

// ---- Section encoders ------------------------------------------------------------------------------

export function encodeSkel(model: SkelModel): Uint8Array {
  const table = new RefTable();
  const boneIndex = indexMap(model.bones.map((b) => b.name));
  const slotIndex = indexMap((model.slots ?? []).map((s) => s.name));
  const ikIndex = indexMap((model.ik ?? []).map((c) => c.name));
  const transformIndex = indexMap((model.transform ?? []).map((c) => c.name));
  const pathIndex = indexMap((model.path ?? []).map((c) => c.name));
  const eventIndex = indexMap((model.events ?? []).map((e) => e.name));
  const skins = model.skins ?? [{ name: 'default', slots: [] }];
  const skinIndex = indexMap(skins.map((s) => s.name));
  const nonessential = model.nonessential ?? false;

  // Body is written first (so the ref table is complete), then metadata + table are prepended.
  const body = new SkelWriter();
  encodeBones(body, model.bones, boneIndex, nonessential);
  encodeSlots(body, model.slots ?? [], boneIndex, table);
  encodeIk(body, model.ik ?? [], boneIndex);
  encodeTransform(body, model.transform ?? [], boneIndex);
  encodePath(body, model.path ?? [], boneIndex, slotIndex);
  encodeSkins(
    body,
    skins,
    { boneIndex, slotIndex, ikIndex, transformIndex, pathIndex },
    table,
    nonessential,
  );
  encodeEvents(body, model.events ?? [], table);
  encodeAnimations(
    body,
    model.animations ?? [],
    { boneIndex, slotIndex, ikIndex, transformIndex, pathIndex, skinIndex, eventIndex },
    table,
  );

  const meta = new SkelWriter();
  meta.string('hash-' + model.version);
  meta.string(model.version);
  meta.float(0); // x
  meta.float(0); // y
  meta.float(0); // width
  meta.float(0); // height
  meta.bool(nonessential);
  if (nonessential) {
    meta.float(model.fps ?? 30);
    meta.string(model.images ?? '');
    meta.string(model.audio ?? '');
  }
  table.writeTable(meta);

  const out = new SkelWriter();
  out.raw([...meta.toBytes(), ...body.toBytes()]);
  return out.toBytes();
}

type IndexMap = ReadonlyMap<string, number>;

function indexMap(names: readonly string[]): IndexMap {
  return new Map(names.map((n, i) => [n, i]));
}

function need(map: IndexMap, name: string, what: string): number {
  const value = map.get(name);
  if (value === undefined) throw new Error(`encodeSkel: unknown ${what} "${name}"`);
  return value;
}

function encodeBones(
  w: SkelWriter,
  bones: readonly SkelBone[],
  boneIndex: IndexMap,
  nonessential: boolean,
): void {
  w.varint(bones.length, true);
  bones.forEach((bone, i) => {
    w.string(bone.name);
    if (i > 0) w.varint(need(boneIndex, bone.parent ?? '', 'parent bone'), true);
    w.float(bone.rotation ?? 0);
    w.float(bone.x ?? 0);
    w.float(bone.y ?? 0);
    w.float(bone.scaleX ?? 1);
    w.float(bone.scaleY ?? 1);
    w.float(bone.shearX ?? 0);
    w.float(bone.shearY ?? 0);
    w.float(bone.length ?? 0);
    w.byte(bone.transform ?? 0);
    w.bool(false); // skin required
    if (nonessential) w.int32(0); // bone color
  });
}

function encodeSlots(
  w: SkelWriter,
  slots: readonly SkelSlot[],
  boneIndex: IndexMap,
  table: RefTable,
): void {
  w.varint(slots.length, true);
  for (const slot of slots) {
    w.string(slot.name);
    w.varint(need(boneIndex, slot.bone, 'slot bone'), true);
    w.colorRgba(slot.color ?? 'ffffffff');
    w.colorDark(slot.dark ?? null);
    w.varint(table.ref(slot.attachment ?? null), true);
    w.byte(slot.blend ?? 0);
  }
}

function encodeBoneList(w: SkelWriter, names: readonly string[], boneIndex: IndexMap): void {
  w.varint(names.length, true);
  for (const name of names) w.varint(need(boneIndex, name, 'constraint bone'), true);
}

function encodeIk(w: SkelWriter, ik: readonly SkelIk[], boneIndex: IndexMap): void {
  w.varint(ik.length, true);
  for (const c of ik) {
    w.string(c.name);
    w.varint(c.order ?? 0, true);
    w.bool(false);
    encodeBoneList(w, c.bones, boneIndex);
    w.varint(need(boneIndex, c.target, 'ik target'), true);
    w.float(c.mix ?? 1);
    w.float(c.softness ?? 0);
    w.sbyte((c.bendPositive ?? true) ? 1 : -1);
    w.bool(c.compress ?? false);
    w.bool(c.stretch ?? false);
    w.bool(c.uniform ?? false);
  }
}

function encodeTransform(
  w: SkelWriter,
  transform: readonly SkelTransform[],
  boneIndex: IndexMap,
): void {
  w.varint(transform.length, true);
  for (const c of transform) {
    w.string(c.name);
    w.varint(c.order ?? 0, true);
    w.bool(false);
    w.varint(need(boneIndex, c.bone, 'transform bone'), true);
    w.varint(need(boneIndex, c.target, 'transform target'), true);
    w.bool(c.local ?? false);
    w.bool(c.relative ?? false);
    w.float(c.rotation ?? 0);
    w.float(c.x ?? 0);
    w.float(c.y ?? 0);
    w.float(c.scaleX ?? 0);
    w.float(c.scaleY ?? 0);
    w.float(c.shearY ?? 0);
    w.float(c.rotateMix ?? 1);
    w.float(c.translateMix ?? 1);
    w.float(c.scaleMix ?? 1);
    w.float(c.shearMix ?? 1);
  }
}

function encodePath(
  w: SkelWriter,
  path: readonly SkelPath[],
  boneIndex: IndexMap,
  slotIndex: IndexMap,
): void {
  w.varint(path.length, true);
  for (const c of path) {
    w.string(c.name);
    w.varint(c.order ?? 0, true);
    w.bool(false);
    encodeBoneList(w, c.bones, boneIndex);
    w.varint(need(slotIndex, c.target, 'path target slot'), true);
    w.byte(c.positionMode ?? 1);
    w.byte(c.spacingMode ?? 0);
    w.byte(c.rotateMode ?? 0);
    w.float(c.rotation ?? 0);
    w.float(c.position ?? 0);
    w.float(c.spacing ?? 0);
    w.float(c.rotateMix ?? 1);
    w.float(c.translateMix ?? 1);
  }
}

interface Indexes {
  boneIndex: IndexMap;
  slotIndex: IndexMap;
  ikIndex: IndexMap;
  transformIndex: IndexMap;
  pathIndex: IndexMap;
}

function encodeSkins(
  w: SkelWriter,
  skins: readonly SkelSkin[],
  idx: Indexes,
  table: RefTable,
  nonessential: boolean,
): void {
  const first = skins[0];
  if (first === undefined || first.name !== 'default') {
    throw new Error('encodeSkel: the first skin must be the default skin');
  }
  encodeSkinAttachments(w, first.slots, idx.slotIndex, idx.boneIndex, table, nonessential);
  const rest = skins.slice(1);
  w.varint(rest.length, true);
  for (const skin of rest) {
    w.varint(table.ref(skin.name), true);
    encodeBoneList(w, skin.bones ?? [], idx.boneIndex);
    encodeNameList(w, skin.ik ?? [], idx.ikIndex, 'skin ik');
    encodeNameList(w, skin.transform ?? [], idx.transformIndex, 'skin transform');
    encodeNameList(w, skin.path ?? [], idx.pathIndex, 'skin path');
    encodeSkinAttachments(w, skin.slots, idx.slotIndex, idx.boneIndex, table, nonessential);
  }
}

function encodeNameList(
  w: SkelWriter,
  names: readonly string[],
  map: IndexMap,
  what: string,
): void {
  w.varint(names.length, true);
  for (const name of names) w.varint(need(map, name, what), true);
}

function encodeSkinAttachments(
  w: SkelWriter,
  slots: readonly SkelSkinSlot[],
  slotIndex: IndexMap,
  boneIndex: IndexMap,
  table: RefTable,
  nonessential: boolean,
): void {
  w.varint(slots.length, true);
  for (const slot of slots) {
    w.varint(need(slotIndex, slot.slot, 'skin slot'), true);
    w.varint(slot.attachments.length, true);
    for (const att of slot.attachments) {
      w.varint(table.ref(att.placeholder), true);
      encodeAttachment(w, att, slotIndex, table, nonessential);
    }
  }
}

function encodeVertices(w: SkelWriter, vertices: readonly number[], vertexCount: number): void {
  const weighted = vertices.length !== vertexCount * 2;
  w.bool(weighted);
  if (!weighted) {
    for (const v of vertices) w.float(v);
    return;
  }
  let cursor = 0;
  while (cursor < vertices.length) {
    const boneCount = vertices[cursor]!;
    w.varint(boneCount, true);
    cursor += 1;
    for (let b = 0; b < boneCount; b += 1) {
      w.varint(vertices[cursor]!, true);
      w.float(vertices[cursor + 1]!);
      w.float(vertices[cursor + 2]!);
      w.float(vertices[cursor + 3]!);
      cursor += 4;
    }
  }
}

function encodeAttachment(
  w: SkelWriter,
  att: SkelAttachment,
  slotIndex: IndexMap,
  table: RefTable,
  nonessential: boolean,
): void {
  w.varint(table.ref(att.name ?? null), true);
  w.byte(TRANSFORM_TYPES[att.type]);
  switch (att.type) {
    case 'region':
      w.varint(table.ref(att.path ?? null), true);
      w.float(att.rotation ?? 0);
      w.float(att.x ?? 0);
      w.float(att.y ?? 0);
      w.float(att.scaleX ?? 1);
      w.float(att.scaleY ?? 1);
      w.float(att.width ?? 0);
      w.float(att.height ?? 0);
      w.colorRgba(att.color ?? 'ffffffff');
      return;
    case 'boundingbox':
      w.varint(att.vertexCount, true);
      encodeVertices(w, att.vertices, att.vertexCount);
      if (nonessential) w.int32(0);
      return;
    case 'mesh': {
      w.varint(table.ref(att.path ?? null), true);
      w.colorRgba(att.color ?? 'ffffffff');
      const uvCount = att.uvs.length / 2;
      w.varint(uvCount, true);
      for (const v of att.uvs) w.float(v);
      w.varint(att.triangles.length, true);
      for (const t of att.triangles) w.short(t);
      encodeVertices(w, att.vertices, uvCount);
      w.varint(att.hull ?? 0, true);
      w.varint((att.edges ?? []).length, true);
      for (const e of att.edges ?? []) w.short(e);
      if (nonessential) {
        w.float(att.width ?? 0);
        w.float(att.height ?? 0);
      }
      return;
    }
    case 'linkedmesh':
      w.varint(table.ref(att.path ?? null), true);
      w.colorRgba(att.color ?? 'ffffffff');
      w.varint(table.ref(att.skin ?? null), true);
      w.varint(table.ref(att.parent), true);
      w.bool(att.deform ?? true);
      if (nonessential) {
        w.float(att.width ?? 0);
        w.float(att.height ?? 0);
      }
      return;
    case 'path':
      w.bool(att.closed ?? false);
      w.bool(att.constantSpeed ?? true);
      w.varint(att.vertexCount, true);
      encodeVertices(w, att.vertices, att.vertexCount);
      for (const l of att.lengths) w.float(l);
      if (nonessential) w.int32(0);
      return;
    case 'point':
      w.float(att.rotation ?? 0);
      w.float(att.x ?? 0);
      w.float(att.y ?? 0);
      if (nonessential) w.int32(0);
      return;
    case 'clipping':
      w.int32(need(slotIndex, att.end, 'clipping end slot'));
      w.varint(att.vertexCount, true);
      encodeVertices(w, att.vertices, att.vertexCount);
      if (nonessential) w.int32(0);
      return;
  }
}

function encodeEvents(w: SkelWriter, events: readonly SkelEvent[], table: RefTable): void {
  w.varint(events.length, true);
  for (const e of events) {
    w.varint(table.ref(e.name), true);
    w.varint(e.int ?? 0, false);
    w.float(e.float ?? 0);
    w.string(e.string ?? null);
    w.string(e.audio ?? null);
    w.float(e.volume ?? 1);
    w.float(e.balance ?? 0);
  }
}

interface AnimIndexes extends Indexes {
  skinIndex: IndexMap;
  eventIndex: IndexMap;
}

function encodeCurve(w: SkelWriter, curve: SkelCurve | undefined): void {
  if (curve === undefined || curve === 'linear') {
    w.byte(0);
    return;
  }
  if (curve === 'stepped') {
    w.byte(1);
    return;
  }
  w.byte(2);
  for (const c of curve.bezier) w.float(c);
}

// Write a continuous timeline's frames; the outgoing curve is written for every frame except the last.
function encodeCurvedFrames<T extends { time: number; curve?: SkelCurve }>(
  w: SkelWriter,
  frames: readonly T[],
  writeValue: (frame: T) => void,
): void {
  w.varint(frames.length, true);
  frames.forEach((frame, i) => {
    w.float(frame.time);
    writeValue(frame);
    if (i < frames.length - 1) encodeCurve(w, frame.curve);
  });
}

function encodeAnimations(
  w: SkelWriter,
  animations: readonly SkelAnimation[],
  idx: AnimIndexes,
  table: RefTable,
): void {
  w.varint(animations.length, true);
  for (const anim of animations) {
    w.varint(table.ref(anim.name), true);
    encodeSlotTimelines(w, anim.slots ?? [], idx.slotIndex, table);
    encodeBoneTimelines(w, anim.bones ?? [], idx.boneIndex);
    encodeIkTimelines(w, anim.ik ?? [], idx.ikIndex);
    encodeTransformTimelines(w, anim.transform ?? [], idx.transformIndex);
    encodePathTimelines(w, anim.path ?? [], idx.pathIndex);
    encodeDeform(w, anim.deform ?? [], idx.skinIndex, idx.slotIndex, table);
    encodeDrawOrder(w, anim.draworder ?? [], idx.slotIndex);
    encodeEventTimeline(w, anim.events ?? [], idx.eventIndex, table);
  }
}

function encodeSlotTimelines(
  w: SkelWriter,
  slots: readonly SkelSlotTimelines[],
  slotIndex: IndexMap,
  table: RefTable,
): void {
  w.varint(slots.length, true);
  for (const slot of slots) {
    w.varint(need(slotIndex, slot.slot, 'anim slot'), true);
    const timelines: Array<'attachment' | 'color' | 'twoColor'> = [];
    if (slot.attachment) timelines.push('attachment');
    if (slot.color) timelines.push('color');
    if (slot.twoColor) timelines.push('twoColor');
    w.varint(timelines.length, true);
    for (const type of timelines) {
      w.byte(SLOT_TL[type]);
      if (type === 'attachment') {
        const frames = slot.attachment!;
        w.varint(frames.length, true);
        for (const frame of frames) {
          w.float(frame.time);
          w.varint(table.ref(frame.name), true);
        }
      } else if (type === 'color') {
        encodeCurvedFrames(w, slot.color!, (frame) => w.colorRgba(frame.color));
      } else {
        encodeCurvedFrames(w, slot.twoColor!, (frame) => {
          w.colorRgba(frame.light);
          w.colorDark(frame.dark);
        });
      }
    }
  }
}

function encodeBoneTimelines(
  w: SkelWriter,
  bones: readonly SkelBoneTimelines[],
  boneIndex: IndexMap,
): void {
  w.varint(bones.length, true);
  for (const bone of bones) {
    w.varint(need(boneIndex, bone.bone, 'anim bone'), true);
    const types: Array<'rotate' | 'translate' | 'scale' | 'shear'> = [];
    if (bone.rotate) types.push('rotate');
    if (bone.translate) types.push('translate');
    if (bone.scale) types.push('scale');
    if (bone.shear) types.push('shear');
    w.varint(types.length, true);
    for (const type of types) {
      w.byte(BONE_TL[type]);
      if (type === 'rotate') {
        encodeCurvedFrames(w, bone.rotate!, (frame) => w.float(frame.angle));
      } else {
        encodeCurvedFrames(w, bone[type]!, (frame) => {
          w.float(frame.x);
          w.float(frame.y);
        });
      }
    }
  }
}

function encodeIkTimelines(w: SkelWriter, ik: readonly SkelIkTimeline[], ikIndex: IndexMap): void {
  w.varint(ik.length, true);
  for (const timeline of ik) {
    w.varint(need(ikIndex, timeline.ik, 'anim ik'), true);
    encodeCurvedFrames(w, timeline.frames, (frame) => {
      w.float(frame.mix);
      w.sbyte(frame.bendPositive ? 1 : -1);
    });
  }
}

function encodeTransformTimelines(
  w: SkelWriter,
  transform: readonly SkelTransformTimeline[],
  transformIndex: IndexMap,
): void {
  w.varint(transform.length, true);
  for (const timeline of transform) {
    w.varint(need(transformIndex, timeline.transform, 'anim transform'), true);
    encodeCurvedFrames(w, timeline.frames, (frame) => {
      w.float(frame.rotateMix);
      w.float(frame.translateMix);
      w.float(frame.scaleMix);
      w.float(frame.shearMix);
    });
  }
}

function encodePathTimelines(
  w: SkelWriter,
  path: readonly SkelPathTimeline[],
  pathIndex: IndexMap,
): void {
  w.varint(path.length, true);
  for (const entry of path) {
    w.varint(need(pathIndex, entry.path, 'anim path'), true);
    const types: Array<'position' | 'spacing' | 'mix'> = [];
    if (entry.position) types.push('position');
    if (entry.spacing) types.push('spacing');
    if (entry.mix) types.push('mix');
    w.varint(types.length, true);
    for (const type of types) {
      w.byte(PATH_TL[type]);
      if (type === 'mix') {
        encodeCurvedFrames(w, entry.mix!, (frame) => {
          w.float(frame.rotateMix);
          w.float(frame.translateMix);
        });
      } else {
        encodeCurvedFrames(w, entry[type]!, (frame) => w.float(frame.value));
      }
    }
  }
}

function encodeDeform(
  w: SkelWriter,
  deform: readonly SkelDeformTimeline[],
  skinIndex: IndexMap,
  slotIndex: IndexMap,
  table: RefTable,
): void {
  // Group by skin, then slot, matching the binary nesting.
  const bySkin = new Map<string, SkelDeformTimeline[]>();
  for (const d of deform) {
    const list = bySkin.get(d.skin) ?? [];
    list.push(d);
    bySkin.set(d.skin, list);
  }
  w.varint(bySkin.size, true);
  for (const [skin, entries] of bySkin) {
    w.varint(need(skinIndex, skin, 'deform skin'), true);
    const bySlot = new Map<string, SkelDeformTimeline[]>();
    for (const d of entries) {
      const list = bySlot.get(d.slot) ?? [];
      list.push(d);
      bySlot.set(d.slot, list);
    }
    w.varint(bySlot.size, true);
    for (const [slot, slotEntries] of bySlot) {
      w.varint(need(slotIndex, slot, 'deform slot'), true);
      w.varint(slotEntries.length, true);
      for (const d of slotEntries) {
        w.varint(table.ref(d.attachment), true);
        w.varint(d.frames.length, true);
        d.frames.forEach((frame, i) => {
          w.float(frame.time);
          if (frame.vertices.length === 0) {
            w.varint(0, true);
          } else {
            w.varint(frame.offset + frame.vertices.length, true);
            w.varint(frame.offset, true);
            for (const v of frame.vertices) w.float(v);
          }
          if (i < d.frames.length - 1) encodeCurve(w, frame.curve);
        });
      }
    }
  }
}

function encodeDrawOrder(
  w: SkelWriter,
  keys: readonly SkelDrawOrderKey[],
  slotIndex: IndexMap,
): void {
  w.varint(keys.length, true);
  for (const key of keys) {
    w.float(key.time);
    w.varint(key.changes.length, true);
    for (const change of key.changes) {
      w.varint(need(slotIndex, change.slot, 'draworder slot'), true);
      w.varint(change.amount, true);
    }
  }
}

function encodeEventTimeline(
  w: SkelWriter,
  events: readonly SkelEventKey[],
  eventIndex: IndexMap,
  table: RefTable,
): void {
  void table;
  w.varint(events.length, true);
  for (const key of events) {
    w.float(key.time);
    w.varint(need(eventIndex, key.event, 'anim event'), true);
    w.varint(key.int ?? 0, false);
    w.float(key.float ?? 0);
    const hasString = key.string !== undefined;
    w.bool(hasString);
    if (hasString) w.string(key.string!);
    w.float(key.volume ?? 1);
    w.float(key.balance ?? 0);
  }
}
