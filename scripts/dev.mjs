import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)), 'app');
const port = Number(process.env.PORT ?? 4173);
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};
createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end();
      return;
    }
    const path = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const directory = root;
    const filename = resolve(directory, path === '/' ? 'index.html' : path.slice(1));
    if (!filename.startsWith(directory + sep) || !mime[extname(filename)]) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const data = await readFile(filename);
    res.writeHead(200, {
      'Content-Type': `${mime[extname(filename)]}; charset=utf-8`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Trackmark: http://127.0.0.1:${port}/`));
