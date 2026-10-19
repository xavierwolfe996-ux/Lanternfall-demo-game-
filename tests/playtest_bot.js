/* Scripted "player" that plays the game through the real rules (js/server.js) with a fake clock, to ESTIMATE how long a
   first playthrough takes. It walks (BFS), talks, accepts and turns in quests, fights with skills, rests, shops and levels up.
   Run:  node tests/playtest_bot.js [class]      (class = shinobi | shadow | mystic)
   It is an estimate for a competent player, not a measurement of real people. */
'use strict';
const path = require('path');
class Store { constructor() { this.m = new Map(); } getItem(k) { return this.m.has(k) ? this.m.get(k) : null; } setItem(k, v) { this.m.set(k, String(v)); } removeItem(k) { this.m.delete(k); } }
globalThis.localStorage = new Store(); globalThis.sessionStorage = new Store();
let CLOCK = 1_800_000_000_000; Date.now = () => CLOCK;
require(path.join(__dirname, '../js/data.js')); require(path.join(__dirname, '../js/maps.js')); require(path.join(__dirname, '../js/server.js'));
const S = globalThis.NA.server, D = globalThis.NA_DATA, MAPS = globalThis.NA_MAPS;

// ---- human-speed assumptions (seconds) -------------------------------------------------
const CASUAL = process.env.CASUAL === '1';   // CASUAL=1 -> a relaxed first-time player instead of a sharp one
const STEP_MS = CASUAL ? 165 : 135;          // one tile (the game moves at 125 ms/tile; turns and stops add a little)
const READ_TALK = CASUAL ? 12000 : 7000;     // reading a dialogue and clicking
const READ_REWARD = CASUAL ? 7000 : 4000;    // accepting / turning in
const SHOP_VISIT = CASUAL ? 20000 : 12000;   // opening the shop and buying
const FIGHT_FIND = CASUAL ? 3500 : 1200;     // spotting the next enemy
const REACT = CASUAL ? 700 : 380;            // delay between key presses in a fight
const verbose = process.argv.includes('-v');

const api = async (a, b) => S.handle(a, b || {});
let X = 0, Y = 0, area = 'lantern_trail', hb = 0;
const log = [];
const t0 = CLOCK;
const T = () => Math.round((CLOCK - t0) / 1000);
const fmt = (s) => `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
const note = (m) => { log.push(`${fmt(T())}  ${m}`); if (verbose) console.log(`${fmt(T())}  ${m}`); };
const pos = () => ({ x: X, y: Y, dir: 'down' });

async function tick(ms) {
  CLOCK += ms; hb += ms;
  while (hb >= 2000) { hb -= 2000; const r = await api('sync', { pos: pos(), play_seconds: 2 }); if (!r.accepted) { X = r.x; Y = r.y; } }
}
const think = (ms) => tick(ms);

// ---- walking -----------------------------------------------------------------------------
function bfs(areaKey, sx, sy, goal) {
  const m = MAPS[D.area_defs[areaKey].map_file.replace('.json', '')];
  const npcs = new Set(Object.values(D.npc_defs).filter((n) => n.area_key === areaKey).map((n) => n.x + ',' + n.y));
  const prev = new Map([[sx + ',' + sy, null]]); const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift();
    if (goal(x, y)) { const p = []; let k = x + ',' + y; while (k) { const [a, b] = k.split(',').map(Number); p.push([a, b]); k = prev.get(k); } return p.reverse(); }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
      if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h || m.blocked[ny][nx] === '1' || prev.has(k) || npcs.has(k)) continue;
      prev.set(k, x + ',' + y); q.push([nx, ny]);
    }
  }
  return null;
}
async function walkPath(p) {
  for (let i = 1; i < p.length; i++) { X = p[i][0]; Y = p[i][1]; await tick(STEP_MS); }
}
async function walkNear(tx, ty, range) {
  const p = bfs(area, X, Y, (x, y) => Math.abs(x - tx) + Math.abs(y - ty) <= range);
  if (!p) throw new Error(`no path in ${area} to ${tx},${ty}`);
  await walkPath(p);
}

// ---- areas ---------------------------------------------------------------------------------
function areaRoute(from, to, unlocked) {
  if (from === to) return [];
  const q = [[from, []]], seen = new Set([from]);
  while (q.length) {
    const [a, route] = q.shift();
    for (const p of D.area_portals.filter((g) => g.from_area === a)) {
      if (seen.has(p.to_area) || !unlocked.includes(p.to_area)) continue;
      const r = route.concat([p]);
      if (p.to_area === to) return r;
      seen.add(p.to_area); q.push([p.to_area, r]);
    }
  }
  return null;
}
async function gotoArea(to) {
  const st = (await api('load')).state;
  const route = areaRoute(area, to, st.areas_unlocked);
  if (!route) throw new Error(`no route ${area} -> ${to}`);
  for (const p of route) {
    await walkNear(p.x, p.y, 1);
    const r = await api('travel', { portal_id: p.id, pos: pos() });
    area = r.state.character.area_key; X = r.state.character.x; Y = r.state.character.y;
    await think(1500);
  }
}

// ---- state helpers --------------------------------------------------------------------------
const load = async () => (await api('load')).state;
const questMap = (st) => Object.fromEntries(st.quests.map((q) => [q.quest_key, q]));
const inv = (st, k) => (st.inventory.find((i) => i.item_key === k) || { quantity: 0 }).quantity;

// ---- talking / quests -------------------------------------------------------------------------
async function gotoNpc(npcKey) {
  const n = D.npc_defs[npcKey];
  await gotoArea(n.area_key);
  await walkNear(n.x, n.y, 2);
}
async function accept(qk) {
  const q = D.quest_defs[qk];
  await gotoNpc(q.giver_npc);
  await api('talk', { npc_key: q.giver_npc, pos: pos() }); await think(READ_TALK);
  await api('quest_accept', { npc_key: q.giver_npc, quest_key: qk, pos: pos() }); await think(READ_REWARD);
  note(`accepted "${q.title}"`);
}
async function turnIn(qk) {
  const q = D.quest_defs[qk];
  await gotoNpc(q.turn_in_npc);
  await api('talk', { npc_key: q.turn_in_npc, pos: pos() }); await think(READ_TALK);
  const r = await api('quest_complete', { npc_key: q.turn_in_npc, quest_key: qk, pos: pos() }); await think(READ_REWARD);
  note(`completed "${q.title}"  (level ${r.state.character.level})`);
  return r;
}

// ---- shopping / healing ------------------------------------------------------------------------
async function shop(npcKey, healTarget) {
  const n = D.npc_defs[npcKey];
  await gotoNpc(npcKey);
  let st = await load();
  const stock = D.shop_stock[n.shop_key];
  const buy = async (k, qty) => { const r = await api('shop_buy', { npc_key: npcKey, item_key: k, quantity: qty || 1, pos: pos() }); return r; };
  // gear upgrades first (best affordable allowed by level), then potions
  for (const slot of ['weapon', 'armor', 'accessory']) {
    const cur = st.equipment[slot] ? D.item_defs[st.equipment[slot]] : null;
    const score = (i) => i.bonus_atk * 2 + i.bonus_def * 2 + i.bonus_hp / 8 + i.bonus_mp / 8;
    const cands = stock.map((k) => D.item_defs[k]).filter((i) => i.item_type === slot && i.req_level <= st.character.level && i.buy_price <= st.character.gold - 40 && (!cur || score(i) > score(cur)));
    cands.sort((a, b) => score(b) - score(a));
    if (cands[0]) { try { await buy(cands[0].item_key); await api('equip', { item_key: cands[0].item_key }); note(`bought ${cands[0].name}`); st = await load(); } catch (e) { /* ignore */ } }
  }
  const heals = ['elixir', 'sushi', 'healing_tonic', 'rice_ball'].filter((k) => stock.includes(k));
  for (const k of heals) {
    const want = (healTarget || 3) - ['elixir', 'sushi', 'healing_tonic'].reduce((a, h) => a + inv(st, h), 0);
    if (want <= 0) break;
    const price = D.item_defs[k].buy_price;
    const n2 = Math.min(want, Math.floor((st.character.gold - 10) / price));
    if (n2 > 0) { try { await buy(k, n2); st = await load(); } catch (e) { /* ignore */ } }
  }
  await think(SHOP_VISIT);
  // sell junk materials we do not need
  st = await load();
  for (const it of st.inventory) {
    const d = D.item_defs[it.item_key];
    if (d.item_type === 'material' && d.sell_price > 0 && !Object.values(D.quest_defs).some((q) => q.target_key === it.item_key && st.quests.find((x) => x.quest_key === q.quest_key && ['active', 'available'].includes(x.state)))) {
      try { await api('shop_sell', { npc_key: npcKey, item_key: it.item_key, quantity: it.quantity, pos: pos() }); } catch (e) { /* ignore */ }
    }
  }
}
async function restAtShrine() {
  const a = D.area_defs[area];
  await walkNear(a.shrine_x, a.shrine_y, 1);
  await api('rest', { pos: pos() }); await think(1500);
}

// ---- combat -------------------------------------------------------------------------------------------
let stats = { fights: 0, deaths: 0, rests: 0 };
async function fight(spawn) {
  stats.fights++;
  await think(FIGHT_FIND);
  const sp = D.enemy_spawns[spawn.spawn_id];
  await walkNear(sp.x, sp.y, spawn.is_boss ? 4 : 2);
  let r = await api('combat_start', { spawn_id: sp.spawn_id, pos: pos() });
  const cd = {};
  let st = await load();
  for (let i = 0; i < 4000; i++) {
    const tk = await api('combat_tick', { pos: pos() });
    if (tk.events.some((e) => e.type === 'defeat')) {      // enemy attacks are applied by the server when we ask, so a death can arrive here
      stats.deaths++; note(`DEFEATED by ${spawn.name}`);
      const c = tk.state.character; area = c.area_key; X = c.x; Y = c.y; await think(3000); return { won: false };
    }
    if (!tk.combat) return { won: false, fled: true };
    const hpMax = st.stats.max_hp, p = tk.player;
    const hp = p.hp, mp = p.mp, now = CLOCK;
    const have = (k) => st.skills.some((s) => s.skill_key === k && s.unlocked);
    const ready = (k) => (cd[k] || 0) <= now && mp >= D.skill_defs[k].mp_cost && have(k);
    let action = null, item = null;
    const potion = ['healing_tonic', 'sushi', 'elixir', 'rice_ball'].find((k) => inv(st, k) > 0);
    if (hp < hpMax * 0.4 && ready('healing_breath')) action = 'healing_breath';
    else if (hp < hpMax * 0.35 && potion && (cd._item || 0) <= now) item = potion;
    else if (ready('fire_burst')) action = 'fire_burst';
    else if (ready('power_strike')) action = 'power_strike';
    else if ((cd.strike || 0) <= now) action = 'strike';
    if (item) {
      const res = await api('use_item', { item_key: item }); cd._item = CLOCK + 1000; st = res.state;
      await think(REACT); continue;
    }
    if (!action) { await think(120); continue; }
    let res;
    try { res = await api('combat_action', { skill_key: action, pos: pos() }); } catch (e) { if (process.env.DEBUGFIGHT && i < 6) console.log('action error', action, e.message, 'hp', hp, 'mp', mp); await think(150); continue; }
    cd[action] = CLOCK + D.skill_defs[action].cooldown_ms;
    if (res.events.some((e) => e.type === 'defeat')) { stats.deaths++; note(`DEFEATED by ${spawn.name}`); const c = res.state.character; area = c.area_key; X = c.x; Y = c.y; await think(3000); return { won: false }; }
    const v = res.events.find((e) => e.type === 'victory');
    const cleared = res.events.find((e) => e.type === 'game_cleared');
    if (process.env.DEBUGFIGHT && i % 40 === 0) console.log('iter', i, 'boss hp', res.combat && res.combat.enemy_hp, 'player', res.player.hp + '/' + res.player.max_hp, 'mp', res.player.mp, 'action', action);
    if (v) { if (res.state) st = res.state; return { won: true, cleared, events: res.events }; }
    if (res.state) st = res.state;
    await think(REACT);
  }
  throw new Error('fight did not end');
}

async function availableSpawns(enemyKey) {
  const a = (await api('area')).area ? await api('area') : null;
  return a.spawns.filter((s) => s.enemy_key === enemyKey && s.respawn_in === 0);
}
async function hunt(enemyKey, until) {
  // go to the area where this enemy lives
  const homes = [...new Set(Object.values(D.enemy_spawns).filter((s) => s.enemy_key === enemyKey).map((s) => s.area_key))];
  const unlocked = (await load()).areas_unlocked;
  const home = homes.includes(area) ? area : (homes.find((a) => unlocked.includes(a)) || homes[0]);
  await gotoArea(home);
  for (let guard = 0; guard < 400; guard++) {
    if (await until()) return;
    let st = await load();
    // heal up before the next fight when low
    const frac = st.character.hp / st.stats.max_hp;
    if (frac < 0.5) {
      const potion = ['rice_ball', 'healing_tonic'].find((k) => inv(st, k) > 0 && st.character.hp < st.stats.max_hp - D.item_defs[k].heal_hp / 2);
      if (frac < 0.3 || !potion) { await restAtShrine(); stats.rests++; } else { await api('use_item', { item_key: potion }); await think(800); }
    }
    const area_ = await api('area');
    const pool = area_.spawns.filter((s) => s.enemy_key === enemyKey && s.respawn_in === 0);
    if (!pool.length) { const soon = Math.min(...area_.spawns.filter((s) => s.enemy_key === enemyKey).map((s) => s.respawn_in)); await think((soon + 1) * 1000); continue; }
    pool.sort((a, b) => Math.abs(a.x - X) + Math.abs(a.y - Y) - (Math.abs(b.x - X) + Math.abs(b.y - Y)));
    const res = await fight(pool[0]);
    if (!res.won && pool[0].is_boss) return;     // go level up / restock before trying a boss again
    if (res.won && res.cleared) { note(`*** GAME CLEARED *** clear time shown to player: ${fmt(res.cleared.seconds)} (level ${res.cleared.level})`); report.cleared = res.cleared; return; }
  }
}

// ---- the policy: play the whole game ------------------------------------------------------------------
const report = {};
async function levelTo(level, enemyPref) {
  for (;;) {
    const st = await load();
    if (st.character.level >= level) return;
    const enemy = [...enemyPref].reverse().find((k) => D.enemy_defs[k].level <= st.character.level + 2) || enemyPref[0];
    const L0 = st.character.level;
    await hunt(enemy, async () => (await load()).character.level > L0);
  }
}
async function main() {
  const cls = process.argv.find((a) => ['shinobi', 'shadow', 'mystic'].includes(a)) || 'shinobi';
  await S.handle('register', { username: 'bot', password: 'BotPass123!' });
  await api('create_character', { name: 'Bot', class_key: cls, sprite_key: 'NinjaGreen' });
  const st0 = await load(); X = st0.character.x; Y = st0.character.y; area = st0.character.area_key;
  note(`new ${cls} starts in ${area}`);
  const order = (process.env.PLAN || '').split(',').filter(Boolean);
  const plan = require('./playtest_plan.js');
  await plan.run({ api, load, questMap, inv, accept, turnIn, hunt, levelTo, shop, restAtShrine, gotoArea, gotoNpc, note, think, fight, stats, report, D, S, getArea: () => area, T, fmt, availableSpawns });
  const total = T();
  const st = await load();
  console.log('\n=== TIMELINE ===\n' + log.join('\n'));
  console.log(`\nfights: ${stats.fights}  deaths: ${stats.deaths}  shrine rests: ${stats.rests}`);
  console.log(`final level ${st.character.level}, gold ${st.character.gold}`);
  console.log(`ESTIMATED TIME TO CLEAR THE GAME (boss defeated): ${report.cleared ? fmt(report.cleared.seconds) : 'not cleared'}   (total simulated ${fmt(total)})`);
}
main().catch((e) => { console.error('BOT ERROR', e); console.log(log.join('\n')); process.exit(1); });
