import { mapBounds, metersPerPixel } from '../shared/map-math';
import { EMS_DEGREES, seismicSummary } from '../shared/seismic';
import type { MapCatalog, MapLayerId, MapSnapshot, PointCheck } from '../shared/types';

export const FLOOD_COLORS = { flood100: '#E8BEFF', flood500: '#FF73DF' } as const;
export const FIRE_LEGEND: [string, string][] = [
  ['Bajo <11,2', '#9CFFC0'], ['Moderado 11,2–21,3', '#CDE24E'], ['Alto 21,3–38', '#E6AC00'],
  ['Muy alto 38–50', '#D97010'], ['Extremo 50–70', '#AD060E'], ['Muy extremo >70', '#3A0015'],
];
export const LAYER_OPACITY: Partial<Record<MapLayerId, number>> = { flood100: 0.7, flood500: 0.7, fire: 0.58, seismic: 0.5 };

let catalogCache: { at: number; value: Promise<MapCatalog> } | null = null;
export function getCatalog(): Promise<MapCatalog> {
  if (!catalogCache || Date.now() - catalogCache.at > 600000) {
    const value = fetch('/api/maps/catalog', { signal: AbortSignal.timeout(20000) }).then(async response => {
      if (!response.ok) throw new Error('No se ha podido consultar el catálogo cartográfico.');
      return response.json() as Promise<MapCatalog>;
    });
    value.catch(() => { if (catalogCache?.value === value) catalogCache = null; });
    catalogCache = { at: Date.now(), value };
  }
  return catalogCache.value;
}

export type PointResponse = Omit<PointCheck, 'municipality' | 'provinceCode' | 'fwi'> & { fwi?: (NonNullable<PointCheck['fwi']> & { components?: Record<string, number> }) | null };

/** Queries SNCZI, EFFIS and IGN at one point (coordinates rounded to ~10 m). */
export async function fetchPoint(lat: number, lon: number): Promise<PointResponse> {
  const response = await fetch('/api/maps/point', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat: Number(lat.toFixed(4)), lon: Number(lon.toFixed(4)) }), signal: AbortSignal.timeout(25000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'No se ha podido consultar el punto.');
  return body as PointResponse;
}

export function toPointCheck(body: PointResponse, municipality: string, provinceCode: string): PointCheck {
  return {
    lat: body.lat, lon: body.lon, checkedAt: body.checkedAt, flood100: body.flood100, flood500: body.flood500,
    fwi: body.fwi ? { value: body.fwi.value, date: body.fwi.date, className: body.fwi.className } : null,
    ...(body.fwiError ? { fwiError: body.fwiError } : {}), ...(body.seismic ? { seismic: body.seismic } : {}),
    municipality, provinceCode,
  };
}

export function layerImageUrl(id: MapLayerId, bbox: string, width: number, height: number, catalog: MapCatalog) {
  const date = catalog.layers.find(layer => layer.id === 'fire')?.date;
  return `/api/maps/image?${new URLSearchParams({ layer: id, bbox, width: String(width), height: String(height), ...(id === 'fire' && date ? { date } : {}) })}`;
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement | null>(resolve => {
    const image = new Image();
    image.onload = () => resolve(image.naturalWidth ? image : null);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

interface Panel { layers: MapLayerId[]; zoom: number; x: number; y: number; w: number; h: number; title: string }

const WIDTH = 1000;

/** Renders the three official hazard views centred on the user's point: flood (street scale), fire and seismic (regional scale). */
export async function renderHazardSnapshot({ lat, lon, marker, municipality, provinceCode, point }: {
  lat: number; lon: number; marker: boolean; municipality: string; provinceCode: string; point?: PointCheck | null;
}): Promise<MapSnapshot> {
  const catalog = await getCatalog();
  const available = (id: MapLayerId) => catalog.layers.find(layer => layer.id === id)?.available ?? false;
  const fireDate = catalog.layers.find(layer => layer.id === 'fire')?.date;
  const panels: Panel[] = [
    { layers: ['flood500', 'flood100'], zoom: marker ? 15 : 13, x: 0, y: 56, w: WIDTH, h: 500, title: 'Inundación · zonas inundables SNCZI (T100 y T500)' },
    { layers: ['fire'], zoom: 9, x: 0, y: 620, w: 490, h: 340, title: `Incendio · índice FWI EFFIS${fireDate ? ` (${fireDate})` : ''}` },
    { layers: ['seismic'], zoom: 7, x: 510, y: 620, w: 490, h: 340, title: 'Terremoto · peligrosidad sísmica IGN (EMS-98)' },
  ];
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH; canvas.height = 1130;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Tu navegador no permite generar el mapa.');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#141414'; ctx.font = '600 22px sans-serif';
  ctx.fillText(`A salvo · Peligros oficiales en ${marker ? 'tu dirección' : municipality}`, 0, 30, WIDTH);
  ctx.font = '13px sans-serif'; ctx.fillStyle = '#6b6b6b';
  ctx.fillText(`${municipality} · ${lat.toFixed(4)}, ${lon.toFixed(4)} · ${new Date().toLocaleString('es-ES')}`, 0, 48, WIDTH);

  const missing: string[] = [];
  await Promise.all(panels.map(async panel => {
    const bbox = mapBounds(lat, lon, panel.zoom, panel.w, panel.h).map(n => n.toFixed(2)).join(',');
    const ids: MapLayerId[] = ['base', ...panel.layers.filter(available)];
    const images = await Promise.all(ids.map(id => loadImage(layerImageUrl(id, bbox, panel.w, panel.h, catalog))));
    return { panel, ids, images };
  })).then(results => results.forEach(({ panel, ids, images }) => {
    ctx.save();
    ctx.beginPath(); ctx.rect(panel.x, panel.y, panel.w, panel.h); ctx.clip();
    ctx.fillStyle = '#eeeeea'; ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
    ids.forEach((id, index) => {
      const image = images[index];
      if (!image) { if (id !== 'base') missing.push(panel.title.split(' · ')[0]); return; }
      ctx.globalAlpha = LAYER_OPACITY[id] ?? 1;
      ctx.drawImage(image, panel.x, panel.y, panel.w, panel.h);
    });
    if (panel.layers.some(id => !available(id))) missing.push(panel.title.split(' · ')[0]);
    ctx.globalAlpha = 1;
    const cx = panel.x + panel.w / 2; const cy = panel.y + panel.h / 2;
    if (marker) {
      ctx.fillStyle = '#141414'; ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(cx, cy, 4.5, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.strokeStyle = '#141414'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.font = '600 13px sans-serif';
    const label = panel.title;
    ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fillRect(panel.x + 8, panel.y + 8, Math.min(panel.w - 16, ctx.measureText(label).width + 16), 24);
    ctx.fillStyle = '#141414'; ctx.fillText(label, panel.x + 16, panel.y + 25, panel.w - 32);
    const km = metersPerPixel(panel.zoom) * Math.cos(lat * Math.PI / 180) * panel.w / 1000;
    ctx.font = '11px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillRect(panel.x + panel.w - 118, panel.y + panel.h - 22, 110, 16);
    ctx.fillStyle = '#3a3a37'; ctx.fillText(`Ancho ≈ ${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} km`, panel.x + panel.w - 112, panel.y + panel.h - 10);
    ctx.restore();
  }));

  const swatch = (x: number, y: number, color: string, label: string, width = 150) => {
    ctx.fillStyle = color; ctx.fillRect(x, y, 14, 11); ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1; ctx.strokeRect(x, y, 14, 11);
    ctx.fillStyle = '#3a3a37'; ctx.font = '11px sans-serif'; ctx.fillText(label, x + 19, y + 10, width - 22);
  };
  swatch(0, 568, FLOOD_COLORS.flood100, 'T100 · 1 % anual', 160);
  swatch(170, 568, FLOOD_COLORS.flood500, 'T500 · 0,2 % anual', 170);
  ctx.fillStyle = '#3a3a37'; ctx.font = '11px sans-serif';
  const floodText = point ? `Tu punto: T100 ${point.flood100.status === 'inside' ? 'DENTRO' : point.flood100.status === 'outside' ? 'fuera' : 'sin datos'} · T500 ${point.flood500.status === 'inside' ? 'DENTRO' : point.flood500.status === 'outside' ? 'fuera' : 'sin datos'}` : 'Solo inundación fluvial de los tramos estudiados.';
  ctx.fillText(floodText, 360, 578, WIDTH - 360);
  FIRE_LEGEND.forEach(([label, color], i) => swatch((i % 3) * 163, 972 + Math.floor(i / 3) * 18, color, label, 163));
  ctx.fillText(point?.fwi ? `Tu punto: FWI ${point.fwi.value.toFixed(1).replace('.', ',')} · ${point.fwi.className}` : 'Resolución ≈ 8 km. No es probabilidad de incendio.', 0, 1022, 490);
  Object.entries(EMS_DEGREES).forEach(([, degree], i) => swatch(510 + (i % 3) * 163, 972 + Math.floor(i / 3) * 18, degree.color, `${degree.roman} ${degree.name}`, 163));
  ctx.fillStyle = '#3a3a37'; ctx.font = '11px sans-serif';
  ctx.fillText(point?.seismic ? `Tu punto: ${seismicSummary(point.seismic)}` : '475 años de periodo de retorno. No predice terremotos.', 510, 1022, 490);
  ctx.fillStyle = '#141414'; ctx.font = '600 11.5px sans-serif';
  ctx.fillText('Sin color NO significa sin riesgo. No son rutas seguras ni una evaluación de tu vivienda.', 0, 1052, WIDTH);
  ctx.font = '11px sans-serif'; ctx.fillStyle = '#3a3a37';
  ctx.fillText('Fuentes: IGN (mapa base y peligrosidad sísmica 2015) · MITECO/SNCZI · Copernicus EMS/EFFIS. Transparencia aplicada a las capas.', 0, 1070, WIDTH);
  ctx.fillText(marker ? 'Círculo negro: tu dirección validada en CartoCiudad o el punto que has marcado.' : 'Círculo: centro del municipio. Añade tu calle y número para consultar tu dirección exacta.', 0, 1088, WIDTH);
  if (missing.length) { ctx.fillStyle = '#b3261e'; ctx.fillText(`Capas no disponibles al generar: ${[...new Set(missing)].join(', ')}. Su ausencia no significa ausencia de peligro.`, 0, 1106, WIDTH); }
  return {
    dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height, municipality, provinceCode, createdAt: new Date().toISOString(),
    layers: catalog.layers.filter(layer => layer.id !== 'base' && layer.available),
  };
}
