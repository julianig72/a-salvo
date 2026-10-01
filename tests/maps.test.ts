import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidBbox, mapBounds, project, unproject } from '../shared/map-math';
import { buildMapUrl, fwiClass, isCurrentMapDate, parseFloodInfo, parseFwiResponse, parseIgnValue, seismicResult } from '../server/maps';
import { emsLabel } from '../shared/seismic';
import { getRegionalRecommendations, regionalRecommendations } from '../shared/regional-advice';
import { getSources } from '../shared/sources';
import { normalizeMunicipalityName, regions } from '../shared/regions';
import { findMunicipality } from '../server/services';

test('transformaciones geográficas reversibles y encuadre Web Mercator válido', () => {
  const [x, y] = project(39.4699, -0.3763);
  const [lat, lon] = unproject(x, y);
  assert.ok(Math.abs(lat - 39.4699) < 1e-9);
  assert.ok(Math.abs(lon + 0.3763) < 1e-9);
  assert.ok(isValidBbox(mapBounds(39.4699, -0.3763, 11).join(',')));
  for (const bbox of ['1,2,0,4', 'NaN,0,3,4', '0,0,1', '0,0,Infinity,1', '0,0,999999999,2']) assert.ok(!isValidBbox(bbox));
  assert.throws(() => project(90, 0), /fuera/);
});

test('los nombres de municipios toleran tildes y artículos pospuestos oficiales', () => {
  assert.equal(normalizeMunicipalityName('Coruña, A'), normalizeMunicipalityName('A Coruña'));
  assert.equal(normalizeMunicipalityName("Hospitalet de Llobregat, L'"), normalizeMunicipalityName("L'Hospitalet de Llobregat"));
  assert.equal(normalizeMunicipalityName('València'), normalizeMunicipalityName('Valencia'));
});

test('WMS usa capas oficiales exactas, CRS y TIME explícito para incendio', () => {
  const bbox = '-70000,4750000,-10000,4810000';
  const flood = buildMapUrl('flood100', bbox, 1000, 620);
  assert.equal(flood.hostname, 'gis.miteco.gob.es');
  assert.equal(flood.searchParams.get('LAYERS'), 'Zi_laminas_q100');
  assert.equal(flood.searchParams.get('CRS'), 'EPSG:3857');
  const today = new Date().toISOString().slice(0, 10);
  const fire = buildMapUrl('fire', bbox, 1000, 620, today);
  assert.equal(fire.searchParams.get('LAYERS'), 'ecmwf.fwi');
  assert.equal(fire.searchParams.get('SRS'), 'EPSG:3857');
  assert.equal(fire.searchParams.get('TIME'), today);
  assert.throws(() => buildMapUrl('fire', bbox, 1000, 620, '2019-01-01'), /fecha/);
  assert.throws(() => buildMapUrl('fire', bbox, 1000, 620), /fecha/);
  assert.throws(() => buildMapUrl('flood500', bbox, 9999, 620), /tamaño/);
  assert.ok(isCurrentMapDate(today));
  assert.ok(!isCurrentMapDate('2099-12-31'));
});

test('los índices oficiales se leen como valores, nunca como probabilidades', () => {
  const html = `<table>${[['FWI', 46.785133], ['ISI', 13.248302], ['BUI', 208.77348], ['FFMC', 94.767227], ['DMC', 132.6386], ['DC', 1225.204]].map(([key, value]) => `<tr><td>Official name (${key})</td><td>${value}</td></tr>`).join('')}</table>`;
  const values = parseFwiResponse(html);
  assert.equal(values.FWI, 46.785133);
  assert.equal(values.DC, 1225.204);
  assert.throws(() => parseFwiResponse('<table></table>'), /no ha devuelto/);
  assert.throws(() => parseFwiResponse(html.replace('46.785133', '-9999')), /no ha devuelto/);
});

test('la consulta puntual del SNCZI distingue dentro, fuera y respuestas no reconocibles', () => {
  assert.deepEqual(parseFloodInfo('no features were found\n'), { status: 'outside' });
  const inside = parseFloodInfo(`Results for FeatureType 'workspaces/agua:Zi_laminas_q500':\n--------\nid_zona = ES080_T010_232\nrio = Barrancos de Poyo y Saleta\ntipo_est = Estudio de Desarrollo del SNCZI\nfecha_apro = 2020-02-13T23:00:00Z\nshape = [GEOMETRY (MultiPolygon) with 81598 points]\n`);
  assert.deepEqual(inside, { status: 'inside', zone: 'ES080_T010_232', river: 'Barrancos de Poyo y Saleta', study: 'Estudio de Desarrollo del SNCZI', approved: '2020' });
  assert.throws(() => parseFloodInfo('<ServiceExceptionReport>'), /reconocible/);
  assert.deepEqual([5, 15, 30, 45, 60, 80].map(fwiClass), ['Bajo', 'Moderado', 'Alto', 'Muy alto', 'Extremo', 'Muy extremo']);
});

test('la peligrosidad sísmica del IGN se lee como intensidad EMS-98 y aceleración, sin inventar valores', () => {
  const body = `Results for FeatureType 'HazardArea2015.Int475':\n--------\ngml_id = x.1\nint0475 = 8\n--------\n`;
  assert.equal(parseIgnValue(body, 'int0475'), 8);
  assert.equal(parseIgnValue(`Results for FeatureType 'HazardArea2015.PGA475_p':\n--------\npga0475 = 0.24\n`, 'pga0475'), 0.24);
  assert.equal(parseIgnValue('no features were found\n', 'int0475'), null);
  assert.throws(() => parseIgnValue('<ServiceExceptionReport>', 'int0475'), /reconocible/);
  assert.deepEqual(seismicResult(null, null).status, 'unknown');
  assert.deepEqual(seismicResult(6, 0.07), { status: 'ok', intensity: 6, pga: 0.07 });
  assert.throws(() => seismicResult(15, null), /EMS-98/);
  const url = buildMapUrl('seismic', '-70000,4750000,-10000,4810000', 490, 340);
  assert.equal(url.hostname, 'www.ign.es');
  assert.equal(url.searchParams.get('LAYERS'), 'HazardArea2015.Int475');
  assert.equal(emsLabel(6), 'VI · Levemente dañino');
});

test('los 19 territorios tienen contenido concreto con organismo y fuente', () => {
  assert.equal(new Set(regionalRecommendations.map(item => item.regionId)).size, 19);
  for (const region of regions) {
    const recommendations = getRegionalRecommendations(region.id, ['flood', 'wildfire', 'earthquake']);
    assert.ok(recommendations.length > 0, region.name);
    const sources = getSources(region.id, ['flood', 'wildfire', 'earthquake']);
    for (const item of recommendations) {
      assert.ok(item.text.length > 30);
      assert.ok(item.organization.length > 10);
      assert.match(item.url, /^https:\/\//);
      assert.ok(sources.some(source => source.id === item.sourceId && source.url === item.url));
    }
  }
  assert.equal(getRegionalRecommendations('asturias', ['wildfire']).length, 0);
});

test('el geocodificador exige municipio exacto en la provincia indicada', async t => {
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/candidates')) return Response.json([
      { id: '46250', type: 'Municipio', provinceCode: '46', muni: 'València' },
      { id: '10203', type: 'Municipio', provinceCode: '10', muni: 'Valencia de Alcántara' },
    ]);
    return Response.json({ muni: 'València', provinceCode: '46', countryCode: '011', lat: 39.42, lng: -0.358 });
  });
  assert.deepEqual(await findMunicipality('Valencia', '46'), { municipality: 'València', provinceCode: '46', lat: 39.42, lon: -0.358 });
  await assert.rejects(findMunicipality('Valencia', '28'), /exacto/);
  await assert.rejects(findMunicipality('Val', '46'), /exacto/);
});
