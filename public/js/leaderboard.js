// Best scores: a per-device top 10 (localStorage) and an optional shared online board (Supabase
// REST, plain fetch, no SDK). If the online board isn't configured or can't be reached, the game
// quietly uses the device table instead.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const LOCAL_MAX = 10;
const GLOBAL_MAX = 50;
const TIMEOUT_MS = 6000;
const localKey = (bookId) => `gb.best.v1.${bookId}`;

// ---------- nicknames ----------
export const NICK_MAX = 12;
export function cleanNickname(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9 \-!._]/g, '').replace(/\s+/g, ' ').trim().slice(0, NICK_MAX);
}
// A small client-side filter for a kids' game: catches common rude words, including simple
// letter swaps (0→O, 1→I, 3→E, 4→A, 5→S, 7→T, @→A, $→S) and spaced/dotted spellings.
const BLOCK = ['FUCK', 'FUK', 'FCK', 'SHIT', 'BITCH', 'CUNT', 'DICK', 'COCK', 'PUSSY', 'ASSHOLE', 'BASTARD', 'WANK', 'TWAT',
  'SLUT', 'WHORE', 'PISS', 'BOLLOCK', 'PENIS', 'VAGINA', 'SEX', 'PORN', 'NAZI', 'HITLER', 'RAPE', 'NIGG', 'NIGA', 'FAGG', 'RETARD',
  'SPAZ', 'IDIOT', 'STUPID'];
const ALLOW = ['SUSSEX', 'ESSEX', 'SEXTON', 'COCKATOO', 'COCKATIEL', 'DICKENS', 'HANCOCK', 'PEACOCK', 'GRAPE', 'DRAPE', 'SCRAPE', 'TRAPE'];
export function nicknameProblem(raw) {
  const nick = cleanNickname(raw);
  if (!nick) return 'TYPE A NICKNAME';
  const squash = nick.replace(/[0]/g, 'O').replace(/[1!]/g, 'I').replace(/3/g, 'E').replace(/4/g, 'A').replace(/5/g, 'S').replace(/7/g, 'T')
    .replace(/[^A-Z]/g, '');
  const unAllowed = ALLOW.reduce((s, w) => s.split(w).join('#'), squash);
  if (BLOCK.some((w) => unAllowed.includes(w))) return 'PICK A FRIENDLIER NICKNAME';
  return null;
}

// ---------- device table ----------
function loadLocal(bookId) {
  try { const v = JSON.parse(localStorage.getItem(localKey(bookId))); return Array.isArray(v) ? v : []; } catch { return []; }
}
const sortScores = (a, b) => b.score_pct - a.score_pct || String(a.created_at).localeCompare(String(b.created_at));
export function localScores(bookId) { return loadLocal(bookId).sort(sortScores).slice(0, LOCAL_MAX); }
// Adds an entry; returns its position (1-based) in the device top 10, or null if it didn't make it.
export function addLocalScore(bookId, entry) {
  const row = { ...entry, created_at: entry.created_at || new Date().toISOString(), id: entry.id || 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) };
  const list = [...loadLocal(bookId), row].sort(sortScores).slice(0, LOCAL_MAX);
  try { localStorage.setItem(localKey(bookId), JSON.stringify(list)); } catch { /* storage full or blocked */ }
  const pos = list.findIndex((r) => r.id === row.id);
  return pos >= 0 ? pos + 1 : null;
}
export function bestLocal(bookId, nickname = null) {
  const list = localScores(bookId);
  return (nickname ? list.filter((r) => r.nickname === nickname) : list)[0] || null;
}

// ---------- shared online board ----------
export const globalConfigured = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);
// New-style publishable keys (sb_publishable_...) go in the `apikey` header only; they are not
// JWTs, so they must not be sent as `Authorization: Bearer` (see Supabase "API keys" docs).
// Legacy anon keys (JWTs starting with "eyJ") also accept a Bearer header, so we add it for them.
function headers(extra = {}) {
  const h = { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json', ...extra };
  if (SUPABASE_ANON_KEY.startsWith('eyJ')) h.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
  return h;
}
async function call(path, opts = {}) {
  if (!globalConfigured()) throw new Error('not configured');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, { ...opts, headers: headers(opts.headers), signal: ctl.signal });
    if (!res.ok) {
      let detail = '';
      try { const j = await res.json(); detail = j.message || j.code || ''; } catch { /* not json */ }
      const err = new Error(`HTTP ${res.status}${detail ? ': ' + detail : ''}`);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json().catch(() => null);
  } finally { clearTimeout(timer); }
}
// Cosmetic bonus stars live in an optional bonus_stars column (added by supabase/schema.sql).
// A table made before that column existed answers 400: then we read and post without it.
let starsColumn = true;
export async function fetchGlobal(limit = GLOBAL_MAX) {
  const q = (cols) => call(`scores?select=${cols}&order=score_pct.desc,created_at.asc&limit=${limit}`);
  const base = 'nickname,avatar,score_pct,rank,zodiac_count,created_at';
  let rows;
  if (starsColumn) {
    try { rows = await q(`${base},bonus_stars`); } catch (e) { if (e.status !== 400) throw e; starsColumn = false; }
  }
  if (!starsColumn) rows = await q(base);
  if (!Array.isArray(rows)) throw new Error('bad response');
  return rows;
}
export async function submitGlobal(entry) {
  const nickname = cleanNickname(entry.nickname);
  if (nicknameProblem(nickname)) throw new Error('nickname not allowed');
  const body = {
    nickname,
    avatar: entry.avatar || {},
    score_pct: Math.max(0, Math.min(100, Math.round(entry.score_pct))),
    rank: String(entry.rank || '').slice(0, 24),
    zodiac_count: Math.max(0, Math.min(12, entry.zodiac_count | 0)),
  };
  if (starsColumn) body.bonus_stars = Math.max(0, Math.min(999, entry.bonus_stars | 0));
  const post = (b) => call('scores', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(b) });
  try {
    await post(body);
  } catch (e) {
    if (e.status !== 400) throw e;
    // Older tables: no bonus_stars column yet, and/or zodiac_count only allows 0-11 (made before the
    // Dragon became the 12th animal). Retry with what such a table accepts rather than fail.
    const { bonus_stars: _s, ...plain } = body;
    if ('bonus_stars' in body) starsColumn = false;
    try { await post(plain); } catch (e2) {
      if (e2.status !== 400 || plain.zodiac_count !== 12) throw e2;
      await post({ ...plain, zodiac_count: 11 });
    }
  }
  return true;
}
