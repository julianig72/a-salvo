/** True in the static build (GitHub Pages): the browser queries the official services directly. */
export const STATIC_MODE = import.meta.env.MODE === 'static';

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!STATIC_MODE) return fetch(path, init);
  const { staticApi } = await import('./static-api');
  return staticApi(path, init);
}
