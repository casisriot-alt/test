// Tiny static file handler shared by the dev server and the PC bridge.
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.md': 'text/plain; charset=utf-8',
};

/** Returns a request handler serving the files under `root`. */
export function staticHandler(root = ROOT) {
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
      let file = join(root, path);
      if (!file.startsWith(root) || /(^|[/\\])\./.test(path)) throw Object.assign(new Error('forbidden'), { code: 'EACCES' });
      const info = await stat(file).catch(() => null);
      if (info?.isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch (err) {
      res.writeHead(err.code === 'EACCES' ? 403 : 404, { 'Content-Type': 'text/plain' });
      res.end(err.code === 'EACCES' ? 'Forbidden' : 'Not found');
    }
  };
}
