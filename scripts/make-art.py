"""Generates the pixel-art scene illustrations in public/img/*.svg (original art, procedurally drawn).
Run: python3 scripts/make-art.py"""
import math, random, os
W, H = 96, 54
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'img')

class Canvas:
    def __init__(s): s.p = [[None]*W for _ in range(H)]
    def px(s, x, y, c):
        x, y = int(x), int(y)
        if 0 <= x < W and 0 <= y < H and c: s.p[y][x] = c
    def rect(s, x, y, w, h, c):
        for j in range(int(y), int(y+h)):
            for i in range(int(x), int(x+w)): s.px(i, j, c)
    def sprite(s, rows, pal, x, y, scale=1, flip=False):
        for j, row in enumerate(rows):
            r = row[::-1] if flip else row
            for i, ch in enumerate(r):
                if ch in pal: s.rect(x+i*scale, y+j*scale, scale, scale, pal[ch])
    def circle(s, cx, cy, r, c):
        for j in range(-r, r+1):
            for i in range(-r, r+1):
                if i*i+j*j <= r*r+r*0.8: s.px(cx+i, cy+j, c)
    def svg(s, name, title):
        out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W*8}" height="{H*8}" shape-rendering="crispEdges"><title>{title}</title>']
        for y in range(H):
            x = 0
            while x < W:
                c = s.p[y][x]
                if c is None: x += 1; continue
                x2 = x
                while x2 < W and s.p[y][x2] == c: x2 += 1
                out.append(f'<rect x="{x}" y="{y}" width="{x2-x}" height="1" fill="{c}"/>')
                x = x2
        out.append('</svg>')
        open(os.path.join(OUT, name + '.svg'), 'w').write(''.join(out))

def sky(cv, top, bottom, horizon=H, bands=6):
    def mix(a, b, t):
        a = [int(a[i:i+2], 16) for i in (1, 3, 5)]; b = [int(b[i:i+2], 16) for i in (1, 3, 5)]
        return '#' + ''.join(f'{int(a[k]+(b[k]-a[k])*t):02x}' for k in range(3))
    bh = horizon / bands
    for i in range(bands):
        cv.rect(0, int(i*bh), W, int(bh)+1, mix(top, bottom, i/(bands-1)))

def stars(cv, rnd, n=40, maxy=30, c='#ffffff'):
    for _ in range(n): cv.px(rnd.randrange(W), rnd.randrange(maxy), c if rnd.random() < .7 else '#9fd8ff')

def skyline(cv, rnd, base, colors, win, minh=8, maxh=30, x0=0, x1=W, lit=.45):
    x = x0
    while x < x1:
        w = rnd.randint(5, 11); h = rnd.randint(minh, maxh); c = rnd.choice(colors)
        cv.rect(x, base-h, w, h, c)
        if rnd.random() < .3: cv.rect(x+w//2, base-h-3, 1, 3, c)  # antenna
        for wy in range(base-h+2, base-1, 2):
            for wx in range(x+1, x+w-1, 2):
                if rnd.random() < lit: cv.px(wx, wy, rnd.choice(win))
        x += w + rnd.randint(0, 1)

def water(cv, rnd, top, c1, c2, refl):
    cv.rect(0, top, W, H-top, c1)
    for y in range(top, H, 2):
        for _ in range(10):
            x = rnd.randrange(W); cv.rect(x, y, rnd.randint(2, 5), 1, c2)
    for _ in range(60):
        x = rnd.randrange(W); y = rnd.randrange(top, H); cv.rect(x, y, rnd.randint(1, 3), 1, rnd.choice(refl))

def moon(cv, x, y, r=4):
    cv.circle(x, y, r, '#fff6c8'); cv.px(x-1, y-1, '#f1e3a0'); cv.px(x+1, y+2, '#f1e3a0')

CAT = (["o.......o.", "oo.....oo.", "ooooooooo.", "oKooooKoo.", "ooopPpooo.", ".ooooooo..", ".ooWWWoo.t", ".ooWWWooot", ".oo.o.oo.."], {'o': '#ff9a3c', 'K': '#1b1b3a', 'p': '#ff7eb6', 'P': '#ffd0e4', 'W': '#fff1d6', 't': '#ff9a3c'})
CAB = (["mmmmmmmmmmmmmm", "mYYYYYYYYYYYYm", "mmmmmmmmmmmmmm", "mkkkkkkkkkkkkm", "mkccccccccccck", "mkcgggcccrrcck", "mkcgggccrrrrck", "mkccccccrrrcck", "mkcccyycccccck", "mkkkkkkkkkkkkm", "mmmmmmmmmmmmmm", "mbbbbbbbbbbbbm", "mbRbbbbbbBbGbm", "mbRbbbbbbbbbbm", "mmmmmmmmmmmmmm", "mmmmmyymmmmmmm", "mmmmmyymmmmmmm", "mmmmmmmmmmmmmm", "mmmmmmmmmmmmmm", "mmmmmmmmmmmmmm"], {'m': '#5b2a86', 'Y': '#ffd23f', 'k': '#111122', 'c': '#0d2a4a', 'g': '#3dff6e', 'r': '#ff2e88', 'y': '#29e7ff', 'b': '#2e1450', 'R': '#ff3355', 'B': '#29e7ff', 'G': '#3dff6e'})
LANT = (["..s..", ".rrr.", "rryrr", "rrrrr", ".rrr.", "..y.."], {'s': '#333355', 'r': '#ff3d5a', 'y': '#ffd23f'})
FERRY = (["......ww..............", ".....wwww.............", "..gggggggggggggggg....", "..gWyWyWyWyWyWyWyg....", "gggggggggggggggggggg..", "wwwwwwwwwwwwwwwwwwwwww", ".wwwwwwwwwwwwwwwwwwww.", "..kkkkkkkkkkkkkkkkkk.."], {'w': '#f2f2f2', 'g': '#1f8a4c', 'W': '#ffe680', 'y': '#1f8a4c', 'k': '#203040'})
TRAM = (["..rrrrrrrrrrrr..", ".rrrrrrrrrrrrrr.", ".ryyryyryyryyrr.", ".ryyryyryyryyrr.", ".rrrrrrrrrrrrrr.", ".cccccccccccccc.", "..k..k....k..k.."], {'r': '#c8102e', 'y': '#ffe680', 'c': '#7a0a1c', 'k': '#222'})
KING = (["...y.y.y....", "...yyyyy....", "..pppppppp..", ".pppppppppp.", ".pWkppWkppp.", ".pppppppppp.", "pppwwwwwwpp.", ".pppppppppp.", "..pppppppp..", ".pp.pppp.pp.", ".p..p..p..p."], {'y': '#ffd23f', 'p': '#8a3ffc', 'W': '#ffffff', 'k': '#111', 'w': '#ffffff'})
GREM = (["p.pp.p", ".pppp.", "pWkWkp", ".pppp.", "p.pp.p"], {'p': '#8a3ffc', 'W': '#fff', 'k': '#111'})
ROBOT = (["...gggggg...", "..g......g..", "..gccccccg..", "..gcRccRcg..", "..gccccccg..", "...gggggg...", "....kkkk....", ".mmmmmmmmmm.", "rm.mmmmmm.mr", "rr.mmmmmm.rr", "...mm..mm...", "..mmm..mmm.."], {'g': '#c0c8d0', 'c': '#37406b', 'R': '#ff3355', 'm': '#b06b3a', 'r': '#ff5d8f', 'k': '#7a4a26'})
PEARL = ([".ww.", "wWWw", "wWWw", ".ww."], {'w': '#9fd8ff', 'W': '#ffffff'})

def dragon(cv, x0, y0, length, amp, colors, head_c, bright=True):
    pts = []
    for i in range(length):
        x = x0 + i; y = y0 + math.sin(i / 7.0) * amp
        pts.append((x, y))
        for t in range(-2, 3):
            c = colors[(i // 2 + t) % len(colors)] if bright else colors[0]
            cv.px(x, y + t, c)
        if i % 4 == 0: cv.px(x, y - 3, '#ffd23f' if bright else '#55556a')  # spines
    hx, hy = pts[-1]
    cv.rect(hx, hy - 3, 6, 5, head_c); cv.rect(hx + 6, hy - 1, 3, 3, head_c)
    cv.px(hx + 3, hy - 2, '#ffffff'); cv.px(hx + 4, hy - 2, '#111')
    cv.rect(hx + 1, hy - 5, 1, 2, '#ffd23f'); cv.rect(hx + 3, hy - 5, 1, 2, '#ffd23f')
    for k in range(6): cv.px(hx + 9 + k, hy + 1 + (k % 2), '#ff9ed2' if bright else '#55556a')  # whisker

def scene_arcade():
    cv = Canvas(); r = random.Random(1)
    cv.rect(0, 0, W, H, '#140a2a')
    for x in range(0, W, 8): cv.rect(x, 0, 1, 40, '#1d1140')
    cv.rect(0, 40, W, 14, '#22123d')
    for x in range(0, W, 6):
        for y in range(41, H, 3): cv.px(x + (y % 2) * 3, y, '#3a1f66')
    # neon sign
    cv.rect(6, 4, 30, 9, '#0b0618'); cv.rect(6, 4, 30, 1, '#ff2e88'); cv.rect(6, 12, 30, 1, '#ff2e88'); cv.rect(6, 4, 1, 9, '#ff2e88'); cv.rect(35, 4, 1, 9, '#ff2e88')
    for i, c in enumerate(['#29e7ff', '#ffd23f', '#3dff6e', '#ff2e88', '#29e7ff', '#ffd23f']):
        cv.rect(9 + i * 4, 7, 3, 3, c)
    # window with rain
    cv.rect(62, 5, 28, 22, '#0c1b3a'); skyline(cv, r, 27, ['#16224a', '#1c2d5c'], ['#ffd23f', '#ff2e88', '#29e7ff'], 4, 16, 62, 90)
    for _ in range(40): x = r.randrange(62, 90); y = r.randrange(5, 25); cv.rect(x, y, 1, 2, '#5d7fb8')
    cv.rect(61, 4, 30, 1, '#3a1f66'); cv.rect(61, 27, 30, 1, '#3a1f66'); cv.rect(61, 4, 1, 24, '#3a1f66'); cv.rect(90, 4, 1, 24, '#3a1f66'); cv.rect(75, 4, 1, 24, '#3a1f66')
    # cabinets
    cv.sprite(*CAB, 38, 20)
    dim = dict(CAB[1]); dim.update({'m': '#2e2a4a', 'Y': '#6d6a8a', 'g': '#24476a', 'r': '#24476a', 'y': '#24476a'})
    cv.sprite(CAB[0], dim, 14, 22); cv.sprite(CAB[0], dim, 2, 22)
    # glow
    for i in range(-3, 17): cv.px(38 + i, 41, '#3a2a7a')
    cv.sprite(*CAT, 56, 32)
    cv.svg('arcade', 'The Golden Joystick arcade')

def scene_harbour():
    cv = Canvas(); r = random.Random(2)
    sky(cv, '#0a0b2a', '#3b1d5e', 34); stars(cv, r, 50, 20); moon(cv, 80, 8)
    skyline(cv, r, 34, ['#1b2350', '#232d66', '#2b1f5c'], ['#ffd23f', '#29e7ff', '#ff2e88', '#3dff6e'], 6, 26)
    water(cv, r, 34, '#0b1f4a', '#123068', ['#ffd23f', '#29e7ff', '#ff2e88'])
    cv.rect(0, 46, 40, 3, '#6b4a2b'); cv.rect(0, 49, 40, 5, '#4a321d')
    for x in range(2, 40, 6): cv.rect(x, 46, 1, 8, '#3a2614')
    cv.sprite(*CAT, 26, 37)
    cv.svg('harbour', 'Pixel Harbour at night')

def scene_market():
    cv = Canvas(); r = random.Random(3)
    sky(cv, '#120a2e', '#3a1650', 30); stars(cv, r, 25, 12)
    skyline(cv, r, 30, ['#24184a', '#2c1d58'], ['#ffd23f', '#ff7eb6'], 10, 26)
    cv.rect(0, 30, W, 24, '#2a1838')
    for x in range(0, W, 4): cv.px(x, 52, '#3d2550')
    for k, sx in enumerate([2, 26, 50, 74]):
        cols = [('#ff2e88', '#ffffff'), ('#29e7ff', '#ffffff'), ('#ffd23f', '#ff2e88'), ('#3dff6e', '#ffffff')][k]
        for i in range(20): cv.rect(sx + i, 24, 1, 4, cols[(i // 2) % 2])
        cv.rect(sx + 1, 28, 18, 10, '#4a2a3a'); cv.rect(sx + 1, 38, 18, 2, '#6b3f2a')
        for i in range(4): cv.rect(sx + 3 + i * 4, 31, 2, 2, r.choice(['#ffd23f', '#ff7eb6', '#ff9a3c', '#9fd8ff']))
    for x in range(0, W, 1): cv.px(x, 10 + int(3 * math.sin(x / 15)), '#555577')
    for x in range(4, W, 10): cv.sprite(*LANT, x, 10 + int(3 * math.sin((x + 2) / 15)))
    cv.sprite(*CAT, 44, 42)
    cv.svg('market', 'The night market')

def scene_ferry():
    cv = Canvas(); r = random.Random(4)
    sky(cv, '#08102e', '#24305e', 32); stars(cv, r, 45, 24); moon(cv, 14, 9, 3)
    cv.rect(70, 14, 5, 18, '#ffffff')
    for y in range(16, 32, 4): cv.rect(70, y, 5, 2, '#ff3355')
    cv.rect(69, 11, 7, 3, '#333355'); cv.rect(70, 9, 5, 2, '#ffd23f')
    for i in range(1, 16): cv.px(75 + i, 10 - i // 4, '#fff6a0' if i % 2 else None)
    cv.rect(62, 30, 22, 3, '#3a3a52')
    water(cv, r, 32, '#0a1a40', '#122a5a', ['#9fd8ff', '#ffd23f'])
    cv.sprite(*FERRY, 14, 34)
    cv.rect(0, 44, 18, 2, '#6b4a2b'); cv.rect(0, 46, 18, 8, '#4a321d')
    cv.svg('ferry', 'The ferry pier')

def scene_tunnel():
    cv = Canvas(); r = random.Random(5)
    cv.rect(0, 0, W, H, '#0b0920')
    for y in range(8, 46):
        w = int(math.sqrt(max(0, 1 - ((y - 27) / 19) ** 2)) * 30)
        cv.rect(48 - w, y, 2 * w, 1, '#1a1536')
    for y in range(10, 46, 3):
        for x in range(r.randrange(0, 4), W, 7): cv.px(x, y, '#2a2450')
    cv.rect(0, 46, W, 8, '#0f0d1c')
    for x in range(0, W, 5): cv.rect(x, 48, 3, 1, '#2a2440')
    cv.rect(0, 50, W, 1, '#3a3350')
    cv.sprite(*TRAM, 10, 39, 1)
    for g in [(60, 30), (74, 36), (84, 26)]:
        cv.px(g[0], g[1], '#ffd23f'); cv.px(g[0] + 2, g[1], '#ffd23f')
    cv.svg('tunnel', 'The dark tram tunnel')

def scene_robot():
    cv = Canvas(); r = random.Random(6)
    sky(cv, '#0a0820', '#2e1a4a', 40); stars(cv, r, 50, 26); moon(cv, 12, 8, 3)
    cv.rect(52, 0, 30, 44, '#1d1838')
    for y in range(3, 44, 4):
        for x in range(55, 80, 4): cv.rect(x, y, 2, 2, '#ffd23f' if r.random() < .3 else '#2c2650')
    cv.rect(60, 30, 12, 14, '#0b0818')
    dragon(cv, 2, 6, 48, 3, ['#3a3a55', '#454565'], '#4a4a66', bright=False)
    cv.rect(0, 44, W, 10, '#1b2a1e')
    for x in range(0, W, 3): cv.px(x, 44, '#2d4a30')
    cv.sprite(*ROBOT, 54, 20, 2)
    cv.svg('robot', 'Bolt-Bot guarding the Sky Tower')

def scene_king():
    cv = Canvas(); r = random.Random(7)
    cv.rect(0, 0, W, H, '#100c24')
    for i in range(6):
        x = 6 + i * 15; cv.rect(x, 6, 11, 8, '#0b2a3a'); cv.rect(x + 1, 7, 9, 6, r.choice(['#12445a', '#1b5a3a', '#4a1b3a']))
        for _ in range(4): cv.px(x + 1 + r.randrange(9), 7 + r.randrange(6), '#3dff6e')
    for k in range(9):
        y = 18 + k; c = r.choice(['#ff2e88', '#29e7ff', '#3dff6e', '#ffd23f'])
        for x in range(W): cv.px(x, y + int(2 * math.sin((x + k * 9) / 6)), c if (x + k) % 3 else None)
    cv.rect(0, 42, W, 12, '#1d1736')
    cv.rect(38, 38, 22, 4, '#5b2a86'); cv.rect(40, 34, 18, 4, '#7b3aa6')
    cv.sprite(*KING, 37, 12, 2)
    cv.sprite(*PEARL, 62, 10, 2)
    cv.circle(80, 14, 6, '#e8e8f0'); cv.circle(80, 14, 5, '#ffffff'); cv.rect(80, 9, 1, 5, '#111'); cv.rect(80, 14, 3, 1, '#111')
    cv.sprite(*GREM, 10, 44); cv.sprite(*GREM, 20, 46, flip=True); cv.sprite(*GREM, 78, 45)
    cv.svg('king', 'The Gremlin King')

def scene_dragon():
    cv = Canvas(); r = random.Random(8)
    sky(cv, '#05051a', '#1f1240', 54); stars(cv, r, 60, 40)
    cv.rect(40, 18, 16, 36, '#1d1838'); cv.rect(44, 10, 8, 8, '#241e45'); cv.rect(47, 4, 2, 6, '#2c2650')
    dragon(cv, 0, 26, 70, 8, ['#4a4a6a', '#56567a'], '#5a5a7a', bright=False)
    cv.sprite(*PEARL, 46, 44, 1)
    cv.svg('dragon', 'The Neon Dragon, almost out of light')

def scene_victory():
    cv = Canvas(); r = random.Random(9)
    sky(cv, '#0a0a30', '#4a1d6e', 32); stars(cv, r, 30, 20)
    for (fx, fy, c) in [(18, 10, '#ff2e88'), (48, 7, '#ffd23f'), (78, 11, '#29e7ff'), (33, 16, '#3dff6e'), (64, 17, '#ff9a3c')]:
        for a in range(12):
            ang = a * math.pi / 6
            for d in range(2, 7):
                if d % 2 == 0 or d == 5: cv.px(fx + math.cos(ang) * d, fy + math.sin(ang) * d, c)
        cv.px(fx, fy, '#ffffff')
    skyline(cv, r, 34, ['#2a2f7a', '#34308a', '#3a2a7a'], ['#ffd23f', '#29e7ff', '#ff2e88', '#3dff6e', '#ffffff'], 6, 24, lit=.85)
    dragon(cv, 0, 22, 64, 4, ['#ff2e88', '#ffd23f', '#3dff6e', '#29e7ff'], '#ff2e88')
    water(cv, r, 34, '#13246a', '#1d3388', ['#ffd23f', '#29e7ff', '#ff2e88', '#3dff6e', '#ffffff'])
    cv.svg('victory', 'Pixel Harbour lit up with fireworks')

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for f in [scene_arcade, scene_harbour, scene_market, scene_ferry, scene_tunnel, scene_robot, scene_king, scene_dragon, scene_victory]: f()
    print('ok', sorted(os.listdir(OUT)))
