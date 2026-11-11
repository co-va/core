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
  // Never allow the HTML parser to treat bundled JS string content as closing script markup.
  const safeJs = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  scripts.push('<script type="module" data-preview-module="' + entry + '">\n' + safeJs + '\n</script>');
}

html = html.replace(/^\s*<link rel="modulepreload"[^>]*>\s*$/gm, '');
html = html.replace(/^\s*<script type="module" src="[^"]+"><\/script>\s*$/gm, '');
if (/rel="stylesheet"|rel="modulepreload"|<script[^>]+src=/.test(html)) {
  throw new Error('Unexpected external CSS/JS dependency in preview HTML');
}
// Always use replacement callbacks: JS replacement strings expand 'html = html.replace('</head>', '<style data-preview-style>\n' + safeCss + '\n</style>\n</head>');
html = html.replace('</body>', scripts.join('\n') + '\n</body>');
const fingerprint = createHash('sha256').update(html).digest('hex').slice(0, 12);' to the matched
// HTML tag. A minified expression like 'html = html.replace('</head>', '<style data-preview-style>\n' + safeCss + '\n</style>\n</head>');
html = html.replace('</body>', scripts.join('\n') + '\n</body>');
const fingerprint = createHash('sha256').update(html).digest('hex').slice(0, 12);&callback' previously became '</body>&callback',
// silently corrupting the compiled JavaScript and leaving Admin with a blank screen.
html = html.replace('</head>', () => '<style data-preview-style>\n' + safeCss + '\n</style>\n</head>');
html = html.replace('</body>', () => scripts.join('\n') + '\n</body>');
if ((html.match(/<\\/body>/g) || []).length !== 1) {
  throw new Error('Corrupt Admin preview: the closing body tag appeared inside the inline modules');
}
const inlineModules = [...html.matchAll(/<script type="module" data-preview-module="[^"]+">\\n([\\s\\S]*?)\\n<\\/script>/g)];
if (inlineModules.length !== entries.length) {
  throw new Error('Corrupt Admin preview: wrong number of inlined modules');
}
for (const [, compiledModule] of inlineModules) {
  await transform(compiledModule, { loader: 'js', format: 'esm', target: 'es2022', logLevel: 'silent' });
}
const fingerprint = createHash('sha256').update(html).digest('hex').slice(0, 12);
html = '<!-- Generated from admin/index.source.html and the Admin UI by scripts/build-admin-preview.mjs. Do not edit directly. -->\n'
  + '<!-- content-sha256: ' + fingerprint + ' -->\n'
  + html;
writeFileSync(resolve(adminRoot, 'index.html'), html);
console.log('Self-contained Admin staging preview: ' + (Buffer.byteLength(html) / 1024).toFixed(1) + ' KiB, revision ' + fingerprint);
