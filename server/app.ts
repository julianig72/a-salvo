import express, { type ErrorRequestHandler } from 'express';
import { generalSources, getSources } from '../shared/sources';
import { getRegion, regions } from '../shared/regions';
import { riskAdvice } from '../shared/advice';
import type { RiskId } from '../shared/types';
import { checkSource, lookupLocation, validCoordinates } from './services';
import { mapRouter } from './maps';
import { geoRouter, matchMunicipality } from './geo';

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
  app.post('/api/sources/check', async (req, res) => {
    const body: unknown = req.body;
    if (!body || typeof body !== 'object') { res.status(400).json({ error: 'Indica una ubicación y los escenarios.' }); return; }
    const { provinceCode, regionId, risks, extra = [] } = body as Record<string, unknown>;
    const region = typeof provinceCode === 'string' ? getRegion(provinceCode) : regions.find(r => r.id === regionId);
    const isRisk = (value: unknown): value is RiskId => typeof value === 'string' && riskAdvice.some(r => r.id === value);
    if (!region || !Array.isArray(risks) || risks.length < 1 || risks.length > 3 || !risks.every(isRisk) || new Set(risks).size !== risks.length) {
      res.status(400).json({ error: 'La ubicación o los escenarios no son válidos.' }); return;
    }
    if (!Array.isArray(extra) || extra.length > Object.keys(generalSources).length || !extra.every(id => typeof id === 'string' && Object.hasOwn(generalSources, id))) {
      res.status(400).json({ error: 'Las fuentes solicitadas no son válidas.' }); return;
    }
    const sources = getSources(region.id, risks, extra as string[]);
    const checks = await Promise.all(sources.map(checkSource));
    res.json({ checks, contentMode: 'editorial', cacheMinutes: 15 });
  });
  app.post('/api/location', async (req, res) => {
    const body: unknown = req.body;
    if (!body || typeof body !== 'object') { res.status(400).json({ error: 'Las coordenadas no son válidas.' }); return; }
    const { lat, lon } = body as Record<string, unknown>;
    if (!validCoordinates(lat, lon) || typeof lon !== 'number') { res.status(400).json({ error: 'La cobertura de esta aplicación es España. Introduce tu municipio y provincia manualmente.' }); return; }
    try {
      const found = await lookupLocation(lat, lon);
      res.json({ ...found, municipalityCode: matchMunicipality(found.municipality, found.provinceCode)?.code ?? '' });
    }
    catch (error) {
      console.warn('No se pudo completar una consulta de CartoCiudad.');
      const timeout = error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name);
      res.status(502).json({ error: timeout ? 'CartoCiudad no ha respondido a tiempo.' : error instanceof Error ? error.message : 'No se pudo consultar CartoCiudad.' });
    }
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
