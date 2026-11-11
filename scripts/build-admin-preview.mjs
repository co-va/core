import { build, transform } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const root = process.cwd();
const adminRoot = resolve(root, 'admin');
const sourceHtml = readFileSync(resolve(adminRoot, 'index.source.html'), 'utf8');

const stylesheetPaths = [];
let html = sourceHtml.replace(/^\s*<link rel="stylesheet" href="([^"]+)">\s*$/gm, (_whole, href) => {
  stylesheetPaths.push(resolve(adminRoot, href));
  return '';
});
if (stylesheetPaths.length !== 9) {
  throw new Error('Admin preview stylesheet contract changed: expected 9 source styles');
}

const styles = stylesheetPaths.map((file) => readFileSync(file, 'utf8')).join('\n');
const compiledCss = await transform(styles, { loader: 'css', minify: true, legalComments: 'none' });
const safeCss = compiledCss.code.replace(/<\/style/gi, '<\\/style');

const entries = ['admin.js', 'commercial-tenant.js'];
const scripts = [];
for (const entry of entries) {
  const result = await build({
    entryPoints: [resolve(adminRoot, entry)],
    outfile: resolve(adminRoot, entry.replace('.js', '.preview.js')),
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: ['es2022'],
    minify: true,
    keepNames: true,
    legalComments: 'none',
    write: false,
    logLevel: 'warning',
  });
  if (result.outputFiles.length !== 1) {
    throw new Error('Preview bundle must be a single inline script: ' + entry);
  }
  // All generated script bodies stay inline. Callback replacement below is
  // essential:   // Keep HTML syntax entirely separate from bundled JavaScript: an inline HTML
  // tokenizer can corrupt a template-heavy module even when the JS is valid.
  // Data URL imports preserve the single-request preview with no eval or
  // additional network request and no exposure to embedded HTML tag sequences.
  const encodedJs = Buffer.from(result.outputFiles[0].text, 'utf8').toString('base64');
  scripts.push('<script type="module" data-preview-module="' + entry
    + '">import "data:text/javascript;base64,' + encodedJs + '";</script>'); in esbuild output must never expand into </body> HTML.
  const safeJs = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  scripts.push('<script type="module" data-preview-module="' + entry + '">\n' + safeJs + '\n</script>');
}

html = html.replace(/^\s*<link rel="modulepreload"[^>]*>\s*$/gm, '');
html = html.replace(/^\s*<script type="module" src="[^"]+"><\/script>\s*$/gm, '');
if (/rel="stylesheet"|rel="modulepreload"|<script[^>]+src=/.test(html)) {
  throw new Error('Unexpected external CSS/JS dependency in preview HTML');
}
// Replacement callbacks are required: String.replace treats '$&' in a replacement string
// as the matched HTML closing tag. Esbuild-generated variable names can contain '$&'
// and that previously inserted literal HTML into valid JavaScript.
html = html.replace('</head>', () => '<style data-preview-style>\n' + safeCss + '\n</style>\n</head>');
html = html.replace('</body>', () => scripts.join('\n') + '\n</body>');
if (html.split('</body>').length !== 2) {
  throw new Error('Corrupt Admin preview: unexpected closing body tag inside a module');
}
for (const entry of entries) {
  const marker = '<script type="module" data-preview-module="' + entry + '">\n';
  const from = html.indexOf(marker);
  const to = html.indexOf('\n</script>', from + marker.length);
  if (from < 0 || to < 0) throw new Error('Missing inlined Admin module: ' + entry);
  const compiledModule = html.slice(from + marker.length, to);
  await transform(compiledModule, { loader: 'js', format: 'esm', target: 'es2022', logLevel: 'silent' });
}
const fingerprint = createHash('sha256').update(html).digest('hex').slice(0, 12);
html = '<!-- Generated from admin/index.source.html and the Admin UI by scripts/build-admin-preview.mjs. Do not edit directly. -->\n'
  + '<!-- content-sha256: ' + fingerprint + ' -->\n'
  + html;
writeFileSync(resolve(adminRoot, 'index.html'), html);
console.log('Self-contained Admin staging preview: ' + (Buffer.byteLength(html) / 1024).toFixed(1) + ' KiB, revision ' + fingerprint);
