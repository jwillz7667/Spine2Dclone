import type { PreviewBackground } from './preview-transport';

// The pure mapping from a PreviewBackground toggle value to the concrete draw parameters the GL preview
// stage consumes (PP-D8). Kept separate from the transport state machine and pixi-free so it is unit-tested
// in the node env: the stage reads `clearColor` for its Application background and, when `checker` is
// present, tiles a two-tone board behind the content. The checker uses a dark two-tone so additive and
// alpha particles read against a neutral field (a bright checker would wash out screen/additive blends).

export interface PreviewBackgroundStyle {
  // The flat clear color for the whole preview surface (0xRRGGBB).
  readonly clearColor: number;
  // When set, a tiled checker is drawn over the clear: alternating colorA / colorB squares of `tile` px.
  readonly checker: {
    readonly colorA: number;
    readonly colorB: number;
    readonly tile: number;
  } | null;
}

const DARK = 0x1e1e1e;
const LIGHT = 0xf0f0f0;
const CHECKER_BASE = 0x2a2a2a;
const CHECKER_ALT = 0x363636;
const CHECKER_TILE = 24;

export function previewBackgroundStyle(background: PreviewBackground): PreviewBackgroundStyle {
  switch (background) {
    case 'dark':
      return { clearColor: DARK, checker: null };
    case 'light':
      return { clearColor: LIGHT, checker: null };
    case 'checker':
      return {
        clearColor: CHECKER_BASE,
        checker: { colorA: CHECKER_BASE, colorB: CHECKER_ALT, tile: CHECKER_TILE },
      };
  }
}

// Whether cell (col, row) of the checker board is the alternate tone. Pure so the stage's tile loop and its
// test agree on the parity (a checker is the XOR of the two axis parities).
export function isCheckerAltTile(col: number, row: number): boolean {
  return ((col & 1) ^ (row & 1)) === 1;
}
