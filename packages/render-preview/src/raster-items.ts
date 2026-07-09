import type { DrawItem } from './draw-items';
import { Framebuffer, rasterizeTriangle, type RasterTriangle } from './raster';
import { projectX, projectY, type WorldToImage } from './viewport';

// Rasterize one world-space DrawItem (a region or mesh quad/triangle set) into the framebuffer through
// the world -> image transform. Factored out of render-frame so the skeleton path and the composed
// skeleton+effect path share ONE rasterizer (no second copy that could drift). Fixed loop order over
// triangles; every vertex is projected once, then handed to the pinned scanline fill.
export function rasterizeWorldItem(fb: Framebuffer, item: DrawItem, transform: WorldToImage): void {
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
    rasterizeTriangle(fb, tri, item.sampler, item.tint, item.alpha, item.blend, item.dark);
  }
}
