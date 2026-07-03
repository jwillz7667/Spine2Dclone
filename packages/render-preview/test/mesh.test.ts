import { describe, expect, it } from 'vitest';
import { renderFrame } from '@marionette/render-preview';
import { MESH_REGION_COLOR, meshScenario } from './scenarios';
import { decode, pixelAt } from './helpers';

describe('skinned + deformed mesh frame', () => {
  it('renders the deformed limb mesh textured from its atlas region', () => {
    const result = renderFrame(meshScenario());
    expect(result.width).toBe(96);
    expect(result.height).toBe(96);

    const image = decode(result.png);
    const teal = {
      r: Math.round(MESH_REGION_COLOR.r * 255),
      g: Math.round(MESH_REGION_COLOR.g * 255),
      b: Math.round(MESH_REGION_COLOR.b * 255),
      a: 255,
    };

    let texturedPixels = 0;
    let backgroundPixels = 0;
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const p = pixelAt(image, x, y);
        if (p.r === teal.r && p.g === teal.g && p.b === teal.b && p.a === 255) texturedPixels += 1;
        if (p.a === 0) backgroundPixels += 1;
      }
    }

    // The mesh covers a substantial region (its atlas window is solid teal) and leaves transparent
    // background around it: both prove the skinned+deformed geometry actually rasterized with its texture.
    expect(texturedPixels).toBeGreaterThan(200);
    expect(backgroundPixels).toBeGreaterThan(200);
  });
});
