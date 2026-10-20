const EMPTY = '0000';
const MAX_LENGTH = 4;
const ALLOWED = /^[A-Za-zА-Яа-яЁё0-9]+$/;

export function normalizeUEI(value) {
  const source = String(value ?? '').trim();
  if (!source) return EMPTY;
  if (source.length > MAX_LENGTH) throw Error('UEI должен содержать не более 4 символов.');
  if (!ALLOWED.test(source)) throw Error('UEI может содержать только цифры и латинские или кириллические буквы.');
  const normalized = source.toUpperCase().padStart(MAX_LENGTH, '0');
  return normalized === EMPTY ? EMPTY : normalized;
}

