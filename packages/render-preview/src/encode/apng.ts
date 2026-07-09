// A first-principles APNG (Animated PNG) encoder. Unlike GIF it is LOSSLESS truecolor with full 8-bit
// alpha: it assembles the animation from the per-frame PNG output of the existing pngjs encoder (so image
// data reuses the pinned, reproducible PNG codec) and wraps it in the APNG control chunks (acTL / fcTL /
// fdAT) with correct sequence numbers and CRCs. Deterministic: no clock, no randomness; the only variation
// is the caller's clip, so the byte-golden gate holds exactly like the still-frame PNG goldens.
//
// Chunk layout: PNG signature, IHDR (from the first frame), acTL (frame count + loop count), then frame 0
// as fcTL(seq 0) + IDAT (frame 0 is the default image AND the first animation frame), then each subsequent
// frame as fcTL + fdAT, and finally IEND. fcTL/fdAT share one increasing sequence counter across the file.

import type { RenderedSequence } from '../render-sequence';
import { ByteWriter, PNG_SIGNATURE, finalizeCrc, readPngChunks, updateCrc } from './bytes';

export interface ApngEncodeOptions {
  // Number of times the animation plays. 0 (default) loops forever.
  readonly loopCount?: number;
}

// APNG dispose/blend ops: each frame is full-size and fully replaces the buffer (blend SOURCE keeps the
// frame's alpha verbatim, so transparency is exact), and disposes to nothing for the next full frame.
const DISPOSE_OP_NONE = 0;
const BLEND_OP_SOURCE = 0;

export function encodeApng(
  sequence: RenderedSequence,
  options: ApngEncodeOptions = {},
): Uint8Array {
  const loopCount = options.loopCount ?? 0;
  const fps = sequence.fps;
  const frameCount = sequence.frameCount;

  const writer = new ByteWriter(8192);
  writer.bytes(PNG_SIGNATURE);

  let seq = 0;
  let wrote = 0;
  let width = 0;
  let height = 0;

  for (const frame of sequence.frames()) {
    const chunks = readPngChunks(frame.png());
    if (wrote === 0) {
      width = chunks.width;
      height = chunks.height;
      writeChunk(writer, 'IHDR', chunks.ihdr);
      writeChunk(writer, 'acTL', acTlData(frameCount, loopCount));
      seq = writeFcTl(writer, seq, width, height, fps);
      writeChunk(writer, 'IDAT', chunks.idat);
    } else {
      if (chunks.width !== width || chunks.height !== height) {
        throw new Error('encodeApng: frame dimensions changed mid-clip');
      }
      seq = writeFcTl(writer, seq, width, height, fps);
      seq = writeFdAt(writer, seq, chunks.idat);
    }
    wrote += 1;
  }

  writeChunk(writer, 'IEND', new Uint8Array(0));
  return writer.toUint8Array();
}

function acTlData(frameCount: number, loopCount: number): Uint8Array {
  const data = new Uint8Array(8);
  writeU32(data, 0, frameCount);
  writeU32(data, 4, loopCount);
  return data;
}

// Write an fcTL chunk (full-frame, delay = 1/fps seconds) and return the next sequence number.
function writeFcTl(
  writer: ByteWriter,
  seq: number,
  width: number,
  height: number,
  fps: number,
): number {
  const data = new Uint8Array(26);
  writeU32(data, 0, seq);
  writeU32(data, 4, width);
  writeU32(data, 8, height);
  writeU32(data, 12, 0); // x offset
  writeU32(data, 16, 0); // y offset
  writeU16(data, 20, 1); // delay numerator
  writeU16(data, 22, fps); // delay denominator => 1/fps seconds
  data[24] = DISPOSE_OP_NONE;
  data[25] = BLEND_OP_SOURCE;
  writeChunk(writer, 'fcTL', data);
  return seq + 1;
}

// Write an fdAT chunk (sequence number + the frame's IDAT payload) and return the next sequence number.
function writeFdAt(writer: ByteWriter, seq: number, idat: Uint8Array): number {
  const data = new Uint8Array(4 + idat.length);
  writeU32(data, 0, seq);
  data.set(idat, 4);
  writeChunk(writer, 'fdAT', data);
  return seq + 1;
}

// Write one PNG chunk: length, type, data, and the CRC over (type + data).
function writeChunk(writer: ByteWriter, type: string, data: Uint8Array): void {
  const typeBytes = asciiBytes(type);
  writer.u32be(data.length);
  writer.bytes(typeBytes);
  writer.bytes(data);
  let crc = updateCrc(0xffffffff, typeBytes);
  crc = updateCrc(crc, data);
  writer.u32be(finalizeCrc(crc));
}

function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function writeU32(buffer: Uint8Array, offset: number, value: number): void {
  buffer[offset] = (value >>> 24) & 0xff;
  buffer[offset + 1] = (value >>> 16) & 0xff;
  buffer[offset + 2] = (value >>> 8) & 0xff;
  buffer[offset + 3] = value & 0xff;
}

function writeU16(buffer: Uint8Array, offset: number, value: number): void {
  buffer[offset] = (value >>> 8) & 0xff;
  buffer[offset + 1] = value & 0xff;
}
