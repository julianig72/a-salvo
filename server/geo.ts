import { Router, type Response } from 'express';
import { addresses, municipalities, resolve, type ApiResult } from './handlers';

export * from './geo-core';

const send = (res: Response, result: ApiResult) => { res.status(result.status).json(result.body); };

export function geoRouter() {
  const router = Router();
  let windowStarted = Date.now();
  let lookups = 0;
  router.use((req, res, next) => {
    if (req.headers['sec-fetch-site'] === 'cross-site') { res.status(403).json({ error: 'La consulta debe realizarse desde esta aplicación.' }); return; }
    next();
  });
  const limited = (res: Response) => {
    if (Date.now() - windowStarted >= 60000) { windowStarted = Date.now(); lookups = 0; }
    lookups += 1;
    if (lookups <= 240) return false;
    res.setHeader('Retry-After', '60');
    res.status(429).json({ error: 'Demasiadas búsquedas de direcciones. Espera un minuto.' });
    return true;
  };

  router.get('/municipalities', (req, res) => {
    const result = municipalities(req.query.q, req.query.province);
    if (result.status === 200) res.setHeader('Cache-Control', 'public, max-age=86400');
    send(res, result);
  });
  router.get('/addresses', async (req, res) => {
    if (limited(res)) return;
    send(res, await addresses(req.query.q, req.query.municipality));
  });
  router.post('/addresses/resolve', async (req, res) => {
    if (limited(res)) return;
    send(res, await resolve(req.body));
  });
  return router;
}
