import type { OfficialSource, SourceCheck } from '../shared/types';
import { normalizeMunicipalityName, provinces } from '../shared/regions';

const cache = new Map<string, SourceCheck>();
const CACHE_MS = 15 * 60 * 1000;

export async function checkSource(source: OfficialSource): Promise<SourceCheck> {
  const cached = cache.get(source.id);
  if (cached && cached.status === 'available' && Date.now() - Date.parse(cached.checkedAt) < CACHE_MS) return cached;
  const checkedAt = new Date().toISOString();
  try {
    const signal = AbortSignal.timeout(7500);
    const original = new URL(source.url);
    let current = original;
    let response: Response | undefined;
    // Only follow redirects within the curated source's own official host.
    for (let redirect = 0; redirect < 4; redirect++) {
      response = await fetch(current, { signal, redirect: 'manual', headers: { 'User-Agent': 'ASalvo/1.0 (official source availability check)', Accept: 'text/html,application/pdf;q=0.8' } });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('La fuente ha devuelto una redirección sin destino.');
      const next = new URL(location, current);
      if (next.protocol !== 'https:' || next.hostname.replace(/^www\./, '') !== original.hostname.replace(/^www\./, '')) throw new Error('La fuente redirige a otro dominio. Consulta el enlace original.');
      current = next;
    }
    if (!response?.ok) throw new Error(`El organismo no ha permitido la consulta (HTTP ${response?.status ?? 'desconocido'}).`);
    const contentType = response.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml\+xml|application\/pdf/i.test(contentType)) {
      await response.body?.cancel();
      throw new Error('El organismo no ha devuelto una página o documento reconocible.');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('La fuente ha devuelto una respuesta vacía.');
    let bytes = 0;
    let excerpt = '';
    const decoder = new TextDecoder();
    try {
      while (bytes < 160_000) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.length;
        excerpt += decoder.decode(part.value, { stream: true });
      }
    } finally { await reader.cancel(); }
    if (bytes < 200) throw new Error('La respuesta no contiene suficiente contenido para comprobar la consulta.');
    if (/just a moment|checking your browser|access denied|captcha|bot verification/i.test(excerpt.slice(0, 12000))) {
      throw new Error('El organismo requiere una comprobación en su web. Consulta el enlace directamente.');
    }
    const result: SourceCheck = { id: source.id, status: 'available', checkedAt, detail: 'Se ha recibido contenido de la fuente. Esto no certifica su vigencia ni actualiza las recomendaciones editoriales.' };
    cache.set(source.id, result);
    return result;
  } catch (error) {
    const timedOut = error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name);
    return { id: source.id, status: 'unavailable', checkedAt, detail: timedOut ? 'El organismo no ha respondido a tiempo. Consulta el enlace directamente.' : error instanceof Error ? `No se pudo consultar: ${error.message}` : 'No se pudo acceder a la fuente oficial.' };
  }
}

export function validCoordinates(lat: unknown, lon: unknown): lat is number {
  return typeof lat === 'number' && Number.isFinite(lat) && typeof lon === 'number' && Number.isFinite(lon)
    && lat >= 27 && lat <= 44 && lon >= -19 && lon <= 5;
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const rad = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * rad / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lon2 - lon1) * rad / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function lookupLocation(lat: number, lon: number) {
  const url = new URL('https://www.cartociudad.es/geocoder/api/geocoder/reverseGeocode');
  url.searchParams.set('lat', lat.toFixed(3));
  url.searchParams.set('lon', lon.toFixed(3));
  const response = await fetch(url, { signal: AbortSignal.timeout(8500), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('CartoCiudad no está disponible en este momento.');
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object') throw new Error('CartoCiudad no ha devuelto un municipio reconocible.');
  const result = data as Record<string, unknown>;
  const provinceCode = typeof result.provinceCode === 'string' ? result.provinceCode.padStart(2, '0') : '';
  if (typeof result.muni !== 'string' || !result.muni.trim() || !provinces.some(p => p.code === provinceCode)
    || result.countryCode !== '011' || typeof result.lat !== 'number' || typeof result.lng !== 'number'
    || !Number.isFinite(result.lat) || !Number.isFinite(result.lng)
    || distanceKm(lat, lon, result.lat, result.lng) > 15) {
    throw new Error('No se ha podido determinar un municipio español cercano con suficiente confianza.');
  }

  return { municipality: result.muni, provinceCode };
}

export async function findMunicipality(municipality: string, provinceCode: string) {
  const searchUrl = new URL('https://www.cartociudad.es/geocoder/api/geocoder/candidates');
  searchUrl.searchParams.set('q', municipality);
  searchUrl.searchParams.set('limit', '30');
  const signal = AbortSignal.timeout(12000);
  const response = await fetch(searchUrl, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('CartoCiudad no ha podido buscar el municipio.');
  const data: unknown = await response.json();
  if (!Array.isArray(data)) throw new Error('La respuesta de búsqueda no es reconocible.');
  const matches = data.filter((item): item is Record<string, unknown> => {
    if (!item || typeof item !== 'object' || typeof item.muni !== 'string') return false;
    return item.type === 'Municipio' && item.provinceCode === provinceCode
      && item.muni.split('/').some((name: string) => normalizeMunicipalityName(name) === normalizeMunicipalityName(municipality));
  });
  if (matches.length !== 1 || typeof matches[0].id !== 'string') throw new Error('No se ha encontrado un municipio exacto en esa provincia. Revisa el nombre completo y la provincia.');
  return municipalityCenter(matches[0].id, provinceCode, signal);
}

/** Centre of a municipality from its INE code, the identifier CartoCiudad uses for type=Municipio. */
export async function municipalityCenter(id: string, provinceCode: string, signal = AbortSignal.timeout(12000)) {
  const detailUrl = new URL('https://www.cartociudad.es/geocoder/api/geocoder/find');
  detailUrl.searchParams.set('id', id);
  detailUrl.searchParams.set('type', 'Municipio');
  const detail = await fetch(detailUrl, { signal, headers: { Accept: 'application/json' } });
  if (!detail.ok) throw new Error('No se ha podido obtener el centro del municipio.');
  const result: unknown = await detail.json();
  if (!result || typeof result !== 'object') throw new Error('El municipio no contiene coordenadas reconocibles.');
  const point = result as Record<string, unknown>;
  if (!validCoordinates(point.lat, point.lng) || typeof point.lng !== 'number' || typeof point.muni !== 'string'
    || point.provinceCode !== provinceCode || point.countryCode !== '011') throw new Error('El municipio no contiene coordenadas españolas válidas.');
  return { municipality: point.muni, provinceCode, lat: point.lat, lon: point.lng };
}
