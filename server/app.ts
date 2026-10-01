import express, { type ErrorRequestHandler } from 'express';
import { checkSource } from './services';
import { mapRouter } from './maps';
import { geoRouter } from './geo';
import { reverseLocation, sourcesCheck } from './handlers';

export function createApi() {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });
  app.use('/api', express.json({ limit: '4kb' }));
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'a-salvo' }));

  let windowStarted = Date.now();
  let requests = 0;
  app.use('/api', (req, res, next) => {
    if (req.method !== 'POST') { next(); return; }
    const site = req.headers['sec-fetch-site'];
    if (site === 'cross-site') { res.status(403).json({ error: 'La consulta debe realizarse desde esta aplicación.' }); return; }
    if (Date.now() - windowStarted >= 60000) { windowStarted = Date.now(); requests = 0; }
    requests += 1;
    if (requests > 60) { res.setHeader('Retry-After', '60'); res.status(429).json({ error: 'Se han realizado demasiadas consultas. Espera un minuto e inténtalo de nuevo.' }); return; }
    next();
  });
  app.post('/api/sources/check', async (req, res) => { const r = await sourcesCheck(req.body, checkSource); res.status(r.status).json(r.body); });
  app.post('/api/location', async (req, res) => {
    const r = await reverseLocation(req.body);
    if (r.status === 502) console.warn('No se pudo completar una consulta de CartoCiudad.');
    res.status(r.status).json(r.body);
  });
  app.use('/api/maps', mapRouter());
  app.use('/api/geo', geoRouter());
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Servicio no encontrado.' }));
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    const status = typeof error.status === 'number' && error.status >= 400 && error.status < 500 ? error.status : 500;
    if (status === 500) console.error('Error interno en la API de A salvo:', error instanceof Error ? error.message : 'Error desconocido');
    res.status(status).json({ error: status < 500 ? 'El cuerpo de la solicitud no es válido o supera el tamaño permitido.' : 'El servicio no ha podido completar la solicitud.' });
  };
  app.use(errorHandler);
  return app;
}
