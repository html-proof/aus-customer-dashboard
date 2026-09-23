// Builds a static, serverless demo of the dashboard into demo/ (sample data, no login).
// Usage: node scripts/build-demo.js   (or npm run build:demo)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'public');
const out = path.join(root, 'demo');

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });

// Absolute app paths -> relative, so the demo works under a subpath (e.g. GitHub Pages)
const relativise = (s) => s
  .replace(/(['"`])\/login\.html\1/g, '$1login.html$1')
  .replace(/location\.href = (['"`])\/\1/g, 'location.href = $1index.html$1')
  .replace(/(src|href)="\/(?!\/)/g, '$1="');

for (const f of fs.readdirSync(out)) {
  if (!/\.(html|js)$/.test(f) || f === 'demo.js') continue;
  const p = path.join(out, f);
  fs.writeFileSync(p, relativise(fs.readFileSync(p, 'utf8')));
}

// index.html: install the mock before any other script, and add a demo badge
const BADGE = `<div id="demoBadge" title="This is a demo with made-up sample data. Changes are not saved."
  style="position:fixed;right:12px;bottom:12px;z-index:9999;background:rgba(15,92,70,.92);color:#fff;font:600 12px/1 Inter,system-ui,sans-serif;
  padding:7px 11px;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.15);pointer-events:none">Demo · sample data</div>`;
const indexPath = path.join(out, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
const firstScript = html.indexOf('<script');
if (firstScript < 0) throw new Error('No <script> in index.html');
html = html.slice(0, firstScript) + '<script>window.DEMO=true</script><script src="demo.js"></script>\n' + html.slice(firstScript);
html = html.replace(/<\/body>/i, BADGE + '\n</body>');
fs.writeFileSync(indexPath, html);

// No sign-in in the demo
fs.writeFileSync(path.join(out, 'login.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="0;url=index.html"><title>Redirecting…</title>
<script>location.replace('index.html')</script></head><body><a href="index.html">Open the demo</a></body></html>\n`);

// GitHub Pages: serve files as-is
fs.writeFileSync(path.join(out, '.nojekyll'), '');

console.log(`Demo built in ${path.relative(root, out)}/ (${fs.readdirSync(out).length} files)`);
