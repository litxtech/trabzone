import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.env.ROOT_DIR || 'dist');
const port = Number(process.argv[2] || 4175);

const routes = {
  '/about': '/seo/about.html',
  '/contact': '/seo/contact.html',
  '/support': '/seo/support.html',
  '/terms': '/seo/terms.html',
  '/privacy': '/seo/privacy.html',
  '/kvkk': '/seo/kvkk.html',
  '/data-protection': '/seo/data-protection.html',
  '/cookies': '/seo/cookies.html',
  '/child-safety': '/seo/child-safety.html',
  '/community-guidelines': '/seo/community-guidelines.html',
  '/delete-account': '/seo/delete-account.html',
  '/data-requests': '/seo/data-requests.html',
  '/policy/marketplace-rules': '/seo/marketplace-rules.html',
  '/policy/real-estate-rules': '/seo/real-estate-rules.html',
  '/policy/vehicle-rules': '/seo/vehicle-rules.html',
};

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);
  pathname = routes[pathname] || pathname;
  if (pathname === '/') pathname = '/index.html';

  const filePath = path.join(root, pathname);
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) {
      return serve(path.join(filePath, 'index.html'), res);
    }
    return serve(filePath, res);
  } catch {
    // SPA fallback
    return serve(path.join(root, 'index.html'), res, 200);
  }
});

async function serve(filePath, res, status = 200) {
  try {
    const body = await readFile(filePath);
    res.writeHead(status, {
      'Content-Type': types[path.extname(filePath)] || 'application/octet-stream',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
}

server.listen(port, () => console.log(`local rewrite server: http://localhost:${port}`));
