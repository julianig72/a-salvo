// Runtime-agnostic: used by the Express server and, in the static GitHub Pages build, directly by the browser.
import ineData from './data/municipios-ine-2026.json';
import { provinces } from '../shared/regions';
import type { AddressSuggestion, HomeAddress, MunicipalitySuggestion } from '../shared/types';
import { validCoordinates } from './services';

const dataset = ineData as { source: string; url: string; municipalities: [string, string][] };
const CARTO = 'https://www.cartociudad.es/geocoder/api/geocoder';
export const ADDRESS_ID = /^[A-Za-z0-9._-]{1,80}$/;
const ID = ADDRESS_ID;
const ARTICLES = /^(el|la|los|las|l'|els|les|es|sa|ses|a|o|as|os)\s*/;

/** Lowercase, accent- and punctuation-free text for matching what people type against official names. */
export function searchKey(text: string) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').replace(/[’`´]/g, "'")
    .replace(/[^a-z0-9ñç' ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export const provinceName = new Map(provinces.map(p => [p.code, p.name]));
const index = dataset.municipalities.map(([code, name]) => {
  const keys = name.split('/').flatMap(part => { const key = searchKey(part); const bare = key.replace(ARTICLES, ''); return bare !== key ? [key, bare] : [key]; });
  return { code, name, provinceCode: code.slice(0, 2), keys };
});
const byCode = new Map(index.map(item => [item.code, item]));

export const municipalityDataset = { source: dataset.source, url: dataset.url, count: index.length };
export const isMunicipalityCode = (code: unknown): code is string => typeof code === 'string' && byCode.has(code);

export function getMunicipality(code: string) {
  return byCode.get(code);
}

/** Ranks INE municipalities: exact, then prefix, then word prefix, then substring. */
export function suggestMunicipalities(query: string, provinceCode?: string, limit = 8): MunicipalitySuggestion[] {
  const q = searchKey(query);
  if (q.length < 2) return [];
  const scored: { item: typeof index[number]; score: number }[] = [];
  for (const item of index) {
    if (provinceCode && item.provinceCode !== provinceCode) continue;
    let score = Infinity;
    for (const key of item.keys) {
      const s = key === q ? 0 : key.startsWith(`${q} `) ? 1 : key.startsWith(q) ? 1.5 : key.includes(` ${q}`) ? 2 : key.includes(q) ? 3 : Infinity;
      if (s < score) score = s;
    }
    if (score < Infinity) scored.push({ item, score });
  }
  return scored.sort((a, b) => a.score - b.score || a.item.name.length - b.item.name.length || a.item.name.localeCompare(b.item.name, 'es'))
    .slice(0, limit)
    .map(({ item }) => ({ code: item.code, name: item.name, provinceCode: item.provinceCode, province: provinceName.get(item.provinceCode) ?? '' }));
}

/** Finds the INE code for an exact name in a province (used when the name comes from reverse geocoding). */
export function matchMunicipality(name: string, provinceCode: string) {
  const keys = name.split('/').map(searchKey);
  const found = index.filter(item => item.provinceCode === provinceCode && item.keys.some(key => keys.includes(key)));
  return found.length === 1 ? found[0] : undefined;
}

const SMALL = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'i', 'e', 'a', 'en', 'dels', 'les', 'els', 'da', 'do', 'das', 'dos']);
/** CartoCiudad returns streets in capitals; show them in sentence-friendly title case. */
export function titleCaseStreet(text: string) {
  return text.toLocaleLowerCase('es').split(/(\s+|-|\/|\()/).map((word, i) => {
    if (!word.trim() || /^[\s\-/(]$/.test(word)) return word;
    if (i > 0 && SMALL.has(word)) return word;
    const apostrophe = /^([dl]')(.+)$/.exec(word);
    if (apostrophe) return `${apostrophe[1]}${apostrophe[2].charAt(0).toLocaleUpperCase('es')}${apostrophe[2].slice(1)}`;
    return word.charAt(0).toLocaleUpperCase('es') + word.slice(1);
  }).join('');
}

const cartoNames = new Map<string, string>();
async function cartoJson(path: string, params: Record<string, string>, signal: AbortSignal) {
  const url = new URL(`${CARTO}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' }, redirect: 'error' });
  if (!response.ok) throw new Error('CartoCiudad no está disponible en este momento.');
  const text = await response.text();
  if (text.length > 400000) throw new Error('La respuesta de CartoCiudad es demasiado grande.');
  return JSON.parse(text) as unknown;
}

/** CartoCiudad names bilingual municipalities in its own order; its filter needs that exact spelling. */
async function cartoMunicipalityName(code: string, signal: AbortSignal) {
  const cached = cartoNames.get(code);
  if (cached) return cached;
  const result = await cartoJson('find', { id: String(Number(code)), type: 'Municipio' }, signal);
  const name = result && typeof result === 'object' && typeof (result as Record<string, unknown>).muni === 'string' ? (result as Record<string, string>).muni : getMunicipality(code)!.name;
  if (cartoNames.size > 2000) cartoNames.clear();
  cartoNames.set(code, name);
  return name;
}

export function parseAddressCandidates(data: unknown, municipalityCode: string, limit = 8): AddressSuggestion[] {
  if (!Array.isArray(data)) throw new Error('La respuesta de CartoCiudad no es reconocible.');
  const seen = new Set<string>();
  const out: AddressSuggestion[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    if ((c.type !== 'callejero' && c.type !== 'portal') || c.muniCode !== municipalityCode || typeof c.id !== 'string' || !ID.test(c.id) || typeof c.address !== 'string') continue;
    const street = c.address.split(',')[0].replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (!street || seen.has(`${c.type}:${street}`)) continue;
    seen.add(`${c.type}:${street}`);
    const place = (c.address.includes(',') ? c.address.split(',').slice(1).join(',') : '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    const muni = typeof c.muni === 'string' ? c.muni : '';
    out.push({ id: c.id, type: c.type, label: titleCaseStreet(street), ...(typeof c.postalCode === 'string' && /^\d{5}/.test(c.postalCode) ? { postalCode: c.postalCode.slice(0, 5) } : {}), ...(place && searchKey(place) !== searchKey(muni) ? { place: place.slice(0, 80) } : {}) });
    if (out.length >= limit) break;
  }
  return out;
}

export async function suggestAddresses(query: string, municipalityCode: string, signal: AbortSignal) {
  const municipality = cartoNames.get(municipalityCode) ?? await cartoMunicipalityName(municipalityCode, signal);
  const search = (q: string, filter?: string) => cartoJson('candidates', {
    q, limit: '20', ...(filter ? { municipio_filter: filter } : {}),
    no_process: 'municipio,poblacion,toponimo,expendeduria,ngbe,codpost,carretera,punto_recarga_electrica',
  }, signal).then(data => parseAddressCandidates(data, municipalityCode, 20));
  const first = await search(query, municipality);
  if (!/\d/.test(query) || first.some(item => item.type === 'portal')) return first.slice(0, 8);
  // CartoCiudad indexes portals of some municipalities under another spelling (e.g. d"En instead of d'En), so the name
  // filter can miss numbers that exist. Retry without the filter; results are still restricted to the INE code.
  const short = municipality.split(/[’'"]/)[0].replace(/\s+(d|l|de|del|la|el|les|els|s)$/i, '').trim();
  const retries = [search(query), search(`${query}, ${municipality}`)];
  if (short && short !== municipality) retries.push(search(`${query}, ${short}`));
  const extra = (await Promise.allSettled(retries)).flatMap(r => r.status === 'fulfilled' ? r.value : []);
  const number = query.match(/(\d+)\s*[a-z]?\s*$/i)?.[1];
  const exact = (item: AddressSuggestion) => item.type === 'portal' && number !== undefined && item.label.endsWith(` ${number}`);
  const portals = extra.filter(item => item.type === 'portal');
  const seen = new Set<string>();
  return [...portals.filter(exact), ...portals, ...first, ...extra]
    .filter(item => { const key = `${item.type}:${item.label}`; if (seen.has(key)) return false; seen.add(key); return true; })
    .slice(0, 8);
}

export async function resolveAddress(id: string, type: 'callejero' | 'portal', municipalityCode: string, signal: AbortSignal): Promise<HomeAddress> {
  const result = await cartoJson('find', { id, type }, signal);
  if (!result || typeof result !== 'object') throw new Error('CartoCiudad no ha devuelto la dirección.');
  const r = result as Record<string, unknown>;
  if (r.muniCode !== municipalityCode || r.countryCode !== '011' || !validCoordinates(r.lat, r.lng) || typeof r.lng !== 'number' || typeof r.address !== 'string') {
    throw new Error('La dirección no pertenece al municipio seleccionado.');
  }
  const via = typeof r.tip_via === 'string' ? `${r.tip_via} ` : '';
  const number = type === 'portal' && typeof r.portalNumber === 'number' ? ` ${r.portalNumber}${typeof r.extension === 'string' && r.extension ? ` ${r.extension}` : ''}` : '';
  return {
    label: titleCaseStreet(`${via}${r.address}${number}`).slice(0, 160), kind: type === 'portal' ? 'portal' : 'street',
    lat: Number(r.lat.toFixed(5)), lon: Number(r.lng.toFixed(5)),
    ...(typeof r.postalCode === 'string' && /^\d{5}$/.test(r.postalCode) ? { postalCode: r.postalCode } : {}),
  };
}
