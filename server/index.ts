import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './app';

const root = fileURLToPath(new URL('..', import.meta.url));
const production = process.argv.includes('--production');
const app = createApi();
const port = Number(process.env.PORT ?? 5173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT debe ser un puerto válido.');

if (production) {
  app.use(express.static(path.join(root, 'dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

const server = app.listen(port, process.env.HOST ?? '127.0.0.1', () => {
  console.log(`A salvo disponible en http://${process.env.HOST ?? '127.0.0.1'}:${port}`);
});
server.on('error', error => { console.error('No se pudo iniciar A salvo:', error.message); process.exitCode = 1; });
