import { unzipSync } from 'fflate';
import { decodePng } from './atlas';
import {
  joinLayerName,
  LayeredParseError,
  type LayeredDiagnostic,
  type LayeredDocument,
  type RasterLayer,
} from './layered-types';

// OpenRaster (.ora) adapter for the layered-file import (PP-D5). An ORA is a zip of PNGs plus a stack.xml
// describing the layer tree, so it is parsed with fflate (MIT, pure JS, no native binaries) plus our
// existing pure-JS PNG decoder. Groups flatten with path-joined names; each layer keeps its x/y offset and
// visibility. It is a pure function of the file bytes (no filesystem, no Electron), so it is unit testable
// headless. A structural failure (not a zip, no stack.xml, unparseable stack) throws a typed
// LayeredParseError; a per-layer problem (a src that is absent or not a PNG) is a typed diagnostic and the
// layer is skipped. Import only; nothing here ever writes an ORA.

export function parseOra(bytes: Uint8Array, name: string): LayeredDocument {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch (cause) {
    throw new LayeredParseError('ORA_NOT_A_ZIP', 'the ORA file is not a readable zip archive', {
      cause,
    });
  }

  const stackBytes = files['stack.xml'];
  if (stackBytes === undefined) {
    throw new LayeredParseError('ORA_NO_STACK', 'the ORA archive has no stack.xml');
  }

  const root = parseXml(new TextDecoder().decode(stackBytes));
  if (root === null || root.tag !== 'image') {
    throw new LayeredParseError('ORA_BAD_STACK', 'stack.xml has no <image> root element');
  }

  const canvasWidth = intAttr(root, 'w', 0);
  const canvasHeight = intAttr(root, 'h', 0);
  const stack = root.children.find((child) => child.tag === 'stack');
  const diagnostics: LayeredDiagnostic[] = [];
  const layers: RasterLayer[] = [];
  if (stack !== undefined) {
    collect(stack, '', files, layers, diagnostics);
  }

  if (layers.length === 0) {
    diagnostics.push({
      feature: 'no-layers',
      layer: '',
      why: 'the ORA contained no usable raster layers',
    });
  }

  return { name, canvasWidth, canvasHeight, layers, diagnostics };
}

// Walk a <stack> element's children IN ORDER (OpenRaster stores top-first). A nested <stack> recurses with
// its name joined onto the prefix; a <layer> is decoded from its `src` PNG at its x/y offset.
function collect(
  stack: XmlElement,
  prefix: string,
  files: Record<string, Uint8Array>,
  out: RasterLayer[],
  diagnostics: LayeredDiagnostic[],
): void {
  for (const child of stack.children) {
    if (child.tag === 'stack') {
      collect(child, joinLayerName(prefix, child.attrs['name']), files, out, diagnostics);
      continue;
    }
    if (child.tag !== 'layer') continue;
    const layer = toRasterLayer(child, prefix, files, diagnostics);
    if (layer !== null) out.push(layer);
  }
}

function toRasterLayer(
  element: XmlElement,
  prefix: string,
  files: Record<string, Uint8Array>,
  diagnostics: LayeredDiagnostic[],
): RasterLayer | null {
  const src = element.attrs['src'];
  const name = joinLayerName(
    prefix,
    element.attrs['name'] ?? (src !== undefined ? baseName(src) : undefined),
  );
  const bytes = src !== undefined ? files[src] : undefined;
  if (bytes === undefined) {
    diagnostics.push({
      feature: 'ora-missing-src',
      layer: name,
      why: `layer src "${src ?? '(none)'}" is not present in the archive; skipped`,
    });
    return null;
  }
  let decoded: { width: number; height: number; rgba: Uint8Array };
  try {
    decoded = decodePng(bytes);
  } catch {
    diagnostics.push({
      feature: 'ora-missing-src',
      layer: name,
      why: `layer src "${src ?? ''}" is not a decodable PNG; skipped`,
    });
    return null;
  }
  if (decoded.width < 1 || decoded.height < 1) {
    diagnostics.push({
      feature: 'empty-layer',
      layer: name,
      why: 'zero-area layer bitmap; skipped',
    });
    return null;
  }
  return {
    name,
    left: intAttr(element, 'x', 0),
    top: intAttr(element, 'y', 0),
    width: decoded.width,
    height: decoded.height,
    rgba: new Uint8Array(decoded.rgba),
    // OpenRaster visibility is "visible" | "hidden"; absent means visible.
    visible: (element.attrs['visibility'] ?? 'visible') !== 'hidden',
  };
}

function baseName(src: string): string {
  const slash = src.lastIndexOf('/');
  const file = slash >= 0 ? src.slice(slash + 1) : src;
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
}

function intAttr(element: XmlElement, attr: string, fallback: number): number {
  const raw = element.attrs[attr];
  if (raw === undefined) return fallback;
  const parsed = Math.trunc(Number(raw));
  return Number.isFinite(parsed) ? parsed : fallback;
}

// A minimal XML element tree for the OpenRaster stack.xml subset (image / stack / layer with attributes).
interface XmlElement {
  readonly tag: string;
  readonly attrs: Record<string, string>;
  readonly children: XmlElement[];
}

// A small dependency-free XML reader sufficient for stack.xml: it understands the declaration, comments,
// self-closing and nested elements, and double/single-quoted attributes; it ignores text and CDATA (the ORA
// stack carries none between structural elements). It returns the root element, or null when none is found.
// It is intentionally narrow (no entities beyond the common five, no namespaces) because stack.xml is a
// tightly specified, machine-generated document, not arbitrary XML.
function parseXml(text: string): XmlElement | null {
  let i = 0;
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;

  const skipUntil = (marker: string): void => {
    const at = text.indexOf(marker, i);
    i = at < 0 ? text.length : at + marker.length;
  };

  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    i = lt + 1;

    if (text.startsWith('?', i)) {
      skipUntil('?>');
      continue;
    }
    if (text.startsWith('!--', i)) {
      skipUntil('-->');
      continue;
    }
    if (text.startsWith('!', i)) {
      skipUntil('>');
      continue;
    }

    if (text.startsWith('/', i)) {
      // Closing tag: pop the current element.
      skipUntil('>');
      const closed = stack.pop();
      if (closed !== undefined && stack.length === 0) root = closed;
      continue;
    }

    const end = findTagEnd(text, i);
    if (end < 0) break;
    const selfClosing = text[end - 1] === '/';
    const inner = text.slice(i, selfClosing ? end - 1 : end).trim();
    i = end + 1;

    const element = parseTag(inner);
    const parent = stack[stack.length - 1];
    if (parent !== undefined) parent.children.push(element);
    if (selfClosing) {
      if (stack.length === 0) root = element;
    } else {
      stack.push(element);
    }
  }

  return root ?? stack[0] ?? null;
}

// Find the index of the '>' that closes a start tag beginning at `from`, skipping any '>' inside a quoted
// attribute value.
function findTagEnd(text: string, from: number): number {
  let quote: string | null = null;
  for (let j = from; j < text.length; j += 1) {
    const ch = text[j];
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '>') return j;
  }
  return -1;
}

// Parse a start-tag body ("tag a=\"1\" b='2'") into an element with its attributes.
function parseTag(inner: string): XmlElement {
  const match = /^([^\s/]+)\s*(.*)$/s.exec(inner);
  const tag = match?.[1] ?? '';
  const rest = match?.[2] ?? '';
  const attrs: Record<string, string> = {};
  const attrPattern = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let attr: RegExpExecArray | null;
  while ((attr = attrPattern.exec(rest)) !== null) {
    const key = attr[1];
    if (key === undefined) continue;
    attrs[key] = decodeEntities(attr[3] ?? attr[4] ?? '');
  }
  return { tag, attrs, children: [] };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
