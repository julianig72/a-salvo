// Run when publishing the static site: regional websites block browser (CORS) requests,
// so their availability is checked here and shipped as dist/source-status.json.
import { writeFileSync } from 'node:fs';
import { generalSources, nationalSources, regionalSources } from '../shared/sources';
import { checkSource } from '../server/services';

const all = new Map([...Object.values(nationalSources), ...Object.values(generalSources), ...Object.values(regionalSources)].map(source => [source.id, source]));
const queue = [...all.values()];
const results: Awaited<ReturnType<typeof checkSource>>[] = [];
await Promise.all(Array.from({ length: 4 }, async () => {
  for (let source = queue.shift(); source; source = queue.shift()) results.push(await checkSource(source));
}));
const checks = Object.fromEntries(results.map(result => [result.id, result]));
writeFileSync(new URL('../dist/source-status.json', import.meta.url), JSON.stringify({ generatedAt: new Date().toISOString(), checks }));
console.log(`Fuentes comprobadas: ${results.filter(r => r.status === 'available').length}/${results.length} disponibles.`);
