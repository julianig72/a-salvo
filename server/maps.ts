import { Router } from 'express';
import { isValidBbox, project } from '../shared/map-math';
import { getRegion } from '../shared/regions';
import { SEISMIC_SOURCE_URL } from '../shared/seismic';
import type { FloodPointResult, MapCatalog, MapLayerId, MapLayerInfo, SeismicPointResult } from '../shared/types';
import { findMunicipality, municipalityCenter, validCoordinates } from './services';
import { getMunicipality } from './geo';

const config = {
  base: { url: 'https://www.ign.es/wms-inspire/ign-base', layer: 'IGNBaseTodo', version: '1.3.0' },
  flood100: { url: 'https://gis.miteco.gob.es/geoserver/agua/wms', layer: 'Zi_laminas_q100', version: '1.3.0' },
  flood500: { url: 'https://gis.miteco.gob.es/geoserver/agua/wms', layer: 'Zi_laminas_q500', version: '1.3.0' },
  fire: { url: 'https://maps.effis.emergency.copernicus.eu/gwis', layer: 'ecmwf.fwi', version: '1.1.1' },
  seismic: { url: 'https://www.ign.es/wms-inspire/geofisica', layer: 'HazardArea2015.Int475', version: '1.3.0' },
} satisfies Record<MapLayerId, { url: string; layer: string; version: string }>;
const SEISMIC_PGA_LAYER = 'HazardArea2015.PGA475_p';

const methodology = 'https://forest-fire.emergency.copernicus.eu/about-effis/technical-background/fire-danger-forecast';
const floodSource = 'https://www.miteco.gob.es/es/agua/temas/gestion-de-los-riesgos-de-inundacion/snczi.html';
const IMAGE_LIMIT = 5 * 1024 * 1024;
let catalogCache: MapCatalog | undefined;
let catalogPending: Promise<MapCatalog> | undefined;
let activeImages = 0;
const imageCache = new Map<string, { bytes: Buffer; createdAt: number }>();

export function parseFwiResponse(html: string) {
  const values: Record<string, number> = {};
  for (const code of ['FWI', 'ISI', 'BUI', 'FFMC', 'DMC', 'DC']) {
    const match = html.match(new RegExp(`\\(${code}\\)\\s*</td>\\s*<td>\\s*([0-9]+(?:\\.[0-9]+)?)\\s*</td>`, 'i'));
    if (!match) throw new Error('EFFIS no ha devuelto todos los índices para este punto y fecha. Puede no haber cobertura.');
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value < 0) throw new Error('EFFIS ha devuelto un índice no válido.');
    values[code] = value;
  }
  return values;
}

export function isCurrentMapDate(date: unknown): date is string {
  return typeof date === 'string' && date === new Date().toISOString().slice(0, 10);
}

async function readBody(response: Response, limit: number) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('El organismo ha devuelto una respuesta vacía.');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.length;
      if (total > limit) throw new Error('La respuesta cartográfica supera el tamaño permitido.');
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}

async function fetchFwi(lat: number, lon: number, date: string) {
  const [x, y] = project(lat, lon);
  const url = new URL(config.fire.url);
  const query = {
    SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetFeatureInfo', LAYERS: 'ecmwf.query', QUERY_LAYERS: 'ecmwf.query',
    STYLES: '', SRS: 'EPSG:3857', BBOX: [x - 5000, y - 5000, x + 5000, y + 5000].join(','),
    WIDTH: '256', HEIGHT: '256', FORMAT: 'image/png', INFO_FORMAT: 'text/html', X: '128', Y: '128', TIME: date,
  };
  url.search = new URLSearchParams(query).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!response.ok) throw new Error(`EFFIS no permite la consulta (HTTP ${response.status}).`);
  const body = await readBody(response, 100000);
  return parseFwiResponse(body.toString('utf8'));
}

export function fwiClass(value: number) {
  if (value < 11.2) return 'Bajo';
  if (value < 21.3) return 'Moderado';
  if (value < 38) return 'Alto';
  if (value < 50) return 'Muy alto';
  if (value < 70) return 'Extremo';
  return 'Muy extremo';
}

/** Parses GeoServer `text/plain` GetFeatureInfo (no geometry, unlike JSON responses that can weigh megabytes). */
export function parseFloodInfo(body: string): FloodPointResult {
  if (/no features were found/i.test(body)) return { status: 'outside' };
  if (!/Results for FeatureType/i.test(body)) throw new Error('El SNCZI no ha devuelto una respuesta reconocible.');
  const fields = new Map<string, string>();
  for (const line of body.split(/\r?\n/)) {
    const match = /^([a-z_]+) = (.*)$/i.exec(line.trim());
    if (match && !fields.has(match[1])) fields.set(match[1], match[2].trim());
  }
  const clean = (value?: string) => value && !value.startsWith('[') ? value.slice(0, 160) : undefined;
  const approved = fields.get('fecha_apro')?.match(/^(\d{4})-\d{2}-\d{2}/)?.[1];
  return { status: 'inside', zone: clean(fields.get('id_zona')), river: clean(fields.get('rio')), study: clean(fields.get('tipo_est') ?? fields.get('estudio')), approved };
}

function featureInfoUrl(base: string, layer: string, lat: number, lon: number) {
  const [x, y] = project(lat, lon);
  const url = new URL(base);
  url.search = new URLSearchParams({
    SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetFeatureInfo', LAYERS: layer, QUERY_LAYERS: layer, STYLES: '',
    CRS: 'EPSG:3857', BBOX: [x - 10, y - 10, x + 10, y + 10].join(','), WIDTH: '21', HEIGHT: '21', I: '10', J: '10',
    INFO_FORMAT: 'text/plain', FEATURE_COUNT: '1',
  }).toString();
  return url;
}

async function queryFlood(id: 'flood100' | 'flood500', lat: number, lon: number): Promise<FloodPointResult> {
  try {
    const response = await fetch(featureInfoUrl(config[id].url, config[id].layer, lat, lon), { signal: AbortSignal.timeout(12000), redirect: 'error' });
    if (!response.ok) throw new Error(`El SNCZI devuelve HTTP ${response.status}.`);
    return parseFloodInfo((await readBody(response, 64000)).toString('utf8'));
  } catch (error) {
    return { status: 'unknown', detail: error instanceof Error ? error.message : 'No se ha podido consultar el SNCZI.' };
  }
}

/** Reads one numeric attribute from the IGN GeoServer `text/plain` GetFeatureInfo. `null` means no polygon at the point. */
export function parseIgnValue(body: string, field: string): number | null {
  if (/no features were found/i.test(body)) return null;
  if (!/Results for FeatureType/i.test(body)) throw new Error('El IGN no ha devuelto una respuesta reconocible.');
  const match = new RegExp(`^\\s*${field} = (-?[0-9]+(?:\\.[0-9]+)?)\\s*$`, 'm').exec(body);
  const value = match ? Number(match[1]) : NaN;
  if (!Number.isFinite(value) || value < 0) throw new Error('El IGN ha devuelto un valor de peligrosidad no válido.');
  return value;
}

export function seismicResult(intensity: number | null, pga: number | null): SeismicPointResult {
  if (intensity === null && pga === null) return { status: 'unknown', detail: 'El mapa de peligrosidad sísmica del IGN no tiene valor en este punto.' };
  if (intensity !== null && (!Number.isInteger(intensity) || intensity < 1 || intensity > 12)) throw new Error('El IGN ha devuelto una intensidad fuera de la escala EMS-98.');
  return { status: 'ok', ...(intensity !== null ? { intensity } : {}), ...(pga !== null ? { pga } : {}) };
}

async function querySeismic(lat: number, lon: number): Promise<SeismicPointResult> {
  try {
    const read = async (layer: string, field: string) => {
      const response = await fetch(featureInfoUrl(config.seismic.url, layer, lat, lon), { signal: AbortSignal.timeout(12000), redirect: 'error' });
      if (!response.ok) throw new Error(`El IGN devuelve HTTP ${response.status}.`);
      return parseIgnValue((await readBody(response, 64000)).toString('utf8'), field);
    };
    const [intensity, pga] = await Promise.all([read(config.seismic.layer, 'int0475'), read(SEISMIC_PGA_LAYER, 'pga0475')]);
    return seismicResult(intensity, pga);
  } catch (error) {
    return { status: 'unknown', detail: error instanceof Error ? error.message : 'No se ha podido consultar el IGN.' };
  }
}

async function checkSeismic(): Promise<MapLayerInfo> {
  const source: MapLayerInfo = {
    id: 'seismic', title: 'Peligrosidad sísmica', attribution: 'Instituto Geográfico Nacional · Mapa de peligrosidad sísmica 2015', sourceUrl: SEISMIC_SOURCE_URL,
    description: 'Intensidad EMS-98 con un periodo de retorno de 475 años (10 % de probabilidad de superarse en 50 años). Escala regional; no predice terremotos.',
    date: null, available: false,
  };
  try {
    const url = new URL(config.seismic.url);
    url.search = new URLSearchParams({ SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetCapabilities' }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(9000), redirect: 'error' });
    if (!response.ok) throw new Error(`El catálogo del IGN devuelve HTTP ${response.status}.`);
    const content = (await readBody(response, 2000000)).toString('utf8');
    if (!content.includes(`<Name>${config.seismic.layer}</Name>`) || !content.includes(`<Name>${SEISMIC_PGA_LAYER}</Name>`) || !content.includes('EPSG:3857')) throw new Error('El catálogo del IGN no anuncia la capa en la proyección esperada.');
    return { ...source, available: true };
  } catch (error) { return { ...source, error: error instanceof Error ? error.message : 'No se ha podido consultar la capa.' }; }
}

async function checkFlood(id: 'flood100' | 'flood500'): Promise<MapLayerInfo> {
  const layer = config[id];
  const source: MapLayerInfo = {
    id, title: id === 'flood100' ? 'Inundación fluvial T100' : 'Inundación fluvial T500',
    attribution: 'SNCZI · MITECO (CC BY 4.0)', sourceUrl: floodSource,
    description: id === 'flood100' ? 'Zonas cartografiadas con periodo de retorno de 100 años (1 % anual de excedencia).' : 'Zonas cartografiadas con periodo de retorno de 500 años (0,2 % anual de excedencia).',
    date: null, available: false,
  };
  try {
    const url = new URL(`https://gis.miteco.gob.es/geoserver/agua/${layer.layer}/wms`);
    url.search = new URLSearchParams({ SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetCapabilities' }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(9000), redirect: 'error' });
    if (!response.ok) throw new Error(`El catálogo del SNCZI devuelve HTTP ${response.status}.`);
    const content = (await readBody(response, 2000000)).toString('utf8');
    if (!content.includes(layer.layer) || !content.includes('EPSG:3857') || !content.includes('WMS_Capabilities')) throw new Error('El catálogo no anuncia la capa en la proyección esperada.');
    return { ...source, available: true };
  } catch (error) { return { ...source, error: error instanceof Error ? error.message : 'No se ha podido consultar la capa.' }; }
}

async function buildCatalog(): Promise<MapCatalog> {
  const date = new Date().toISOString().slice(0, 10);
  const fire: MapLayerInfo = {
    id: 'fire', title: 'Peligro de incendio · FWI', attribution: 'UE / Copernicus EMS · EFFIS / ECMWF', sourceUrl: methodology,
    description: 'Índice científico FWI precomputado. Resolución aproximada de 8 km; no representa probabilidad por parcela.',
    available: false, date: null,
  };
  const fireCheck = async (): Promise<MapLayerInfo> => {
    try {
      // The WMS advertises dates up to 2099. Probe an actual land value instead of treating that range as availability.
      await fetchFwi(39.5, -0.42, date);
      return { ...fire, date, available: true };
    } catch (error) {
      return { ...fire, error: `Sin datos de validez comprobada para ${date}. ${error instanceof Error ? error.message : 'No se pudo consultar EFFIS.'}` };
    }
  };
  const [flood100, flood500, checkedFire, seismic] = await Promise.all([checkFlood('flood100'), checkFlood('flood500'), fireCheck(), checkSeismic()]);
  return {
    checkedAt: new Date().toISOString(),
    layers: [
      { id: 'base', title: 'Mapa base IGN', attribution: 'Instituto Geográfico Nacional', sourceUrl: 'https://www.ign.es/wms-inspire/ign-base?SERVICE=WMS&REQUEST=GetCapabilities', description: 'Cartografía de referencia del IGN.', date: null, available: true },
      flood100, flood500, checkedFire, seismic,
    ],
  };
}

export async function getMapCatalog() {
  const now = new Date();
  if (catalogCache && catalogCache.checkedAt.slice(0, 10) === now.toISOString().slice(0, 10)
    && now.getTime() - Date.parse(catalogCache.checkedAt) < (catalogCache.layers.every(layer => layer.available) ? 900000 : 60000)) return catalogCache;
  if (!catalogPending) {
    catalogPending = buildCatalog().then(catalog => { catalogCache = catalog; return catalog; }).finally(() => { catalogPending = undefined; });
  }
  return catalogPending;
}

export function buildMapUrl(id: MapLayerId, bbox: string, width: number, height: number, date?: string, legend = false) {
  if (!isValidBbox(bbox) || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 1200 || height > 1200) throw new Error('El encuadre o tamaño del mapa no es válido.');
  if (id === 'fire' && !isCurrentMapDate(date)) throw new Error('La fecha del mapa FWI ya no es la fecha actual. Actualiza el catálogo.');
  const settings = config[id];
  const url = new URL(settings.url);
  url.searchParams.set('SERVICE', 'WMS');
  url.searchParams.set('VERSION', settings.version);
  url.searchParams.set('REQUEST', legend ? 'GetLegendGraphic' : 'GetMap');
  url.searchParams.set(legend ? 'LAYER' : 'LAYERS', settings.layer);
  url.searchParams.set('FORMAT', 'image/png');
  if (legend) {
    url.searchParams.set('STYLE', 'default');
  } else {
    url.searchParams.set('STYLES', '');
    url.searchParams.set(settings.version === '1.3.0' ? 'CRS' : 'SRS', 'EPSG:3857');
    url.searchParams.set('BBOX', bbox);
    url.searchParams.set('WIDTH', String(width)); url.searchParams.set('HEIGHT', String(height));
    url.searchParams.set('TRANSPARENT', id === 'base' ? 'FALSE' : 'TRUE');
    if (id === 'fire') url.searchParams.set('TIME', date!);
  }
  return url;
}

function isLayer(value: unknown): value is MapLayerId { return typeof value === 'string' && Object.hasOwn(config, value); }

export function mapRouter() {
  const router = Router();
  router.post('/location', async (req, res) => {
    const municipality: unknown = req.body?.municipality;
    const provinceCode: unknown = req.body?.provinceCode;
    const municipalityCode: unknown = req.body?.municipalityCode;
    if (typeof municipality !== 'string' || !municipality.trim() || municipality.length > 100 || typeof provinceCode !== 'string' || !getRegion(provinceCode)
      || (municipalityCode !== undefined && municipalityCode !== '' && (typeof municipalityCode !== 'string' || !getMunicipality(municipalityCode) || municipalityCode.slice(0, 2) !== provinceCode))) {
      res.status(400).json({ error: 'Introduce el municipio completo y una provincia válida.' }); return;
    }
    try { res.json(typeof municipalityCode === 'string' && municipalityCode ? await municipalityCenter(String(Number(municipalityCode)), provinceCode) : await findMunicipality(municipality.trim(), provinceCode)); }
    catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : 'No se pudo localizar el municipio.' }); }
  });
  router.get('/catalog', async (_req, res) => res.json(await getMapCatalog()));
  router.get('/fwi', async (req, res) => {
    const lat = Number(req.query.lat); const lon = Number(req.query.lon); const date = req.query.date;
    if (!validCoordinates(lat, lon) || !isCurrentMapDate(date)) { res.status(400).json({ error: 'Coordenadas o fecha de validez incorrectas. Actualiza el mapa.' }); return; }
    try { res.json({ values: await fetchFwi(lat, lon, date), date, lat, lon, resolutionKm: 8, sourceUrl: methodology }); }
    catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : 'Sin datos FWI para este punto.' }); }
  });
  router.post('/point', async (req, res) => {
    const lat = Number(Number(req.body?.lat).toFixed(4));
    const lon = Number(Number(req.body?.lon).toFixed(4));
    if (typeof req.body?.lat !== 'number' || typeof req.body?.lon !== 'number' || !validCoordinates(lat, lon)) {
      res.status(400).json({ error: 'El punto debe estar en España.' }); return;
    }
    const date = new Date().toISOString().slice(0, 10);
    const [flood100, flood500, fwi, seismic] = await Promise.all([
      queryFlood('flood100', lat, lon), queryFlood('flood500', lat, lon),
      fetchFwi(lat, lon, date).then(values => ({ value: values.FWI, date, className: fwiClass(values.FWI), components: values }), (error: unknown) => ({ error: error instanceof Error ? error.message : 'Sin datos FWI.' })),
      querySeismic(lat, lon),
    ]);
    res.json({ lat, lon, checkedAt: new Date().toISOString(), flood100, flood500, seismic, ...('error' in fwi ? { fwi: null, fwiError: fwi.error } : { fwi }) });
  });
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
      const bytes = await readBody(response, IMAGE_LIMIT);
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
