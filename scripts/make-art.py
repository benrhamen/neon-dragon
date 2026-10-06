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

TAXI = (["....yyyy........", "...rrrrrrrr.....", "..rccrrrccrr....", ".rrccrrrccrrrrr.", "rrrrrrrrrrrrrrrr", "rWrrrrrrrrrrrrYr", "rrrrrrrrrrrrrrrr", "..kk.......kk...", "..kk.......kk..."], {'y': '#fff6c8', 'r': '#d7263d', 'c': '#9fd8ff', 'W': '#fff6a0', 'Y': '#ffb347', 'k': '#1b1b2a'})
MINI = (["..rrrrrrrrrrrr..", ".rwwwwwwwwwwwwr.", ".rcccccccccccwr.", ".rcccccccccccwr.", "rrrrrrrrrrrrrrrr", "rrggggggggggrrYr", "rrrrrrrrrrrrrrrr", "..kk........kk.."], {'r': '#d7263d', 'w': '#f2f2f2', 'c': '#9fd8ff', 'g': '#1f8a4c', 'Y': '#fff6a0', 'k': '#1b1b2a'})
CUP = ([".ss.", "wwww", "wbbw", "wbbw", "wbbw", ".ww."], {'s': '#ff2e88', 'w': '#e8e8f0', 'b': '#8a5a3c'})
STEAMER = ([".wwwww.", "kkkkkkk", "kyyyyyk", "kkkkkkk"], {'w': '#e8e8f0', 'k': '#8a5a2b', 'y': '#ffe6a0'})
TART = ([".oooo.", "oyyyyo", ".oooo."], {'o': '#c8803a', 'y': '#ffd23f'})

def firework(cv, fx, fy, c, rad=6):
    for a in range(12):
        ang = a * math.pi / 6
        for d in range(2, rad + 1):
            if d % 2 == 0 or d == rad - 1: cv.px(fx + math.cos(ang) * d, fy + math.sin(ang) * d, c)
    cv.px(fx, fy, '#ffffff')

def scene_mtr():
    cv = Canvas(); r = random.Random(11)
    cv.rect(0, 0, W, H, '#1a1f2e')
    cv.rect(0, 0, W, 6, '#2a3146')
    for x in range(4, W, 12): cv.rect(x, 1, 8, 2, '#f2f6ff')
    cv.rect(0, 8, W, 3, '#e8e8f0'); cv.rect(0, 9, W, 1, '#d7263d')
    for i, ch in enumerate('MTR'): cv.rect(6 + i * 4, 13, 3, 4, '#d7263d')
    cv.rect(4, 12, 15, 1, '#e8e8f0')
    cv.rect(0, 20, W, 16, '#2b6e4f')
    for x in range(0, W, 8): cv.rect(x, 20, 7, 15, '#2f7a57')
    cv.rect(0, 36, W, 2, '#ffd23f')
    for x in range(0, W, 4): cv.rect(x, 37, 2, 1, '#1a1f2e')
    cv.rect(0, 38, W, 16, '#3a3f52')
    for x in range(0, W, 6): cv.rect(x, 44 + (x // 6) % 2, 4, 1, '#454b62')
    # train in the station
    cv.rect(2, 21, 92, 15, '#c9ced8'); cv.rect(2, 21, 92, 2, '#d7263d'); cv.rect(2, 33, 92, 1, '#d7263d')
    for x in range(6, 90, 14): cv.rect(x, 25, 9, 6, '#20304a'); cv.rect(x + 1, 26, 3, 2, '#5c7fb0')
    for x in range(17, 90, 28): cv.rect(x, 24, 1, 10, '#7a808e')
    # crowd silhouettes
    for x in range(4, W, 5):
        h = r.randint(7, 10); c = r.choice(['#161a26', '#20263a', '#2a2240'])
        cv.rect(x, 52 - h, 4, h, c); cv.rect(x + 1, 52 - h - 2, 2, 2, c)
    cv.svg('mtr', 'An MTR platform at rush hour')

def scene_causeway():
    cv = Canvas(); r = random.Random(12)
    sky(cv, '#0a0820', '#2a1450', 30); stars(cv, r, 18, 10)
    skyline(cv, r, 34, ['#1b1840', '#241d52', '#1d2550'], ['#ff2e88', '#29e7ff', '#ffd23f', '#3dff6e'], 14, 32, lit=.6)
    # giant screen
    cv.rect(30, 4, 30, 17, '#0b0618'); cv.rect(31, 5, 28, 15, '#1c3a8a')
    for k in range(4): cv.rect(33 + k * 7, 8, 5, 9, ['#ff2e88', '#ffd23f', '#29e7ff', '#3dff6e'][k])
    # neon shop signs
    for (x, y, c) in [(3, 12, '#ff2e88'), (4, 20, '#29e7ff'), (84, 10, '#ffd23f'), (86, 22, '#3dff6e'), (68, 16, '#ff9a3c')]:
        cv.rect(x, y, 6, 8, '#0b0618'); cv.rect(x + 1, y + 1, 4, 6, c)
    cv.rect(0, 34, W, 20, '#2a2a3a')
    # zebra crossing
    for x in range(4, W, 6): cv.rect(x, 42, 4, 8, '#e8e8f0')
    # crowd
    for x in range(0, W, 3):
        if r.random() < .55:
            c = r.choice(['#ff5d8f', '#29e7ff', '#ffd23f', '#9b5cff', '#3dff6e', '#f2f2f2'])
            cv.rect(x, 36 + r.randint(0, 2), 2, 4, c); cv.px(x, 35 + r.randint(0, 1), '#f5c28f')
    cv.svg('causeway', 'Causeway Bay at night, neon signs and a giant screen')

def scene_taxi():
    cv = Canvas(); r = random.Random(13)
    cv.rect(0, 0, W, H, '#0b0a1c')
    # tunnel arch with lights
    for y in range(0, 40):
        w = int(math.sqrt(max(0, 1 - ((y - 40) / 40) ** 2)) * 46)
        cv.rect(48 - w, y, 2 * w, 1, '#16142e')
    for i in range(10):
        x = 48 + int(math.cos(math.pi * (i + .5) / 10) * 42); y = 40 - int(math.sin(math.pi * (i + .5) / 10) * 36)
        cv.rect(x, y, 2, 1, '#3dff6e' if i % 2 else '#b05cff')
    cv.rect(0, 40, W, 14, '#24222e')
    for x in range(0, W, 10): cv.rect(x, 47, 6, 1, '#ffd23f')
    cv.sprite(*TAXI, 30, 32, 2)
    for i in range(1, 8): cv.rect(30 - i * 3, 40 + (i % 2), 2, 1, '#55556a')
    cv.svg('taxi', 'A red taxi racing through the cross-harbour tunnel')

def scene_manmo():
    cv = Canvas(); r = random.Random(14)
    cv.rect(0, 0, W, H, '#2a0f0f')
    for x in range(0, W, 12): cv.rect(x, 0, 2, 40, '#5a1a14'); cv.rect(x, 0, 2, 2, '#c8a040')
    cv.rect(0, 0, W, 3, '#7a2a1a'); cv.rect(0, 3, W, 1, '#c8a040')
    # hanging incense coils
    for (cx, cy, rad) in [(16, 12, 6), (40, 9, 5), (64, 13, 6), (84, 8, 4)]:
        cv.rect(cx, 4, 1, cy - rad - 4, '#7a5a3a')
        for k in range(rad, 0, -2):
            for a in range(0, 360, 12):
                cv.px(cx + math.cos(math.radians(a)) * k, cy + math.sin(math.radians(a)) * k * .5 + (rad - k), '#b07a3a' if k % 4 else '#e0a050')
        cv.px(cx, cy + rad, '#ff7a1a')
    # smoke
    for _ in range(70):
        x = r.randrange(W); y = r.randrange(14, 40); cv.px(x, y, r.choice(['#5a3a3a', '#6a4a4a', '#4a2a2a']))
    # altar
    cv.rect(26, 34, 44, 6, '#7a2a1a'); cv.rect(26, 34, 44, 1, '#c8a040')
    cv.rect(42, 28, 12, 6, '#c8a040'); cv.rect(44, 26, 8, 2, '#e8c060')
    for x in (44, 48, 52): cv.rect(x, 22, 1, 4, '#8a5a3a'); cv.px(x, 21, '#ff7a1a')
    cv.rect(0, 40, W, 14, '#3a1610')
    for x in range(0, W, 8): cv.rect(x, 40, 7, 1, '#4a1e16')
    cv.svg('manmo', 'Inside a quiet temple with hanging incense coils')

def scene_bubbletea():
    cv = Canvas(); r = random.Random(15)
    cv.rect(0, 0, W, H, '#1a0f2e')
    cv.rect(0, 0, W, 12, '#2a1450')
    cv.rect(18, 2, 60, 8, '#0b0618'); cv.rect(19, 3, 58, 6, '#ff5d8f')
    for i in range(8): cv.rect(23 + i * 7, 4, 4, 4, '#ffffff' if i % 2 else '#ffd23f')
    # menu boards
    for x in (6, 70):
        cv.rect(x, 14, 20, 16, '#0d2a3a'); 
        for y in range(16, 29, 3): cv.rect(x + 2, y, r.randint(8, 16), 1, '#9fd8ff')
    # counter
    cv.rect(0, 34, W, 20, '#5a3a6a'); cv.rect(0, 34, W, 2, '#ff9ed2')
    for i, x in enumerate(range(30, 66, 8)):
        pal = dict(CUP[1]); pal['b'] = ['#8a5a3c', '#ff9ed2', '#3dff6e', '#ffd23f', '#9b5cff'][i % 5]
        cv.sprite(CUP[0], pal, x, 27, 1)
    cv.sprite(*CAT, 10, 25)
    cv.svg('bubbletea', 'A bubble tea shop with a neon sign')

def scene_dimsum():
    cv = Canvas(); r = random.Random(16)
    cv.rect(0, 0, W, H, '#3a0a14')
    # red and gold walls with dragon panels
    cv.rect(0, 0, W, 3, '#c8a040')
    for x in range(4, W, 22): cv.rect(x, 6, 16, 18, '#5a1420'); cv.rect(x + 1, 7, 14, 16, '#7a1a28'); cv.circle(x + 8, 15, 4, '#c8a040'); cv.circle(x + 8, 15, 3, '#7a1a28')
    for x in range(10, W, 22): cv.sprite(*LANT, x, 2)
    # round table
    cv.rect(10, 34, 76, 6, '#f2f2f2'); cv.rect(8, 36, 80, 4, '#e0e0e8'); cv.rect(44, 40, 8, 14, '#5a1420')
    for x in (16, 30, 54, 70): cv.sprite(*STEAMER, x, 29)
    for x in (24, 62): cv.sprite(*TART, x, 32)
    for x in (18, 32, 56, 72):
        for k in range(3): cv.px(x + 2 + k, 26 - k, '#c8c8d8')
    cv.svg('dimsum', 'A busy dim sum restaurant with bamboo steamers')

def scene_fireworks():
    cv = Canvas(); r = random.Random(17)
    sky(cv, '#0a0a30', '#4a1d6e', 32); stars(cv, r, 30, 20)
    for (fx, fy, c, rr) in [(14, 9, '#ff2e88', 7), (40, 6, '#ffd23f', 6), (66, 10, '#29e7ff', 7), (86, 6, '#3dff6e', 5), (27, 17, '#ff9a3c', 5), (54, 18, '#ff5d8f', 5), (78, 19, '#ffffff', 4)]:
        firework(cv, fx, fy, c, rr)
    skyline(cv, r, 34, ['#2a2f7a', '#34308a', '#3a2a7a'], ['#ffd23f', '#29e7ff', '#ff2e88', '#3dff6e', '#ffffff'], 8, 26, lit=.85)
    dragon(cv, 0, 24, 56, 4, ['#ff2e88', '#ffd23f', '#3dff6e', '#29e7ff'], '#ff2e88')
    water(cv, r, 34, '#13246a', '#1d3388', ['#ffd23f', '#29e7ff', '#ff2e88', '#3dff6e', '#ffffff'])
    cv.sprite(*FERRY, 60, 40)
    cv.svg('fireworks', 'Fireworks over the harbour with the Star Ferry')

def scene_trapped():
    cv = Canvas(); r = random.Random(18)
    cv.rect(0, 0, W, H, '#05030c')
    for _ in range(90):
        x = r.randrange(W); y = r.randrange(H); cv.px(x, y, r.choice(['#1a1430', '#2a1a40', '#3a1030']))
    # glitch bars
    for y in (6, 19, 44):
        x = r.randrange(0, 60); cv.rect(x, y, r.randint(10, 30), 1, r.choice(['#ff2e88', '#29e7ff']))
    # a big arcade cabinet, screen left empty in the middle for the hero
    cv.rect(30, 2, 36, 52, '#3a1a5a'); cv.rect(30, 2, 36, 6, '#5b2a86')
    cv.rect(33, 3, 30, 4, '#0b0618')
    for i, c in enumerate(['#ff3355', '#ffd23f', '#ff3355', '#ffd23f', '#ff3355', '#ffd23f', '#ff3355']): cv.rect(35 + i * 4, 4, 2, 2, c)
    cv.rect(33, 10, 30, 22, '#111122'); cv.rect(35, 12, 26, 18, '#0a1a2a')
    for y in range(12, 30, 2): cv.rect(35, y, 26, 1, '#0d2236')
    cv.rect(33, 34, 30, 6, '#2a1450')
    cv.rect(40, 35, 2, 3, '#ff3355'); cv.circle(52, 36, 1, '#29e7ff'); cv.circle(57, 36, 1, '#3dff6e')
    cv.rect(44, 44, 8, 3, '#ffd23f'); cv.rect(45, 45, 6, 1, '#111')
    cv.svg('trapped', 'A lonely arcade machine glowing in a dark void')

def scene_park():
    cv = Canvas(); r = random.Random(19)
    sky(cv, '#0a1030', '#24305e', 30); stars(cv, r, 30, 18); moon(cv, 82, 7, 3)
    skyline(cv, r, 26, ['#1b2350', '#232d66'], ['#ffd23f', '#29e7ff'], 6, 16, lit=.35)
    cv.rect(0, 26, W, 28, '#1f4a2a')
    for x in range(0, W, 2): cv.px(x, 26 + (x % 3 == 0), '#2d6a3a')
    for (tx, ty) in [(8, 18), (26, 20), (88, 19)]:
        cv.rect(tx, ty + 6, 2, 8, '#4a2e1a'); cv.circle(tx + 1, ty + 4, 5, '#1d5a2a'); cv.circle(tx, ty + 3, 3, '#27703a')
    # path + flower beds
    for y in range(36, H): cv.rect(30 + (y - 36) // 2, y, 22, 1, '#7a6a4a')
    for _ in range(40):
        x = r.choice([r.randrange(0, 28), r.randrange(60, W)]); y = r.randrange(38, H); cv.px(x, y, r.choice(['#ff5d8f', '#ffd23f', '#ff9a3c', '#f2f2f2']))
    for x in (4, 20, 70, 86): cv.rect(x, 30, 1, 6, '#55556a'); cv.rect(x - 1, 28, 3, 2, '#fff6a0')
    cv.svg('park', 'Victoria Park at night with flower beds')

def scene_racecourse():
    cv = Canvas(); r = random.Random(20)
    sky(cv, '#0a0d2a', '#2a2a5e', 24); stars(cv, r, 25, 14)
    skyline(cv, r, 22, ['#1b2350', '#232d66', '#2b1f5c'], ['#ffd23f', '#29e7ff', '#ff2e88'], 8, 20, lit=.6)
    # floodlights
    for x in (6, 90):
        cv.rect(x, 4, 1, 20, '#7a808e'); cv.rect(x - 2, 3, 5, 2, '#fff6c8')
        for k in range(1, 9): cv.px(x + (k if x < 50 else -k), 5 + k, '#3a3a6a')
    cv.rect(0, 22, W, 10, '#1d2a3a')
    for x in range(30, W, 5): cv.rect(x, 28, 3, 1, '#f2f2f2')
    cv.rect(30, 29, W - 30, 1, '#f2f2f2')
    # grandstand
    cv.rect(0, 22, 30, 10, '#3a3a52'); 
    for y in range(23, 31, 2):
        for x in range(1, 29, 2): cv.px(x, y, r.choice(['#ff5d8f', '#29e7ff', '#ffd23f', '#f2f2f2']))
    cv.rect(0, 32, W, 22, '#2a7a3a')
    for y in (36, 46): cv.rect(0, y, W, 1, '#f2f2f2')
    for x in range(0, W, 4): cv.rect(x, 35, 1, 2, '#f2f2f2')
    for x in range(0, W, 3): cv.px(x, 40 + (x % 2), '#33883f')
    cv.svg('racecourse', 'The Happy Valley racecourse under floodlights')

def scene_tram():
    cv = Canvas(); r = random.Random(21)
    sky(cv, '#0a0a26', '#2a1a4e', 28); stars(cv, r, 20, 12)
    skyline(cv, r, 30, ['#2a2048', '#33285a', '#1e2a52'], ['#ffd23f', '#ff2e88', '#29e7ff'], 16, 30, lit=.55)
    # shop signs sticking out
    for (x, y, c) in [(6, 10, '#ff2e88'), (20, 14, '#ffd23f'), (78, 9, '#29e7ff'), (88, 15, '#3dff6e')]:
        cv.rect(x, y, 4, 10, '#0b0618'); cv.rect(x + 1, y + 1, 2, 8, c)
    cv.rect(0, 30, W, 24, '#2a2a3a')
    cv.rect(0, 50, W, 1, '#7a808e'); cv.rect(0, 52, W, 1, '#7a808e')
    cv.rect(0, 2, W, 1, '#55556a')
    # double-decker ding-ding tram
    cv.rect(18, 16, 44, 32, '#1f7a4c'); cv.rect(18, 16, 44, 2, '#2a9a5c'); cv.rect(18, 31, 44, 2, '#f2f2f2')
    for x in range(21, 60, 8): cv.rect(x, 20, 6, 7, '#ffe680'); cv.rect(x, 35, 6, 7, '#ffe680')
    cv.rect(18, 45, 44, 3, '#14502f'); cv.rect(22, 48, 4, 2, '#1b1b2a'); cv.rect(54, 48, 4, 2, '#1b1b2a')
    cv.rect(39, 6, 1, 10, '#7a808e'); cv.rect(36, 3, 7, 1, '#7a808e')
    cv.rect(28, 12, 24, 4, '#0b0618'); cv.rect(29, 13, 22, 2, '#ffd23f')
    cv.svg('tram', 'A double-decker ding-ding tram on a neon street')

def scene_peak():
    cv = Canvas(); r = random.Random(22)
    sky(cv, '#05051a', '#2a1450', 30); stars(cv, r, 50, 24); moon(cv, 12, 7, 3)
    # city far below
    for y in range(30, 42):
        for x in range(0, W):
            if r.random() < .25: cv.px(x, y, r.choice(['#ffd23f', '#29e7ff', '#ff2e88', '#ffffff', '#3dff6e']))
    water(cv, r, 42, '#0b1f4a', '#123068', ['#ffd23f', '#29e7ff'])
    # hills
    for x in range(W):
        h = int(10 + 4 * math.sin(x / 9) + 3 * math.sin(x / 4))
        cv.rect(x, 30 - h // 3, 1, 2, '#1a1636')
    # lookout terrace and railing
    cv.rect(0, 46, W, 8, '#3a3346')
    cv.rect(0, 44, W, 1, '#9aa3c7'); cv.rect(0, 46, W, 1, '#9aa3c7')
    for x in range(0, W, 6): cv.rect(x, 44, 1, 3, '#9aa3c7')
    # the Sky Tower on the left
    cv.rect(4, 8, 10, 36, '#1d1838'); cv.rect(6, 4, 6, 4, '#241e45')
    for y in range(10, 42, 3): cv.px(8, y, '#ffd23f'); cv.px(11, y + 1, '#29e7ff')
    cv.svg('peak', 'The view from the Peak lookout at night')

def scene_vault():
    cv = Canvas(); r = random.Random(23)
    cv.rect(0, 0, W, H, '#14100a')
    for y in range(0, 40, 6):
        off = (y // 6) % 2 * 6
        for x in range(-6 + off, W, 12): cv.rect(x, y, 11, 5, '#2a2014'); cv.rect(x, y, 11, 1, '#3a2c1a')
    cv.rect(0, 40, W, 14, '#1d160c')
    # treasure piles
    for _ in range(140):
        x = r.randrange(W); y = r.randrange(36, H)
        if abs(x - 48) < 14 and y < 44: continue
        cv.px(x, y, r.choice(['#ffd23f', '#c8a040', '#ff2e88', '#29e7ff', '#e8e8f0', '#3dff6e', '#ff9a3c']))
    # umbrellas and socks
    for x in (6, 80):
        cv.rect(x, 30, 9, 2, '#ff5d8f'); cv.rect(x + 1, 28, 7, 2, '#ff5d8f'); cv.rect(x + 4, 32, 1, 6, '#7a5a3a')
    # cushion with the pearl
    cv.rect(38, 40, 20, 4, '#8a1a3a'); cv.rect(36, 42, 24, 3, '#a02a4a')
    cv.sprite(*PEARL, 46, 34, 1)
    for k in range(1, 5): cv.px(48 + k * 2, 33 - k, '#9fd8ff'); cv.px(48 - k * 2, 33 - k, '#9fd8ff')
    cv.svg('vault', 'A treasure vault full of stolen things and a glowing pearl')

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for f in [scene_arcade, scene_harbour, scene_market, scene_ferry, scene_tunnel, scene_robot, scene_king, scene_dragon,
              scene_mtr, scene_causeway, scene_taxi, scene_manmo, scene_bubbletea, scene_dimsum, scene_fireworks, scene_trapped,
              scene_park, scene_racecourse, scene_tram, scene_peak, scene_vault]: f()
    print('ok', sorted(os.listdir(OUT)))
