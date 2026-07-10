import type { PageBitmap } from './pack';

// The compressed-texture encoder SLOT (phase-5 WP-5.2, TASK-5.2.6 / DECISION-5.2.c). The export pipeline
// wants one Basis Universal UASTC KTX2 per page (default transport) or per-target sidecars, transcoded at
// load to the device's GPU format. Producing that artifact requires a real UASTC/KTX2 encoder.
//
// DECISION-5.2.c (recorded in docs/plan/phase-5-texture-transport.md): there is currently NO maintained,
// version-pinnable, license-clean pure-JS / wasm UASTC KTX2 ENCODER we can add as a production dependency
// (the Basis Universal reference encoder is C++, and no engine-verified wasm build is pinned here; a native
// binary is forbidden by policy). Rather than ship a toy encoder, this package defines the encoder as an
// injectable interface with a default STUB that returns a typed unsupported diagnostic. The canonical PNG
// pipeline (the contract page, AtlasPage.file) is unaffected and always succeeds; the manifest records the
// intended compressed file names plus the diagnostic, so a future real encoder drops into this exact seam
// (async signature preserved for wasm init) and the golden-hash tests attach without a pipeline rewrite.

// The compressed GPU targets an encoder may emit. Spelled as in the Export Profile's compressionTargets
// enum ('astc6x6' is the authored ASTC block size); the runtime-web selector exposes the coarser 'astc'
// family name to the loader.
export type CompressedTextureTarget = 'astc6x6' | 'bc7' | 'etc2';

export interface TextureEncodeInput {
  readonly page: PageBitmap;
  // sha256 of the source PNG bytes, threaded through so the encoder result and the manifest agree.
  readonly pngSha256: string;
  readonly target: CompressedTextureTarget;
  // Whether the page pixels are premultiplied (affects a real encoder's alpha handling; recorded for the
  // stub so the diagnostic is self-describing).
  readonly premultipliedAlpha: boolean;
}

export interface TextureEncodeOk {
  readonly ok: true;
  // The encoded artifact bytes (a KTX2 container for a real encoder).
  readonly bytes: Uint8Array;
  // Deterministic encoder fingerprint `<encoder>@<version>+<settings-hash>` (WP-5.2 R4 determinism note).
  readonly fingerprint: string;
}

export interface TextureEncodeDiagnostic {
  readonly ok: false;
  readonly code: 'ATLAS_COMPRESSION_UNSUPPORTED';
  readonly target: CompressedTextureTarget;
  readonly message: string;
}

export type TextureEncodeResult = TextureEncodeOk | TextureEncodeDiagnostic;

// The encoder abstraction. Async so a real wasm encoder (which needs module init) satisfies it unchanged.
export interface TextureEncoder {
  readonly name: string;
  encode(input: TextureEncodeInput): Promise<TextureEncodeResult>;
}

// The default slot: every target is unsupported, reported as a typed diagnostic (never a throw), so the
// PNG pipeline still completes and the manifest is honest about what was NOT produced.
export const unsupportedTextureEncoder: TextureEncoder = {
  name: 'unsupported',
  encode(input: TextureEncodeInput): Promise<TextureEncodeResult> {
    return Promise.resolve({
      ok: false,
      code: 'ATLAS_COMPRESSION_UNSUPPORTED',
      target: input.target,
      message:
        `no production UASTC/KTX2 encoder is wired (DECISION-5.2.c); ` +
        `target ${input.target} not emitted for a ${input.premultipliedAlpha ? 'premultiplied' : 'straight'}-alpha page`,
    });
  },
};
