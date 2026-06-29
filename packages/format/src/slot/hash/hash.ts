import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { canonicalJsonExcludingKey } from '../../hash/canonicalize';
import type { SlotSceneDocument } from '../scene-document';

// Content hashing for the slot scene format (format-contract section 15.5, phase-4 section 6.1.1). The
// hash is the SHA-256 digest, lowercase hex, of the canonical UTF-8 bytes of `{ slotSceneFormatVersion,
// name, scene, refs }` (the envelope with its own `hash` field removed). This REUSES the ONE
// canonicalizer in the system (hash/canonicalize.ts, format-contract section 9.2 and 9.4): the skeleton,
// effects, and slot formats hash identically structured content the same way. There is no second hash
// algorithm and no second canonicalizer.

// Compute the content hash of a SlotSceneDocument, ignoring any existing `doc.hash`.
export function computeSlotSceneHash(doc: SlotSceneDocument): string {
  const canonical = canonicalJsonExcludingKey(doc, 'hash');
  return bytesToHex(sha256(new TextEncoder().encode(canonical)));
}

// True when the stored `doc.hash` matches the recomputed content hash.
export function verifySlotSceneContentHash(doc: SlotSceneDocument): boolean {
  return doc.hash === computeSlotSceneHash(doc);
}
