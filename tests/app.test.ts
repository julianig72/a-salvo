import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request } from 'node:http';
import { inflateSync } from 'node:zlib';
import { initialHousehold, needs, validateHousehold } from '../shared/advice';
import { provinces, regions, getRegion } from '../shared/regions';
import { generalSources, getSources, regionalSources } from '../shared/sources';
import { buildKit, buildPersonalPlan, mapSuggestedRisks, planSourceIds } from '../shared/personalize';
import type { HomeAddress, Household, PointCheck, PreparedPlan } from '../shared/types';
import { buildPlanPdf } from '../src/pdf';
import { createApi } from '../server/app';
import { checkSource, lookupLocation, validCoordinates } from '../server/services';
import { getMunicipality, matchMunicipality, municipalityDataset, parseAddressCandidates, suggestAddresses, suggestMunicipalities, titleCaseStreet } from '../server/geo';

const household: Household = { ...initialHousehold, municipality: 'València', municipalityCode: '46250', provinceCode: '46', people: 4, needs: ['children', 'mobility', 'medication', 'pets'], risks: ['flood', 'wildfire', 'earthquake'], contact: 'CONTACTO-PRUEBA', meetingPoint: 'PUNTO-PROPUESTO-SIN-VALIDAR' };
const insideT100: PointCheck = { municipality: 'Paiporta', provinceCode: '46', lat: 39.4283, lon: -0.4176, checkedAt: '2026-09-27T10:00:00.000Z', flood100: { status: 'inside', zone: 'ZI' }, flood500: { status: 'inside' }, fwi: { value: 42, date: '2026-09-27', className: 'Muy alto' } };
const ids = (h: Household, point?: PointCheck) => buildPersonalPlan(h, point).actions.map(a => a.id);

test('52 provincias y 19 territorios tienen una fuente regional HTTPS', () => {
  assert.equal(provinces.length, 52);
  assert.equal(new Set(provinces.map(p => p.code)).size, 52);
  assert.equal(regions.length, 19);
  for (const province of provinces) {
    const region = getRegion(province.code);
    assert.ok(region);
    assert.ok(regionalSources[region.id]);
    assert.match(regionalSources[region.id].url, /^https:\/\//);
    const sources = getSources(province.code, ['flood']);
    assert.equal(sources.filter(s => s.scope === 'regional' && s.kind === 'portal').length, 1);
    assert.equal(sources.filter(s => s.scope === 'national').length, 1);
  }
  assert.equal(getRegion('99'), undefined);
});

test('el catálogo no asigna riesgos: respeta únicamente los escenarios seleccionados', () => {
  const sourceIds = getSources('28', ['earthquake']).map(s => s.id);
  assert.ok(sourceIds.includes('national-earthquake'));
  assert.ok(!sourceIds.includes('national-flood'));
  const plan = buildPersonalPlan({ ...household, risks: ['earthquake'] });
  assert.ok(plan.actions.every(a => a.risk === 'general' || a.risk === 'earthquake'));
});

test('cada acción y artículo citado tiene su fuente en el plan', () => {
  const variants: [Household, PointCheck?][] = [
    [household], [household, insideT100],
    [{ ...household, needs: ['elderly', 'power', 'sensory'], level: 'basement', features: ['garage-below', 'near-water', 'near-vegetation', 'vehicle'], dwelling: 'house' }, insideT100],
    [{ ...household, provinceCode: '08', risks: ['wildfire'] }],
  ];
  for (const [h, point] of variants) {
    const sources = getSources(h.provinceCode, h.risks, planSourceIds(h, point));
    const { actions, kit, priorities } = buildPersonalPlan(h, point);
    for (const item of [...actions, ...kit]) if (item.sourceId) assert.ok(sources.some(s => s.id === item.sourceId), `${item.id} → ${item.sourceId}`);
    assert.equal(new Set(actions.map(a => a.id)).size, actions.length);
    assert.equal(priorities.length, 5);
  }
  for (const source of Object.values(generalSources)) assert.match(source.url, /^https:\/\//);
});

test('la vivienda y el hogar cambian el plan', () => {
  const upper = ids({ ...household, level: 'upper', features: [] });
  const ground = ids({ ...household, level: 'ground', features: ['garage-below', 'vehicle'] });
  assert.ok(!upper.includes('flood-upper-refuge') && ground.includes('flood-upper-refuge'));
  assert.ok(!upper.includes('flood-no-garage') && ground.includes('flood-no-garage'));
  assert.ok(ground.includes('flood-car-plan'));
  assert.ok(ids({ ...household, needs: ['power'] }).includes('need-power-backup'));
  assert.ok(!ids({ ...household, needs: [] }).includes('need-power-backup'));
  const forest = ids({ ...household, features: ['near-vegetation'] });
  assert.ok(forest.includes('fire-urbanization-plan'));
  assert.ok(!ids({ ...household, dwelling: 'flat', features: [] }).includes('fire-urbanization-plan'));
});

test('la consulta del punto oficial prioriza la zona inundable y el FWI alto', () => {
  const plan = buildPersonalPlan({ ...household, level: 'ground' }, insideT100);
  assert.equal(plan.priorities[0].id, 'flood-zone-t100');
  assert.ok(plan.actions.some(a => a.id === 'fire-fwi-high' && a.sourceId === 'effis'));
  assert.ok(!plan.actions.some(a => a.id === 'flood-check-zone'));
  assert.ok(plan.profile.includes('Punto en zona inundable T100'));
  const outside = buildPersonalPlan(household, { ...insideT100, flood100: { status: 'outside' }, flood500: { status: 'outside' }, fwi: { value: 5, date: '2026-09-27', className: 'Bajo' } });
  assert.ok(!outside.actions.some(a => a.id.startsWith('flood-zone') || a.id === 'fire-fwi-high'));
  assert.ok(planSourceIds(household, insideT100).includes('snczi'));
});

test('la peligrosidad sísmica del punto cambia el plan de terremoto y sugiere escenarios', () => {
  const quakeHousehold: Household = { ...household, risks: ['earthquake'] };
  const granada: PointCheck = { ...insideT100, flood100: { status: 'outside' }, flood500: { status: 'outside' }, fwi: null, seismic: { status: 'ok', intensity: 8, pga: 0.24 } };
  const plan = buildPersonalPlan(quakeHousehold, granada);
  const zone = plan.actions.find(a => a.id === 'quake-zone');
  assert.ok(zone && zone.sourceId === 'ign-seismic' && /475/.test(zone.text));
  assert.ok(plan.priorities.some(a => a.id === 'quake-zone'));
  assert.ok(planSourceIds(quakeHousehold, granada).includes('ign-seismic'));
  const madrid = buildPersonalPlan(quakeHousehold, { ...granada, seismic: { status: 'ok', intensity: 4, pga: 0.01 } });
  assert.ok(!madrid.actions.some(a => a.id === 'quake-zone'));
  assert.deepEqual(mapSuggestedRisks(granada), ['earthquake']);
  assert.deepEqual(mapSuggestedRisks(insideT100), ['flood', 'wildfire']);
  assert.deepEqual(mapSuggestedRisks({ ...granada, seismic: { status: 'unknown' } }), []);
  assert.deepEqual(mapSuggestedRisks(null), []);
});

test('el kit se calcula para el hogar', () => {
  const kit = buildKit({ ...household, people: 3, needs: [] , risks: ['earthquake'] });
  assert.equal(kit.find(k => k.id === 'water')?.quantity, '27 litros');
  assert.equal(kit.find(k => k.id === 'food')?.quantity, '27 raciones');
  assert.ok(!kit.some(k => k.id === 'pets-kit' || k.id === 'waterproof-bags'));
  const full = buildKit(household).map(k => k.id);
  assert.ok(full.includes('pets-kit') && full.includes('children-kit') && full.includes('waterproof-bags') && full.includes('masks'));
});

test('validación de municipio, provincia, personas, escenarios y campos opcionales', () => {
  assert.equal(validateHousehold(household), undefined);
  for (const changes of [{ municipality: ' ' }, { municipality: 'x'.repeat(101) }, { provinceCode: '99' }, { people: 0 }, { people: 1.5 }, { people: 31 }, { risks: [] }, { risks: ['flood', 'flood'] }, { contact: 'x'.repeat(181) }, { level: 'attic' }, { features: ['pool'] }] as Partial<Household>[]) {
    assert.ok(validateHousehold({ ...household, ...changes }));
  }
  assert.ok(validateHousehold(initialHousehold));
  assert.equal(needs.length, 7);
});

test('el municipio debe estar verificado con el código INE de su provincia', () => {
  const address: HomeAddress = { label: 'Calle San Antonio 5', kind: 'portal', lat: 39.42842, lon: -0.42251, postalCode: '46200' };
  assert.ok(validateHousehold({ ...household, municipalityCode: '' }));
  assert.equal(validateHousehold({ ...household, municipalityCode: '' }, { requireVerified: false }), undefined);
  assert.ok(validateHousehold({ ...household, municipalityCode: '28079' }));
  assert.ok(validateHousehold({ ...household, municipalityCode: '4625' }));
  assert.equal(validateHousehold({ ...household, municipality: 'Paiporta', municipalityCode: '46186', address }), undefined);
  for (const bad of [{ ...address, lat: 60 }, { ...address, label: '' }, { ...address, kind: 'house' }, { ...address, postalCode: 'ABC' }] as HomeAddress[]) {
    assert.ok(validateHousehold({ ...household, address: bad }), JSON.stringify(bad));
  }
});

test('las sugerencias de municipio salen del nomenclátor oficial del INE', () => {
  assert.equal(municipalityDataset.count, 8132);
  const valen = suggestMunicipalities('valen');
  assert.deepEqual(valen[0], { code: '46250', name: 'València', provinceCode: '46', province: 'Valencia / València' });
  assert.ok(suggestMunicipalities('rozas').some(m => m.code === '28127' && m.name === 'Las Rozas de Madrid'));
  assert.ok(suggestMunicipalities('eliana').some(m => m.name === "l'Eliana"));
  assert.ok(suggestMunicipalities('alcala', '28').every(m => m.provinceCode === '28'));
  assert.deepEqual(suggestMunicipalities('zzzzqqq'), []);
  assert.equal(matchMunicipality('Valencia', '46')?.code, '46250');
  assert.equal(matchMunicipality('Alicante', '03')?.code, '03014');
  assert.equal(matchMunicipality('Paiporta', '28'), undefined);
  assert.equal(getMunicipality('46186')?.name, 'Paiporta');
});

test('las calles de CartoCiudad se filtran por municipio y tipo, y se normalizan', () => {
  assert.equal(titleCaseStreet('CALLE SAN ANTONIO 5'), 'Calle San Antonio 5');
  assert.equal(titleCaseStreet('AVENIDA DE LA PAZ'), 'Avenida de la Paz');
  const parsed = parseAddressCandidates([
    { id: '10.46.G46_461860704025', type: 'portal', address: 'CALLE SAN ANTONIO 5, Paiporta', muni: 'Paiporta', muniCode: '46186', postalCode: '46200' },
    { id: 'other-muni', type: 'callejero', address: 'CALLE SAN ANTONIO', muni: 'Torrent', muniCode: '46244' },
    { id: 'place', type: 'toponimo', address: 'SAN ANTONIO', muni: 'Paiporta', muniCode: '46186' },
    { id: 'bad id!', type: 'callejero', address: 'CALLE X', muni: 'Paiporta', muniCode: '46186' },
  ], '46186');
  assert.deepEqual(parsed, [{ id: '10.46.G46_461860704025', type: 'portal', label: 'Calle San Antonio 5', postalCode: '46200' }]);
});

test('el número se encuentra aunque CartoCiudad indexe el municipio con otra grafía', async t => {
  const urls: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: URL) => {
    urls.push(input);
    if (input.pathname.endsWith('/find')) return Response.json({ muni: "Canet d'En Berenguer", muniCode: '46082' });
    if (input.searchParams.has('municipio_filter')) return Response.json([{ id: '460820000177', type: 'callejero', address: 'CALLE JOSE SEGRELLES, Platja de Canet', muni: "Canet d'En Berenguer", muniCode: '46082' }]);
    return Response.json([
      { id: '10.46.G46_461860000001', type: 'portal', address: 'CALLE JOSE SEGRELLES 5, Paiporta', muni: 'Paiporta', muniCode: '46186' },
      { id: '10.46.G46_460820000004', type: 'portal', address: 'CALLE JOSE SEGRELLES 4, Platja de Canet (Canet d"En Berenguer)', muni: 'Canet d"En Berenguer', muniCode: '46082', postalCode: '46529' },
      { id: '10.46.G46_460820000005', type: 'portal', address: 'CALLE JOSE SEGRELLES 5, Platja de Canet (Canet d"En Berenguer)', muni: 'Canet d"En Berenguer', muniCode: '46082', postalCode: '46529' },
    ]);
  });
  const suggestions = await suggestAddresses('Calle Jose Segrelles 5', '46082', AbortSignal.timeout(2000));
  assert.deepEqual(suggestions.slice(0, 2).map(s => [s.type, s.label]), [['portal', 'Calle Jose Segrelles 5'], ['portal', 'Calle Jose Segrelles 4']]);
  assert.ok(suggestions.every(s => s.id.includes('46082') || s.id === '460820000177'), 'solo direcciones del municipio elegido');
  assert.ok(urls.some(u => u.searchParams.get('q') === 'Calle Jose Segrelles 5, Canet'), 'reintenta con el nombre corto');
});

test('coordenadas solo dentro de límites de cobertura; NaN e infinitos rechazados', () => {
  assert.ok(validCoordinates(39.469, -0.376));
  assert.ok(validCoordinates(28.46, -16.25));
  assert.ok(!validCoordinates(52.52, 13.4));
  assert.ok(!validCoordinates(NaN, 0));
  assert.ok(!validCoordinates(40, Infinity));
  assert.ok(!validCoordinates('40', '-3'));
});

test('PDF contiene perfil, prioridades, advertencias, kit y fuentes, sin recortes de texto', () => {
  const point = { ...insideT100, municipality: 'València' };
  const plan: PreparedPlan = { household, createdAt: '2026-09-05T10:00:00.000Z', region: 'Comunitat Valenciana', sources: getSources('46', household.risks, planSourceIds(household, point)), checks: [], sourceError: 'ACCESO-NO-COMPROBADO', pointCheck: point };
  const pdf = buildPlanPdf(plan, { checkedKit: ['water'], checkedTasks: ['general-es-alert'] });
  assert.ok(pdf.getNumberOfPages() >= 6);
  const bytes = Buffer.from(pdf.output('arraybuffer'));
  assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
  const raw = bytes.toString('latin1');
  const streams: string[] = [];
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    streams.push(inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'));
  }
  const content = streams.join('\n');
  for (const marker of ['CONTACTO-PRUEBA', 'PUNTO-PROPUESTO-SIN-VALIDAR', '112', 'ACCESO-NO-COMPROBADO', 'Inundaciones', 'Incendios forestales', 'Terremotos', '[Listo]', '[Pendiente]', '[Hecho]', 'Tus 5 prioridades', 'Por qu', 'T100', 'Protecci']) assert.ok(content.includes(marker), marker);
  for (const source of plan.sources) assert.ok(raw.includes(source.url), source.url);
  // PDF coordinates are in points, measured from the bottom; body text must stay on-page.
  for (const stream of streams) {
    for (const match of stream.matchAll(/([-\d.]+) ([-\d.]+) Td/g)) {
      assert.ok(Number(match[2]) >= 25, `Text below printable area: ${match[0]}`);
    }
  }
});

test('la consulta oficial informa de éxito y conserva la fecha de la caché', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(`<html><head><title>Protección Civil</title></head><body>${'Recomendaciones oficiales. '.repeat(30)}</body></html>`, { headers: { 'Content-Type': 'text/html' } }));
  const source = { ...getSources('46', ['flood'])[0], id: 'test-cache' };
  const first = await checkSource(source);
  const second = await checkSource(source);
  assert.equal(first.status, 'available');
  assert.equal(first.checkedAt, second.checkedAt);
  assert.match(first.detail, /no certifica/);
});

test('una fuente inaccesible nunca se presenta como consultada', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('unavailable', { status: 503 }));
  const result = await checkSource({ ...getSources('46', ['flood'])[0], id: 'test-error' });
  assert.equal(result.status, 'unavailable');
  assert.match(result.detail, /503/);
});

test('una redirección fuera del organismo no se sigue', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 302, headers: { location: 'https://example.com/' } }));
  const result = await checkSource({ ...getSources('46', ['flood'])[0], id: 'test-redirect' });
  assert.equal(result.status, 'unavailable');
  assert.match(result.detail, /otro dominio/);
});

test('CartoCiudad devuelve solo municipio y provincia, no dirección ni coordenadas', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ muni: 'València', provinceCode: '46', countryCode: '011', lat: 39.47, lng: -0.376, address: 'NO-DEVOLVER', refCatastral: 'NO-DEVOLVER' }));
  assert.deepEqual(await lookupLocation(39.47, -0.376), { municipality: 'València', provinceCode: '46' });
});

test('no se acepta un resultado de CartoCiudad demasiado lejano', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ muni: 'València', provinceCode: '46', countryCode: '011', lat: 39.47, lng: -0.376 }));
  await assert.rejects(lookupLocation(40.42, -3.70), /confianza/);
});

test('API rechaza ubicaciones, escenarios y solicitudes inválidas', async t => {
  const app = createApi();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const post = (path: string, body: string) => new Promise<number>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: address.port, path, method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode!)); });
    req.on('error', reject); req.end(body);
  });
  assert.equal(await post('/api/sources/check', JSON.stringify({ provinceCode: '99', risks: ['flood'] })), 400);
  assert.equal(await post('/api/sources/check', JSON.stringify({ provinceCode: '46', risks: ['unrecognised'] })), 400);
  assert.equal(await post('/api/sources/check', JSON.stringify({ provinceCode: '46', risks: [] })), 400);
  assert.equal(await post('/api/sources/check', JSON.stringify({ provinceCode: '46', risks: ['flood', 'flood'] })), 400);
  assert.equal(await post('/api/sources/check', JSON.stringify({ provinceCode: '46', risks: ['flood'], extra: ['https://example.com'] })), 400);
  assert.equal(await post('/api/sources/check', JSON.stringify({ provinceCode: '46', risks: ['flood'], extra: 'es-alert' })), 400);
  assert.equal(await post('/api/location', JSON.stringify({ lat: 51, lon: -3 })), 400);
  assert.equal(await post('/api/location', '{bad-json'), 400);
  const get = (path: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
    request({ hostname: '127.0.0.1', port: address.port, path }, res => { let body = ''; res.setEncoding('utf8'); res.on('data', c => body += c); res.on('end', () => resolve({ status: res.statusCode!, body })); }).on('error', reject).end();
  });
  assert.equal(JSON.parse((await get('/api/geo/municipalities?q=')).body).suggestions.length, 0);
  assert.equal((await get('/api/geo/municipalities?q=paip&province=99')).status, 400);
  const found = await get('/api/geo/municipalities?q=paip');
  assert.equal(found.status, 200);
  assert.equal(JSON.parse(found.body).suggestions[0].code, '46186');
  assert.equal((await get('/api/geo/addresses?q=san%20antonio')).status, 400);
  assert.equal((await get('/api/geo/addresses?q=sa&municipality=46186')).status, 400);
  assert.equal(await post('/api/geo/addresses/resolve', JSON.stringify({ id: '../x', type: 'portal', municipality: '46186' })), 400);
});
