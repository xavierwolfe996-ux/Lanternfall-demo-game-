/* World engine: tile map rendering, smooth grid movement, collision, NPCs, enemies,
   effects and camera. It only DRAWS and MOVES things; the server decides all outcomes. */
(function () {
  'use strict';
  const NA = (window.NA = window.NA || {});
  const T = 16;
  const STEP_MS = 125;
  const DIRV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const FX = {
    cut: { img: 'FX/Attack/Cut/SpriteSheet.png', fw: 32, fh: 32, frames: 4, dur: 280, scale: 1.2 },
    flame: { img: 'FX/Elemental/Flam/SpriteSheet.png', fw: 40, fh: 30, frames: 5, dur: 520, scale: 1.2 },
    aura: { img: 'FX/Magic/Aura/SpriteSheet.png', fw: 25, fh: 24, frames: 5, dur: 600, scale: 1.4 },
  };

  const W = {
    canvas: null, ctx: null, scale: 3, vw: 384, vh: 216,
    map: null, area: null, ground: null, props: [], propImgs: {},
    player: null, npcs: [], enemies: [], portals: [], fx: [], floats: [],
    held: [], time: 0, running: false, frozen: false, shake: 0, npcMarks: {},
    onStep: null, onContact: null,
  };
  NA.world = W;

  W.init = function (canvas) {
    W.canvas = canvas;
    W.ctx = canvas.getContext('2d');
    window.addEventListener('resize', W.resize);
    W.resize();
  };

  W.resize = function () {
    if (!W.canvas) return;
    const cw = W.canvas.clientWidth || window.innerWidth;
    const ch = W.canvas.clientHeight || window.innerHeight;
    W.scale = Math.max(2, Math.round(ch / 230));
    W.vw = Math.ceil(cw / W.scale);
    W.vh = Math.ceil(ch / W.scale);
    W.canvas.width = W.vw;
    W.canvas.height = W.vh;
    W.ctx.imageSmoothingEnabled = false;
  };

  // ------------------------------------------------------------------ loading
  W.loadArea = async function (data, ch) {
    W.map = data.map;
    W.area = data.area;
    const sheets = Object.values(NA.tiles.sheets);
    const chars = [`Actor/Character/${ch.sprite_key}/SpriteSheet.png`].concat(data.npcs.map((n) => n.sprite), data.spawns.map((s) => s.sprite));
    await NA.assets.preload(sheets.concat(chars, Object.values(FX).map((f) => f.img)));
    buildGround();
    W.props = W.map.props.map((p) => {
      const r = NA.tiles.props[p.t];
      return r ? { x: p.x, y: p.y, r, key: p.y * T + r[4] } : null;
    }).filter(Boolean);
    W.player = {
      tx: ch.x, ty: ch.y, px: ch.x * T, py: ch.y * T, dir: ch.dir || 'down', moving: false, t: 0,
      from: null, to: null, attackUntil: 0, hurtUntil: 0, sprite: NA.assets.img(`Actor/Character/${ch.sprite_key}/SpriteSheet.png`),
    };
    W.npcs = data.npcs.map((n) => Object.assign({}, n, { img: NA.assets.img(n.sprite), dir: 'down' }));
    W.portals = data.portals;
    W.enemies = data.spawns.map((s) => makeEnemy(s));
    W.fx = []; W.floats = [];
    W.engagedId = data.combat ? data.combat.spawn_id : null;
  };

  function makeEnemy(s) {
    const boss = s.is_boss;
    return {
      id: s.spawn_id, def: s, hx: s.x, hy: s.y, tx: s.x, ty: s.y, px: s.x * T, py: s.y * T, dir: 'down',
      img: NA.assets.img(s.sprite), boss, hidden: s.respawn_in > 0, respawnAt: s.respawn_in > 0 ? Date.now() + s.respawn_in * 1000 : 0,
      nextThink: 0, flash: 0, hpFrac: 1, showBarUntil: 0, leash: boss ? 3 : 6, aggro: boss ? 6 : 5, contact: boss ? 3 : 1, stepMs: boss ? 650 : 520,
    };
  }

  function buildGround() {
    const m = W.map;
    const g = document.createElement('canvas');
    g.width = m.w * T; g.height = m.h * T;
    const c = g.getContext('2d');
    c.imageSmoothingEnabled = false;
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        const kind = m.ground[y][x];
        const variants = NA.tiles.ground[kind] || NA.tiles.ground.g;
        const v = variants[(x * 7 + y * 13 + ((x * y) % 5)) % variants.length];
        c.drawImage(NA.assets.img(v[0]), v[1], v[2], T, T, x * T, y * T, T, T);
      }
    }
    W.ground = g;
  }

  // ------------------------------------------------------------------ queries
  W.blocked = function (x, y) {
    const m = W.map;
    if (x < 0 || y < 0 || x >= m.w || y >= m.h || m.blocked[y][x] === '1') return true;
    if (W.npcs.some((n) => n.x === x && n.y === y)) return true;
    if (W.enemies.some((e) => !e.hidden && e.tx === x && e.ty === y)) return true;
    return false;
  };

  W.nearest = function () {
    const p = W.player;
    if (!p) return null;
    let best = null;
    const consider = (type, ref, x, y, label, range) => {
      const d = Math.abs(p.tx - x) + Math.abs(p.ty - y);
      if (d <= range && (!best || d < best.d)) best = { type, ref, d, label };
    };
    W.npcs.forEach((n) => consider('npc', n, n.x, n.y, 'Talk to ' + n.name, 2));
    W.portals.forEach((g) => consider('portal', g, g.x, g.y, g.locked ? g.label + ' (locked)' : g.label, 2));
    if (W.area) consider('shrine', W.area, W.area.shrine_x, W.area.shrine_y, 'Rest at the shrine', 2);
    return best;
  };

  W.nearestEnemy = function (range) {
    const p = W.player;
    let best = null;
    W.enemies.forEach((e) => {
      if (e.hidden) return;
      const d = Math.abs(p.tx - e.tx) + Math.abs(p.ty - e.ty) - (e.boss ? 2 : 0);
      if (d <= range && (!best || d < best.d)) best = { e, d };
    });
    return best ? best.e : null;
  };

  W.enemyById = (id) => W.enemies.find((e) => e.id === id);
  W.setHeld = (list) => { W.held = list; };
  W.face = (dir) => { if (W.player) W.player.dir = dir; };

  W.snapTo = function (x, y) {
    const p = W.player;
    p.tx = x; p.ty = y; p.px = x * T; p.py = y * T; p.moving = false;
  };

  // ------------------------------------------------------------------ effects
  W.addFx = function (kind, tx, ty, opts) {
    const f = FX[kind] || FX.cut;
    W.fx.push({ f, x: tx * T + 8, y: ty * T + 8, born: performance.now(), flip: opts && opts.flip });
  };
  W.addFloat = function (text, color, tx, ty, big) {
    W.floats.push({ text, color, x: tx * T + 8 + (Math.random() * 8 - 4), y: ty * T - 2, born: performance.now(), big: !!big });
  };
  W.hitEnemy = function (id, frac) {
    const e = W.enemyById(id);
    if (e) { e.flash = performance.now() + 140; e.hpFrac = frac; e.showBarUntil = performance.now() + 4000; }
  };
  W.killEnemy = function (id, respawnSeconds) {
    const e = W.enemyById(id);
    if (e) { e.hidden = true; e.respawnAt = Date.now() + respawnSeconds * 1000; e.hpFrac = 1; }
  };
  W.kick = (amount) => { W.shake = amount || 2; };

  // ------------------------------------------------------------------ update
  function stepPlayer(dir) {
    const p = W.player;
    p.dir = dir;
    const [dx, dy] = DIRV[dir];
    const nx = p.tx + dx, ny = p.ty + dy;
    if (W.blocked(nx, ny)) return false;
    p.moving = true; p.t = 0; p.from = [p.tx * T, p.ty * T]; p.to = [nx * T, ny * T];
    p.tx = nx; p.ty = ny;
    return true;
  }

  function updatePlayer(dt) {
    const p = W.player;
    if (p.moving) {
      p.t += dt;
      const k = Math.min(1, p.t / STEP_MS);
      p.px = p.from[0] + (p.to[0] - p.from[0]) * k;
      p.py = p.from[1] + (p.to[1] - p.from[1]) * k;
      if (k >= 1) { p.moving = false; if (W.onStep) W.onStep(p.tx, p.ty); }
    }
    if (!p.moving && !W.frozen && W.held.length) {
      stepPlayer(W.held[W.held.length - 1]);
    }
  }

  function updateEnemies(now, dt) {
    const p = W.player;
    W.enemies.forEach((e) => {
      if (e.hidden) {
        if (e.respawnAt && Date.now() >= e.respawnAt) { e.hidden = false; e.respawnAt = 0; e.tx = e.hx; e.ty = e.hy; e.px = e.hx * T; e.py = e.hy * T; e.hpFrac = 1; }
        return;
      }
      // smooth glide toward its tile
      e.px += (e.tx * T - e.px) * Math.min(1, dt / 110);
      e.py += (e.ty * T - e.py) * Math.min(1, dt / 110);
      const dist = Math.abs(p.tx - e.tx) + Math.abs(p.ty - e.ty);
      const engaged = W.engagedId === e.id;
      if (engaged) {
        const dx = p.tx - e.tx, dy = p.ty - e.ty;
        e.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
        return;
      }
      if (now < e.nextThink || W.frozen) return;
      const fromHome = Math.abs(e.tx - e.hx) + Math.abs(e.ty - e.hy);
      if (dist <= e.aggro && W.playerAlive !== false) {
        if (dist <= e.contact) {
          e.nextThink = now + 600;
          if (W.onContact) W.onContact(e);
          return;
        }
        const dx = Math.sign(p.tx - e.tx), dy = Math.sign(p.ty - e.ty);
        const tries = Math.abs(p.tx - e.tx) >= Math.abs(p.ty - e.ty) ? [[dx, 0], [0, dy]] : [[0, dy], [dx, 0]];
        for (const [sx, sy] of tries) {
          if (!sx && !sy) continue;
          const nx = e.tx + sx, ny = e.ty + sy;
          const away = Math.abs(nx - e.hx) + Math.abs(ny - e.hy);
          if (away <= e.leash && !W.blocked(nx, ny) && !(nx === p.tx && ny === p.ty)) {
            e.tx = nx; e.ty = ny; e.dir = sx ? (sx > 0 ? 'right' : 'left') : (sy > 0 ? 'down' : 'up'); break;
          }
        }
        e.nextThink = now + e.stepMs;
      } else {
        // wander near home, or drift back if it strayed
        e.nextThink = now + 900 + Math.random() * 1400;
        const options = Object.values(DIRV).filter(([sx, sy]) => {
          const nx = e.tx + sx, ny = e.ty + sy;
          return !W.blocked(nx, ny) && !(nx === p.tx && ny === p.ty) && Math.abs(nx - e.hx) + Math.abs(ny - e.hy) <= (fromHome > 2 ? fromHome - 1 : 2);
        });
        if (options.length && Math.random() < 0.5) {
          const [sx, sy] = options[Math.floor(Math.random() * options.length)];
          e.tx += sx; e.ty += sy; e.dir = sx ? (sx > 0 ? 'right' : 'left') : (sy > 0 ? 'down' : 'up');
        }
      }
    });
  }

  let last = performance.now();
  function frame(now) {
    if (!W.running) return;
    const dt = Math.min(60, now - last);
    last = now;
    W.time = now;
    if (W.player && W.map) {
      updatePlayer(dt);
      updateEnemies(now, dt);
      draw(now);
    }
    requestAnimationFrame(frame);
  }
  W.start = function () { if (!W.running) { W.running = true; last = performance.now(); requestAnimationFrame(frame); } };
  W.stop = function () { W.running = false; };

  // ------------------------------------------------------------------ drawing
  function draw(now) {
    const c = W.ctx, p = W.player, m = W.map;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#0a120a';
    c.fillRect(0, 0, W.vw, W.vh);

    // camera
    let camX = Math.round(p.px + 8 - W.vw / 2), camY = Math.round(p.py + 8 - W.vh / 2);
    const mw = m.w * T, mh = m.h * T;
    camX = mw <= W.vw ? Math.round((mw - W.vw) / 2) : Math.max(0, Math.min(mw - W.vw, camX));
    camY = mh <= W.vh ? Math.round((mh - W.vh) / 2) : Math.max(0, Math.min(mh - W.vh, camY));
    let sx = 0, sy = 0;
    if (W.shake > 0) { sx = Math.round((Math.random() - .5) * W.shake * 2); sy = Math.round((Math.random() - .5) * W.shake * 2); W.shake = Math.max(0, W.shake - 0.25); }
    c.translate(-camX + sx, -camY + sy);
    W.cam = { x: camX, y: camY };

    c.drawImage(W.ground, 0, 0);
    drawWater(c, now, camX, camY);
    drawShrineAndPortals(c, now);

    // depth-sorted drawables
    const list = [];
    const inView = (x, y, w, h) => x + w >= camX - 16 && x <= camX + W.vw + 16 && y + h >= camY - 16 && y <= camY + W.vh + 16;
    W.props.forEach((pr) => {
      if (inView(pr.x * T, pr.y * T, pr.r[3], pr.r[4])) list.push({ k: pr.key, d: () => c.drawImage(NA.assets.img(pr.r[0]), pr.r[1], pr.r[2], pr.r[3], pr.r[4], pr.x * T, pr.y * T, pr.r[3], pr.r[4]) });
    });
    W.npcs.forEach((n) => list.push({ k: n.y * T + 16, d: () => drawNpc(c, n, now) }));
    W.enemies.forEach((e) => { if (!e.hidden) list.push({ k: e.py + (e.boss ? 20 : 16), d: () => drawEnemy(c, e, now) }); });
    list.push({ k: p.py + 16, d: () => drawPlayer(c, p, now) });
    list.sort((a, b) => a.k - b.k).forEach((it) => it.d());

    // effects + floating text
    W.fx = W.fx.filter((f) => now - f.born < f.f.dur);
    W.fx.forEach((f) => {
      const k = (now - f.born) / f.f.dur, fi = Math.min(f.f.frames - 1, Math.floor(k * f.f.frames));
      const im = NA.assets.img(f.f.img);
      if (!NA.assets.ok(im)) return;
      const w = f.f.fw * f.f.scale, h = f.f.fh * f.f.scale;
      c.drawImage(im, fi * f.f.fw, 0, f.f.fw, f.f.fh, f.x - w / 2, f.y - h / 2, w, h);
    });
    W.floats = W.floats.filter((f) => now - f.born < 950);
    c.textAlign = 'center';
    W.floats.forEach((f) => {
      const k = (now - f.born) / 950;
      c.globalAlpha = 1 - k * k;
      c.font = (f.big ? '14px' : '10px') + ' NinjaPixel, monospace';
      c.fillStyle = '#000'; c.fillText(f.text, f.x + 1, f.y - k * 18 + 1);
      c.fillStyle = f.color; c.fillText(f.text, f.x, f.y - k * 18);
    });
    c.globalAlpha = 1;

    if (m.tint) { c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = m.tint; c.fillRect(0, 0, W.vw, W.vh); }
    if (p.hurtUntil > now) { c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = 'rgba(200,20,20,' + (0.25 * (p.hurtUntil - now) / 220) + ')'; c.fillRect(0, 0, W.vw, W.vh); }
  }

  function drawWater(c, now, camX, camY) {
    const m = W.map;
    const x0 = Math.max(0, Math.floor(camX / T)), x1 = Math.min(m.w - 1, Math.ceil((camX + W.vw) / T));
    const y0 = Math.max(0, Math.floor(camY / T)), y1 = Math.min(m.h - 1, Math.ceil((camY + W.vh) / T));
    c.fillStyle = 'rgba(255,255,255,0.35)';
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (m.ground[y][x] !== 'w') continue;
      const ph = (now / 700 + x * 0.7 + y * 1.3) % 3;
      if (ph < 1) c.fillRect(x * T + 3 + Math.floor(ph * 6), y * T + 5 + ((x + y) % 3) * 3, 5, 1);
    }
  }

  function drawShrineAndPortals(c, now) {
    const a = W.area;
    if (a) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 420);
      const x = a.shrine_x * T + 8, y = a.shrine_y * T + 8;
      const g = c.createRadialGradient(x, y, 1, x, y, 16 + pulse * 5);
      g.addColorStop(0, 'rgba(255,240,170,0.75)'); g.addColorStop(1, 'rgba(255,200,90,0)');
      c.fillStyle = g; c.fillRect(x - 24, y - 24, 48, 48);
    }
    W.portals.forEach((g) => {
      const x = g.x * T + 8, y = g.y * T + 8, spin = now / 500;
      const col = g.locked ? '120,120,140' : '90,230,255';
      c.save(); c.translate(x, y);
      const rg = c.createRadialGradient(0, 0, 1, 0, 0, 20);
      rg.addColorStop(0, `rgba(${col},0.55)`); rg.addColorStop(1, `rgba(${col},0)`);
      c.fillStyle = rg; c.fillRect(-22, -22, 44, 44);
      c.strokeStyle = `rgba(${col},0.95)`; c.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(0, 0, 5 + i * 3, spin * (i % 2 ? -1 : 1) + i, spin * (i % 2 ? -1 : 1) + i + 3.2); c.stroke(); }
      c.restore();
    });
  }

  function shadow(c, x, y, w) {
    c.fillStyle = 'rgba(0,0,0,0.3)';
    c.beginPath(); c.ellipse(x + 8, y + 15, w || 6, 2.5, 0, 0, Math.PI * 2); c.fill();
  }

  function drawPlayer(c, p, now) {
    shadow(c, p.px, p.py);
    const attacking = p.attackUntil > now;
    const row = attacking ? 4 : (p.moving ? Math.floor(now / 110) % 4 : 0);
    NA.drawChar(c, p.sprite, p.dir, row, p.px, p.py - 2, 16);
  }

  function drawNpc(c, n, now) {
    const x = n.x * T, y = n.y * T;
    shadow(c, x, y);
    NA.drawChar(c, n.img, n.dir, Math.floor(now / 700) % 2, x, y - 2, 16);
    c.font = '8px NinjaPixel, monospace'; c.textAlign = 'center';
    c.fillStyle = '#000'; c.fillText(n.name, x + 9, y - 6);
    c.fillStyle = '#fff3c4'; c.fillText(n.name, x + 8, y - 7);
    const mark = W.npcMarks[n.npc_key];
    if (mark) {
      const bob = Math.sin(now / 250) * 1.5;
      c.font = '12px NinjaPixel, monospace';
      c.fillStyle = '#000'; c.fillText(mark, x + 9, y - 14 + bob);
      c.fillStyle = mark === '?' ? '#7dff8c' : '#ffd24a'; c.fillText(mark, x + 8, y - 15 + bob);
    }
  }

  function drawEnemy(c, e, now) {
    const flashing = e.flash > now;
    if (e.boss) {
      const im = NA.assets.img(e.def.sprite);
      if (!NA.assets.ok(im)) return;
      const BOSS = { w: e.def.boss_w || 62, h: e.def.boss_h || 62, frames: e.def.boss_frames || 6 };
      const fi = Math.floor(now / 160) % BOSS.frames;
      const x = e.px + 8 - BOSS.w / 2, y = e.py + 16 - BOSS.h + 6;
      c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.ellipse(e.px + 8, e.py + 14, 20, 6, 0, 0, Math.PI * 2); c.fill();
      if (flashing) c.filter = 'brightness(2.2)';
      c.drawImage(im, fi * BOSS.w, 0, BOSS.w, BOSS.h, Math.round(x), Math.round(y), BOSS.w, BOSS.h);
      c.filter = 'none';
      drawEnemyBar(c, e, e.px + 8, y - 4, 44, now);
      return;
    }
    shadow(c, e.px, e.py);
    if (flashing) c.filter = 'brightness(2.4)';
    NA.drawChar(c, e.img, e.dir, Math.floor(now / 220) % 4, e.px, e.py - 2, 16);
    c.filter = 'none';
    drawEnemyBar(c, e, e.px + 8, e.py - 5, 14, now);
  }

  function drawEnemyBar(c, e, cx, y, w, now) {
    if (e.showBarUntil < now && W.engagedId !== e.id) return;
    c.fillStyle = '#000'; c.fillRect(cx - w / 2 - 1, y - 1, w + 2, 4);
    c.fillStyle = '#c93a34'; c.fillRect(cx - w / 2, y, w * Math.max(0, e.hpFrac), 2);
  }
})();
