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
  atlasImport: 'atlas:import',
  // Import a user-owned exported Spine project (.json or .skel). Main owns the file dialog (no renderer
  // path, the path-injection defense), runs the clean-room importer OUTSIDE the renderer document path,
  // and returns the converted document plus the lossy-conversion warnings, or a typed failure (PP-A5).
  spineImport: 'spine:import',
  // Import images supplied BY THE RENDERER as bytes (drag-drop onto the assets panel, or a file-input
  // picker). Unlike atlas:import (main owns a directory dialog), here the sandboxed renderer reads the
  // dropped/picked File bytes via the web File API and ships them; main stages them and runs the SAME pack.
  atlasImportImages: 'atlas:importImages',
  // menu:action is the one MAIN -> RENDERER push channel (webContents.send): the native application menu
  // lives in the main process, and a menu click dispatches one of the allowlisted MenuActionId strings to
  // the renderer, which maps it to the same action a keybinding would (undo/redo/save/open/import/tool/mode).
  menuAction: 'menu:action',
} as const;

export type IpcChannel = (typeof IpcChannel)[keyof typeof IpcChannel];

export const ALLOWED_CHANNELS: readonly IpcChannel[] = Object.freeze(Object.values(IpcChannel));

export function isAllowedChannel(channel: string): channel is IpcChannel {
  return (ALLOWED_CHANNELS as readonly string[]).includes(channel);
}

// The allowlisted application-menu actions (the single source shared by the main-process menu factory and
// the renderer dispatcher, so the two can never disagree about which actions exist). Each menu click sends
// one of these over IpcChannel.menuAction; the preload forwards ONLY these (an unknown string is dropped).
export const MENU_ACTION_IDS = [
  'file:new',
  'file:open',
  'file:save',
  'file:importSprites',
  'file:importSpine',
  'edit:undo',
  'edit:redo',
  'tool:select',
  'tool:createBone',
  'mode:setup',
  'mode:animation',
  'mode:toggleAutoKey',
] as const;

export type MenuActionId = (typeof MENU_ACTION_IDS)[number];

const MENU_ACTION_SET: ReadonlySet<string> = new Set(MENU_ACTION_IDS);

// True when `value` is a known menu action. The preload uses this to forward only allowlisted actions to
// the renderer (defense in depth: a spoofed menu:action payload with an unknown id is ignored).
export function isMenuActionId(value: unknown): value is MenuActionId {
  return typeof value === 'string' && MENU_ACTION_SET.has(value);
}

// app:getVersion. No request payload; responds with the application version.
export const getVersionRequestSchema = z.undefined();
export const getVersionResponseSchema = z.object({ version: z.string().min(1) }).strict();

export type GetVersionResponse = z.infer<typeof getVersionResponseSchema>;

// One packed atlas page's bytes crossing the sandbox boundary. The renderer cannot read the app-owned
// output dir itself (no filesystem in the sandbox), so the main process ships raw PNG bytes on import and
// on restore, and the renderer ships them back on save. Transport is a Uint8Array: Electron's structured
// clone preserves it end to end (a Node Buffer is a Uint8Array and arrives as a plain Uint8Array), and
// z.instanceof validates it without the base64 size bloat and extra decode step. `file` is the
// AtlasPage.file basename, the key runtime-web's buildRegionTextures resolves each page texture by.
export const atlasImportPageSchema = z
  .object({ file: z.string().min(1), data: z.instanceof(Uint8Array) })
  .strict();

export type AtlasImportPage = z.infer<typeof atlasImportPageSchema>;

// file:save. The renderer sends an already-exported document (validated by document-core); the main
// process deep-validates it with @marionette/format before any disk write, then shows a save dialog
// (the renderer never supplies an arbitrary filesystem path, which is the path-injection defense). A
// user cancel is a normal outcome (status 'canceled'), not an IPC error. The document is opaque at the
// transport layer (z.unknown); the format validator in main is the real gate. `pages` carries the atlas
// page PNG bytes (empty when no atlas is loaded); main persists them next to the project so a later open
// can restore the textures (PP-D5) instead of falling back to placeholders.
export const fileSaveRequestSchema = z
  .object({ document: z.unknown(), pages: z.array(atlasImportPageSchema) })
  .strict();
export const fileSaveResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('saved'), path: z.string().min(1) }).strict(),
  z.object({ status: z.literal('canceled') }).strict(),
]);

export type FileSaveResponse = z.infer<typeof fileSaveResponseSchema>;

// file:open. No request payload; the main process shows an open dialog, reads and validates the file,
// and returns the parsed document (the renderer re-validates via loadDocument and mints internal ids).
// `pages` carries the atlas page PNG bytes read back from the project-relative textures directory (PP-D5),
// so the renderer restores the atlas textures on load instead of clearing to placeholders; it is empty
// when the project has no atlas or its textures directory is absent (a partial or missing set is fine).
export const fileOpenRequestSchema = z.undefined();
export const fileOpenResponseSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('opened'),
      name: z.string().min(1),
      document: z.unknown(),
      pages: z.array(atlasImportPageSchema),
    })
    .strict(),
  z.object({ status: z.literal('canceled') }).strict(),
]);

export type FileOpenResponse = z.infer<typeof fileOpenResponseSchema>;

// spine:import. No request payload; the main process shows the .json/.skel open dialog, runs the
// clean-room importer, and returns the converted document plus warnings, a typed failure, or a cancel.
// The warning/error shapes mirror @marionette/import-spine's typed diagnostics structurally (editor-shared
// stays a leaf that imports only Zod, never the importer package); the main process maps the importer's
// result into these shapes. `document` is opaque at the transport layer (z.unknown), exactly like
// file:open: the importer already validated it and the renderer re-validates via loadDocument (LAW 3).
export const spineImportWarningSchema = z
  .object({ feature: z.string().min(1), path: z.string(), why: z.string().min(1) })
  .strict();

export type SpineImportWarning = z.infer<typeof spineImportWarningSchema>;

export const spineImportErrorSchema = z
  .object({ code: z.string().min(1), path: z.string(), message: z.string().min(1) })
  .strict();

export type SpineImportError = z.infer<typeof spineImportErrorSchema>;

export const spineImportRequestSchema = z.undefined();
export const spineImportResponseSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('imported'),
      name: z.string().min(1),
      document: z.unknown(),
      warnings: z.array(spineImportWarningSchema),
    })
    .strict(),
  z
    .object({
      status: z.literal('failed'),
      errors: z.array(spineImportErrorSchema),
      warnings: z.array(spineImportWarningSchema),
    })
    .strict(),
  z.object({ status: z.literal('canceled') }).strict(),
]);

export type SpineImportResponse = z.infer<typeof spineImportResponseSchema>;

// atlas:import. No request payload (the renderer supplies NO filesystem path, the path-injection
// defense): the main process shows the directory dialog, runs the deterministic pack pipeline, reads the
// packed page PNGs back into bytes, and returns the packed AtlasRef plus those page bytes, or a canceled
// status if the user dismissed the dialog. The atlas is opaque at the transport layer (z.unknown), exactly
// like file:open's document: the main-process pipeline is the trusted producer of a typed AtlasRef, and the
// format validator re-checks it at export (LAW 3). `pages` carries the pixels the sandboxed renderer needs
// to build textures (it cannot read userData itself); it is always present on success (empty for an empty
// atlas).
export const atlasImportRequestSchema = z.undefined();
export const atlasImportResponseSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('imported'),
      atlas: z.unknown(),
      pages: z.array(atlasImportPageSchema),
    })
    .strict(),
  z.object({ status: z.literal('canceled') }).strict(),
]);

export type AtlasImportResponse = z.infer<typeof atlasImportResponseSchema>;

// atlas:importImages. The renderer sends one or more source images as raw bytes (a dropped or picked PNG);
// main stages them under an app-owned directory and runs the deterministic pack, returning the same packed
// AtlasRef + page bytes as atlas:import. Each `name` is the dropped file name; main treats it as untrusted
// (basename-confined at the staging boundary). The response reuses atlasImportResponseSchema.
export const atlasImportImagesRequestSchema = z
  .object({
    images: z.array(z.object({ name: z.string().min(1), data: z.instanceof(Uint8Array) }).strict()),
  })
  .strict();

export type AtlasImportImagesRequest = z.infer<typeof atlasImportImagesRequestSchema>;

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
  // Save an exported format document plus its atlas page bytes; main shows the dialog, writes the JSON,
  // and persists the pages next to it for later texture restore. Returns the written path or a canceled
  // status.
  saveDocument(
    document: unknown,
    pages: readonly AtlasImportPage[],
  ): Promise<IpcResult<FileSaveResponse>>;
  // Open a document; main shows the dialog, reads and validates the file. Returns the parsed document
  // or a canceled status.
  openDocument(): Promise<IpcResult<FileOpenResponse>>;
  // Import a directory of source sprites; main owns the directory dialog (no renderer path), packs the
  // atlas, and returns the packed AtlasRef or a canceled status.
  importAtlas(): Promise<IpcResult<AtlasImportResponse>>;
  // Import images the renderer read as bytes (drag-drop or a file-input picker); main stages and packs
  // them, returning the packed AtlasRef and page bytes.
  importAtlasImages(
    images: AtlasImportImagesRequest['images'],
  ): Promise<IpcResult<AtlasImportResponse>>;
  // Import a user-owned Spine project (.json or .skel); main owns the dialog, runs the clean-room
  // importer off the renderer document path, and returns the converted document plus warnings, a typed
  // failure, or a canceled status.
  importSpineProject(): Promise<IpcResult<SpineImportResponse>>;
  // Subscribe to application-menu clicks pushed from the main process (menu:action). The callback receives
  // one allowlisted MenuActionId per click; returns an unsubscribe function. This is the only MAIN ->
  // RENDERER push in the bridge; everything else is request/response.
  onMenuAction(callback: (action: MenuActionId) => void): () => void;
}
