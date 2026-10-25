import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const scopeFile = path.join(root, '.task-scope.json');
const lockFile = path.join(root, '.task-scope.lock');

function fail(message, details = []) {
  console.error(`task scope: FAILED\n- ${message}`);
  for (const item of details) console.error(`- ${item}`);
  process.exit(1);
}

function runGit(args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    if (allowFailure) return '';
    const stderr = String(error?.stderr || '').trim();
    fail(`git ${args.join(' ')} failed`, stderr ? [stderr] : []);
  }
}

function hash(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function parseArgs(argv) {
  const out = { allow: [], deny: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    if (key === 'allow' || key === 'deny') {
      const value = argv[++i];
      if (!value) fail(`missing value for --${key}`);
      out[key].push(value);
      continue;
    }
    const value = argv[++i];
    if (!value) fail(`missing value for --${key}`);
    out[key] = value;
  }
  return out;
}

function cleanPattern(value) {
  return String(value || '').trim().replace(/^\.\//, '').replaceAll('\\', '/');
}

function patternToRegExp(pattern) {
  const input = cleanPattern(pattern);
  if (!input) fail('empty scope pattern is forbidden');
  let out = '^';
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];
    if (char === '*' && next === '*') {
      out += '.*';
      i += 1;
    } else if (char === '*') {
      out += '[^/]*';
    } else if (char === '?') {
      out += '[^/]';
    } else {
      out += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  out += '$';
  return new RegExp(out);
}

function matches(file, patterns) {
  return patterns.some((pattern) => patternToRegExp(pattern).test(file));
}

function assertCleanBeforeInit() {
  const status = runGit(['status', '--porcelain']);
  if (status) {
    fail('scope must be fixed before the first project change; working tree is not clean', status.split('\n').slice(0, 20));
  }
}

function init(argv) {
  if (fs.existsSync(scopeFile) || fs.existsSync(lockFile)) {
    fail('an active task scope already exists; close it before starting a new stage');
  }
  assertCleanBeforeInit();
  const args = parseArgs(argv);
  if (!args.task) fail('--task is required');
  if (!args.contour) fail('--contour is required');
  if (!args.allow.length) fail('at least one --allow pattern is required');

  const branch = runGit(['branch', '--show-current']);
  if (branch !== 'staging') fail(`scope can be initialized only on staging; current branch is ${branch || '(detached)'}`);
  const baseSha = runGit(['rev-parse', 'HEAD']);

  const payload = {
    version: 1,
    task: String(args.task).trim(),
    contour: String(args.contour).trim(),
    baseSha,
    branch,
    allow: [...new Set(args.allow.map(cleanPattern))],
    deny: [...new Set(args.deny.map(cleanPattern))],
    createdAt: new Date().toISOString(),
  };

  const text = `${JSON.stringify(payload, null, 2)}\n`;
  fs.writeFileSync(scopeFile, text, 'utf8');
  fs.writeFileSync(lockFile, `${hash(text)}\n`, 'utf8');
  console.log(`task scope: LOCKED\n- task: ${payload.task}\n- contour: ${payload.contour}\n- base: ${payload.baseSha}\n- allow: ${payload.allow.join(', ')}${payload.deny.length ? `\n- deny: ${payload.deny.join(', ')}` : ''}`);
}

function loadLockedScope() {
  if (!fs.existsSync(scopeFile) || !fs.existsSync(lockFile)) {
    fail('no active locked scope; initialize scope before changing project files');
  }
  const text = fs.readFileSync(scopeFile, 'utf8');
  const expected = fs.readFileSync(lockFile, 'utf8').trim();
  const actual = hash(text);
  if (!expected || expected !== actual) {
    fail('task scope was changed after it was locked; cross-contour expansion is forbidden');
  }
  let scope;
  try {
    scope = JSON.parse(text);
  } catch {
    fail('.task-scope.json is not valid JSON');
  }
  if (scope?.version !== 1) fail('unsupported task scope version');
  if (!scope.baseSha || !scope.branch || !Array.isArray(scope.allow) || !scope.allow.length) {
    fail('task scope is incomplete');
  }
  return scope;
}

function changedFiles(baseSha) {
  runGit(['cat-file', '-e', `${baseSha}^{commit}`]);
  const ancestor = runGit(['merge-base', '--is-ancestor', baseSha, 'HEAD'], { allowFailure: true });
  void ancestor;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', baseSha, 'HEAD'], { cwd: root, stdio: 'ignore' });
  } catch {
    fail(`scope base ${baseSha} is no longer an ancestor of HEAD; start a new stage from the current HEAD`);
  }

  const sets = [
    runGit(['diff', '--name-only', '--diff-filter=ACDMRTUXB', '--no-renames', `${baseSha}..HEAD`], { allowFailure: true }),
    runGit(['diff', '--name-only', '--diff-filter=ACDMRTUXB', '--no-renames'], { allowFailure: true }),
    runGit(['diff', '--cached', '--name-only', '--diff-filter=ACDMRTUXB', '--no-renames'], { allowFailure: true }),
    runGit(['ls-files', '--others', '--exclude-standard'], { allowFailure: true }),
  ];
  const files = new Set();
  for (const block of sets) {
    for (const file of String(block || '').split('\n')) {
      const clean = cleanPattern(file);
      if (clean && clean !== '.task-scope.json' && clean !== '.task-scope.lock') files.add(clean);
    }
  }
  return [...files].sort();
}

function check() {
  const scope = loadLockedScope();
  const branch = runGit(['branch', '--show-current']);
  if (branch !== scope.branch || branch !== 'staging') {
    fail(`branch changed after scope lock; expected staging, got ${branch || '(detached)'}`);
  }

  const files = changedFiles(scope.baseSha);
  const violations = [];
  for (const file of files) {
    if (scope.deny?.length && matches(file, scope.deny)) {
      violations.push(`${file}: matches DENY`);
      continue;
    }
    if (!matches(file, scope.allow)) violations.push(`${file}: outside ALLOW`);
  }

  if (violations.length) {
    fail(`scope violation in ${scope.contour} / ${scope.task}`, violations);
  }

  console.log(`task scope: OK\n- task: ${scope.task}\n- contour: ${scope.contour}\n- changed files: ${files.length}${files.length ? `\n  ${files.join('\n  ')}` : ''}`);
}

function checkIfActive() {
  if (!fs.existsSync(scopeFile) && !fs.existsSync(lockFile)) {
    console.log('task scope: SKIPPED (no active local scope)');
    return;
  }
  check();
}

function close() {
  check();
  const status = runGit(['status', '--porcelain']);
  const projectChanges = status
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.endsWith('.task-scope.json') && !line.endsWith('.task-scope.lock'));
  if (projectChanges.length) {
    fail('cannot close scope with uncommitted project changes; commit or revert the completed stage first', projectChanges.slice(0, 20));
  }
  fs.rmSync(scopeFile, { force: true });
  fs.rmSync(lockFile, { force: true });
  console.log('task scope: CLOSED');
}

const [command, ...argv] = process.argv.slice(2);
if (command === 'init') init(argv);
else if (command === 'check') check();
else if (command === 'check-if-active') checkIfActive();
else if (command === 'close') close();
else {
  console.error('Usage:\n  node scripts/task-scope.mjs init --task "..." --contour "..." --allow "path/**" [--allow "file"] [--deny "path/**"]\n  node scripts/task-scope.mjs check\n  node scripts/task-scope.mjs check-if-active\n  node scripts/task-scope.mjs close');
  process.exit(2);
}
