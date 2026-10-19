#!/usr/bin/env python3
"""
Generates js/maps.js (ground, collision and props used by the game for drawing AND collision).  Run:  python3 tools/build_maps.py

Edit the AREAS table below to change layouts, then re-run.  The script refuses to
write a map when a key location (start, shrine, NPC, spawn, portal) is blocked or
unreachable from the start tile.
"""
import json, os, random
from collections import deque

W, H = 48, 30
OUT = os.path.join(os.path.dirname(__file__), '..', 'js', 'maps.js')

# Key locations (must match database/seed.sql). They are kept clear of obstacles.
AREAS = {
 'lantern_trail': dict(
    base='g', patch='d', density=0.060, trees=['tree', 'tree', 'round', 'pine'], tint=None,
    start=(12, 14), shrine=(14, 12),
    keys=[(17, 13), (9, 17), (21, 19), (45, 14)],
    paths=[(2, 13, 46, 15), (22, 6, 23, 24), (8, 15, 10, 18), (20, 18, 23, 20)],
    water=[(37, 4, 43, 9)],
    rocks=[(5, 4, 'grayrock'), (36, 22, 'grayrock')],
    signs=[(44, 13)], seed=11),
 'bamboo_grove': dict(
    base='d', patch='g', density=0.085, trees=['pine', 'pine', 'round', 'tree'], tint='rgba(10,40,20,0.12)',
    start=(4, 14), shrine=(6, 12),
    keys=[(8, 15), (2, 14), (45, 14), (43, 14)],
    paths=[(2, 13, 46, 15), (18, 6, 19, 14), (24, 15, 25, 24)],
    water=[(30, 3, 36, 6)],
    rocks=[(10, 22, 'grayrock'), (40, 6, 'grayrock')],
    signs=[(3, 13), (44, 13)], seed=22),
 'shadow_ridge': dict(
    base='d', patch='d', density=0.050, trees=['dead', 'dead', 'dead', 'pine'], tint='rgba(40,0,50,0.28)',
    start=(4, 14), shrine=(6, 12),
    keys=[(40, 14), (2, 14), (43, 14), (45, 14), (8, 14)],
    paths=[(2, 13, 38, 15), (38, 9, 46, 19), (13, 8, 14, 15), (18, 15, 19, 20)],
    water=[],
    rocks=[(9, 4, 'brownrock'), (30, 4, 'brownrock'), (12, 22, 'brownrock'), (33, 23, 'brownrock')],
    signs=[(3, 13)], seed=33),

 'misty_marsh': dict(
    base='d', patch='g', density=0.050, trees=['dead', 'round', 'dead', 'pine'], tint='rgba(20,90,80,0.22)',
    start=(4, 14), shrine=(6, 12),
    keys=[(8, 15), (11, 13), (2, 14), (43, 14), (45, 14)],
    paths=[(2, 13, 46, 15), (8, 15, 9, 15), (11, 12, 11, 13)],
    water=[(12, 3, 18, 7), (21, 19, 28, 25), (33, 3, 40, 8), (10, 20, 16, 26), (38, 19, 44, 24), (22, 3, 27, 6), (30, 9, 34, 11)],
    rocks=[(18, 9, 'grayrock')],
    signs=[(3, 13), (44, 13)], seed=55),
 'lanternfall_town': dict(
    base='g', patch='g', density=0.018, trees=['tree', 'round', 'pine'], tint='rgba(255,170,80,0.09)',
    start=(4, 14), shrine=(24, 12),
    keys=[(2, 14), (13, 13), (19, 13), (27, 15), (16, 16), (36, 13), (31, 13)],
    paths=[(2, 13, 46, 15), (19, 16, 29, 18), (13, 12, 13, 12), (19, 12, 19, 12), (31, 12, 31, 12), (36, 12, 36, 12)],
    water=[(38, 23, 44, 27)],
    rocks=[], signs=[(3, 12), (45, 16)], seed=44,
    fixed=[('torii', 3, 13),
           ('h1', 6, 9), ('redhouse', 11, 9), ('h2', 17, 9), ('greenhouse', 29, 9), ('stone', 35, 9), ('h1', 40, 9),
           ('h3', 6, 19), ('h1', 12, 19), ('stall', 21, 19), ('shopA', 33, 19), ('h2', 38, 19),
           ('barrel', 9, 12), ('barrel', 10, 12), ('crate', 15, 12), ('barrel', 33, 12), ('crate', 34, 12), ('crate', 5, 17),
           ('flag', 21, 10), ('flag', 28, 10), ('baskets', 25, 20), ('lamp', 8, 16), ('lamp', 18, 16), ('lamp', 30, 16), ('lamp', 42, 16)]),
}

# footprint (w,h,blocked rows from bottom) per prop type
FOOT = {'tree': (2, 2, 1), 'round': (2, 2, 1), 'pine': (2, 2, 1), 'dead': (2, 2, 1),
        'grayrock': (4, 3, 2), 'brownrock': (4, 3, 2), 'bush': (1, 1, 1), 'sign': (1, 1, 1),
        'flower': (1, 1, 0), 'flower2': (1, 1, 0), 'tuft': (1, 1, 0), 'tuft2': (1, 1, 0),
        'barrel': (1, 1, 1), 'crate': (1, 1, 1),
        'h1': (4, 3, 2), 'h2': (4, 3, 2), 'h3': (4, 3, 2), 'redhouse': (4, 3, 2), 'shopA': (3, 3, 2), 'greenhouse': (4, 3, 2),
        'stone': (3, 3, 2), 'torii': (3, 2, 0), 'stall': (5, 3, 2), 'baskets': (3, 2, 1), 'flag': (1, 2, 1), 'lamp': (1, 2, 1)}


try:
    from layout import LAYOUT
except Exception:
    LAYOUT = {}


def build(name, c):
    c = dict(c)
    c['keys'] = list(c['keys']) + [tuple(p) for p in LAYOUT.get(name, {}).get('keys', [])]
    rnd = random.Random(c['seed'])
    ground = [[c['base']] * W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            if rnd.random() < 0.10:
                ground[y][x] = c['patch']
    blocked = [[0] * W for _ in range(H)]
    props = []

    def rect(x1, y1, x2, y2):
        for y in range(y1, y2 + 1):
            for x in range(x1, x2 + 1):
                if 0 <= x < W and 0 <= y < H:
                    yield x, y

    for r in c['paths']:
        for x, y in rect(*r):
            ground[y][x] = 'p'
    for r in c['water']:
        for x, y in rect(*r):
            ground[y][x] = 'w'
            blocked[y][x] = 1

    # Walls: 2-tile blocked ring around the map (portal column stays open, inside the ring)
    for y in range(H):
        for x in range(W):
            if x < 2 or y < 2 or x >= W - 2 or y >= H - 2:
                blocked[y][x] = 1
    # re-open the west edge door tiles (x=2 column is already outside the ring)
    keep = set()
    for kx, ky in c['keys'] + [c['start'], c['shrine']]:
        for x, y in rect(kx - 2, ky - 2, kx + 2, ky + 2):
            keep.add((x, y))

    def place(t, x, y, force=False):
        fw, fh, fb = FOOT[t]
        cells = list(rect(x, y, x + fw - 1, y + fh - 1))
        blockcells = list(rect(x, y + fh - fb, x + fw - 1, y + fh - 1)) if fb else []
        if not force:
            for cx, cy in cells:
                if cx < 0 or cy < 0 or cx >= W or cy >= H or (cx, cy) in keep or ground[cy][cx] in ('p', 'w'):
                    return False
            for cx, cy in blockcells:
                if blocked[cy][cx]:
                    return False
        for cx, cy in blockcells:
            blocked[cy][cx] = 1
        props.append({'t': t, 'x': x, 'y': y})
        return True

    # shrine rock sits just north of the shrine tile
    sx, sy = c['shrine']
    for x, y in rect(sx - 2, sy - 3, sx + 3, sy):
        ground[y][x] = ground[y][x] if ground[y][x] == 'p' else c['base']
    place('grayrock', sx - 1, sy - 3, force=True)
    for rx, ry, t in c['rocks']:
        place(t, rx, ry)
    for sgx, sgy in c['signs']:
        place('sign', sgx, sgy, force=True)
    for t, fx, fy in c.get('fixed', []):
        place(t, fx, fy, force=True)

    # border forest: tree sprites along the ring, leaving the middle door rows clear
    for x in range(0, W, 2):
        for y in (0, H - 2):
            place(rnd.choice(c['trees']), x, y, force=True)
    for y in range(2, H - 2, 2):
        for x in (0, W - 2):
            place(rnd.choice(c['trees']), x, y, force=True)
    # scatter
    for _ in range(int(W * H * c['density'] * 6)):
        x, y = rnd.randrange(2, W - 3), rnd.randrange(2, H - 3)
        place(rnd.choice(c['trees']), x, y)
    for _ in range(40):
        x, y = rnd.randrange(2, W - 2), rnd.randrange(2, H - 2)
        place(rnd.choice(['bush', 'bush', 'rock_dummy'] if False else ['bush']), x, y)
    for _ in range(90):
        x, y = rnd.randrange(2, W - 2), rnd.randrange(2, H - 2)
        if ground[y][x] in ('g', 'd') and not blocked[y][x]:
            place(rnd.choice(['flower', 'flower2', 'tuft', 'tuft2']), x, y)

    # reachability check
    sx0, sy0 = c['start']
    seen = {(sx0, sy0)}
    q = deque([(sx0, sy0)])
    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < W and 0 <= ny < H and not blocked[ny][nx] and (nx, ny) not in seen:
                seen.add((nx, ny)); q.append((nx, ny))
    for kx, ky in c['keys'] + [c['start'], c['shrine']]:
        if blocked[ky][kx]:
            raise SystemExit(f'{name}: key tile {(kx, ky)} is blocked')
        if (kx, ky) not in seen:
            raise SystemExit(f'{name}: key tile {(kx, ky)} unreachable from start')

    return {'area': name, 'w': W, 'h': H, 'tint': c['tint'],
            'ground': [''.join(r) for r in ground],
            'blocked': [''.join(str(v) for v in r) for r in blocked],
            'props': sorted(props, key=lambda p: (p['y'] + FOOT[p['t']][1], p['x']))}


if __name__ == '__main__':
    maps = {name: build(name, cfg) for name, cfg in AREAS.items()}
    with open(OUT, 'w') as f:
        f.write('/* Tile maps generated by tools/build_maps.py (ground, collision, props). */\n')
        f.write("(typeof window!=='undefined'?window:globalThis).NA_MAPS = " + json.dumps(maps, separators=(',', ':')) + ';\n')
    print('wrote', OUT, {k: len(v['props']) for k, v in maps.items()})
