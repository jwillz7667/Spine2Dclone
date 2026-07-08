import { z } from 'zod';

// Event definitions (handoff section 6, format-contract sections 4.2 and 4.10). First AUTHORED in
// stage F1 (ADR-0008, formatVersion 0.3.0). An event is a named marker an animation's event timeline
// fires; the definition carries the payload defaults and an optional audio hint. Names are unique
// across the document (EVENT_NAME_DUPLICATE), a referential check that lives in the semantic layer
// (validate/semantic.ts), which is why `events` is an ARRAY, not a Record (a Record key cannot be
// duplicated in a parsed object, so the uniqueness fault would be undetectable).

// An optional audio playback hint (ADR-0008 section 1). `volume` is in [0, 1] and `balance` is in
// [-1, 1] (left to right). Both range faults are reported as EVENT_AUDIO_RANGE via a custom issue
// carrying `params.code`, mirroring COLOR_RANGE and the mix-range refinements (format-contract 4.1).
export const eventAudioSchema = z
  .object({
    path: z.string().min(1),
    volume: z.number().finite(),
    balance: z.number().finite(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.volume < 0 || value.volume > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['volume'],
        params: { code: 'EVENT_AUDIO_RANGE' },
        message: `event audio volume must be in [0, 1], received ${value.volume}`,
      });
    }
    if (value.balance < -1 || value.balance > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['balance'],
        params: { code: 'EVENT_AUDIO_RANGE' },
        message: `event audio balance must be in [-1, 1], received ${value.balance}`,
      });
    }
  });

// A named event definition (ADR-0008 section 1). `int`/`float`/`string` are OPTIONAL payload defaults
// the event carries when fired; an event-timeline key may override any of them. `int` is an integer (a
// non-integer fails structurally as SCHEMA_SHAPE). `audio` is optional. Closed (.strict()).
export const eventDefSchema = z
  .object({
    name: z.string().min(1),
    int: z.number().int().finite().optional(),
    float: z.number().finite().optional(),
    string: z.string().optional(),
    audio: eventAudioSchema.optional(),
  })
  .strict();

export type EventAudio = z.infer<typeof eventAudioSchema>;
export type EventDef = z.infer<typeof eventDefSchema>;
