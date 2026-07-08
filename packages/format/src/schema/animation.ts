import { z } from 'zod';
import { rgbaSchema } from './color';
import { ikMixSchema, tcMixSchema } from './constraint';
import { curveSchema } from './curve';

// A keyframe carries a time (seconds), a typed value, and an outgoing interpolation curve
// (handoff section 6). The curve on the last keyframe of a timeline is ignored by the runtime.
function keyframeSchema<TValue extends z.ZodTypeAny>(valueSchema: TValue) {
  return z
    .object({
      time: z.number().finite(),
      value: valueSchema,
      curve: curveSchema,
    })
    .strict();
}

const rotateValueSchema = z.object({ angle: z.number().finite() }).strict();
const vec2ValueSchema = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const colorValueSchema = z.object({ color: rgbaSchema }).strict();

// Per-bone transform timelines (handoff section 6). Each channel is optional; when present it is a
// list of keyframes whose strict-ascending time order and in-duration range are checked in the
// semantic layer.
export const boneTimelinesSchema = z
  .object({
    rotate: z.array(keyframeSchema(rotateValueSchema)).optional(),
    translate: z.array(keyframeSchema(vec2ValueSchema)).optional(),
    scale: z.array(keyframeSchema(vec2ValueSchema)).optional(),
    shear: z.array(keyframeSchema(vec2ValueSchema)).optional(),
  })
  .strict();

// The attachment timeline swaps the active attachment; it is stepped by nature and carries no
// curve. A non-null `name` must resolve in the default skin under the slot (a Phase-1 deep check;
// Phase 0 validates time order/range only).
const attachmentFrameSchema = z
  .object({
    time: z.number().finite(),
    name: z.string().nullable(),
  })
  .strict();

// Per-slot timelines (handoff section 6, Phase-0 subset: attachment swaps and color tint).
export const slotTimelinesSchema = z
  .object({
    attachment: z.array(attachmentFrameSchema).optional(),
    color: z.array(keyframeSchema(colorValueSchema)).optional(),
  })
  .strict();

// A keyed IK constraint frame (handoff section 6 IkFrame): a `mix` blend and a `bendPositive` flag.
// `bendPositive` is NON-interpolatable and sampled STEPPED in all runtimes (ADR-0003 section 7); the
// format carries the value and the curve, and the runtime ignores the curve for the boolean channel.
const ikFrameSchema = z.object({ mix: ikMixSchema, bendPositive: z.boolean() }).strict();

// A keyed transform-constraint frame (handoff section 6 TransformFrame): a PARTIAL record of the six
// world-channel mix factors. A frame MAY carry a subset; the meaning of an absent channel during a
// frame is SOLVE semantics (ADR-0003), not format. Present channels are range-checked to [0, 1]
// (TC_MIX_RANGE), the same refinement as the constraint definition (format-contract section 4.8).
const transformFrameSchema = z
  .object({
    mixRotate: tcMixSchema.optional(),
    mixX: tcMixSchema.optional(),
    mixY: tcMixSchema.optional(),
    mixScaleX: tcMixSchema.optional(),
    mixScaleY: tcMixSchema.optional(),
    mixShearY: tcMixSchema.optional(),
  })
  .strict();

// A deform keyframe value: per-LOGICAL-vertex (dx, dy) offsets from the setup mesh, laid out flat as
// [dx0, dy0, dx1, dy1, ...] (handoff section 6, format-contract section 4.9). The length invariant
// (offsets.length === 2 * V) is a referential check (it needs the target mesh) and lives in the
// semantic layer (DEFORM_OFFSET_LENGTH).
const deformFrameValueSchema = z.object({ offsets: z.array(z.number().finite()) }).strict();

// DeformTimelines (handoff section 6, format-contract section 4.9):
//   Record<skinName, Record<slotName, Record<attachmentName, Keyframe<{ offsets }>[]>>>.
// The keys' referential validity (skin/slot/attachment exist, attachment is a mesh) is semantic.
export const deformTimelinesSchema = z.record(
  z.string(),
  z.record(z.string(), z.record(z.string(), z.array(keyframeSchema(deformFrameValueSchema)))),
);

// A draw-order offset entry (format-contract section 4.10, ADR-0008 section 3). Moves one named slot
// from its setup draw-order index by a signed integer `offset`. The full per-frame order is DERIVED
// from the setup order plus these offsets, a solve concern owned by runtime-core; the format validates
// only that the listed offsets describe a consistent reordering (DRAWORDER_INCOMPLETE, semantic layer).
const drawOrderOffsetSchema = z
  .object({
    slot: z.string(),
    offset: z.number().int().finite(),
  })
  .strict();

// A draw-order keyframe (ADR-0008 section 3): at `time`, apply a compact list of per-slot offsets to
// the setup draw order. An empty `offsets` list means the setup order (identity), so a key can restore
// it after an earlier reorder. There is no curve (a draw-order change is a discrete, stepped
// reordering). Strict-ascending time (format-contract section 4.8) and offset consistency are checked
// in the semantic layer.
export const drawOrderKeyframeSchema = z
  .object({
    time: z.number().finite(),
    offsets: z.array(drawOrderOffsetSchema),
  })
  .strict();

// An event keyframe (ADR-0008 section 2): fires the named event at `time`, optionally overriding the
// event's int/float/string payload defaults. No curve (events are discrete). The `name` must reference
// a defined EventDef (ANIM_EVENT_UNKNOWN); event times are NON-DECREASING (coincident events are legal,
// only a strictly decreasing pair is ANIM_TIME_ORDER). Both referential and ordering checks live in the
// semantic layer (format-contract sections 4.8 and 4.10).
export const eventKeyframeSchema = z
  .object({
    time: z.number().finite(),
    name: z.string(),
    int: z.number().int().finite().optional(),
    float: z.number().finite().optional(),
    string: z.string().optional(),
  })
  .strict();

// An animation (handoff section 6). Phase 2 makes the ik/transform/deform timelines REAL (ADR-0004);
// stage F1 (ADR-0008, formatVersion 0.3.0) adds the `drawOrder` and `events` timelines. All five of
// ik/transform/deform/drawOrder/events are REQUIRED collections, empty when an animation keys none, so
// a pre-0.3.0 document is migrated (empties injected) rather than silently widened. The root stays
// `.strict()` and closes over exactly these eight keys.
export const animationSchema = z
  .object({
    duration: z.number().finite().nonnegative(),
    bones: z.record(z.string(), boneTimelinesSchema),
    slots: z.record(z.string(), slotTimelinesSchema),
    ik: z.record(z.string(), z.array(keyframeSchema(ikFrameSchema))),
    transform: z.record(z.string(), z.array(keyframeSchema(transformFrameSchema))),
    deform: deformTimelinesSchema,
    drawOrder: z.array(drawOrderKeyframeSchema),
    events: z.array(eventKeyframeSchema),
  })
  .strict();

export type Keyframe<TValue> = { time: number; value: TValue; curve: z.infer<typeof curveSchema> };
export type BoneTimelines = z.infer<typeof boneTimelinesSchema>;
export type SlotTimelines = z.infer<typeof slotTimelinesSchema>;
export type IkFrame = z.infer<typeof ikFrameSchema>;
export type TransformFrame = z.infer<typeof transformFrameSchema>;
export type DeformTimelines = z.infer<typeof deformTimelinesSchema>;
export type DrawOrderOffset = z.infer<typeof drawOrderOffsetSchema>;
export type DrawOrderKeyframe = z.infer<typeof drawOrderKeyframeSchema>;
export type EventKeyframe = z.infer<typeof eventKeyframeSchema>;
export type Animation = z.infer<typeof animationSchema>;
