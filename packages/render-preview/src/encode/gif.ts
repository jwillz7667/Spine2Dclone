// A first-principles GIF89a animated encoder (pure TypeScript, no third-party codec). It consumes a
// RenderedSequence and emits a looping animated GIF: median-cut quantized palette (global by default, or a
// per-frame local table), LZW-compressed image data, a per-frame delay derived from the clip fps, and a
// reserved transparent index for clips with alpha. Every step is deterministic (no clock, no randomness),
// so the same clip always yields the same bytes and the byte-golden gate holds.
//
// GIF limitations, documented rather than hidden: color is paletted (<= 256 entries) so truecolor is
// approximated by the quantizer; alpha is a single hard transparent index (a pixel is transparent iff its
// alpha is below the threshold), there is no partial transparency; frame delay is quantized to centiseconds
// (1/100 s). For lossless truecolor + full alpha use the APNG encoder instead.

import type { RenderedSequence, SequenceFrame } from '../render-sequence';
import { ByteWriter } from './bytes';
import { encodeGifImageBlock } from './lzw';
import { ColorHistogram, quantizeMedianCut, type Quantized } from './quantize';

export interface GifEncodeOptions {
  // 'global' (default): one palette for the whole clip (smaller, no inter-frame flicker), built from a
  // first pass over the frames. 'per-frame': a local table per frame (better per-frame fidelity, larger).
  readonly palette?: 'global' | 'per-frame';
  // Netscape loop count. 0 (default) loops forever; N plays N times.
  readonly loopCount?: number;
  // Reserve a transparent index. 'auto' (default) enables it iff any frame has a sub-threshold pixel.
  readonly transparency?: boolean | 'auto';
  // Alpha in [0, 1] below which a pixel is transparent (default 0.5). Above it, the pixel is opaque and
  // contributes its color to the palette.
  readonly alphaThreshold?: number;
}

const GIF_HEADER = 'GIF89a';
const EXTENSION_INTRODUCER = 0x21;
const GRAPHIC_CONTROL_LABEL = 0xf9;
const APPLICATION_LABEL = 0xff;
const IMAGE_SEPARATOR = 0x2c;
const TRAILER = 0x3b;
const DISPOSAL_DO_NOT = 1;
const DISPOSAL_RESTORE_BG = 2;

export function encodeGif(sequence: RenderedSequence, options: GifEncodeOptions = {}): Uint8Array {
  const width = sequence.width;
  const height = sequence.height;
  const paletteMode = options.palette ?? 'global';
  const loopCount = options.loopCount ?? 0;
  const threshold255 = alphaThresholdToByte(options.alphaThreshold);
  const delayCentiseconds = Math.max(0, Math.round(100 / sequence.fps));

  const writer = new ByteWriter(4096);
  writer.ascii(GIF_HEADER);

  if (paletteMode === 'global') {
    encodeGlobalPalette(writer, sequence, {
      width,
      height,
      loopCount,
      threshold255,
      delayCentiseconds,
      transparency: options.transparency ?? 'auto',
    });
  } else {
    encodePerFramePalette(writer, sequence, {
      width,
      height,
      loopCount,
      threshold255,
      delayCentiseconds,
      transparency: options.transparency ?? 'auto',
    });
  }

  writer.u8(TRAILER);
  return writer.toUint8Array();
}

interface EncodeParams {
  readonly width: number;
  readonly height: number;
  readonly loopCount: number;
  readonly threshold255: number;
  readonly delayCentiseconds: number;
  readonly transparency: boolean | 'auto';
}

function encodeGlobalPalette(
  writer: ByteWriter,
  sequence: RenderedSequence,
  params: EncodeParams,
): void {
  // Pass 1: build the histogram over every frame and detect transparency in the same scan.
  const histogram = new ColorHistogram();
  let anyTransparent = false;
  for (const frame of sequence.frames()) {
    histogram.addFrame(frame.rgba, params.threshold255);
    if (!anyTransparent && frameHasTransparency(frame, params.threshold255)) anyTransparent = true;
  }
  const transparent = resolveTransparency(params.transparency, anyTransparent);
  const maxColors = transparent ? 255 : 256;
  const quant = quantizeMedianCut(histogram, maxColors);
  const transparentIndex = transparent ? quant.colorCount : -1;

  const table = buildColorTable(quant, transparentIndex);
  writeLogicalScreenDescriptor(writer, params.width, params.height, table.sizeBits);
  writer.bytes(table.bytes);
  writeNetscapeLoop(writer, params.loopCount);

  // Pass 2: map each frame against the global palette and write its image block (no local table).
  const indices = new Uint8Array(params.width * params.height);
  for (const frame of sequence.frames()) {
    mapIndices(frame.rgba, quant, transparentIndex, params.threshold255, indices);
    writeGraphicControl(writer, params.delayCentiseconds, transparentIndex);
    writeImageDescriptor(writer, params.width, params.height, null);
    writer.bytes(encodeGifImageBlock(indices, table.minCodeSize));
  }
}

function encodePerFramePalette(
  writer: ByteWriter,
  sequence: RenderedSequence,
  params: EncodeParams,
): void {
  // Decide transparency globally (uniform disposal) with one detection pass when 'auto'.
  let transparent: boolean;
  if (params.transparency === 'auto') {
    let anyTransparent = false;
    for (const frame of sequence.frames()) {
      if (frameHasTransparency(frame, params.threshold255)) {
        anyTransparent = true;
        break;
      }
    }
    transparent = anyTransparent;
  } else {
    transparent = params.transparency;
  }
  const maxColors = transparent ? 255 : 256;

  writeLogicalScreenDescriptor(writer, params.width, params.height, 0); // no global color table
  writeNetscapeLoop(writer, params.loopCount);

  const indices = new Uint8Array(params.width * params.height);
  for (const frame of sequence.frames()) {
    const histogram = new ColorHistogram();
    histogram.addFrame(frame.rgba, params.threshold255);
    const quant = quantizeMedianCut(histogram, maxColors);
    const transparentIndex = transparent ? quant.colorCount : -1;
    const table = buildColorTable(quant, transparentIndex);

    mapIndices(frame.rgba, quant, transparentIndex, params.threshold255, indices);
    writeGraphicControl(writer, params.delayCentiseconds, transparentIndex);
    writeImageDescriptor(writer, params.width, params.height, table.sizeBits);
    writer.bytes(table.bytes);
    writer.bytes(encodeGifImageBlock(indices, table.minCodeSize));
  }
}

function alphaThresholdToByte(threshold: number | undefined): number {
  const t = threshold ?? 0.5;
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.round(clamped * 255);
}

function resolveTransparency(option: boolean | 'auto', detected: boolean): boolean {
  return option === 'auto' ? detected : option;
}

function frameHasTransparency(frame: SequenceFrame, threshold255: number): boolean {
  const rgba = frame.rgba;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i]! < threshold255) return true;
  }
  return false;
}

interface ColorTable {
  readonly bytes: Uint8Array;
  // The GIF "size of color table" field encodes 2^sizeBits entries as (sizeBits - 1).
  readonly sizeBits: number;
  // The LZW minimum code size (>= 2 even for a 2-color table, per the GIF spec).
  readonly minCodeSize: number;
}

// Build a padded GIF color table for `quant` (plus a placeholder entry for the transparent index when
// present). The entry count is rounded up to a power of two in [2, 256]; unused entries are zero-filled.
function buildColorTable(quant: Quantized, transparentIndex: number): ColorTable {
  const entries = transparentIndex >= 0 ? quant.colorCount + 1 : quant.colorCount;
  let size = 2;
  let sizeBits = 1;
  while (size < entries) {
    size <<= 1;
    sizeBits += 1;
  }
  const bytes = new Uint8Array(size * 3);
  for (let i = 0; i < quant.colorCount; i += 1) {
    bytes[i * 3] = quant.palette[i * 3]!;
    bytes[i * 3 + 1] = quant.palette[i * 3 + 1]!;
    bytes[i * 3 + 2] = quant.palette[i * 3 + 2]!;
  }
  // Remaining entries (transparent placeholder + padding) stay zero.
  return { bytes, sizeBits, minCodeSize: Math.max(2, sizeBits) };
}

function mapIndices(
  rgba: Uint8Array,
  quant: Quantized,
  transparentIndex: number,
  threshold255: number,
  out: Uint8Array,
): void {
  const hasTransparency = transparentIndex >= 0;
  for (let p = 0, i = 0; i < rgba.length; i += 4, p += 1) {
    if (hasTransparency && rgba[i + 3]! < threshold255) {
      out[p] = transparentIndex;
    } else {
      out[p] = quant.indexOf(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
    }
  }
}

function writeLogicalScreenDescriptor(
  writer: ByteWriter,
  width: number,
  height: number,
  globalSizeBits: number,
): void {
  writer.u16le(width);
  writer.u16le(height);
  if (globalSizeBits > 0) {
    // Global color table present: flag set, color resolution mirrors the table depth, size field = bits-1.
    const packed = 0x80 | (((globalSizeBits - 1) & 0x7) << 4) | ((globalSizeBits - 1) & 0x7);
    writer.u8(packed);
  } else {
    writer.u8(0x70); // no GCT, color resolution 8 bits (7), no sort, size 0
  }
  writer.u8(0); // background color index
  writer.u8(0); // pixel aspect ratio (none)
}

function writeNetscapeLoop(writer: ByteWriter, loopCount: number): void {
  writer.u8(EXTENSION_INTRODUCER);
  writer.u8(APPLICATION_LABEL);
  writer.u8(11);
  writer.ascii('NETSCAPE2.0');
  writer.u8(3);
  writer.u8(1);
  writer.u16le(loopCount & 0xffff);
  writer.u8(0);
}

function writeGraphicControl(
  writer: ByteWriter,
  delayCentiseconds: number,
  transparentIndex: number,
): void {
  const hasTransparency = transparentIndex >= 0;
  const disposal = hasTransparency ? DISPOSAL_RESTORE_BG : DISPOSAL_DO_NOT;
  const packed = (disposal << 2) | (hasTransparency ? 1 : 0);
  writer.u8(EXTENSION_INTRODUCER);
  writer.u8(GRAPHIC_CONTROL_LABEL);
  writer.u8(4);
  writer.u8(packed);
  writer.u16le(delayCentiseconds);
  writer.u8(hasTransparency ? transparentIndex : 0);
  writer.u8(0);
}

function writeImageDescriptor(
  writer: ByteWriter,
  width: number,
  height: number,
  localSizeBits: number | null,
): void {
  writer.u8(IMAGE_SEPARATOR);
  writer.u16le(0); // left
  writer.u16le(0); // top
  writer.u16le(width);
  writer.u16le(height);
  if (localSizeBits !== null && localSizeBits > 0) {
    writer.u8(0x80 | ((localSizeBits - 1) & 0x7));
  } else {
    writer.u8(0);
  }
}
