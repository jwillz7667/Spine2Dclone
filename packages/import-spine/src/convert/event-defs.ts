import type { EventDef } from '@marionette/format';
import type { Diagnostics } from '../diagnostics';
import {
  asRecord,
  ptr,
  readNumber,
  readOptionalNumber,
  readOptionalString,
  type JsonRecord,
} from '../read';

// Convert Spine's top-level `events` object (name -> definition) into our `events` ARRAY of EventDef.
// Our format uses an array because event-name uniqueness is a validated invariant (a Record key cannot
// carry a duplicate to detect); a JSON object cannot express a duplicate anyway, so the array preserves
// definition order. int/float/string are optional payload defaults, carried only when the Spine export
// includes them. An `audio` path lifts the sibling volume (default 1) and balance (default 0) into our
// nested audio block; without an audio path there is no audio block.
export function convertEvents(eventsValue: unknown, base: string, diag: Diagnostics): EventDef[] {
  const out: EventDef[] = [];
  if (eventsValue === undefined) return out;
  const rec = asRecord(eventsValue, base, diag);
  if (rec === undefined) return out;

  for (const [name, raw] of Object.entries(rec)) {
    const path = ptr(base, name);
    const eventRec = asRecord(raw, path, diag);
    if (eventRec === undefined) continue;

    const int = readOptionalNumber(eventRec, 'int', path, diag);
    const float = readOptionalNumber(eventRec, 'float', path, diag);
    const string = readOptionalString(eventRec, 'string', path, diag);
    out.push({
      name,
      ...(int === undefined ? {} : { int }),
      ...(float === undefined ? {} : { float }),
      ...(string === undefined ? {} : { string }),
      ...readAudio(eventRec, path, diag),
    });
  }
  return out;
}

function readAudio(
  rec: JsonRecord,
  base: string,
  diag: Diagnostics,
): { audio?: EventDef['audio'] } {
  const audioPath = readOptionalString(rec, 'audio', base, diag);
  if (audioPath === undefined || audioPath.length === 0) return {};
  return {
    audio: {
      path: audioPath,
      volume: readNumber(rec, 'volume', base, diag, 1),
      balance: readNumber(rec, 'balance', base, diag, 0),
    },
  };
}
