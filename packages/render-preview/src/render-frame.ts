import { parseDocument, type ValidateOptions } from '@marionette/format';
import { AtlasIndex, type AtlasPixelSource } from './atlas';
import { TRANSPARENT, type Color } from './color';
import { gatherDrawItems, type DrawItem } from './draw-items';
import { encodePng } from './png';
import { Framebuffer, rasterizeTriangle, type RasterTriangle } from './raster';
import { projectX, projectY, resolveWorldToImage, WorldBounds, type Viewport } from './viewport';

// The render-preview entry point (ADR-0006). All inputs are values; the function is a pure, deterministic
// function of them (no file IO, no clock, no randomness). The host resolves atlas page pixels and passes
// them in.
export interface RenderFrameOptions {
  // The document to render, validated internally via packages/format before any solve (validate-before-
  // solve boundary): invalid input throws a typed FormatError and never reaches runtime-core.
  readonly document: unknown;
  // The animation id to sample; omit for the setup pose.
  readonly animation?: string;
  // The time (seconds) to sample the animation at; clamped to [0, duration]. Ignored without `animation`.
  readonly time?: number;
  // Decoded atlas page pixels, keyed by AtlasPage.file.
  readonly atlas: AtlasPixelSource;
  // Output size and framing.
  readonly viewport: Viewport;
  // Background color (straight alpha, [0, 1]). Defaults to fully transparent.
  readonly background?: Color;
  // Optional format validation options (e.g. verifyHash). verifyHash defaults to false: runtimes treat
  // `hash` as opaque (format-contract 9.3), matching runtime-web SkeletonView.sync.
  readonly validate?: ValidateOptions;
}

export interface RenderFrameResult {
  readonly png: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export function renderFrame(options: RenderFrameOptions): RenderFrameResult {
  const document = parseDocument(options.document, {
    verifyHash: options.validate?.verifyHash ?? false,
  });

  const atlas = new AtlasIndex(document.atlas, options.atlas);
  const items = gatherDrawItems(document, atlas, options.animation, options.time);

  const bounds = new WorldBounds();
  for (const item of items) {
    const positions = item.worldPositions;
    for (let i = 0; i < positions.length; i += 2) {
      bounds.add(positions[i]!, positions[i + 1]!);
    }
  }

  const transform = resolveWorldToImage(options.viewport, bounds);
  const fb = new Framebuffer(
    options.viewport.width,
    options.viewport.height,
    options.background ?? TRANSPARENT,
  );

  for (const item of items) {
    rasterizeItem(fb, item, transform);
  }

  const rgba = fb.toStraightRgba8();
  const png = encodePng(rgba, options.viewport.width, options.viewport.height);
  return { png, width: options.viewport.width, height: options.viewport.height };
}

function rasterizeItem(
  fb: Framebuffer,
  item: DrawItem,
  transform: { scale: number; offsetX: number; offsetY: number },
): void {
  const positions = item.worldPositions;
  const uvs = item.uvs;
  const triangles = item.triangles;
  for (let t = 0; t < triangles.length; t += 3) {
    const i0 = triangles[t]!;
    const i1 = triangles[t + 1]!;
    const i2 = triangles[t + 2]!;
    const tri: RasterTriangle = {
      x0: projectX(transform, positions[i0 * 2]!),
      y0: projectY(transform, positions[i0 * 2 + 1]!),
      u0: uvs[i0 * 2]!,
      v0: uvs[i0 * 2 + 1]!,
      x1: projectX(transform, positions[i1 * 2]!),
      y1: projectY(transform, positions[i1 * 2 + 1]!),
      u1: uvs[i1 * 2]!,
      v1: uvs[i1 * 2 + 1]!,
      x2: projectX(transform, positions[i2 * 2]!),
      y2: projectY(transform, positions[i2 * 2 + 1]!),
      u2: uvs[i2 * 2]!,
      v2: uvs[i2 * 2 + 1]!,
    };
    rasterizeTriangle(fb, tri, item.sampler, item.tint, item.alpha, item.blend);
  }
}
