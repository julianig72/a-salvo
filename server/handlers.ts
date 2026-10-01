// API handlers without HTTP framework: the Express server and the static (GitHub Pages) build share them.
import { riskAdvice } from '../shared/advice';
import { getRegion, regions } from '../shared/regions';
import { generalSources, getSources } from '../shared/sources';
import type { OfficialSource, RiskId, SourceCheck } from '../shared/types';
import { ADDRESS_ID, getMunicipality, isMunicipalityCode, matchMunicipality, provinceName, resolveAddress, searchKey, suggestAddresses, suggestMunicipalities, municipalityDataset } from './geo-core';
import { getMapCatalog, queryPoint } from './maps-core';
import { findMunicipality, lookupLocation, municipalityCenter, validCoordinates } from './services';

export interface ApiResult { status: number; body: unknown }
const ok = (body: unknown): ApiResult => ({ status: 200, body });
const fail = (status: number, error: string): ApiResult => ({ status, body: { error } });
const isTimeout = (error: unknown) => error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name);
type Fields = Record<string, unknown>;
const fields = (body: unknown): Fields => (body && typeof body === 'object' ? body as Fields : {});

export async function sourcesCheck(body: unknown, check: (source: OfficialSource) => Promise<SourceCheck>): Promise<ApiResult> {
  if (!body || typeof body !== 'object') return fail(400, 'Indica una ubicación y los escenarios.');
  const { provinceCode, regionId, risks, extra = [] } = body as Fields;
  const region = typeof provinceCode === 'string' ? getRegion(provinceCode) : regions.find(r => r.id === regionId);
  const isRisk = (value: unknown): value is RiskId => typeof value === 'string' && riskAdvice.some(r => r.id === value);
  if (!region || !Array.isArray(risks) || risks.length < 1 || risks.length > 3 || !risks.every(isRisk) || new Set(risks).size !== risks.length) {
    return fail(400, 'La ubicación o los escenarios no son válidos.');
  }
  if (!Array.isArray(extra) || extra.length > Object.keys(generalSources).length || !extra.every(id => typeof id === 'string' && Object.hasOwn(generalSources, id))) {
    return fail(400, 'Las fuentes solicitadas no son válidas.');
  }
  const sources = getSources(region.id, risks, extra as string[]);
  return ok({ checks: await Promise.all(sources.map(check)), contentMode: 'editorial', cacheMinutes: 15 });
}

export async function reverseLocation(body: unknown): Promise<ApiResult> {
  const { lat, lon } = fields(body);
  if (!validCoordinates(lat, lon) || typeof lon !== 'number') return fail(400, 'La cobertura de esta aplicación es España. Introduce tu municipio y provincia manualmente.');
  try {
    const found = await lookupLocation(lat, lon);
    return ok({ ...found, municipalityCode: matchMunicipality(found.municipality, found.provinceCode)?.code ?? '' });
  } catch (error) {
    return fail(502, isTimeout(error) ? 'CartoCiudad no ha respondido a tiempo.' : error instanceof Error ? error.message : 'No se pudo consultar CartoCiudad.');
  }
}

export async function mapLocation(body: unknown): Promise<ApiResult> {
  const { municipality, provinceCode, municipalityCode } = fields(body);
  if (typeof municipality !== 'string' || !municipality.trim() || municipality.length > 100 || typeof provinceCode !== 'string' || !getRegion(provinceCode)
    || (municipalityCode !== undefined && municipalityCode !== '' && (typeof municipalityCode !== 'string' || !getMunicipality(municipalityCode) || municipalityCode.slice(0, 2) !== provinceCode))) {
    return fail(400, 'Introduce el municipio completo y una provincia válida.');
  }
  try { return ok(typeof municipalityCode === 'string' && municipalityCode ? await municipalityCenter(String(Number(municipalityCode)), provinceCode) : await findMunicipality(municipality.trim(), provinceCode)); }
  catch (error) { return fail(502, error instanceof Error ? error.message : 'No se pudo localizar el municipio.'); }
}

export async function mapCatalog(): Promise<ApiResult> { return ok(await getMapCatalog()); }

export async function mapPoint(body: unknown): Promise<ApiResult> {
  const { lat: rawLat, lon: rawLon } = fields(body);
  const lat = Number(Number(rawLat).toFixed(4));
  const lon = Number(Number(rawLon).toFixed(4));
  if (typeof rawLat !== 'number' || typeof rawLon !== 'number' || !validCoordinates(lat, lon)) return fail(400, 'El punto debe estar en España.');
  return ok(await queryPoint(lat, lon));
}

export function municipalities(q: unknown, province: unknown): ApiResult {
  if (typeof q !== 'string' || q.length > 100 || (province !== undefined && (typeof province !== 'string' || !provinceName.has(province)))) return fail(400, 'Búsqueda de municipio no válida.');
  return ok({ suggestions: suggestMunicipalities(q, province as string | undefined), source: municipalityDataset.source });
}

export async function addresses(q: unknown, code: unknown): Promise<ApiResult> {
  if (typeof q !== 'string' || searchKey(q).length < 3 || q.length > 120 || !isMunicipalityCode(code)) return fail(400, 'Escribe al menos 3 letras de la calle y elige antes el municipio.');
  try { return ok({ suggestions: await suggestAddresses(q.trim(), code, AbortSignal.timeout(8000)) }); }
  catch (error) { return fail(502, isTimeout(error) ? 'CartoCiudad no ha respondido a tiempo.' : error instanceof Error ? error.message : 'No se ha podido buscar la calle.'); }
}

export async function resolve(body: unknown): Promise<ApiResult> {
  const { id, type, municipality } = fields(body);
  if (typeof id !== 'string' || !ADDRESS_ID.test(id) || (type !== 'callejero' && type !== 'portal') || !isMunicipalityCode(municipality)) return fail(400, 'Dirección no válida.');
  try { return ok(await resolveAddress(id, type, municipality, AbortSignal.timeout(8000))); }
  catch (error) { return fail(502, error instanceof Error ? error.message : 'No se ha podido validar la dirección.'); }
}
