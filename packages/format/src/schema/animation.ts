import { z } from 'zod';
import { rgbaSchema } from './color';
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

// An animation (handoff section 6, Phase-0 subset). The ik/transform/deform/drawOrder/event
// timelines are deferred to the Phase 1 animation validator (format-contract WP-F.6); Phase 0
// authors bone and slot timelines only, so the root closes over exactly those keys.
export const animationSchema = z
  .object({
    duration: z.number().finite().nonnegative(),
    bones: z.record(z.string(), boneTimelinesSchema),
    slots: z.record(z.string(), slotTimelinesSchema),
  })
  .strict();

export type Keyframe<TValue> = { time: number; value: TValue; curve: z.infer<typeof curveSchema> };
export type BoneTimelines = z.infer<typeof boneTimelinesSchema>;
export type SlotTimelines = z.infer<typeof slotTimelinesSchema>;
export type Animation = z.infer<typeof animationSchema>;
