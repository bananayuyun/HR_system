import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const base = path.resolve(import.meta.dirname, '..');
const original = fs.readFileSync(path.resolve(base, '../../人力资源平台原型-v1.html'), 'utf8');
fs.mkdirSync(path.join(base, 'public/assets'), { recursive: true });
fs.mkdirSync(path.join(base, 'src/styles'), { recursive: true });
// Mechanical asset extraction: styles and embedded fonts are kept verbatim.
let css = [...original.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi)]
  .filter((m, i) => i === 0 || m[1].trim().startsWith('/*'))
  .map((m) => m[1])
  .join('\n');
css = css.replace(/data:([^;,]+);base64,([a-zA-Z0-9+/=]+)/g, (_, mime, encoded) => {
  const data = Buffer.from(encoded, 'base64');
  const ext = mime.includes('woff2')
    ? 'woff2'
    : mime.includes('woff')
      ? 'woff'
      : mime.includes('png')
        ? 'png'
        : 'bin';
  const name = crypto.createHash('sha256').update(data).digest('hex').slice(0, 16) + '.' + ext;
  fs.writeFileSync(path.join(base, 'public/assets', name), data);
  return '/assets/' + name;
});
fs.writeFileSync(path.join(base, 'src/styles/prototype.css'), css);
console.log(
  `Extracted ${css.length} characters of original CSS and ${fs.readdirSync(path.join(base, 'public/assets')).length} assets.`,
);
