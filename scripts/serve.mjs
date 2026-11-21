#!/usr/bin/env node
// Minimal static server for local development (no dependencies).
// Usage: node scripts/serve.mjs [port]
// Browsers expose the camera only on secure origins: http://localhost is fine,
// a LAN address is not. To try from a phone use GitHub Pages, an HTTPS tunnel
// or the PC bridge (bridge/server.mjs), which serves the app over HTTPS.
import { createServer } from 'node:http';
import { ROOT, staticHandler } from './static.mjs';

const port = Number(process.argv[2] || process.env.PORT || 8080);
createServer(staticHandler()).listen(port, () => console.log(`Gesto: http://localhost:${port}  (cartella ${ROOT})`));
