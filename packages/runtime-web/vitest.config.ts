import { defineConfig } from 'vitest/config';

// The runtime-web suites are pure: map-transform is Pixi-free, and the scene-graph suite constructs
// PixiJS v8 display objects (Container, Graphics, Sprite, Texture.WHITE) and reads their transforms
// WITHOUT a renderer, so no WebGL or DOM context is required and the Node environment is sufficient.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
