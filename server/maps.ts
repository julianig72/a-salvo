import { Router, type Response } from 'express';
import { isValidBbox } from '../shared/map-math';
import { FWI_METHODOLOGY, buildMapUrl, fetchFwi, isCurrentMapDate, isLayer, readBody } from './maps-core';
import { mapCatalog, mapLocation, mapPoint, type ApiResult } from './handlers';
import { validCoordinates } from './services';

export * from './maps-core';

const IMAGE_LIMIT = 5 * 1024 * 1024;
let activeImages = 0;
const imageCache = new Map<string, { bytes: Buffer; createdAt: number }>();
const send = (res: Response, result: ApiResult) => { res.status(result.status).json(result.body); };

export function mapRouter() {
  const router = Router();
  router.post('/location', async (req, res) => send(res, await mapLocation(req.body)));
  router.get('/catalog', async (_req, res) => send(res, await mapCatalog()));
  router.get('/fwi', async (req, res) => {
    const lat = Number(req.query.lat); const lon = Number(req.query.lon); const date = req.query.date;
    if (!validCoordinates(lat, lon) || !isCurrentMapDate(date)) { res.status(400).json({ error: 'Coordenadas o fecha de validez incorrectas. Actualiza el mapa.' }); return; }
    try { res.json({ values: await fetchFwi(lat, lon, date), date, lat, lon, resolutionKm: 8, sourceUrl: FWI_METHODOLOGY }); }
    catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : 'Sin datos FWI para este punto.' }); }
  });
  router.post('/point', async (req, res) => send(res, await mapPoint(req.body)));
  router.get(['/image', '/legend'], async (req, res) => {
    const id = req.query.layer;
    const legend = req.path === '/legend';
    const bbox = legend ? '-70000,4750000,-10000,4810000' : req.query.bbox;
    const width = legend ? 256 : Number(req.query.width);
    const height = legend ? 256 : Number(req.query.height);
    if (!isLayer(id) || !isValidBbox(bbox) || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 1200 || height > 1200
      || (id === 'fire' && !isCurrentMapDate(req.query.date))) {
      res.status(400).json({ error: 'Capa, encuadre, tamaño o fecha no permitidos.' }); return;
    }
    const date = typeof req.query.date === 'string' ? req.query.date : undefined;
    const url = buildMapUrl(id, bbox, width, height, date, legend);
    const cached = imageCache.get(url.href);
    if (cached && Date.now() - cached.createdAt < 900000) {
      res.setHeader('Cache-Control', 'private, max-age=300'); res.type('image/png').send(cached.bytes); return;
    }
    if (activeImages >= 12) { res.setHeader('Retry-After', '5'); res.status(503).json({ error: 'El servicio cartográfico está ocupado. Reintenta la capa.' }); return; }
    activeImages += 1;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(14000), redirect: 'error', headers: { Accept: 'image/png' } });
      if (!response.ok) throw new Error(`El organismo cartográfico devuelve HTTP ${response.status}.`);
      if (!(response.headers.get('content-type') ?? '').includes('image/png')) { await response.body?.cancel(); throw new Error('El organismo no ha devuelto una imagen PNG. No se mostrará como una zona sin peligro.'); }
      const bytes = Buffer.from(await readBody(response, IMAGE_LIMIT));
      if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('La imagen oficial no tiene una firma PNG válida.');
      if (!legend && (bytes.readUInt32BE(16) !== width || bytes.readUInt32BE(20) !== height)) throw new Error('La imagen oficial no tiene las dimensiones solicitadas.');
      if (imageCache.size >= 40) imageCache.delete(imageCache.keys().next().value!);
      imageCache.set(url.href, { bytes, createdAt: Date.now() });
      res.setHeader('Cache-Control', 'private, max-age=300'); res.type('image/png').send(bytes);
    } catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : 'No se ha podido representar la capa oficial.' }); }
    finally { activeImages -= 1; }
  });
  return router;
}
