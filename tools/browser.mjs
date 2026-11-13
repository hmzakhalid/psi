// A small headless-Chrome driver for the playtest and screenshot tools.
// It talks the DevTools protocol directly over node's built-in WebSocket, so there are no dependencies.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const GRID_W = 256, GRID_H = 144;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

const KEY_CODES = { KeyW: 87, KeyA: 65, KeyS: 83, KeyD: 68, KeyR: 82, KeyM: 77, KeyH: 72, KeyF: 70, Space: 32, Enter: 13, Escape: 27, BracketRight: 221 };

/** Serve the repository root over http on a free port. ES modules do not load from file://. */
export async function serve(root = ROOT) {
  const base = normalize(root.endsWith(sep) ? root : root + sep);
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = normalize(join(base, path === '/' ? 'index.html' : path));
    if (!file.startsWith(base)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() };
}

/** Launch headless Chrome and return helpers for driving the game with real input events. */
export async function launch({ width = 1280, height = 720 } = {}) {
  const binary = CHROME_CANDIDATES.find(p => p && existsSync(p));
  if (!binary) throw new Error('No Chrome found. Set CHROME_PATH to a Chrome or Chromium binary.');

  const profile = mkdtempSync(join(tmpdir(), 'psi-chrome-'));
  const port = 9300 + Math.floor(Math.random() * 600);
  const chrome = spawn(binary, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`, '--hide-scrollbars', '--mute-audio', '--no-first-run',
    '--autoplay-policy=no-user-gesture-required',
    // software GL, so the WebGL path runs on machines without a GPU
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    'about:blank',
  ], { stdio: 'ignore' });

  let socket = null;
  for (let attempt = 0; attempt < 60 && !socket; attempt++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = targets.find(t => t.type === 'page');
      if (page) {
        socket = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
      }
    } catch {
      await sleep(150);
    }
  }
  if (!socket) { chrome.kill(); throw new Error('Chrome did not open a debugging port.'); }

  const errors = [];
  const pending = new Map();
  let nextId = 0;
  socket.onmessage = message => {
    const data = JSON.parse(message.data);
    if (data.id && pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id); }
    if (data.method === 'Runtime.exceptionThrown') {
      const details = data.params.exceptionDetails;
      errors.push(`${details.text} ${details.exception?.description || ''}`.trim());
    }
    if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') {
      errors.push('console.error: ' + data.params.args.map(a => a.value ?? a.description).join(' '));
    }
    if (data.method === 'Log.entryAdded' && data.params.entry.level === 'error') {
      errors.push(`${data.params.entry.text} ${data.params.entry.url || ''}`.trim());
    }
  };
  const send = (method, params = {}) => new Promise(resolve => {
    const id = ++nextId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Log.enable');
  // an exact viewport, so the 16:9 stage fills screenshots edge to edge
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

  /** Evaluate an expression in the page and return its value. */
  async function evaluate(expression, { awaitPromise = false } = {}) {
    const reply = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (reply.result.exceptionDetails) throw new Error('evaluate failed: ' + JSON.stringify(reply.result.exceptionDetails));
    return reply.result.result.value;
  }

  let stage = { left: 0, top: 0, width, height };
  async function goto(url) {
    await send('Page.navigate', { url });
    for (let i = 0; i < 100; i++) {
      await sleep(100);
      const ready = await evaluate('typeof window.__psi === "object" && !!document.getElementById("stage")').catch(() => false);
      if (ready) break;
    }
    stage = await evaluate(`(() => { const r = document.getElementById('stage').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
  }

  // The game works in grid cells (256 x 144); these helpers take grid coordinates.
  const toPage = (gx, gy) => ({ x: stage.left + (gx / GRID_W) * stage.width, y: stage.top + (gy / GRID_H) * stage.height });
  const mouse = (type, gx, gy) => {
    const { x, y } = toPage(gx, gy);
    const pressed = type === 'mousePressed';
    return send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: pressed ? 1 : 0, clickCount: 1, pointerType: 'mouse' });
  };
  const key = (type, code) => send('Input.dispatchKeyEvent', {
    type, code, key: code.startsWith('Key') ? code.slice(3).toLowerCase() : code, windowsVirtualKeyCode: KEY_CODES[code] || 0,
  });

  async function screenshot(file) {
    const reply = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(reply.result.data, 'base64'));
  }

  async function close() {
    try { socket.close(); } catch { /* already closed */ }
    chrome.kill();
    await sleep(200);
    rmSync(profile, { recursive: true, force: true });
  }

  return {
    errors, evaluate, goto, screenshot, close,
    move: (gx, gy) => mouse('mouseMoved', gx, gy),
    press: (gx, gy) => mouse('mousePressed', gx, gy),
    release: (gx, gy) => mouse('mouseReleased', gx, gy),
    keyDown: code => key('keyDown', code),
    keyUp: code => key('keyUp', code),
  };
}
