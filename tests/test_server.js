/* Rule tests for js/server.js (no browser needed).   Run:  node tests/test_server.js
   Uses a fake clock, a fake localStorage and two separate accounts. */
'use strict';
const path = require('path');
class Store { constructor() { this.m = new Map(); } getItem(k) { return this.m.has(k) ? this.m.get(k) : null; } setItem(k, v) { this.m.set(k, String(v)); } removeItem(k) { this.m.delete(k); } }
globalThis.localStorage = new Store();
globalThis.sessionStorage = new Store();
let CLOCK = 1_800_000_000_000;
Date.now = () => CLOCK;
require(path.join(__dirname, '../js/data.js'));
require(path.join(__dirname, '../js/maps.js'));
require(path.join(__dirname, '../js/server.js'));
const S = globalThis.NA.server;
const D = globalThis.NA_DATA;

let pass = 0, fail = 0;
function check(name, cond, extra) { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name + ' ' + (extra || '')); } }
async function call(action, body) { try { return { ok: true, status: 200, d: await S.handle(action, body) }; } catch (e) { return { ok: false, status: e.status, msg: e.message }; } }
const sleep = (ms) => { CLOCK += ms; };
const session = (uid) => globalThis.sessionStorage.setItem('ninja_adventure_rpg_session', String(uid));
const getUid = () => parseInt(globalThis.sessionStorage.getItem('ninja_adventure_rpg_session'), 10);
const state = async () => (await call('load')).d.state;

class Player {
  constructor(name) { this.name = name; this.uid = null; this.x = 0; this.y = 0; }
  use() { session(this.uid); }
  async c(action, body) { this.use(); return call(action, body); }
  pos() { return { x: this.x, y: this.y, dir: 'right' }; }
  async walk(tx, ty) {
    this.use();
    const st = (await state()).character;
    const m = globalThis.NA_MAPS[D.area_defs[st.area_key].map_file.replace('.json', '')];
    const prev = new Map([[this.x + ',' + this.y, null]]); const q = [[this.x, this.y]]; let end = null;
    while (q.length) {
      const [x, y] = q.shift();
      if (x === tx && y === ty) { end = x + ',' + y; break; }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
        if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h || m.blocked[ny][nx] === '1' || prev.has(k)) continue;
        prev.set(k, x + ',' + y); q.push([nx, ny]);
      }
    }
    if (!end) throw new Error('no path to ' + tx + ',' + ty + ' in ' + st.area_key);
    const path = []; for (let k = end; k; k = prev.get(k)) path.push(k.split(',').map(Number)); path.reverse();
    for (let i = 6; ; i += 6) {                                      // legal hops of at most 6 tiles, like the real game's heartbeat
      const idx = Math.min(i, path.length - 1);
      [this.x, this.y] = path[idx]; sleep(800);
      const r = await this.c('sync', { pos: this.pos() });
      if (!r.d.accepted) throw new Error('sync rejected at ' + this.x + ',' + this.y);
      if (idx === path.length - 1) break;
    }
  }
}
const editDb = (fn) => { const d = JSON.parse(localStorage.getItem('ninja_adventure_rpg_db_v1')); fn(d); localStorage.setItem('ninja_adventure_rpg_db_v1', JSON.stringify(d)); };
const spawnsOf = (prefix) => Object.values(D.enemy_spawns).filter((sp) => sp.spawn_id.startsWith(prefix));
async function healIfLow(pl) {
  pl.use(); const st = await state();
  if (st.character.hp < st.stats.max_hp * 0.55) {
    for (const k of ['healing_tonic', 'rice_ball', 'sushi', 'elixir']) if (st.inventory.some((i) => i.item_key === k)) { await pl.c('use_item', { item_key: k }); return; }
  }
}
async function fightSpawn(pl, sp, skill) {
  await healIfLow(pl); await pl.walk(sp.x, sp.y);
  let r = await pl.c('combat_start', { spawn_id: sp.spawn_id, pos: pl.pos() });
  if (!r.ok) return { ok: false, r };
  for (let i = 0; i < 700; i++) {
    sleep(520); r = await pl.c('combat_action', { skill_key: skill || 'strike', pos: pl.pos() });
    if (!r.ok) { if (r.status === 429) continue; return { ok: false, r }; }
    if (r.d.events.some((e) => e.type === 'victory')) return { ok: true, r };
    if (r.d.events.some((e) => e.type === 'defeat')) return { ok: false, r, defeat: true };
  }
  return { ok: false };
}
(async () => {
  const pw = 'TestPass123!';
  const A = new Player('alpha'), B = new Player('beta');

  console.log('\n[1] Registration, login, character creation');
  check('no session -> load rejected (401)', (await call('load')).status === 401);
  check('short username rejected', (await call('register', { username: 'x', password: pw })).status === 422);
  check('weak password rejected', (await call('register', { username: 'alpha', password: 'short' })).status === 422);
  let r = await call('register', { username: 'alpha', password: pw }); A.uid = getUid();
  check('account A registered', r.ok && A.uid > 0);
  r = await call('register', { username: 'beta', password: pw }); B.uid = getUid();
  check('account B registered with a different id', r.ok && B.uid !== A.uid);
  check('duplicate username (any case) rejected', (await call('register', { username: 'ALPHA', password: pw })).status === 409);
  A.use();
  check('invalid class rejected', (await A.c('create_character', { name: 'Aiko', class_key: 'hacker', sprite_key: 'NinjaGreen' })).status === 422);
  check('invalid name rejected', (await A.c('create_character', { name: '<b>', class_key: 'shinobi', sprite_key: 'NinjaGreen' })).status === 422);
  r = await A.c('create_character', { name: 'Aiko', class_key: 'shinobi', sprite_key: 'NinjaGreen' });
  check('character A created', r.ok && r.d.state.character.name === 'Aiko');
  r = await B.c('create_character', { name: 'Bao', class_key: 'mystic', sprite_key: 'NinjaRed' });
  check('character B created (different class)', r.ok && r.d.state.character.class_key === 'mystic');
  check('second character on same account rejected', (await A.c('create_character', { name: 'Again', class_key: 'shadow', sprite_key: 'NinjaRed' })).status === 409);
  A.use(); const sa0 = await state(); B.use(); const sb0 = await state();
  check('A starts: level 1, 30 gold, only Lantern Trail', sa0.character.level === 1 && sa0.character.gold === 30 && sa0.areas_unlocked.join() === 'lantern_trail');
  check('A and B have independent stats', sa0.stats.max_mp !== sb0.stats.max_mp);
  [A.x, A.y] = [sa0.character.x, sa0.character.y]; [B.x, B.y] = [sb0.character.x, sb0.character.y];

  console.log('\n[2] Rule enforcement (cannot cheat through the API)');
  check('combat action without a fight rejected', (await B.c('combat_action', { skill_key: 'strike' })).status === 409);
  check('unlearned skill rejected', (await B.c('combat_action', { skill_key: 'fire_burst' })).status === 403);
  check('cannot equip an item you do not own', (await B.c('equip', { item_key: 'ninja_amulet' })).status === 409);
  check('cannot equip a high-level item you do not own', [403, 409].includes((await B.c('equip', { item_key: 'tyrant_blade' })).status));
  check('cannot buy while far from the merchant', (await B.c('shop_buy', { npc_key: 'haru', item_key: 'healing_tonic', quantity: 1, price: 0, pos: B.pos() })).status === 409);
  check('cannot complete a quest you never accepted', (await B.c('quest_complete', { npc_key: 'sora', quest_key: 'trail_trouble', pos: B.pos() })).status === 409);
  check('cannot talk to an NPC from another area', (await B.c('talk', { npc_key: 'kenji', pos: B.pos() })).status === 404);
  r = await B.c('sync', { pos: { x: 40, y: 14, dir: 'down' } });
  check('teleport (impossible speed) rejected', r.d.accepted === false);
  r = await B.c('sync', { pos: { x: 0, y: 0, dir: 'down' } });
  check('walking into a wall tile rejected', r.d.accepted === false);
  check('gate unusable from far away', (await B.c('travel', { portal_id: 1, pos: B.pos() })).status === 409);
  check('cannot use an item you do not have', (await B.c('use_item', { item_key: 'sushi' })).status === 409);
  check('cannot fight an enemy in another area', (await B.c('combat_start', { spawn_id: 'sr_boss', pos: B.pos() })).status === 404);
  check('cannot fight a far-away enemy', (await B.c('combat_start', { spawn_id: 'lt_sprite_1', pos: B.pos() })).status === 409);
  check('cannot sell items you do not own', [404, 409].includes((await B.c('shop_sell', { npc_key: 'haru', item_key: 'wild_honey', quantity: 5, pos: B.pos() })).status));
  check('out-of-range settings rejected', (await B.c('settings', { music_on: true, music_volume: 500, sfx_on: true, sfx_volume: 10 })).status === 400);
  B.use(); const sb1 = await state();
  check('B unchanged after all those attempts', sb1.character.gold === 30 && sb1.character.xp === 0 && sb1.character.level === 1);

  console.log('\n[3] Full quest chain for A (walk, talk, fight, loot, turn in, level gate, unlock)');
  await A.walk(16, 14);
  r = await A.c('talk', { npc_key: 'sora', pos: A.pos() });
  check('Sora offers the quest', r.ok && r.d.options.some((o) => o.type === 'accept'));
  check('A accepts "Trouble on the Trail"', (await A.c('quest_accept', { npc_key: 'sora', quest_key: 'trail_trouble', pos: A.pos() })).ok);
  check('accepting twice rejected', (await A.c('quest_accept', { npc_key: 'sora', quest_key: 'trail_trouble', pos: A.pos() })).status === 409);
  check('unfinished quest cannot be turned in', (await A.c('quest_complete', { npc_key: 'sora', quest_key: 'trail_trouble', pos: A.pos() })).status === 409);
  check('locked gate refuses entry', [403, 409].includes((await A.c('travel', { portal_id: 1, pos: A.pos() })).status));
  let kills = 0, firstDone = false;
  for (const sp of spawnsOf('lt_sprite_')) {
    if (kills >= 6) break;
    const f = await fightSpawn(A, sp);
    check('A defeats ' + sp.spawn_id, f.ok, f.r && f.r.msg);
    if (f.ok) { kills++; if (!firstDone) { firstDone = true; check(sp.spawn_id + ' cannot be farmed again immediately', (await A.c('combat_start', { spawn_id: sp.spawn_id, pos: A.pos() })).status === 409); } }
  }
  A.use(); let sa = await state(); const qa = Object.fromEntries(sa.quests.map((q) => [q.quest_key, q]));
  check('quest ready after 6 kills', qa.trail_trouble.state === 'ready', JSON.stringify(qa.trail_trouble));
  check('XP and gold earned from victories', sa.character.xp > 0 && sa.character.gold > 30);
  await A.walk(16, 14);
  check('A turns in the quest', (await A.c('quest_complete', { npc_key: 'sora', quest_key: 'trail_trouble', pos: A.pos() })).ok);
  check('reward cannot be claimed twice', (await A.c('quest_complete', { npc_key: 'sora', quest_key: 'trail_trouble', pos: A.pos() })).status === 409);
  A.use(); sa = await state();
  check('A is level 2 now and received the reward tonics', sa.character.level >= 2 && sa.inventory.some((i) => i.item_key === 'healing_tonic' && i.quantity >= 3));
  check('The Yellow Trial is level-gated (needs level 3)', sa.quests.find((q) => q.quest_key === 'sora_trial').state === 'locked');
  check('the Bamboo Grove is NOT open yet', !sa.areas_unlocked.includes('bamboo_grove'));
  editDb((d) => { const P = d.players[A.uid]; P.char.level = 3; P.skills = ['strike', 'power_strike', 'fire_burst']; P.char.hp = 9999; });   // shortcut: skip grinding to level 3
  A.use(); sa = await state();
  check('The Yellow Trial becomes available at level 3', sa.quests.find((q) => q.quest_key === 'sora_trial').state === 'available');
  check('A accepts The Yellow Trial', (await A.c('quest_accept', { npc_key: 'sora', quest_key: 'sora_trial', pos: A.pos() })).ok);
  kills = 0;
  for (const sp of spawnsOf('lt_yellow_')) {
    if (kills >= 5) break;
    const f = await fightSpawn(A, sp, 'power_strike'); if (!f.ok && f.r && f.r.status === 409) { sleep(3000); }
    const g = f.ok ? f : await fightSpawn(A, sp);
    if (g.ok) kills++;
  }
  check('A defeats 5 Yellow Sprites', kills === 5);
  await A.walk(16, 14);
  check('A turns in The Yellow Trial', (await A.c('quest_complete', { npc_key: 'sora', quest_key: 'sora_trial', pos: A.pos() })).ok);
  A.use(); sa = await state();
  check('A unlocked the Bamboo Grove', sa.areas_unlocked.includes('bamboo_grove'));
  check('A learned Power Strike by level (skill list)', sa.skills.some((k) => k.skill_key === 'power_strike' && k.unlocked));
  check('A received the Ninja Amulet reward', sa.inventory.some((i) => i.item_key === 'ninja_amulet'));
  const goldAfterQuest = sa.character.gold;

  console.log('\n[4] Data isolation');
  B.use(); const sb = await state();
  check('B did NOT get the Bamboo Grove unlock', sb.areas_unlocked.join() === 'lantern_trail');
  check('B gold, xp, level unchanged', sb.character.gold === 30 && sb.character.xp === 0 && sb.character.level === 1);
  check('B quests unchanged', sb.quests.every((q) => ['available', 'locked'].includes(q.state)));
  check('B inventory unchanged', JSON.stringify(sb.inventory.map((i) => [i.item_key, i.quantity])) === JSON.stringify([['healing_tonic', 2], ['rice_ball', 2]]));
  check('B still cannot enter the grove', [403, 409].includes((await B.c('travel', { portal_id: 1, pos: B.pos() })).status));

  console.log('\n[5] Shop, equipment, consumables');
  await A.walk(10, 17);
  r = await A.c('shop_buy', { npc_key: 'haru', item_key: 'iron_katana', quantity: 1, price: 1, pos: A.pos() });
  A.use(); sa = await state();
  if (goldAfterQuest >= 90) check('buying uses the definition price (90), not a client price', r.ok && sa.character.gold === goldAfterQuest - 90, r.msg);
  else check('too poor for the katana (client price ignored)', r.status === 409);
  check('items not in stock cannot be bought', (await A.c('shop_buy', { npc_key: 'haru', item_key: 'tyrant_blade', quantity: 1, pos: A.pos() })).status === 404);
  check('A buys a rice ball', (await A.c('shop_buy', { npc_key: 'haru', item_key: 'rice_ball', quantity: 1, pos: A.pos() })).ok);
  check('consumables cannot be equipped', (await A.c('equip', { item_key: 'healing_tonic' })).status === 409);
  r = await A.c('unequip', { slot: 'weapon' });
  check('A unequips the weapon', r.ok && r.d.state.equipment.weapon === null);
  r = await A.c('equip', { item_key: 'wooden_blade' });
  check('A re-equips the weapon', r.ok && r.d.state.equipment.weapon === 'wooden_blade');

  console.log('\n[6] Persistence across logout/login');
  A.use(); const before = await state();
  await S.handle('logout');
  check('after logout the session is dead (401)', (await call('load')).status === 401);
  check('wrong password rejected', (await call('login', { username: 'alpha', password: 'nope-nope-nope' })).status === 401);
  r = await call('login', { username: 'alpha', password: pw });
  check('A logs in again', r.ok && r.d.has_character === true);
  const after = await state();
  check('A progress persisted (character, inventory, quests, areas, equipment)', ['character', 'inventory', 'quests', 'areas_unlocked', 'equipment'].every((k) => JSON.stringify(before[k]) === JSON.stringify(after[k])));
  check('save really lives in localStorage (survives a fresh module state)', JSON.parse(localStorage.getItem('ninja_adventure_rpg_db_v1')).players[A.uid].char.name === 'Aiko');

  console.log('\n[7] New Game wipes only the caller');
  A.use(); const aSnap = await state();
  check('wrong password refused, save kept', (await B.c('new_game', { password: 'wrong-password' })).status === 403 && (await B.c('load')).ok);
  check('B erases own save with the right password', (await B.c('new_game', { password: pw })).ok);
  check('B now has no character (409)', (await B.c('load')).status === 409);
  A.use(); const aSnap2 = await state();
  check('A is completely unaffected', JSON.stringify(aSnap.character) === JSON.stringify(aSnap2.character) && JSON.stringify(aSnap.inventory) === JSON.stringify(aSnap2.inventory));
  r = await B.c('create_character', { name: 'Bao2', class_key: 'shadow', sprite_key: 'NinjaBlue2' });
  check('B can start fresh afterwards', r.ok && r.d.state.character.level === 1 && r.d.state.areas_unlocked.join() === 'lantern_trail');

  console.log('\n[8] Defeat, respawn and travel');
  const sp1 = D.enemy_spawns.lt_sprite_1;
  editDb((d) => { Object.assign(d.players[B.uid].char, { hp: 1, gold: 100, pos_x: sp1.x, pos_y: sp1.y, last_move_ms: CLOCK }); });
  r = await B.c('combat_start', { spawn_id: 'lt_sprite_1' });
  check('fight starts', r.ok);
  sleep(3000);
  r = await B.c('combat_tick', {});
  check('server-timed enemy attacks defeat the player', r.ok && r.d.events.some((e) => e.type === 'defeat'));
  B.use(); const bs = await state();
  check('respawned at shrine checkpoint', bs.character.x === 14 && bs.character.y === 13 && bs.character.hp > 0);
  check('lost 10% gold (100 -> 90)', bs.character.gold === 90);
  editDb((d) => { const P = d.players[B.uid]; P.areas.push('bamboo_grove'); Object.assign(P.char, { level: 3, pos_x: 45, pos_y: 14, last_move_ms: CLOCK - 60000 }); });
  r = await B.c('travel', { portal_id: 1, pos: { x: 45, y: 14 } });
  check('travel to Bamboo Grove works once unlocked (level 3)', r.ok && r.d.state.character.area_key === 'bamboo_grove' && r.d.state.character.x === 4);
  editDb((d) => { Object.assign(d.players[B.uid].char, { pos_x: 45, pos_y: 14, last_move_ms: CLOCK - 60000 }); });
  check('locked Misty Marsh refused', (await B.c('travel', { portal_id: 3 })).status === 403);
  editDb((d) => { const P = d.players[B.uid]; P.areas.push('misty_marsh'); P.char.level = 3; Object.assign(P.char, { pos_x: 45, pos_y: 14, last_move_ms: CLOCK - 60000 }); });
  check('level-gated Misty Marsh (needs level 6) refused even when unlocked', (await B.c('travel', { portal_id: 3 })).status === 403);

  console.log('\n[10] Boss killed BEFORE accepting the quest (and an older save without kill records)');
  const mk = async (name, cls) => {
    const p = new Player(name);
    await call('register', { username: name, password: pw }); p.uid = getUid();
    await p.c('create_character', { name: name.slice(0, 8), class_key: cls, sprite_key: 'NinjaGreen' });
    return p;
  };
  const prereqs = ['trail_trouble', 'sora_trial', 'whispers_in_bamboo', 'mushroom_menace', 'slime_king', 'ridge_scout'];
  const C = await mk('gamma', 'shinobi');
  editDb((d) => {
    const P = d.players[C.uid];
    Object.assign(P.char, { level: 12, hp: 9999, area_key: 'shadow_ridge', pos_x: 9, pos_y: 14, last_move_ms: CLOCK - 60000 });
    P.areas.push('bamboo_grove', 'misty_marsh', 'shadow_ridge');
    prereqs.forEach((k) => { P.quests[k] = { status: 'complete', progress: 1 }; });
    P.spawns.sr_boss = CLOCK - 5000;                       // the boss was killed earlier, before the quest was taken (old save: no kills record)
    delete P.kills; delete P.deaths; delete P.save.cleared;
  });
  C.use(); let cs = await state();
  check('old save is upgraded: Lanternfall Town unlocked', cs.areas_unlocked.includes('lanternfall_town'));
  check('old save: game counts as cleared (no time recorded for it)', cs.save.cleared === true && cs.save.clear_seconds === null);
  [C.x, C.y] = [cs.character.x, cs.character.y];
  r = await C.c('talk', { npc_key: 'daichi', pos: C.pos() });
  check('Captain Daichi offers the Bamboo Tyrant quest', r.ok && r.d.options.some((o) => o.quest_key === 'bamboo_tyrant'));
  r = await C.c('quest_accept', { npc_key: 'daichi', quest_key: 'bamboo_tyrant', pos: C.pos() });
  check('quest accepted after the boss was already killed', r.ok);
  C.use(); cs = await state();
  check('quest is READY immediately (earlier boss kill counts, no stuck state)', cs.quests.find((q) => q.quest_key === 'bamboo_tyrant').state === 'ready');
  r = await C.c('quest_complete', { npc_key: 'daichi', quest_key: 'bamboo_tyrant', pos: C.pos() });
  check('quest completes and pays out (Tyrant Blade)', r.ok && r.d.state.inventory.some((i) => i.item_key === 'tyrant_blade'));

  console.log('\n[11] Defeating the boss: ending, clear time, Lanternfall Town');
  const Dp = await mk('delta', 'shinobi');
  editDb((d) => {
    const P = d.players[Dp.uid];
    Object.assign(P.char, { level: 12, hp: 9999, mp: 9999, area_key: 'shadow_ridge', pos_x: 36, pos_y: 14, last_move_ms: CLOCK - 60000 });
    P.areas.push('bamboo_grove', 'misty_marsh', 'shadow_ridge'); P.save.play_seconds = 754; P.save.last_saved_at = CLOCK;
    P.inv = { elixir: 60 }; P.skills = ['strike', 'power_strike', 'fire_burst', 'healing_breath'];
  });
  Dp.x = 36; Dp.y = 14;
  r = await Dp.c('combat_start', { spawn_id: 'sr_boss', pos: Dp.pos() });
  check('fight with the Bamboo Tyrant starts', r.ok && r.d.combat.enemy_key === 'giant_bamboo');
  let cleared = null, victory = null;
  let hpNow = 9999;
  for (let i = 0; i < 900 && !victory; i++) {
    sleep(520);
    if (hpNow < 70) { await Dp.c('use_item', { item_key: 'elixir' }); sleep(1100); }          // heal like a real player would
    r = await Dp.c('combat_action', { skill_key: 'strike', pos: Dp.pos() });
    if (!r.ok) { if (r.status === 429) continue; check('boss fight action', false, r.msg); break; }
    hpNow = r.d.player.hp;
    victory = r.d.events.find((e) => e.type === 'victory');
    cleared = r.d.events.find((e) => e.type === 'game_cleared') || cleared;
  }
  check('the Tyrant can be defeated', !!victory);
  check('ending event reports a clear time of 12m 34s or slightly more (754s + a few seconds)', cleared && cleared.seconds >= 754 && cleared.seconds <= 765, JSON.stringify(cleared));
  check('area_unlocked event for Lanternfall Town', r.d.events.some((e) => e.type === 'area_unlocked' && e.name === 'Lanternfall Town'));
  Dp.use(); let ds = await state();
  check('town unlocked and the save is marked cleared with the time', ds.areas_unlocked.includes('lanternfall_town') && ds.save.cleared === true && ds.save.clear_seconds === cleared.seconds);
  check('the Tyrant stays defeated (no second clear / no time overwrite)', (await Dp.c('combat_start', { spawn_id: 'sr_boss', pos: Dp.pos() })).status === 409);
  await Dp.walk(45, 14);
  r = await Dp.c('travel', { portal_id: 5, pos: Dp.pos() });
  check('travel through the new gate to Lanternfall Town', r.ok && r.d.state.character.area_key === 'lanternfall_town');
  [Dp.x, Dp.y] = [r.d.state.character.x, r.d.state.character.y];
  const area = (await (async () => { Dp.use(); return call('area'); })()).d;
  check('town has 6 NPCs, no enemies, and a gate back', area.npcs.length === 6 && area.spawns.length === 0 && area.portals.length === 1);
  editDb((d) => { d.players[Dp.uid].char.gold = 1000; });
  await Dp.walk(34, 14); await Dp.walk(34, 13); sleep(900);
  r = await Dp.c('shop_buy', { npc_key: 'goro', item_key: 'moonblade', quantity: 1, pos: Dp.pos() });
  check('Goro the blacksmith sells the Moonblade at the definition price (380)', r.ok && r.d.state.character.gold === 620, r.msg);
  r = await Dp.c('equip', { item_key: 'moonblade' });
  check('Moonblade equips at level 12', r.ok && r.d.state.equipment.weapon === 'moonblade');
  check('town quests are locked until the Tyrant quest is done',
    (await state()).quests.filter((q) => ['festival_of_lanterns', 'ridge_cleansing', 'smiths_request', 'brew_for_yuki', 'rin_pests'].includes(q.quest_key)).every((q) => q.state === 'locked'));
  Dp.use();
  check('player D never saw a second ending (clear_seconds fixed)', (await state()).save.clear_seconds === cleared.seconds);
  check('C (quest turned in) now has the town quests available', (await (async () => { C.use(); return state(); })()).quests.filter((q) => ['festival_of_lanterns', 'rin_pests', 'brew_for_yuki'].includes(q.quest_key)).every((q) => q.state === 'available'));

  console.log('\n[12] Misty Marsh mid-boss (Slime King) and the story gates');
  const Ep = await mk('epsilon', 'shinobi');
  check('a new hero starts with exactly the 3 level-1 quests available', (await (async () => { Ep.use(); return state(); })()).quests.filter((q) => q.state === 'available').map((q) => q.quest_key).sort().join() === 'haru_wagon,honey_for_mei,trail_trouble');
  const earlyLocked = (await state()).quests.filter((q) => ['slime_king', 'bamboo_tyrant', 'ridge_scout', 'mushroom_menace'].includes(q.quest_key)).every((q) => q.state === 'locked');
  check('later story quests are locked behind earlier ones', earlyLocked);
  editDb((d) => {
    const P = d.players[Ep.uid];
    Object.assign(P.char, { level: 12, hp: 9999, mp: 9999, area_key: 'misty_marsh', pos_x: 36, pos_y: 14, last_move_ms: CLOCK - 60000 });
    P.areas.push('bamboo_grove', 'misty_marsh'); P.skills = ['strike', 'power_strike', 'fire_burst', 'healing_breath']; P.inv = { elixir: 40 };
  });
  Ep.x = 36; Ep.y = 14;
  Ep.use(); check('Shadow Ridge is still locked before the Slime King falls', !(await state()).areas_unlocked.includes('shadow_ridge'));
  r = await Ep.c('combat_start', { spawn_id: 'mm_giant', pos: Ep.pos() });
  check('fight with the Slime King starts', r.ok && r.d.combat.enemy_key === 'giant_slime');
  let sk = null, ending = null;
  let hpE = 9999;
  for (let i = 0; i < 900 && !sk; i++) {
    sleep(520);
    if (hpE < 70) { await Ep.c('use_item', { item_key: 'elixir' }); sleep(1100); }
    r = await Ep.c('combat_action', { skill_key: i % 7 === 0 ? 'power_strike' : 'strike', pos: Ep.pos() });
    if (!r.ok) { if (r.status === 429) continue; check('slime king action', false, r.msg); break; }
    hpE = r.d.player.hp;
    sk = r.d.events.find((e) => e.type === 'victory'); ending = r.d.events.find((e) => e.type === 'game_cleared');
  }
  check('the Slime King can be defeated', !!sk);
  check('defeating the mid-boss does NOT end the game', !ending);
  check('it unlocks Shadow Ridge', r.d.events.some((e) => e.type === 'area_unlocked' && e.name === 'Shadow Ridge'));
  Ep.use(); const es = await state();
  check('Shadow Ridge unlocked in the save, game not cleared', es.areas_unlocked.includes('shadow_ridge') && es.save.cleared === false);
  check('the Slime King stays defeated', (await Ep.c('combat_start', { spawn_id: 'mm_giant', pos: Ep.pos() })).status === 409);

  console.log('\n[9] Content sanity');
  let bad = 0;
  Object.values(D.enemy_spawns).forEach((s) => { const m = globalThis.NA_MAPS[D.area_defs[s.area_key].map_file.replace('.json', '')]; if (m.blocked[s.y][s.x] === '1') bad++; });
  Object.values(D.npc_defs).forEach((n) => { const m = globalThis.NA_MAPS[D.area_defs[n.area_key].map_file.replace('.json', '')]; if (m.blocked[n.y][n.x] === '1') bad++; });
  check('no NPC or enemy stands on a blocked tile', bad === 0);

  console.log('\nResult: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
