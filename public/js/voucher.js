// PLAY AGAIN VOUCHERS. Only the hidden all-12-zodiac route earns one (the LEGEND! finale). A code
// is self-checking (6 random characters + 2 check characters), so it can be printed or screenshotted
// and typed back in on any device. Redeeming one in the creator gives the next game a one-time
// bonus; used codes are remembered on this device. This is the only link between two games.
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I/L to mix up
const SALT = 'neon-dragon:play-again';
export const VOUCHER_BONUS = [{ stat: 'tokens', add: 2 }];
export const VOUCHER_BONUS_TEXT = '+2 TOKENS';

function checkChars(body) {
  let h = 0x811c9dc5; // FNV-1a
  for (const ch of SALT + body) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return ALPHA[h % ALPHA.length] + ALPHA[Math.floor(h / ALPHA.length) % ALPHA.length];
}
const format = (raw) => `ND-${raw.slice(0, 4)}-${raw.slice(4, 8)}`;

export function makeVoucherCode(rng = Math.random) {
  let body = '';
  for (let i = 0; i < 6; i++) body += ALPHA[Math.floor(rng() * ALPHA.length) % ALPHA.length];
  return format(body + checkChars(body));
}

// "nd 7kq2 ab9x" → "ND-7KQ2-AB9X" when it is a valid code, otherwise null.
export function normalizeVoucher(input) {
  let raw = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.startsWith('ND') && raw.length === 10) raw = raw.slice(2);
  if (raw.length !== 8 || [...raw].some((c) => !ALPHA.includes(c))) return null;
  return checkChars(raw.slice(0, 6)) === raw.slice(6) ? format(raw) : null;
}
export const isValidVoucher = (input) => normalizeVoucher(input) !== null;
