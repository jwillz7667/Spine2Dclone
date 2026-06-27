import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import type { SkeletonDocument } from '../schema/document';
import { canonicalJsonExcludingKey } from './canonicalize';

// Content hashing for runtime cache-busting (format-contract section 9). The hash is the SHA-256
// digest, lowercase hex, of the canonical UTF-8 bytes of the document with its own `hash` field
// removed. Two documents with identical content hash identically; any content change busts caches.
// This is the ONE hash algorithm in the system; the slot scene (Phase 4) reuses this canonicalizer.

// Compute the content hash of any record, ignoring its `hash` key. Internal: migrations hash a
// migrated record that is not yet typed as a SkeletonDocument (it is validated structurally right
// after). Not part of the public barrel; computeContentHash is the typed entry point.
export function canonicalContentHash(value: Record<string, unknown>): string {
  const canonical = canonicalJsonExcludingKey(value, 'hash');
  return bytesToHex(sha256(new TextEncoder().encode(canonical)));
}

// Compute the content hash, ignoring any existing `doc.hash`.
export function computeContentHash(doc: SkeletonDocument): string {
  return canonicalContentHash(doc);
}

// True when the stored `doc.hash` matches the recomputed content hash.
export function verifyContentHash(doc: SkeletonDocument): boolean {
  return doc.hash === computeContentHash(doc);
}
