// Pixel avatar: 16x16 sprite assembled from layers, drawn on a canvas and scaled with
// CSS `image-rendering: pixelated` so it stays crisp at any size.

// skins 6-8 (blue, green, grey) were added in v2.3.0: new colours go on the END so saved
// avatars (which store an index) keep their skin.
export const SKINS = ['#ffdbb5', '#f5c28f', '#e0a370', '#c68650', '#9a5f34', '#6b3f22', '#5b8cff', '#5fd068', '#a3a7b5'];
export const SKIN_NAMES = ['peach', 'sand', 'honey', 'caramel', 'chestnut', 'cocoa', 'blue', 'green', 'grey'];
export const HAIR_COLORS = ['#1b1b2a', '#5a3215', '#a8642a', '#f2c94c', '#ff5d8f', '#29e7ff', '#9b5cff', '#eeeeee'];
export const OUTFITS = ['#ff2e88', '#29e7ff', '#3dff6e', '#ffd23f', '#8a3ffc', '#ff7a1a', '#f5f5f5', '#5b8cff'];
export const HAIR_STYLES = ['short', 'spiky', 'long', 'bun', 'pigtails'];
export const ACCESSORIES = ['none', 'cap', 'glasses', 'headphones', 'crown'];
// optional extras: each one is an independent on/off switch (stored as true, or left out)
export const EXTRAS = ['beard', 'beanie', 'cape'];
export const LABELS = {
  short: 'SHORT', spiky: 'SPIKY', long: 'LONG', bun: 'BUN', pigtails: 'PIGTAILS',
  none: 'NONE', cap: 'CAP', glasses: 'GLASSES', headphones: 'PHONES', crown: 'CROWN',
  beard: 'BEARD', beanie: 'BEANIE', cape: 'CAPE',
};

export const PRESETS = [
  { label: 'NEON NINJA', skin: 1, hairStyle: 'spiky', hairColor: 0, outfit: 4, accessory: 'headphones' },
  { label: 'STAR PILOT', skin: 3, hairStyle: 'short', hairColor: 1, outfit: 1, accessory: 'cap' },
  { label: 'PIXEL WIZARD', skin: 0, hairStyle: 'long', hairColor: 6, outfit: 0, accessory: 'none' },
  { label: 'HARBOUR HERO', skin: 2, hairStyle: 'pigtails', hairColor: 4, outfit: 2, accessory: 'none' },
  { label: 'ARCADE ACE', skin: 4, hairStyle: 'bun', hairColor: 3, outfit: 3, accessory: 'glasses' },
  { label: 'DRAGON RIDER', skin: 5, hairStyle: 'short', hairColor: 5, outfit: 5, accessory: 'crown' },
];

const BASE = [
  '................',
  '................',
  '................',
  '....SSSSSSSS....',
  '....SSSSSSSS....',
  '....SSSSSSSS....',
  '....SEESSEES....',
  '....SSSSSSSS....',
  '.....SSMMSS.....',
  '......SSSS......',
  '....OOOXXOOO....',
  '...SOOOXXOOOS...',
  '...SOOOOOOOOS...',
  '....PPPPPPPP....',
  '....PPP..PPP....',
  '...BBBB..BBBB...',
];

const HAIR = {
  short: { 2: '.....HHHHHH.....', 3: '....HHHHHHHH....', 4: '....HHHHHHHH....', 5: '....H......H....' },
  spiky: { 0: '.....H.H..H.....', 1: '....HHHHHHHH....', 2: '...HHHHHHHHHH...', 3: '...HHHHHHHHHH...', 4: '....HHHHHHHH....', 5: '....H......H....' },
  long: { 2: '.....HHHHHH.....', 3: '....HHHHHHHH....', 4: '...HHHHHHHHHH...', 5: '...HH......HH...', 6: '...H........H...', 7: '...H........H...', 8: '...HH......HH...', 9: '...HHH....HHH...' },
  bun: { 0: '......HHHH......', 1: '......HHHH......', 2: '.....HHHHHH.....', 3: '....HHHHHHHH....', 4: '....HHHHHHHH....', 5: '....H......H....' },
  pigtails: { 2: '.....HHHHHH.....', 3: '....HHHHHHHH....', 4: '...HHHHHHHHHH...', 5: '..HHH......HHH..', 6: '..HH........HH..', 7: '..H..........H..' },
};
const ACC = {
  none: {},
  cap: { 1: '.....CCCCCC.....', 2: '....CCCCCCCC....', 3: '....CCCCCCCCCC..' },
  glasses: { 6: '....GEEGGEEG....' },
  headphones: { 1: '....AAAAAAAA....', 2: '...A........A...', 3: '...A........A...', 4: '...A........A...', 5: '..AA........AA..', 6: '..AA........AA..', 7: '..AA........AA..' },
  crown: { 0: '....Y.YYYY.Y....', 1: '....YYRYYRYY....' },
};

// beard: sideburns, a bushy jaw around the mouth and a little point on the collar
const BEARD = { 7: '....D......D....', 8: '....DDD..DDD....', 9: '.....DDDDDD.....', 10: '.......DD.......' };
// beanie: pulled down to the eyebrows, with a pom-pom and a folded cuff. Hair under it is
// hidden down to the cuff; hair that hangs lower (long, pigtails) still shows.
const BEANIE = { 1: '.......ww.......', 2: '.....NNNNNN.....', 3: '....NNNNNNNN....', 4: '...NNNNNNNNNN...', 5: '...KKKKKKKKKK...' };
// cape: drawn BEHIND the hero (only on empty pixels), flaring out to the floor
const CAPE = { 10: '...V........V...', 11: '..V..........V..', 12: '..V..........V..', 13: '..VV........VV..', 14: '..VVV..VV..VVV..', 15: '.VVV...VV...VVV.' };

export function defaultAvatar() { return { ...PRESETS[0] }; }

// Clean up any stored avatar (old saves, leaderboard rows, hand-edited data): known values only,
// sensible defaults for anything missing, and the extras as plain on/off switches. Extras that are
// off are left out, so old avatars and new ones without extras look exactly alike.
export function normalizeAvatar(a) {
  const src = a && typeof a === 'object' ? a : {};
  const idx = (v, list) => (Number.isInteger(v) && v >= 0 && v < list.length ? v : 0);
  const out = {
    skin: idx(src.skin, SKINS),
    hairStyle: HAIR_STYLES.includes(src.hairStyle) ? src.hairStyle : 'short',
    hairColor: idx(src.hairColor, HAIR_COLORS),
    outfit: idx(src.outfit, OUTFITS),
    accessory: ACCESSORIES.includes(src.accessory) ? src.accessory : 'none',
  };
  for (const k of EXTRAS) if (src[k] === true) out[k] = true;
  return out;
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * (1 + amt))));
  return '#' + [f(n >> 16), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function avatarGrid(raw) {
  const a = normalizeAvatar(raw);
  const grid = BASE.map((r) => r.split(''));
  const overlay = (layer, behind = false) => {
    for (const [y, row] of Object.entries(layer)) row.split('').forEach((ch, x) => { if (ch !== '.' && (!behind || grid[y][x] === '.')) grid[y][x] = ch; });
  };
  if (a.cape) overlay(CAPE, true);
  overlay(HAIR[a.hairStyle] || HAIR.short);
  if (a.beard) overlay(BEARD);
  if (a.beanie) {
    for (let y = 0; y <= 4; y++) grid[y] = grid[y].map((ch, x) => (ch === 'H' ? BASE[y][x] : ch));
    overlay(BEANIE);
  }
  overlay(ACC[a.accessory] || {});
  return grid;
}

export function drawAvatar(canvas, raw) {
  const a = normalizeAvatar(raw);
  const ctx = canvas.getContext('2d');
  canvas.width = 16; canvas.height = 16;
  ctx.clearRect(0, 0, 16, 16);
  const outfit = OUTFITS[a.outfit] ?? OUTFITS[0];
  const pal = {
    S: SKINS[a.skin] ?? SKINS[0],
    E: '#1b1b2a',
    M: shade(SKINS[a.skin] ?? SKINS[0], -0.35),
    O: outfit,
    X: shade(outfit, 0.45),
    P: '#2c2f5a',
    B: '#14142a',
    H: HAIR_COLORS[a.hairColor] ?? HAIR_COLORS[0],
    C: shade(outfit, -0.25),
    G: '#29e7ff',
    A: '#ff2e88',
    Y: '#ffd23f',
    R: '#ff3355',
    D: shade(HAIR_COLORS[a.hairColor] ?? HAIR_COLORS[0], -0.15),
    N: a.outfit === 6 ? '#c4183c' : outfit, // a white outfit gets a red beanie (white would vanish)
    K: a.outfit === 6 ? '#f5f5f5' : shade(outfit, 0.45),
    w: '#f5f5f5',
    V: a.outfit === 6 ? '#c4183c' : shade(outfit, -0.45),
  };
  avatarGrid(a).forEach((row, y) => row.forEach((ch, x) => {
    if (pal[ch]) { ctx.fillStyle = pal[ch]; ctx.fillRect(x, y, 1, 1); }
  }));
}

export function randomAvatar() {
  const r = (n) => Math.floor(Math.random() * n);
  return {
    label: 'CUSTOM',
    skin: r(Math.min(8, SKINS.length)), hairStyle: HAIR_STYLES[r(HAIR_STYLES.length)], hairColor: r(HAIR_COLORS.length),
    outfit: r(OUTFITS.length), accessory: ACCESSORIES[r(ACCESSORIES.length)],
    ...Object.fromEntries(EXTRAS.filter(() => Math.random() < 0.3).map((k) => [k, true])),
  };
}

// Draw a schema pixelSprite ({palette, rows}) onto a canvas.
export function drawSprite(canvas, sprite) {
  const h = sprite.rows.length;
  const w = Math.max(...sprite.rows.map((r) => r.length));
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  sprite.rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const c = sprite.palette[ch];
    if (c && ch !== '.' && ch !== ' ') { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); }
  }));
}
