const RADIUS = 6378137;
const WORLD = 2 * Math.PI * RADIUS;
export const MAP_WIDTH = 1000;
export const MAP_HEIGHT = 620;

export function project(lat: number, lon: number): [number, number] {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85.05112878 || Math.abs(lon) > 180) throw new Error('Coordenadas fuera de la proyección del mapa.');
  return [RADIUS * lon * Math.PI / 180, RADIUS * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
}

export function unproject(x: number, y: number): [number, number] {
  return [(2 * Math.atan(Math.exp(y / RADIUS)) - Math.PI / 2) * 180 / Math.PI, x / RADIUS * 180 / Math.PI];
}

export function metersPerPixel(zoom: number) {
  return WORLD / (256 * 2 ** zoom);
}

export function mapBounds(lat: number, lon: number, zoom: number, width = MAP_WIDTH, height = MAP_HEIGHT): [number, number, number, number] {
  const [x, y] = project(lat, lon);
  const halfWidth = width * metersPerPixel(zoom) / 2;
  const halfHeight = height * metersPerPixel(zoom) / 2;
  return [x - halfWidth, y - halfHeight, x + halfWidth, y + halfHeight];
}

export function isValidBbox(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = value.split(',').map(Number);
  return parts.length === 4 && parts.every(n => Number.isFinite(n) && Math.abs(n) <= WORLD / 2)
    && parts[0] < parts[2] && parts[1] < parts[3] && parts[2] - parts[0] <= WORLD / 2 && parts[3] - parts[1] <= WORLD / 2;
}
