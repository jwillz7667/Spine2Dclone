import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import type { SkeletonDocument } from '../schema/document';
import { canonicalJsonExcludingKey } from './canonicalize';

// Content hashing for runtime cache-busting (format-contract section 9). The hash is the SHA-256
// digest, lowercase hex, of the canonical UTF-8 bytes of the document with its own `hash` field
// removed. Two documents with identical content hash identically; any content change busts caches.
// This is the ONE hash algorithm in the system; the slot scene (Phase 4) reuses this canonicalizer.

// Compute the content hash, ignoring any existing `doc.hash`.
export function computeContentHash(doc: SkeletonDocument): string {
  const canonical = canonicalJsonExcludingKey(doc, 'hash');
  return bytesToHex(sha256(new TextEncoder().encode(canonical)));
}

// True when the stored `doc.hash` matches the recomputed content hash.
export function verifyContentHash(doc: SkeletonDocument): boolean {
  return doc.hash === computeContentHash(doc);
}
