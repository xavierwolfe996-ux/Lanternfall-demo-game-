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
    while (this.x !== tx || this.y !== ty) {
      const dx = Math.max(-6, Math.min(6, tx - this.x));
      const dy = dx === 0 ? Math.max(-6, Math.min(6, ty - this.y)) : 0;
      this.x += dx; this.y += dy; sleep(800);
      const r = await this.c('sync', { pos: this.pos() });
      if (!r.d.accepted) throw new Error('sync rejected at ' + this.x + ',' + this.y);
    }
  }
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
  check('cannot fight a far-away enemy', (await B.c('combat_start', { spawn_id: 'lt_bamboo_1', pos: B.pos() })).status === 409);
  check('cannot sell items you do not own', [404, 409].includes((await B.c('shop_sell', { npc_key: 'haru', item_key: 'wild_honey', quantity: 5, pos: B.pos() })).status));
  check('out-of-range settings rejected', (await B.c('settings', { music_on: true, music_volume: 500, sfx_on: true, sfx_volume: 10 })).status === 400);
  B.use(); const sb1 = await state();
  check('B unchanged after all those attempts', sb1.character.gold === 30 && sb1.character.xp === 0 && sb1.character.level === 1);

  console.log('\n[3] Full quest loop for A (walk, talk, fight, loot, turn in)');
  await A.walk(16, 14);
  r = await A.c('talk', { npc_key: 'sora', pos: A.pos() });
  check('Sora offers the quest', r.ok && r.d.options.some((o) => o.type === 'accept'));
  check('A accepts "Trouble on the Trail"', (await A.c('quest_accept', { npc_key: 'sora', quest_key: 'trail_trouble', pos: A.pos() })).ok);
  check('accepting twice rejected', (await A.c('quest_accept', { npc_key: 'sora', quest_key: 'trail_trouble', pos: A.pos() })).status === 409);
  check('unfinished quest cannot be turned in', (await A.c('quest_complete', { npc_key: 'sora', quest_key: 'trail_trouble', pos: A.pos() })).status === 409);
  check('locked gate refuses entry', [403, 409].includes((await A.c('travel', { portal_id: 1, pos: A.pos() })).status));
  A.use(); const hp0 = (await state()).character.hp;
  let kills = 0;
  const spawns = { lt_bamboo_1: [28, 10], lt_bamboo_2: [31, 19], lt_bamboo_3: [35, 13], lt_bamboo_4: [27, 23] };
  for (const id of Object.keys(spawns)) {
    if (kills >= 3) break;
    await A.walk(id === 'lt_bamboo_3' ? 30 : Math.min(spawns[id][0], 30), 14);
    r = await A.c('combat_start', { spawn_id: id, pos: A.pos() });
    if (!r.ok) { check('combat_start ' + id, false, r.msg); continue; }
    let won = false;
    for (let i = 0; i < 40 && !won; i++) {
      sleep(520);
      r = await A.c('combat_action', { skill_key: 'strike', pos: A.pos() });
      if (!r.ok) { if (r.status === 429) continue; check('combat action ok', false, r.msg); break; }
      if (r.d.events.some((e) => e.type === 'victory')) won = true;
      if (r.d.events.some((e) => e.type === 'defeat')) break;
    }
    check('A defeats ' + id, won);
    if (won) { kills++; check(id + ' cannot be farmed again immediately', (await A.c('combat_start', { spawn_id: id, pos: A.pos() })).status === 409); }
  }
  A.use(); let sa = await state(); const qa = Object.fromEntries(sa.quests.map((q) => [q.quest_key, q]));
  check('quest ready after 3 kills', qa.trail_trouble.state === 'ready');
  check('XP and gold earned from victories', sa.character.xp > 0 && sa.character.gold > 30);
  await A.walk(16, 14);
  check('A turns in the quest', (await A.c('quest_complete', { npc_key: 'sora', quest_key: 'trail_trouble', pos: A.pos() })).ok);
  check('reward cannot be claimed twice', (await A.c('quest_complete', { npc_key: 'sora', quest_key: 'trail_trouble', pos: A.pos() })).status === 409);
  A.use(); sa = await state();
  check('A unlocked Bamboo Grove', sa.areas_unlocked.includes('bamboo_grove'));
  check('A reached level 2 and learned Power Strike', sa.character.level >= 2 && sa.skills.some((k) => k.skill_key === 'power_strike' && k.unlocked));
  check('A received reward items', sa.inventory.some((i) => i.item_key === 'healing_tonic' && i.quantity >= 4));
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
  const db = JSON.parse(localStorage.getItem('ninja_adventure_rpg_db_v1'));
  const P = db.players[B.uid];
  Object.assign(P.char, { hp: 1, gold: 100, pos_x: 28, pos_y: 12, last_move_ms: CLOCK });
  localStorage.setItem('ninja_adventure_rpg_db_v1', JSON.stringify(db));
  r = await B.c('combat_start', { spawn_id: 'lt_bamboo_1' });
  check('fight starts', r.ok);
  sleep(3000);
  r = await B.c('combat_tick', {});
  check('server-timed enemy attacks defeat the player', r.ok && r.d.events.some((e) => e.type === 'defeat'));
  B.use(); const bs = await state();
  check('respawned at shrine checkpoint', bs.character.x === 14 && bs.character.y === 13 && bs.character.hp > 0);
  check('lost 10% gold (100 -> 90)', bs.character.gold === 90);
  const db2 = JSON.parse(localStorage.getItem('ninja_adventure_rpg_db_v1'));
  db2.players[B.uid].areas.push('bamboo_grove'); Object.assign(db2.players[B.uid].char, { level: 2, pos_x: 45, pos_y: 14, last_move_ms: CLOCK - 60000 });
  localStorage.setItem('ninja_adventure_rpg_db_v1', JSON.stringify(db2));
  r = await B.c('travel', { portal_id: 1, pos: { x: 45, y: 14 } });
  check('travel to Bamboo Grove works once unlocked', r.ok && r.d.state.character.area_key === 'bamboo_grove' && r.d.state.character.x === 4);
  const db3 = JSON.parse(localStorage.getItem('ninja_adventure_rpg_db_v1')); Object.assign(db3.players[B.uid].char, { pos_x: 45, pos_y: 14, last_move_ms: CLOCK - 60000 });
  localStorage.setItem('ninja_adventure_rpg_db_v1', JSON.stringify(db3));
  r = await B.c('travel', { portal_id: 3 });
  check('locked Shadow Ridge refused', r.status === 403);

  console.log('\n[9] Content sanity');
  let bad = 0;
  Object.values(D.enemy_spawns).forEach((s) => { const m = globalThis.NA_MAPS[D.area_defs[s.area_key].map_file.replace('.json', '')]; if (m.blocked[s.y][s.x] === '1') bad++; });
  Object.values(D.npc_defs).forEach((n) => { const m = globalThis.NA_MAPS[D.area_defs[n.area_key].map_file.replace('.json', '')]; if (m.blocked[n.y][n.x] === '1') bad++; });
  check('no NPC or enemy stands on a blocked tile', bad === 0);

  console.log('\nResult: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
