// Isomorphic IPC contract: channel names, Zod request/response schemas, and the renderer-facing
// bridge type. Imported by main (handlers + validation), preload (typed bridge), and the renderer
// (window typing) without leaking node, electron, or PixiJS into the sandbox. Stays runtime-free
// except for Zod. WP-0.8 extends this with the file IO channels.

import { z } from 'zod';

// Namespaced channel names. The main process registers handlers ONLY for these, and the preload
// exposes ONLY these; any other channel has no handler and is rejected by Electron.
export const IpcChannel = {
  getVersion: 'app:getVersion',
  fileSave: 'file:save',
  fileOpen: 'file:open',
} as const;

export type IpcChannel = (typeof IpcChannel)[keyof typeof IpcChannel];

export const ALLOWED_CHANNELS: readonly IpcChannel[] = Object.freeze(Object.values(IpcChannel));

export function isAllowedChannel(channel: string): channel is IpcChannel {
  return (ALLOWED_CHANNELS as readonly string[]).includes(channel);
}

// app:getVersion. No request payload; responds with the application version.
export const getVersionRequestSchema = z.undefined();
export const getVersionResponseSchema = z.object({ version: z.string().min(1) }).strict();

export type GetVersionResponse = z.infer<typeof getVersionResponseSchema>;

// file:save. The renderer sends an already-exported document (validated by document-core); the main
// process deep-validates it with @marionette/format before any disk write, then shows a save dialog
// (the renderer never supplies an arbitrary filesystem path, which is the path-injection defense). A
// user cancel is a normal outcome (status 'canceled'), not an IPC error. The document is opaque at the
// transport layer (z.unknown); the format validator in main is the real gate.
export const fileSaveRequestSchema = z.object({ document: z.unknown() }).strict();
export const fileSaveResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('saved'), path: z.string().min(1) }).strict(),
  z.object({ status: z.literal('canceled') }).strict(),
]);

export type FileSaveResponse = z.infer<typeof fileSaveResponseSchema>;

// file:open. No request payload; the main process shows an open dialog, reads and validates the file,
// and returns the parsed document (the renderer re-validates via loadDocument and mints internal ids).
export const fileOpenRequestSchema = z.undefined();
export const fileOpenResponseSchema = z.discriminatedUnion('status', [
  z
    .object({ status: z.literal('opened'), name: z.string().min(1), document: z.unknown() })
    .strict(),
  z.object({ status: z.literal('canceled') }).strict(),
]);

export type FileOpenResponse = z.infer<typeof fileOpenResponseSchema>;

// Typed IPC error model. The main boundary never throws a bare string across the wire; it returns
// a discriminated result so the renderer can branch on success without try/catch over IPC.
export type IpcErrorCode =
  | 'IPC_BAD_REQUEST'
  | 'IPC_BAD_RESPONSE'
  | 'IPC_UNKNOWN_CHANNEL'
  | 'IPC_HANDLER_ERROR';

export interface IpcError {
  readonly code: IpcErrorCode;
  readonly message: string;
}

export type IpcResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: IpcError };

// Boundary validation helper: parse with a schema and return a typed result, never throwing.
export function validateWith<T>(
  schema: z.ZodType<T>,
  input: unknown,
  code: IpcErrorCode,
): IpcResult<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    error: { code, message: parsed.error.issues.map((i) => i.message).join('; ') },
  };
}

// The typed surface exposed on window.marionette by the preload. The renderer depends on THIS
// type (from editor-shared), never on the preload module, so the process split holds.
export interface MarionetteApi {
  getVersion(): Promise<IpcResult<GetVersionResponse>>;
  // Save an exported format document; main shows the dialog and writes it. Returns the written path
  // or a canceled status.
  saveDocument(document: unknown): Promise<IpcResult<FileSaveResponse>>;
  // Open a document; main shows the dialog, reads and validates the file. Returns the parsed document
  // or a canceled status.
  openDocument(): Promise<IpcResult<FileOpenResponse>>;
}
