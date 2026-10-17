/* Local game "server": all rules (combat, XP, loot, quests, shops, saves) running in the browser.
   Accounts and saves live in localStorage under one key. There is NO real server, so this is an
   honest single-device game: anyone with dev tools can edit their own save. */
(function (root) {
  'use strict';
  const NA = (root.NA = root.NA || {});
  const D = root.NA_DATA;
  const MAPS = root.NA_MAPS;

  const DB_KEY = 'ninja_adventure_rpg_db_v1';
  const SESSION_KEY = 'ninja_adventure_rpg_session';
  const MAX_LEVEL = 20, MAX_STACK = 99, MAX_INV = 30, MAX_MOVE = 9, COMBAT_RANGE = 9, INTERACT = 3;
  const STALE_MS = 25000, MAX_HITS = 3, ITEM_CD = 1000, DEATH_LOSS = 10;
  const EQUIP_SLOTS = ['weapon', 'armor', 'accessory'];
  const SPRITES = { NinjaGreen: 'Leaf Green', NinjaBlue2: 'River Blue', NinjaRed: 'Ember Red', NinjaDark: 'Night Dark', NinjaYellow: 'Sun Yellow', NinjaGray: 'Ash Gray' };

  class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status || 400; } }
  const now = () => Date.now();
  const rnd = () => Math.random();
  const randInt = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // ------------------------------------------------------------------ storage
  function storage() { return root.localStorage; }
  function loadDb() {
    try {
      const raw = storage().getItem(DB_KEY);
      if (raw) { const db = JSON.parse(raw); if (db && db.users && db.players) return db; }
    } catch (e) { /* corrupted: start fresh below */ }
    return { nextId: 1, users: {}, players: {} };
  }
  function saveDb(db) {
    try { storage().setItem(DB_KEY, JSON.stringify(db)); }
    catch (e) { throw new ApiError('Your browser would not let the game save (storage full or blocked).', 500); }
  }
  function sessionUid() { try { const v = root.sessionStorage.getItem(SESSION_KEY); return v ? parseInt(v, 10) : null; } catch (e) { return null; } }
  function setSession(uid) { try { if (uid) root.sessionStorage.setItem(SESSION_KEY, String(uid)); else root.sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ } }

  /** Run fn with the logged-in player's record. All changes are written only if fn succeeds. */
  function withPlayer(fn, needChar) {
    const uid = sessionUid();
    const db = loadDb();
    const user = uid ? Object.values(db.users).find((u) => u.id === uid) : null;
    if (!user) throw new ApiError('Please sign in again.', 401);
    const P = db.players[uid] || null;
    if (needChar !== false && !P) throw new ApiError('No character yet.', 409);
    const result = fn(P, db, user);
    saveDb(db);
    return result;
  }

  // ------------------------------------------------------------------ rules
  const xpNeeded = (lv) => 20 * lv + 10 * (lv - 1) * lv;
  const dist = (x1, y1, x2, y2) => Math.abs(x1 - x2) + Math.abs(y1 - y2);
  const mapOf = (areaKey) => {
    const a = D.area_defs[areaKey];
    if (!a) throw new ApiError('Unknown area.', 404);
    return MAPS[a.map_file.replace(/\.json$/, '')];
  };
  const tileBlocked = (m, x, y) => x < 0 || y < 0 || x >= m.w || y >= m.h || m.blocked[y][x] === '1';

  function baseStats(cls, level) {
    const l = level - 1;
    return { max_hp: cls.base_hp + l * cls.hp_per_level, max_mp: cls.base_mp + l * cls.mp_per_level, attack: cls.base_atk + l * cls.atk_per_level, defense: cls.base_def + l * cls.def_per_level };
  }
  function derived(P) {
    const s = baseStats(D.class_defs[P.char.class_key], P.char.level);
    EQUIP_SLOTS.forEach((slot) => {
      const it = P.equip[slot] && D.item_defs[P.equip[slot]];
      if (it) { s.attack += it.bonus_atk; s.defense += it.bonus_def; s.max_hp += it.bonus_hp; s.max_mp += it.bonus_mp; }
    });
    return s;
  }
  function logTx(P, kind, gold, item, qty, note) {
    P.tx.push({ kind, gold, item, qty, note, at: now() });
    if (P.tx.length > 150) P.tx.splice(0, P.tx.length - 150);
  }
  const itemCount = (P, k) => P.inv[k] || 0;
  function canAdd(P, k, qty) {
    const have = itemCount(P, k);
    if (have === 0 && Object.keys(P.inv).length >= MAX_INV) return false;
    return have + qty <= MAX_STACK;
  }
  function addItem(P, k, qty, kind, note) {
    if (qty <= 0 || !D.item_defs[k]) return 0;
    const have = itemCount(P, k);
    if (have === 0 && Object.keys(P.inv).length >= MAX_INV) return 0;
    const add = Math.min(qty, MAX_STACK - have);
    if (add <= 0) return 0;
    P.inv[k] = have + add;
    logTx(P, kind, 0, k, add, note || '');
    return add;
  }
  function removeItem(P, k, qty, kind, note) {
    if (qty <= 0 || itemCount(P, k) < qty) return false;
    P.inv[k] -= qty;
    if (P.inv[k] <= 0) delete P.inv[k];
    logTx(P, kind, 0, k, -qty, note || '');
    return true;
  }
  function addGold(P, delta, kind, note) {
    if (!delta) return;
    P.char.gold = Math.max(0, P.char.gold + delta);
    logTx(P, kind, delta, null, 0, note || '');
  }
  function unlockSkills(P, level) {
    const names = [];
    Object.values(D.skill_defs).forEach((sk) => {
      if (sk.unlock_level <= level && !P.skills.includes(sk.skill_key)) { P.skills.push(sk.skill_key); names.push(sk.name); }
    });
    return names;
  }
  function grantXp(P, amount) {
    const ev = [];
    let lv = P.char.level, xp = P.char.xp + Math.max(0, amount), up = false;
    while (lv < MAX_LEVEL && xp >= xpNeeded(lv)) { xp -= xpNeeded(lv); lv++; up = true; }
    if (lv >= MAX_LEVEL) xp = Math.min(xp, xpNeeded(MAX_LEVEL) - 1);
    P.char.level = lv; P.char.xp = xp;
    if (up) {
      const st = derived(P); P.char.hp = st.max_hp; P.char.mp = st.max_mp;
      ev.push({ type: 'level_up', level: lv });
      unlockSkills(P, lv).forEach((n) => ev.push({ type: 'skill_unlocked', name: n }));
    }
    return ev;
  }
  function clampVitals(P) { const s = derived(P); P.char.hp = Math.min(P.char.hp, s.max_hp); P.char.mp = Math.min(P.char.mp, s.max_mp); }

  /** Validates a position reported by the game loop (walls + speed). Area is never taken from the client. */
  function applyPosition(P, pos) {
    if (!pos || !Number.isInteger(pos.x) || !Number.isInteger(pos.y)) return false;
    const c = P.char, m = mapOf(c.area_key);
    if (tileBlocked(m, pos.x, pos.y)) return false;
    const t = now(), dt = Math.max(0, t - c.last_move_ms) / 1000;
    if (dist(c.pos_x, c.pos_y, pos.x, pos.y) > dt * MAX_MOVE + 4) return false;
    c.pos_x = pos.x; c.pos_y = pos.y; c.last_move_ms = t;
    if (['down', 'up', 'left', 'right'].includes(pos.dir)) c.direction = pos.dir;
    return true;
  }
  function touchSave(P, secs, count) {
    P.save.last_saved_at = now(); if (count) P.save.save_count++;
    P.save.play_seconds += Math.max(0, Math.min(120, secs | 0));
  }

  // ------------------------------------------------------------------ quests
  function questStates(P) {
    const out = {};
    Object.values(D.quest_defs).forEach((q) => {
      const p = P.quests[q.quest_key];
      let state = 'locked', progress = 0;
      if (p && p.status === 'complete') { state = 'complete'; progress = q.target_count; }
      else if (p) {
        progress = Math.min(q.objective_type === 'collect' ? itemCount(P, q.target_key) : p.progress, q.target_count);
        state = progress >= q.target_count ? 'ready' : 'active';
      } else {
        const preDone = !q.prerequisite || (P.quests[q.prerequisite] && P.quests[q.prerequisite].status === 'complete');
        if (preDone && P.char.level >= q.required_level) state = 'available';
      }
      out[q.quest_key] = {
        quest_key: q.quest_key, title: q.title, kind: q.kind, sort: q.sort_order, state, progress, target: q.target_count, summary: q.summary,
        giver_npc: q.giver_npc, turn_in_npc: q.turn_in_npc, required_level: q.required_level,
        reward: {
          xp: q.reward_xp, gold: q.reward_gold, item: q.reward_item ? D.item_defs[q.reward_item].name : null, item_qty: q.reward_item_qty,
          unlock: q.reward_unlock_area ? D.area_defs[q.reward_unlock_area].name : null,
        },
      };
    });
    return out;
  }
  function questOnKill(P, enemyKey) {
    Object.values(D.quest_defs).forEach((q) => {
      const p = P.quests[q.quest_key];
      if (q.objective_type === 'kill' && q.target_key === enemyKey && p && p.status === 'active') p.progress = Math.min(p.progress + 1, q.target_count);
    });
  }

  // ------------------------------------------------------------------ payloads
  function brief(P) {
    const s = derived(P), c = P.char;
    return {
      hp: Math.min(c.hp, s.max_hp), mp: Math.min(c.mp, s.max_mp), max_hp: s.max_hp, max_mp: s.max_mp, gold: c.gold, xp: c.xp, level: c.level,
      xp_next: c.level >= MAX_LEVEL ? 0 : xpNeeded(c.level), area_key: c.area_key, x: c.pos_x, y: c.pos_y,
    };
  }
  function fullState(P) {
    const s = derived(P), c = P.char;
    return {
      character: {
        name: c.name, class_key: c.class_key, class_name: D.class_defs[c.class_key].name, sprite_key: c.sprite_key, level: c.level, xp: c.xp,
        xp_next: c.level >= MAX_LEVEL ? 0 : xpNeeded(c.level), hp: Math.min(c.hp, s.max_hp), mp: Math.min(c.mp, s.max_mp), gold: c.gold,
        story_stage: c.story_stage, area_key: c.area_key, x: c.pos_x, y: c.pos_y, dir: c.direction,
      },
      stats: s,
      equipment: clone(P.equip),
      inventory: Object.keys(P.inv).sort().map((k) => ({ item_key: k, quantity: P.inv[k] })),
      skills: Object.keys(D.skill_defs).map((k) => ({ skill_key: k, unlocked: P.skills.includes(k) })),
      quests: Object.values(questStates(P)),
      areas_unlocked: P.areas.slice(),
      settings: clone(P.settings),
      save: clone(P.save),
    };
  }
  function publicItem(i) {
    return {
      item_key: i.item_key, name: i.name, description: i.description, type: i.item_type, icon: i.icon, rarity: i.rarity, req_level: i.req_level,
      atk: i.bonus_atk, def: i.bonus_def, hp: i.bonus_hp, mp: i.bonus_mp, heal_hp: i.heal_hp, heal_mp: i.heal_mp, buy: i.buy_price, sell: i.sell_price,
    };
  }
  function gameDefs() {
    const items = {}, skills = {}, areas = {}, npcs = {};
    Object.entries(D.item_defs).forEach(([k, i]) => { items[k] = publicItem(i); });
    Object.entries(D.skill_defs).forEach(([k, s]) => {
      skills[k] = { skill_key: k, name: s.name, description: s.description, icon: s.icon, unlock_level: s.unlock_level, mp_cost: s.mp_cost, cooldown_ms: s.cooldown_ms, effect: s.effect_type, fx: s.fx, slot: s.slot_no };
    });
    Object.entries(D.area_defs).forEach(([k, a]) => { areas[k] = { area_key: k, name: a.name, description: a.description, min_level: a.min_level }; });
    Object.entries(D.npc_defs).forEach(([k, n]) => { npcs[k] = { npc_key: k, name: n.name }; });
    return { items, skills, classes: classList(), areas, npcs, sprites: SPRITES, max_level: MAX_LEVEL };
  }
  function classList() {
    return ['shinobi', 'shadow', 'mystic'].map((k) => {
      const c = D.class_defs[k];
      return { class_key: k, name: c.name, description: c.description, hp: c.base_hp, mp: c.base_mp, atk: c.base_atk, def: c.base_def };
    });
  }
  function combatView(P) {
    const s = P.combat;
    if (!s) return null;
    const e = D.enemy_defs[s.enemy_key], t = now(), cd = {};
    Object.keys(s.cooldowns).forEach((k) => { cd[k] = Math.max(0, s.cooldowns[k] - t); });
    return { spawn_id: s.spawn_id, enemy_key: s.enemy_key, enemy_name: e.name, enemy_hp: s.enemy_hp, enemy_max_hp: e.max_hp, cooldowns: cd };
  }
  function areaData(P) {
    const c = P.char, a = D.area_defs[c.area_key], t = now();
    const portals = D.area_portals.filter((p) => p.from_area === c.area_key).map((p) => ({
      id: p.id, x: p.x, y: p.y, label: p.label, to_name: D.area_defs[p.to_area].name, locked: !P.areas.includes(p.to_area), min_level: D.area_defs[p.to_area].min_level,
    }));
    const npcs = Object.values(D.npc_defs).filter((n) => n.area_key === c.area_key).map((n) => ({
      npc_key: n.npc_key, name: n.name, title: n.title, x: n.x, y: n.y, sprite: n.sprite_path, face: n.face_path, has_shop: !!n.shop_key,
    }));
    const spawns = Object.values(D.enemy_spawns).filter((s) => s.area_key === c.area_key).map((s) => {
      const e = D.enemy_defs[s.enemy_key], d = P.spawns[s.spawn_id];
      const wait = d ? Math.max(0, s.respawn_seconds - Math.floor((t - d) / 1000)) : 0;
      return {
        spawn_id: s.spawn_id, enemy_key: s.enemy_key, x: s.x, y: s.y, respawn_in: wait, respawn_seconds: s.respawn_seconds, name: e.name, sprite_kind: e.sprite_kind,
        sprite: e.sprite_path, face: e.face_path, level: e.level, max_hp: e.max_hp, is_boss: !!e.is_boss,
      };
    });
    return {
      area: { area_key: c.area_key, name: a.name, description: a.description, music: a.music, shrine_x: a.shrine_x, shrine_y: a.shrine_y },
      map: mapOf(c.area_key), portals, npcs, spawns, combat: combatView(P),
    };
  }

  // ------------------------------------------------------------------ combat
  function spawnAvailable(P, sp) { const d = P.spawns[sp.spawn_id]; return !d || (now() - d) / 1000 >= sp.respawn_seconds; }

  function combatStart(P, body) {
    const c = P.char;
    applyPosition(P, body.pos);
    const sp = D.enemy_spawns[body.spawn_id];
    if (!sp || sp.area_key !== c.area_key) throw new ApiError('Nothing to fight here.', 404);
    if (c.hp <= 0) throw new ApiError('You are too weak to fight.', 409);
    if (dist(c.pos_x, c.pos_y, sp.x, sp.y) > COMBAT_RANGE) throw new ApiError('That enemy is too far away.', 409);
    if (!spawnAvailable(P, sp)) throw new ApiError('That enemy has already been defeated.', 409);
    if (!P.combat || P.combat.spawn_id !== sp.spawn_id) {
      P.combat = { spawn_id: sp.spawn_id, enemy_key: sp.enemy_key, enemy_hp: D.enemy_defs[sp.enemy_key].max_hp, last_enemy_attack_ms: now() + 900, cooldowns: {} };
    }
    return { combat: combatView(P), player: brief(P), events: [] };
  }

  function combatDefeat(P, events) {
    P.combat = null;
    const loss = Math.floor(P.char.gold * DEATH_LOSS / 100);
    addGold(P, -loss, 'death_penalty', 'Defeated in battle');
    const cp = P.save;
    const st = derived(P);
    Object.assign(P.char, { hp: Math.max(1, Math.ceil(st.max_hp / 2)), area_key: cp.checkpoint_area, pos_x: cp.checkpoint_x, pos_y: cp.checkpoint_y, direction: 'down', last_move_ms: now() });
    events.push({ type: 'defeat', lost_gold: loss });
  }

  /** Apply due enemy attacks. Returns the live combat object or null if the fight ended. */
  function combatSettle(P, events) {
    const s = P.combat;
    if (!s) return null;
    const c = P.char, e = D.enemy_defs[s.enemy_key], sp = D.enemy_spawns[s.spawn_id], t = now(), last = s.last_enemy_attack_ms;
    if (t - last > STALE_MS) { P.combat = null; return null; }
    if (!sp || sp.area_key !== c.area_key || dist(c.pos_x, c.pos_y, sp.x, sp.y) > COMBAT_RANGE + 4) { P.combat = null; events.push({ type: 'fled' }); return null; }
    const interval = Math.max(400, e.attack_interval_ms);
    const due = t > last ? Math.floor((t - last) / interval) : 0;
    if (due > 0) {
      const st = derived(P);
      let hp = Math.min(c.hp, st.max_hp);
      const hits = Math.min(due, MAX_HITS);
      for (let i = 0; i < hits && hp > 0; i++) {
        const dmg = Math.max(Math.ceil(e.attack * 0.2), Math.round(e.attack * (0.85 + rnd() * 0.3)) - st.defense);
        hp = Math.max(0, hp - dmg);
        events.push({ type: 'enemy_hit', damage: dmg, enemy: e.name });
      }
      c.hp = hp;
      s.last_enemy_attack_ms = due > MAX_HITS ? t : last + due * interval;
      if (hp <= 0) { combatDefeat(P, events); return null; }
    }
    return s;
  }

  function combatVictory(P, events) {
    const s = P.combat, e = D.enemy_defs[s.enemy_key];
    P.combat = null;
    P.spawns[s.spawn_id] = now();
    const gold = randInt(e.gold_min, Math.max(e.gold_min, e.gold_max));
    addGold(P, gold, 'loot_gold', 'Defeated ' + e.name);
    const drops = [];
    (e.loot || []).forEach((d) => {
      if (rnd() <= d.chance) {
        const added = addItem(P, d.item, randInt(d.min, d.max), 'loot', 'Dropped by ' + e.name);
        drops.push({ item_key: d.item, name: D.item_defs[d.item].name, quantity: added, bag_full: added === 0 });
      }
    });
    questOnKill(P, e.enemy_key);
    const xpEv = grantXp(P, e.xp_reward);
    events.push({ type: 'victory', enemy: e.name, spawn_id: s.spawn_id, xp: e.xp_reward, gold, drops });
    xpEv.forEach((x) => events.push(x));
  }

  function combatAction(P, body) {
    applyPosition(P, body.pos);
    const events = [];
    const key = String(body.skill_key || '');
    const sk = D.skill_defs[key];
    if (!sk || !P.skills.includes(key)) throw new ApiError('You have not learned that skill.', 403);
    const s = combatSettle(P, events);
    if (!s) {
      const defeated = events.some((e) => e.type === 'defeat');
      if (!defeated && !events.length) throw new ApiError('You are not in a fight.', 409);
      const out = { combat: null, player: brief(P), events };
      if (defeated) out.state = fullState(P);
      return out;
    }
    const st = derived(P), t = now();
    if ((s.cooldowns[key] || 0) > t) throw new ApiError('That skill is still cooling down.', 429);
    let mp = Math.min(P.char.mp, st.max_mp);
    if (mp < sk.mp_cost) throw new ApiError('Not enough MP.', 409);
    const e = D.enemy_defs[s.enemy_key];
    let hp = Math.min(P.char.hp, st.max_hp);
    mp -= sk.mp_cost;
    s.cooldowns[key] = t + sk.cooldown_ms;
    if (sk.effect_type === 'heal') {
      const before = hp;
      hp = Math.min(st.max_hp, hp + Math.round(st.max_hp * sk.power_pct / 100));
      events.push({ type: 'player_heal', amount: hp - before, fx: sk.fx });
    } else {
      let raw = st.attack * sk.power_pct / 100 * (0.9 + rnd() * 0.2);
      if (sk.effect_type === 'damage') raw -= e.defense;
      const crit = sk.effect_type === 'damage' && rnd() < 0.08;
      const dmg = Math.max(1, Math.round(crit ? raw * 1.5 : raw));
      s.enemy_hp = Math.max(0, s.enemy_hp - dmg);
      events.push({ type: 'player_hit', damage: dmg, crit, fx: sk.fx, skill: sk.name });
    }
    P.char.hp = hp; P.char.mp = mp;
    const out = {};
    if (s.enemy_hp <= 0) { combatVictory(P, events); out.combat = null; out.state = fullState(P); }
    else out.combat = combatView(P);
    out.player = brief(P); out.events = events;
    return out;
  }
  function combatTick(P, body) {
    applyPosition(P, body.pos);
    const events = [];
    const s = combatSettle(P, events);
    const out = { combat: s ? combatView(P) : null, player: brief(P), events };
    if (events.some((e) => e.type === 'defeat')) out.state = fullState(P);
    return out;
  }

  // ------------------------------------------------------------------ world actions
  const near = (P, x, y, what) => { if (dist(P.char.pos_x, P.char.pos_y, x, y) > INTERACT) throw new ApiError('You are too far from the ' + what + '.', 409); };
  function loadNpc(P, key) {
    const n = D.npc_defs[key];
    if (!n || n.area_key !== P.char.area_key) throw new ApiError('There is nobody here.', 404);
    near(P, n.x, n.y, n.name);
    return n;
  }
  function travel(P, body) {
    applyPosition(P, body.pos);
    const p = D.area_portals.find((g) => g.id === body.portal_id && g.from_area === P.char.area_key);
    if (!p) throw new ApiError('There is no gate here.', 404);
    near(P, p.x, p.y, 'gate');
    const dest = D.area_defs[p.to_area];
    if (!P.areas.includes(p.to_area)) throw new ApiError('This path is not open to you yet.', 403);
    if (P.char.level < dest.min_level) throw new ApiError('You must be level ' + dest.min_level + ' to enter ' + dest.name + '.', 403);
    P.combat = null;
    Object.assign(P.char, { area_key: p.to_area, pos_x: p.to_x, pos_y: p.to_y, last_move_ms: now() });
    touchSave(P, 0, true);
    return { state: fullState(P) };
  }
  function rest(P, body) {
    applyPosition(P, body.pos);
    const a = D.area_defs[P.char.area_key];
    near(P, a.shrine_x, a.shrine_y, 'shrine');
    if (P.combat) throw new ApiError('You cannot rest during a fight.', 409);
    const st = derived(P);
    P.char.hp = st.max_hp; P.char.mp = st.max_mp;
    Object.assign(P.save, { checkpoint_area: P.char.area_key, checkpoint_x: a.shrine_x, checkpoint_y: a.shrine_y + 1 });
    touchSave(P, 0, true);
    return { player: brief(P), message: 'You rest at the shrine. Your progress is saved.' };
  }
  function sync(P, body) {
    const ok = applyPosition(P, body.pos);
    touchSave(P, Number.isInteger(body.play_seconds) ? body.play_seconds : 0, false);
    return { accepted: ok, x: P.char.pos_x, y: P.char.pos_y, player: brief(P) };
  }
  function talk(P, body) {
    applyPosition(P, body.pos);
    const npcKey = String(body.npc_key || '');
    const npc = loadNpc(P, npcKey);
    const states = questStates(P);
    let text = npc.greeting, best = null;
    const options = [], rank = { ready: 4, available: 3, active: 2, complete: 1 };
    Object.values(states).forEach((s) => {
      const q = D.quest_defs[s.quest_key], isTurn = q.turn_in_npc === npcKey, isGiver = q.giver_npc === npcKey;
      if (!isTurn && !isGiver) return;
      if (s.state === 'ready' && isTurn) options.push({ type: 'turn_in', quest_key: s.quest_key, label: 'Turn in: ' + q.title });
      else if (s.state === 'available' && isGiver) options.push({ type: 'accept', quest_key: s.quest_key, label: 'Accept: ' + q.title });
      const r = rank[s.state] || 0;
      if (r > 0 && (!best || r > best.r || (r === best.r && s.sort < best.sort))) best = { r, key: s.quest_key, state: s.state, sort: s.sort };
    });
    if (best) {
      const q = D.quest_defs[best.key];
      text = { ready: q.dialog_ready, available: q.dialog_offer, active: q.dialog_active }[best.state] || q.dialog_complete;
    }
    let stock = [];
    if (npc.shop_key) { options.push({ type: 'shop', label: 'Trade' }); stock = (D.shop_stock[npc.shop_key] || []).slice(); }
    return { npc: { npc_key: npcKey, name: npc.name, title: npc.title, face: npc.face_path }, text, options, stock };
  }
  function questAccept(P, body) {
    applyPosition(P, body.pos);
    const npc = loadNpc(P, String(body.npc_key || ''));
    const q = D.quest_defs[body.quest_key];
    const st = questStates(P);
    if (!q || q.giver_npc !== npc.npc_key || !st[q.quest_key] || st[q.quest_key].state !== 'available') throw new ApiError('That quest is not available.', 409);
    P.quests[q.quest_key] = { status: 'active', progress: 0 };
    return { state: fullState(P), message: 'Quest accepted: ' + q.title, text: q.dialog_active };
  }
  function questComplete(P, body) {
    applyPosition(P, body.pos);
    const npc = loadNpc(P, String(body.npc_key || ''));
    const q = D.quest_defs[body.quest_key];
    const st = questStates(P);
    if (!q || q.turn_in_npc !== npc.npc_key || !st[q.quest_key] || st[q.quest_key].state !== 'ready') throw new ApiError('That quest is not ready to turn in.', 409);
    if (q.objective_type === 'collect' && !removeItem(P, q.target_key, q.target_count, 'quest_turn_in', q.title)) throw new ApiError('You are missing the quest items.', 409);
    if (q.reward_item && !canAdd(P, q.reward_item, q.reward_item_qty)) throw new ApiError('Your bag is full. Make some room first.', 409);   // throwing discards the removal above
    P.quests[q.quest_key] = { status: 'complete', progress: q.target_count };
    const events = [];
    addGold(P, q.reward_gold, 'quest_reward', q.title);
    if (q.reward_item) addItem(P, q.reward_item, q.reward_item_qty, 'quest_reward', q.title);
    if (q.reward_unlock_area) {
      if (!P.areas.includes(q.reward_unlock_area)) P.areas.push(q.reward_unlock_area);
      events.push({ type: 'area_unlocked', name: D.area_defs[q.reward_unlock_area].name });
    }
    if (q.kind === 'main') P.char.story_stage = Math.max(P.char.story_stage, q.sort_order);
    grantXp(P, q.reward_xp).forEach((e) => events.push(e));
    touchSave(P, 0, true);
    return { state: fullState(P), events, text: q.dialog_complete, message: 'Quest complete: ' + q.title };
  }
  function shopNpc(P, body) {
    const n = loadNpc(P, String(body.npc_key || ''));
    if (!n.shop_key) throw new ApiError('They have nothing to sell.', 404);
    return n;
  }
  const qtyOf = (b) => { const q = b.quantity; if (!Number.isInteger(q) || q < 1 || q > MAX_STACK) throw new ApiError('Invalid request.', 400); return q; };
  function shopBuy(P, body) {
    applyPosition(P, body.pos);
    const npc = shopNpc(P, body), key = String(body.item_key || ''), qty = qtyOf(body);
    if (!(D.shop_stock[npc.shop_key] || []).includes(key)) throw new ApiError('That item is not for sale here.', 404);
    const total = D.item_defs[key].buy_price * qty;   // price always comes from the definitions
    if (P.char.gold < total) throw new ApiError('You cannot afford that.', 409);
    if (!canAdd(P, key, qty)) throw new ApiError('Your bag is full.', 409);
    addGold(P, -total, 'shop_buy', D.item_defs[key].name + ' x' + qty);
    addItem(P, key, qty, 'shop_buy', 'Bought from ' + npc.name);
    return { state: fullState(P), message: 'Bought ' + D.item_defs[key].name + ' x' + qty };
  }
  function shopSell(P, body) {
    applyPosition(P, body.pos);
    shopNpc(P, body);
    const key = String(body.item_key || ''), qty = qtyOf(body), it = D.item_defs[key];
    if (!it || it.sell_price <= 0) throw new ApiError('Nobody will buy that.', 409);
    if (!removeItem(P, key, qty, 'shop_sell', 'Sold ' + it.name)) throw new ApiError('You do not have that many.', 409);
    addGold(P, it.sell_price * qty, 'shop_sell', it.name + ' x' + qty);
    return { state: fullState(P), message: 'Sold ' + it.name + ' x' + qty };
  }

  // ------------------------------------------------------------------ inventory
  function equip(P, body) {
    const key = String(body.item_key || ''), it = D.item_defs[key];
    if (!it || !EQUIP_SLOTS.includes(it.item_type)) throw new ApiError('That cannot be equipped.', 409);
    if (P.char.level < it.req_level) throw new ApiError('You need level ' + it.req_level + ' to equip that.', 403);
    if (!removeItem(P, key, 1, 'equip', 'Equipped ' + it.name)) throw new ApiError('You do not have that item.', 409);
    const old = P.equip[it.item_type];
    if (old && addItem(P, old, 1, 'unequip', 'Swapped out') !== 1) throw new ApiError('Your bag is full.', 409);
    P.equip[it.item_type] = key;
    clampVitals(P);
    return { state: fullState(P), message: 'Equipped ' + it.name };
  }
  function unequip(P, body) {
    const slot = String(body.slot || '');
    if (!EQUIP_SLOTS.includes(slot)) throw new ApiError('Invalid slot.', 422);
    const key = P.equip[slot];
    if (!key) throw new ApiError('Nothing is equipped there.', 409);
    if (addItem(P, key, 1, 'unequip', 'Unequipped') !== 1) throw new ApiError('Your bag is full.', 409);
    P.equip[slot] = null;
    clampVitals(P);
    return { state: fullState(P), message: 'Unequipped ' + D.item_defs[key].name };
  }
  function useItem(P, body) {
    const key = String(body.item_key || ''), it = D.item_defs[key];
    if (!it || it.item_type !== 'consumable') throw new ApiError('You cannot use that.', 409);
    const events = [], s = combatSettle(P, events);
    if (P.char.hp <= 0 || events.some((e) => e.type === 'defeat')) return { state: fullState(P), events, combat: null, player: brief(P) };
    const st = derived(P), hp = Math.min(P.char.hp, st.max_hp), mp = Math.min(P.char.mp, st.max_mp);
    if ((it.heal_hp === 0 || hp >= st.max_hp) && (it.heal_mp === 0 || mp >= st.max_mp)) throw new ApiError('That would have no effect right now.', 409);
    if (s) {
      const t = now();
      if ((s.cooldowns._item || 0) > t) throw new ApiError('You cannot use items that quickly.', 429);
      s.cooldowns._item = t + ITEM_CD;
    }
    if (!removeItem(P, key, 1, 'use_item', 'Used ' + it.name)) throw new ApiError('You do not have that item.', 409);
    const nh = Math.min(st.max_hp, hp + it.heal_hp), nm = Math.min(st.max_mp, mp + it.heal_mp);
    P.char.hp = nh; P.char.mp = nm;
    events.push({ type: 'item_used', name: it.name, hp: nh - hp, mp: nm - mp });
    return { state: fullState(P), events, player: brief(P), combat: combatView(P) };
  }
  function settings(P, body) {
    const num = (k) => { const v = body[k]; if (!Number.isInteger(v) || v < 0 || v > 100) throw new ApiError('Invalid request.', 400); return v; };
    P.settings = { music_on: !!body.music_on, music_volume: num('music_volume'), sfx_on: !!body.sfx_on, sfx_volume: num('sfx_volume') };
    return { ok: true };
  }

  // ------------------------------------------------------------------ accounts
  const hex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  async function hashPassword(pw, saltHex) {
    const subtle = root.crypto && root.crypto.subtle;
    if (subtle) {
      const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
      const key = await subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
      return 'pbkdf2:' + hex(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 120000 }, key, 256));
    }
    // Fallback for very old browsers: simple, NOT strong (documented in README).
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57; const s = saltHex + pw;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    return 'weak:' + (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
  }
  function randomSalt() {
    const a = new Uint8Array(16);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(a); else for (let i = 0; i < 16; i++) a[i] = Math.floor(rnd() * 256);
    return hex(a);
  }
  const findUser = (db, name) => db.users[String(name).toLowerCase()];

  async function register(body) {
    const username = String(body.username || '').trim(), password = String(body.password || '');
    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) throw new ApiError('Usernames use 3-24 letters, numbers or underscores.', 422);
    if (password.length < 8 || password.length > 72) throw new ApiError('Passwords must be 8-72 characters long.', 422);
    const db = loadDb();
    if (findUser(db, username)) throw new ApiError('That username is already taken.', 409);
    const salt = randomSalt();
    const user = { id: db.nextId++, username, salt, hash: await hashPassword(password, salt), created: now() };
    const db2 = loadDb();                      // re-read in case another tab registered meanwhile
    if (findUser(db2, username)) throw new ApiError('That username is already taken.', 409);
    user.id = db2.nextId++;
    db2.users[username.toLowerCase()] = user;
    saveDb(db2);
    setSession(user.id);
    return { username, csrf: '', has_character: false };
  }
  async function login(body) {
    const username = String(body.username || '').trim(), password = String(body.password || '');
    if (!username || !password) throw new ApiError('Enter your username and password.', 422);
    const db = loadDb(), user = findUser(db, username);
    const ok = user && (await hashPassword(password, user.salt)) === user.hash;
    if (!ok) throw new ApiError('Wrong username or password.', 401);
    setSession(user.id);
    return { username: user.username, csrf: '', has_character: !!db.players[user.id] };
  }
  function currentUser() {
    const uid = sessionUid(), db = loadDb();
    const user = uid ? Object.values(db.users).find((u) => u.id === uid) : null;
    return { db, user };
  }
  function session() {
    const { db, user } = currentUser();
    if (!user) return { authenticated: false, csrf: '' };
    return { authenticated: true, username: user.username, csrf: '', has_character: !!db.players[user.id] };
  }
  function createCharacter(body) {
    return withPlayer((P, db, user) => {
      if (P) throw new ApiError('You already have a character.', 409);
      const name = String(body.name || '').trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9 '\-]{1,15}$/.test(name)) throw new ApiError('Character names use 2-16 letters, numbers, spaces or hyphens.', 422);
      const cls = D.class_defs[body.class_key];
      if (!cls || !SPRITES[body.sprite_key]) throw new ApiError('Pick a valid class and look.', 422);
      const a = D.area_defs.lantern_trail, bs = baseStats(cls, 1);
      const np = {
        char: { name, class_key: cls.class_key, sprite_key: body.sprite_key, level: 1, xp: 0, hp: bs.max_hp, mp: bs.max_mp, gold: 0, story_stage: 0, area_key: a.area_key, pos_x: a.start_x, pos_y: a.start_y, direction: 'down', last_move_ms: now() },
        inv: {}, equip: { weapon: 'wooden_blade', armor: 'cloth_garb', accessory: null }, quests: {}, areas: ['lantern_trail'], skills: [], spawns: {}, combat: null,
        settings: { music_on: true, music_volume: 40, sfx_on: true, sfx_volume: 60 },
        save: { checkpoint_area: a.area_key, checkpoint_x: a.shrine_x, checkpoint_y: a.shrine_y + 1, play_seconds: 0, save_count: 1, last_saved_at: now() }, tx: [],
      };
      unlockSkills(np, 1);
      addItem(np, 'healing_tonic', 2, 'starter', 'Starting kit');
      addItem(np, 'rice_ball', 2, 'starter', 'Starting kit');
      addGold(np, 30, 'starter', 'Starting gold');
      db.players[user.id] = np;
      return { state: fullState(np) };
    }, false);
  }
  async function newGame(body) {
    const { user } = currentUser();
    if (!user) throw new ApiError('Please sign in again.', 401);
    if (!body.password || (await hashPassword(String(body.password), user.salt)) !== user.hash) throw new ApiError('Wrong password. Your save was not touched.', 403);
    const db = loadDb();
    delete db.players[user.id];
    saveDb(db);
    return { ok: true };
  }

  // ------------------------------------------------------------------ router (same actions the old API had)
  const P_ = (fn) => (body) => withPlayer((P) => fn(P, body || {}));
  const routes = {
    session: () => session(),
    classes: () => ({ classes: classList(), sprites: SPRITES }),
    register: (b) => register(b), login: (b) => login(b),
    logout: () => { setSession(null); return { ok: true }; },
    new_game: (b) => newGame(b),
    create_character: (b) => createCharacter(b),
    load: () => withPlayer((P) => ({ state: fullState(P), defs: gameDefs() })),
    area: () => withPlayer((P) => areaData(P)),
    sync: P_(sync),
    save: P_((P, b) => { const r = sync(P, b); touchSave(P, 0, true); r.message = 'Progress saved.'; return r; }),
    travel: P_(travel), rest: P_(rest), talk: P_(talk),
    quest_accept: P_(questAccept), quest_complete: P_(questComplete),
    shop_buy: P_(shopBuy), shop_sell: P_(shopSell),
    equip: P_(equip), unequip: P_(unequip), use_item: P_(useItem), settings: P_(settings),
    combat_start: P_(combatStart), combat_action: P_(combatAction), combat_tick: P_(combatTick),
    combat_flee: P_((P) => { P.combat = null; return { combat: null, player: brief(P), events: [] }; }),
  };

  NA.server = {
    ApiError,
    async handle(action, body) {
      const r = routes[action];
      if (!r) throw new ApiError('Unknown request.', 404);
      try { return clone(await r(body || {})); }
      catch (e) {
        if (e instanceof ApiError) throw e;
        if (typeof console !== 'undefined') console.error('Game error:', e);
        throw new ApiError('Something went wrong. Please try again.', 500);
      }
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
