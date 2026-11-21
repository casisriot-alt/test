#!/usr/bin/env node
// Gesto PC bridge: control the computer with the gestures seen by the phone.
//
//   node bridge/server.mjs [--port 8443] [--map mappa.json] [--dry-run]
//
// It serves the Gesto app over HTTPS on the local network (the camera needs a
// secure page) and receives the gestures over a WebSocket, protected by a
// random token that is part of the address printed at startup. Each gesture is
// turned into a key press: arrows for slides, space for videos, volume, …
// No dependencies; the HTTPS certificate is self-signed (created with openssl).

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { staticHandler } from '../scripts/static.mjs';
import { DEFAULT_MAP, KEYS, REPEATABLE, createKeySender } from './keys.mjs';
import { acceptUpgrade } from './websocket.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const port = Number(opt('port', process.env.PORT || 8443));
const dryRun = args.includes('--dry-run');
const token = opt('token', process.env.GESTO_TOKEN || randomBytes(6).toString('hex'));
const here = fileURLToPath(new URL('.', import.meta.url));

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Uso: node bridge/server.mjs [--port 8443] [--map mappa.json] [--dry-run] [--token xyz]

Mappa predefinita (gesto → tasto):
${Object.entries(DEFAULT_MAP).map(([g, k]) => `  ${g.padEnd(16)} → ${k}`).join('\n')}

Tasti disponibili: ${Object.keys(KEYS).join(', ')}`);
  process.exit(0);
}

// ---------------------------------------------------------------- mapping
let map = { ...DEFAULT_MAP };
const mapFile = opt('map');
if (mapFile) {
  const custom = JSON.parse(readFileSync(mapFile, 'utf8'));
  for (const [gesture, key] of Object.entries(custom)) {
    if (key && !KEYS[key]) throw new Error(`Tasto sconosciuto "${key}" per ${gesture}. Validi: ${Object.keys(KEYS).join(', ')}`);
  }
  map = { ...map, ...custom };
}

// ---------------------------------------------------------------- certificate
function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
}

function certificate() {
  const dir = join(here, '.cert');
  const key = join(dir, 'key.pem');
  const cert = join(dir, 'cert.pem');
  if (!existsSync(key) || !existsSync(cert)) {
    mkdirSync(dir, { recursive: true });
    const san = ['DNS:localhost', 'IP:127.0.0.1', ...lanAddresses().map((ip) => `IP:${ip}`)].join(',');
    try {
      execFileSync('openssl', [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '825',
        '-keyout', key, '-out', cert, '-subj', '/CN=Gesto bridge', '-addext', `subjectAltName=${san}`,
      ], { stdio: 'ignore' });
    } catch {
      console.error('Serve "openssl" per creare il certificato HTTPS (su Windows è incluso in Git for Windows).');
      console.error(`In alternativa metti key.pem e cert.pem in ${dir}`);
      process.exit(1);
    }
  }
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

// ---------------------------------------------------------------- server
const sender = createKeySender({ dryRun });
const serveStatic = staticHandler();
const server = createServer(certificate(), (req, res) => {
  if (req.url.startsWith('/gesto')) {
    res.writeHead(426, { 'Content-Type': 'text/plain' });
    return res.end('WebSocket only');
  }
  serveStatic(req, res);
});

let lastFire = new Map();
server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'https://localhost');
  if (url.pathname !== '/gesto' || url.searchParams.get('token') !== token) {
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }
  const ws = acceptUpgrade(req, socket);
  if (!ws) return;
  const who = req.socket.remoteAddress;
  console.log(`📱 Telefono collegato (${who})`);
  ws.send(JSON.stringify({ type: 'hello', host: hostname(), platform: sender.platform, pointer: false }));
  ws.on('message', (text) => {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.type !== 'gesture' || typeof msg.id !== 'string') return;
    const key = map[msg.id];
    if (!key || !KEYS[key]) return;
    if (msg.repeat && !REPEATABLE.has(key)) return;
    // Safety net against floods: at most one key per 150 ms per gesture.
    const now = Date.now();
    if (now - (lastFire.get(msg.id) ?? 0) < 150) return;
    lastFire.set(msg.id, now);
    console.log(`✋ ${msg.id.padEnd(16)} → ${key}`);
    sender.press(key);
    ws.send(JSON.stringify({ type: 'ack', id: msg.id, key }));
  });
  ws.on('close', () => console.log(`📴 Telefono scollegato (${who})`));
});

server.listen(port, () => {
  const ips = lanAddresses();
  console.log(`\n✋ Gesto — ponte PC attivo (${sender.platform})${dryRun ? ' — modalità prova' : ''}\n`);
  console.log('Apri sul telefono (stessa rete Wi-Fi):');
  for (const ip of ips.length ? ips : ['localhost']) console.log(`   https://${ip}:${port}/?bridge=${token}`);
  console.log('\nIl certificato è autofirmato: il browser mostrerà un avviso, scegli "Avanzate → Procedi".');
  console.log('Mappa attiva:');
  for (const [g, k] of Object.entries(map)) if (k) console.log(`   ${g.padEnd(16)} → ${k}`);
  console.log('\nCtrl+C per chiudere.\n');
});

process.on('SIGINT', () => {
  sender.close();
  process.exit(0);
});
