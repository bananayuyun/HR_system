import fs from 'node:fs';
import path from 'node:path';
const base = path.resolve(import.meta.dirname, '..');
const source = JSON.parse(
  fs.readFileSync(path.resolve(base, '../.local/prototype/state.json'), 'utf8'),
);
const pages = JSON.parse(
  fs.readFileSync(path.resolve(base, '../.local/prototype/captures.json'), 'utf8'),
);
fs.mkdirSync(path.join(base, 'src/config'), { recursive: true });
// Copy schema only. Do not package prototype employee or candidate data.
fs.writeFileSync(
  path.join(base, 'src/config/prototype-metadata.json'),
  JSON.stringify(
    {
      schemas: Object.fromEntries(pages.map((p) => [p.route, p.schemas])),
      employeeSections: source.employeeSections,
      importConfig: Object.fromEntries(
        Object.entries(source.importConfig).map(([key, value]) => [key, { ...value, sample: [] }]),
      ),
    },
    null,
    2,
  ),
);
