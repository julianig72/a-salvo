// Regenerates server/data/municipios-ine-2026.json from the official INE list.
// Usage: node scripts/build-municipalities.cjs diccionario26.xlsx [server/data/municipios-ine-2026.json]
// Source: https://www.ine.es/daco/daco42/codmun/diccionario26.xlsx (Relación de municipios y códigos, 1 de enero de 2026).
const fs = require('fs');
const zlib = require('zlib');

const [input, output = 'server/data/municipios-ine-2026.json'] = process.argv.slice(2);
if (!input) { console.error('Usage: node scripts/build-municipalities.cjs diccionario26.xlsx [output.json]'); process.exit(1); }

// Minimal XLSX (zip) reader: central directory + raw deflate, no dependencies.
const buf = fs.readFileSync(input);
const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
const files = {};
for (let i = 0, off = buf.readUInt32LE(eocd + 16), count = buf.readUInt16LE(eocd + 10); i < count; i++) {
  const method = buf.readUInt16LE(off + 10), size = buf.readUInt32LE(off + 20);
  const nameLen = buf.readUInt16LE(off + 28), extraLen = buf.readUInt16LE(off + 30), commentLen = buf.readUInt16LE(off + 32), header = buf.readUInt32LE(off + 42);
  const name = buf.subarray(off + 46, off + 46 + nameLen).toString();
  const start = header + 30 + buf.readUInt16LE(header + 26) + buf.readUInt16LE(header + 28);
  const data = buf.subarray(start, start + size);
  files[name] = method === 8 ? zlib.inflateRawSync(data) : data;
  off += 46 + nameLen + extraLen + commentLen;
}

const decode = s => s.replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const shared = [...files['xl/sharedStrings.xml'].toString().matchAll(/<si>([\s\S]*?)<\/si>/g)]
  .map(m => decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')));
const rows = [...files['xl/worksheets/sheet1.xml'].toString().matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)]
  .map(r => [...r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>(?:<v>([^<]*)<\/v>|<is><t>([^<]*)<\/t><\/is>)?<\/c>)/g)]
    .map(c => /t="s"/.test(c[2]) ? shared[+c[3]] : (c[3] ?? c[4])));

// Columns: CODAUTO, CPRO, CMUN, DC, NOMBRE. INE postposes articles ("Rozas de Madrid, Las"); show them in natural order.
const ARTICLE = /^(.+), (El|La|Los|Las|L'|l'|el|la|els|les|Els|Les|Es|Sa|Ses|A|O|As|Os)$/;
const display = name => name.split('/').map(part => {
  const m = ARTICLE.exec(part.trim());
  return m ? `${m[2]}${m[2].endsWith("'") ? '' : ' '}${m[1]}` : part.trim();
}).join('/');
const municipalities = rows
  .filter(r => r.length >= 5 && /^\d{2}$/.test(r[1]) && /^\d{3}$/.test(r[2]))
  .map(r => [r[1] + r[2], display(decode(r[4]).trim())])
  .sort((a, b) => a[0].localeCompare(b[0]));

fs.writeFileSync(output, JSON.stringify({
  source: 'INE · Relación de municipios y códigos a 1 de enero de 2026 (diccionario26.xlsx)',
  url: 'https://www.ine.es/daco/daco42/codmun/diccionario26.xlsx',
  municipalities,
}));
console.log(`${municipalities.length} municipios → ${output}`);
