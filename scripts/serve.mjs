import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPlacesWithAlbums } from './albums.mjs';
import { publicPlaces, publicWishlist, referencedFiles, isPublicStatic, publicFile } from './public-site.mjs';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.geojson': 'application/geo+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8' };
export function createPreviewServer({ root = defaultRoot, base = '' } = {}) {
  return http.createServer(async (request, response) => {
    const reply = (status, body = '') => { response.writeHead(status); response.end(request.method === 'HEAD' ? undefined : body); };
    try {
      const origins = ['127.0.0.1', 'localhost'].map(host => `http://${host}:${request.socket.localPort}`);
      if (!origins.includes(`http://${request.headers.host}`) || request.headers.origin && !origins.includes(request.headers.origin) || request.headers['sec-fetch-site'] === 'cross-site') { reply(403, 'Forbidden'); return; }
      if (!['GET', 'HEAD'].includes(request.method)) { reply(405); return; }
      let pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (base && !pathname.startsWith(`${base}/`)) { reply(404, 'Not found'); return; }
      if (base) pathname = pathname.slice(base.length);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const relative = pathname.slice(1);
      if (pathname.includes('\\') || relative.split('/').some(p => !p || p.startsWith('.'))) { reply(403, 'Forbidden'); return; }
      let data;
      if (relative === 'data/places.geojson') {
        await publicFile(root, relative); await publicFile(root, 'data/photo-albums.json');
        data = JSON.stringify(publicPlaces(await loadPlacesWithAlbums(root)));
      } else if (relative === 'data/wishlist.json') {
        data = JSON.stringify(publicWishlist(JSON.parse(await fs.readFile(await publicFile(root, relative), 'utf8'))));
      } else {
        const media = /^(?:photos|stories)\//.test(relative);
        if (!isPublicStatic(relative) && !(media && referencedFiles(await loadPlacesWithAlbums(root)).has(relative))) { reply(403, 'Forbidden'); return; }
        data = await fs.readFile(await publicFile(root, relative));
      }
      response.writeHead(200, { 'Content-Type': types[path.extname(relative)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch { reply(404, 'Not found'); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 4173), base = process.env.PREVIEW_BASE || '';
  const server = createPreviewServer({ base });
  server.listen(port, '127.0.0.1', () => console.log(`Travel Footprints: http://127.0.0.1:${server.address().port}${base}/`));
}
