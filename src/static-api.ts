// Browser implementation of /api/* for the static build. It reuses the server handlers;
// official sources are checked when the site is published (source-status.json) because
// regional websites do not allow cross-origin requests from the browser.
import { addresses, mapCatalog, mapLocation, mapPoint, municipalities, resolve, reverseLocation, sourcesCheck, type ApiResult } from '../server/handlers';
import type { OfficialSource, SourceCheck } from '../shared/types';

let statusFile: Promise<{ generatedAt?: string; checks: Record<string, SourceCheck> }> | null = null;
function publishedStatus() {
  statusFile ??= fetch(`${import.meta.env.BASE_URL}source-status.json`, { cache: 'no-cache' })
    .then(response => (response.ok ? response.json() : { checks: {} }))
    .catch(() => { statusFile = null; return { checks: {} }; });
  return statusFile;
}

async function publishedCheck(source: OfficialSource): Promise<SourceCheck> {
  const { generatedAt, checks } = await publishedStatus();
  const found = checks[source.id];
  if (found) return { ...found, detail: `${found.detail} (comprobado al publicar la web${generatedAt ? ` el ${new Date(generatedAt).toLocaleDateString('es-ES')}` : ''})` };
  return { id: source.id, status: 'unavailable', checkedAt: new Date().toISOString(), detail: 'No hay una comprobación reciente de este enlace. Ábrelo para confirmar que sigue disponible.' };
}

async function route(path: string, body: unknown): Promise<ApiResult> {
  const url = new URL(path, 'https://local.invalid');
  const q = url.searchParams;
  switch (url.pathname) {
    case '/api/sources/check': return sourcesCheck(body, publishedCheck);
    case '/api/location': return reverseLocation(body);
    case '/api/maps/location': return mapLocation(body);
    case '/api/maps/catalog': return mapCatalog();
    case '/api/maps/point': return mapPoint(body);
    case '/api/geo/municipalities': return municipalities(q.get('q') ?? undefined, q.get('province') ?? undefined);
    case '/api/geo/addresses': return addresses(q.get('q') ?? undefined, q.get('municipality') ?? undefined);
    case '/api/geo/addresses/resolve': return resolve(body);
    default: return { status: 404, body: { error: 'Ruta no encontrada.' } };
  }
}

export async function staticApi(path: string, init: RequestInit): Promise<Response> {
  init.signal?.throwIfAborted();
  let body: unknown;
  try { body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined; } catch { body = undefined; }
  const work = route(path, body);
  const result = init.signal
    ? await Promise.race([work, new Promise<never>((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true }))])
    : await work;
  return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json' } });
}
