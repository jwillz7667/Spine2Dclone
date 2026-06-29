import { describe, expect, it } from 'vitest';
import * as common from '../src/common';
import { blendModeSchema } from '../src/schema/slot';
import { atlasRefSchema, atlasPageSchema, atlasRegionSchema } from '../src/schema/atlas';
import { curveSchema } from '../src/schema/curve';
import { skeletonDocumentSchema } from '../src/schema/document';
import { effectsDocumentSchema } from '../src/effects/schema/document';
import { validateDocument } from '../src/validate';
import minimalSkeleton from './fixtures/minimal.json';

// WP-3.0 TASK-3.0.1: `packages/format/src/common` RE-EXPORTS the existing primitives without moving
// or rewriting them, so the SkeletonDocument byte shape is UNCHANGED. The identity assertions below
// prove `common` hands back the SAME schema objects the skeletal schemas use (not a copy), so both
// documents validate against one frozen sub-contract.
describe('shared common sub-contract', () => {
  it('re-exports the identical primitive schema objects (no move, no copy)', () => {
    expect(common.blendModeSchema).toBe(blendModeSchema);
    expect(common.atlasRefSchema).toBe(atlasRefSchema);
    expect(common.atlasPageSchema).toBe(atlasPageSchema);
    expect(common.atlasRegionSchema).toBe(atlasRegionSchema);
    expect(common.curveSchema).toBe(curveSchema);
  });

  it('leaves the skeletal document schema validating the committed fixture unchanged (LAW 3)', () => {
    // The skeletal validator still passes its committed minimal fixture with zero errors: introducing
    // the effects sibling format did not perturb the SkeletonDocument byte shape.
    const report = validateDocument(minimalSkeleton);
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it('keeps the two document schemas distinct (independent version lines)', () => {
    expect(skeletonDocumentSchema).not.toBe(effectsDocumentSchema);
  });
});
