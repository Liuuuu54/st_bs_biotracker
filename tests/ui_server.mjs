// 迷你静态服务器：为 tests/ui-harness.html 提供 ES module 加载环境。
// 用法：node tests/ui_server.mjs [port]，默认 8017。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const PORT = Number(process.argv[2]) || 8017;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const relative = urlPath === '/' ? '/tests/ui-harness.html' : urlPath;
    const filePath = normalize(join(ROOT, relative));
    if (!filePath.startsWith(ROOT)) throw new Error('outside root');
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
}).on('error', (error) => {
  // 端口被占用多半是另一个 harness（例如编辑器的预览）已经在跑：直接用它，或换个端口
  if (error.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用：harness 可能已在 http://localhost:${PORT}/ 运行。`);
    console.error(`要另开一个，请指定其他端口，例如：node tests/ui_server.mjs ${PORT + 1}`);
    process.exit(1);
  }
  throw error;
}).listen(PORT, () => {
  console.log(`BioTracker UI harness: http://localhost:${PORT}/`);
});
