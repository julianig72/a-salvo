export const regions = [
  { id: 'andalucia', name: 'Andalucía' },
  { id: 'aragon', name: 'Aragón' },
  { id: 'asturias', name: 'Principado de Asturias' },
  { id: 'baleares', name: 'Illes Balears' },
  { id: 'canarias', name: 'Canarias' },
  { id: 'cantabria', name: 'Cantabria' },
  { id: 'castilla-leon', name: 'Castilla y León' },
  { id: 'castilla-mancha', name: 'Castilla-La Mancha' },
  { id: 'cataluna', name: 'Cataluña' },
  { id: 'valenciana', name: 'Comunitat Valenciana' },
  { id: 'extremadura', name: 'Extremadura' },
  { id: 'galicia', name: 'Galicia' },
  { id: 'madrid', name: 'Comunidad de Madrid' },
  { id: 'murcia', name: 'Región de Murcia' },
  { id: 'navarra', name: 'Comunidad Foral de Navarra' },
  { id: 'pais-vasco', name: 'País Vasco' },
  { id: 'rioja', name: 'La Rioja' },
  { id: 'ceuta', name: 'Ceuta' },
  { id: 'melilla', name: 'Melilla' },
] as const;

export type RegionId = typeof regions[number]['id'];
export interface Province { code: string; name: string; regionId: RegionId }

const rows: [string, string, RegionId][] = [
  ['01', 'Araba / Álava', 'pais-vasco'], ['02', 'Albacete', 'castilla-mancha'],
  ['03', 'Alicante / Alacant', 'valenciana'], ['04', 'Almería', 'andalucia'],
  ['05', 'Ávila', 'castilla-leon'], ['06', 'Badajoz', 'extremadura'],
  ['07', 'Illes Balears', 'baleares'], ['08', 'Barcelona', 'cataluna'],
  ['09', 'Burgos', 'castilla-leon'], ['10', 'Cáceres', 'extremadura'],
  ['11', 'Cádiz', 'andalucia'], ['12', 'Castellón / Castelló', 'valenciana'],
  ['13', 'Ciudad Real', 'castilla-mancha'], ['14', 'Córdoba', 'andalucia'],
  ['15', 'A Coruña', 'galicia'], ['16', 'Cuenca', 'castilla-mancha'],
  ['17', 'Girona', 'cataluna'], ['18', 'Granada', 'andalucia'],
  ['19', 'Guadalajara', 'castilla-mancha'], ['20', 'Gipuzkoa', 'pais-vasco'],
  ['21', 'Huelva', 'andalucia'], ['22', 'Huesca', 'aragon'],
  ['23', 'Jaén', 'andalucia'], ['24', 'León', 'castilla-leon'],
  ['25', 'Lleida', 'cataluna'], ['26', 'La Rioja', 'rioja'],
  ['27', 'Lugo', 'galicia'], ['28', 'Madrid', 'madrid'],
  ['29', 'Málaga', 'andalucia'], ['30', 'Murcia', 'murcia'],
  ['31', 'Navarra', 'navarra'], ['32', 'Ourense', 'galicia'],
  ['33', 'Asturias', 'asturias'], ['34', 'Palencia', 'castilla-leon'],
  ['35', 'Las Palmas', 'canarias'], ['36', 'Pontevedra', 'galicia'],
  ['37', 'Salamanca', 'castilla-leon'], ['38', 'Santa Cruz de Tenerife', 'canarias'],
  ['39', 'Cantabria', 'cantabria'], ['40', 'Segovia', 'castilla-leon'],
  ['41', 'Sevilla', 'andalucia'], ['42', 'Soria', 'castilla-leon'],
  ['43', 'Tarragona', 'cataluna'], ['44', 'Teruel', 'aragon'],
  ['45', 'Toledo', 'castilla-mancha'], ['46', 'Valencia / València', 'valenciana'],
  ['47', 'Valladolid', 'castilla-leon'], ['48', 'Bizkaia', 'pais-vasco'],
  ['49', 'Zamora', 'castilla-leon'], ['50', 'Zaragoza', 'aragon'],
  ['51', 'Ceuta', 'ceuta'], ['52', 'Melilla', 'melilla'],
];

export const provinces: Province[] = rows
  .map(([code, name, regionId]) => ({ code, name, regionId }))
  .sort((a, b) => a.name.localeCompare(b.name, 'es'));

export function getRegion(provinceCode: string) {
  const province = provinces.find(p => p.code === provinceCode);
  return regions.find(r => r.id === province?.regionId);
}

export function normalizeMunicipalityName(name: string) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim()
    .replace(/^(.+),\s*(el|la|los|las|a|o|as|os|l['’])$/, (_match, town: string, article: string) => `${article}${article.endsWith("'") || article.endsWith('’') ? '' : ' '}${town}`)
    .replace(/’/g, "'").replace(/\s+/g, ' ');
}
