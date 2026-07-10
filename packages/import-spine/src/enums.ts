import type { BlendMode, TransformMode } from '@marionette/format';

// Cast-free type guards for the closed string unions the importer maps by identity. Written as explicit
// literal comparisons so TypeScript narrows the string to the union without an `as` assertion (house
// rule: no `as` unless unavoidable). Enums whose Spine spelling differs from ours (the path modes) are
// mapped explicitly in the constraints converter instead of guarded here.

export function isTransformMode(value: string): value is TransformMode {
  return (
    value === 'normal' ||
    value === 'onlyTranslation' ||
    value === 'noRotationOrReflection' ||
    value === 'noScale' ||
    value === 'noScaleOrReflection'
  );
}

export function isBlendMode(value: string): value is BlendMode {
  return value === 'normal' || value === 'additive' || value === 'multiply' || value === 'screen';
}
