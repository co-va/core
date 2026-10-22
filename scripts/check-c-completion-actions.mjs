import fs from 'node:fs';
import path from 'node:path';

const EXCLUDED_DIRS = new Set([
  '.git', '.github', 'node_modules', 'server', 'tests', 'scripts', 'dist', 'build', 'coverage',
]);

const COMPLETION_LABEL = /^(?:Сохранить|Изменить|Исправить|Создать|Применить|Подтвердить|Отправить|Далее|Записаться|Рабочий|Выходной|Выгрузить|Проверить|Перенести|Готово|Завершить|Оплатить|Повторить)(?:\b|\s|$)/i;

function jsFilesUnder(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) return [];
      return jsFilesUnder(file);
    }
    return entry.isFile() && entry.name.endsWith('.js') ? [file] : [];
  });
}

function lineNumber(source, index) {
  return source.slice(0, index).split('\n').length;
}

function quotedLabels(source) {
  const labels = [];
  const regex = /\blabel\s*:\s*(['"`])([^'"`]+)\1/g;
  for (const match of source.matchAll(regex)) labels.push(match[2].trim());
  return labels;
}

function buttonLabels(source) {
  const labels = [];
  const regex = /\bbutton\(\s*(['"`])([^'"`]+)\1/g;
  for (const match of source.matchAll(regex)) labels.push(match[2].trim());
  return labels;
}

function stringLiterals(source) {
  const values = [];
  const regex = /(['"`])([^'"`\n]+)\1/g;
  for (const match of source.matchAll(regex)) values.push(match[2].trim());
  return values;
}

function readExpression(source, start) {
  let index = start;
  while (/\s/.test(source[index] || '')) index += 1;
  const begin = index;
  const stack = [];
  let quote = '';
  let escaped = false;

  for (; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{' || char === '[' || char === '(') {
      stack.push(char);
      continue;
    }
    if (char === '}' || char === ']' || char === ')') {
      if (!stack.length) break;
      stack.pop();
      continue;
    }
    if (char === ',' && !stack.length) break;
  }
  return source.slice(begin, index);
}

function completionLabels(source, { includeAllStrings = false } = {}) {
  const candidates = [...quotedLabels(source), ...buttonLabels(source), ...(includeAllStrings ? stringLiterals(source) : [])];
  return [...new Set(candidates.filter((label) => COMPLETION_LABEL.test(label)))];
}

const files = [
  ...fs.readdirSync('.', { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => entry.name),
  ...jsFilesUnder('.'),
].filter((file, index, all) => !file.startsWith('server/') && !file.startsWith('tests/') && !file.startsWith('scripts/') && all.indexOf(file) === index);

const failures = [];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');

  const cSource = /\bc\s*:/g;
  for (const match of source.matchAll(cSource)) {
    const expression = readExpression(source, match.index + match[0].length);
    const labels = completionLabels(expression, { includeAllStrings: true });
    for (const label of labels) {
      failures.push(`${file}:${lineNumber(source, match.index)} Header C completion-action «${label}»`);
    }
  }

  for (const marker of ['data-v2-primary-action', 'page-header-action']) {
    let offset = 0;
    while (true) {
      const index = source.indexOf(marker, offset);
      if (index < 0) break;
      const snippet = source.slice(Math.max(0, index - 360), Math.min(source.length, index + marker.length + 360));
      const labels = completionLabels(snippet);
      for (const label of labels) {
        failures.push(`${file}:${lineNumber(source, index)} ${marker} completion-action «${label}»`);
      }
      offset = index + marker.length;
    }
  }
}

const uniqueFailures = [...new Set(failures)];
if (uniqueFailures.length) {
  uniqueFailures.forEach((failure) => console.error(`C completion guard: ${failure}`));
  process.exit(1);
}

console.log('C completion action guard: OK');
