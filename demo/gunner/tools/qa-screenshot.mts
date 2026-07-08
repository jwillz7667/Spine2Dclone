import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Headless QA screenshots of the built player via raw CDP (no puppeteer; Node's native WebSocket).
// Chrome's --virtual-time-budget fast-forwards past background-thread image decodes, so this driver
// keeps Chrome alive in REAL time: navigate with ?t=NN&noaudio=1, poll document.title until the
// player reports qa-rendered, then Page.captureScreenshot.
//
// Usage: tsx qa-screenshot.mts <outDir> <t1> <t2> ...

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9377;

const outDir = process.argv[2] ?? join(root, 'renders', 'player-qa');
const times = process.argv.slice(3).map(Number);
if (times.length === 0) throw new Error('usage: qa-screenshot.mts <outDir> <t1> <t2> ...');
mkdirSync(outDir, { recursive: true });

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    `--remote-debugging-port=${PORT}`,
    '--window-size=1920,1080',
    '--hide-scrollbars',
    '--user-data-dir=/tmp/gunner-qa-chrome',
    'about:blank',
  ],
  { stdio: 'ignore' },
);
process.on('exit', () => chrome.kill());

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitForEndpoint(): Promise<string> {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      const targets = (await res.json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
      const page = targets.find((t) => t.type === 'page');
      if (page !== undefined) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error('chrome debug endpoint never came up');
}

const wsUrl = await waitForEndpoint();
const ws = new WebSocket(wsUrl);
await new Promise<void>((resolve, reject) => {
  ws.onopen = () => resolve();
  ws.onerror = (e) => reject(new Error(String(e)));
});

let nextId = 1;
const pending = new Map<number, (v: Record<string, unknown>) => void>();
ws.onmessage = (ev) => {
  const msg = JSON.parse(String(ev.data)) as { id?: number; result?: Record<string, unknown> };
  if (msg.id !== undefined && pending.has(msg.id)) {
    pending.get(msg.id)!(msg.result ?? {});
    pending.delete(msg.id);
  }
};
function cdp(
  method: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const id = nextId;
  nextId += 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pending.set(id, resolve));
}

async function evalJs(expr: string): Promise<unknown> {
  const res = (await cdp('Runtime.evaluate', { expression: expr, returnByValue: true })) as {
    result?: { value?: unknown };
  };
  return res.result?.value;
}

await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', {
  width: 1920,
  height: 1080,
  deviceScaleFactor: 1,
  mobile: false,
});

const playerUrl = `file://${join(root, 'player', 'index.html')}`;
let loaded = false;
for (const t of times) {
  if (!loaded) {
    await cdp('Page.navigate', { url: `${playerUrl}?t=${t}&noaudio=1` });
    // wait for the player to finish booting and render the QA frame (real time)
    for (let i = 0; i < 240; i += 1) {
      const title = (await evalJs('document.title')) as string;
      if (title === 'qa-rendered') break;
      if (typeof title === 'string' && title.startsWith('ERR:')) throw new Error(title);
      await sleep(500);
    }
    loaded = true;
  } else {
    // subsequent frames: seek in-page through the QA hook exposed via location change is a reload;
    // cheaper: call the seek hook directly
    await evalJs(`window.__gunnerSeek && window.__gunnerSeek(${t})`);
    await sleep(400);
  }
  const shot = (await cdp('Page.captureScreenshot', { format: 'png' })) as { data?: string };
  if (shot.data === undefined) throw new Error(`no screenshot at t=${t}`);
  writeFileSync(
    join(outDir, `t${String(t).padStart(3, '0')}.png`),
    Buffer.from(shot.data, 'base64'),
  );
  console.log(`captured t=${t}`);
}

ws.close();
chrome.kill();
console.log(`done -> ${outDir}`);
