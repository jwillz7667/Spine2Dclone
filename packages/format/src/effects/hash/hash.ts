import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { canonicalJsonExcludingKey } from '../../hash/canonicalize';
import type { EffectsDocument } from '../schema/document';

// Content hashing for the effects format (phase-3-vfx-particles.md section 8.1, mirroring the skeletal
// hash/hash.ts). The hash is the SHA-256 digest, lowercase hex, of the canonical UTF-8 bytes of the
// document with its own `hash` field removed. This reuses the ONE canonicalizer in the system
// (hash/canonicalize.ts), so the skeleton and effects formats hash identically structured content the
// same way; there is no second hash algorithm.

// Compute the content hash of an EffectsDocument, ignoring any existing `doc.hash`.
export function computeEffectsContentHash(doc: EffectsDocument): string {
  const canonical = canonicalJsonExcludingKey(doc, 'hash');
  return bytesToHex(sha256(new TextEncoder().encode(canonical)));
}

// True when the stored `doc.hash` matches the recomputed content hash.
export function verifyEffectsContentHash(doc: EffectsDocument): boolean {
  return doc.hash === computeEffectsContentHash(doc);
}
