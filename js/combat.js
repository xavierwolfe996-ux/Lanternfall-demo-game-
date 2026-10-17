/* Client side of combat. It sends "use skill X" and DRAWS what the server reports:
   damage, enemy HP, cooldowns, rewards. It never decides an outcome itself. */
(function () {
  'use strict';
  const NA = (window.NA = window.NA || {});
  const C = (NA.combat = { active: null, inflight: false, cdReady: {}, timer: null });

  C.reset = function () {
    C.active = null; C.inflight = false; C.cdReady = {};
    NA.world.engagedId = null;
    if (C.timer) { clearInterval(C.timer); C.timer = null; }
    NA.ui.showEnemyBar(null);
  };

  function setActive(view) {
    C.active = view;
    NA.world.engagedId = view ? view.spawn_id : null;
    NA.ui.showEnemyBar(view);
    if (view) {
      const now = performance.now();
      Object.keys(view.cooldowns || {}).forEach((k) => { C.cdReady[k] = now + view.cooldowns[k]; });
      const e = NA.world.enemyById(view.spawn_id);
      if (e) e.hpFrac = view.enemy_hp / view.enemy_max_hp;
      if (!C.timer) C.timer = setInterval(C.tick, 800);
    } else if (C.timer) { clearInterval(C.timer); C.timer = null; }
  }
  C.setActive = setActive;

  C.start = async function (enemy) {
    if (C.active || C.inflight || NA.main.blocked()) return false;
    C.inflight = true;
    try {
      const r = await NA.api.call('combat_start', { spawn_id: enemy.id, pos: NA.main.pos() });
      NA.ui.updateVitals(r.player);
      setActive(r.combat);
      return true;
    } catch (e) {
      if (e.status === 409 || e.status === 404) { enemy.nextThink = performance.now() + 2500; }
      return false;
    } finally { C.inflight = false; }
  };

  C.useSkill = async function (key) {
    const S = NA.S, def = S.defs.skills[key];
    if (!def || C.inflight || NA.main.blocked()) return;
    const owned = S.state.skills.find((s) => s.skill_key === key && s.unlocked);
    if (!owned) { NA.ui.toast('Skill not learned yet (level ' + def.unlock_level + ').', 'bad'); return; }
    const now = performance.now();
    if ((C.cdReady[key] || 0) > now) return;
    if (S.state.character.mp < def.mp_cost) { NA.ui.toast('Not enough MP.', 'bad'); NA.audio.sfx('cancel'); return; }
    if (!C.active) {
      const enemy = NA.world.nearestEnemy(2);
      if (!enemy) { if (def.effect !== 'heal') NA.ui.toast('Nothing to strike. Get closer to an enemy.', ''); return; }
      if (!(await C.start(enemy))) return;
    }
    const p = NA.world.player;
    const target = NA.world.enemyById(C.active.spawn_id);
    if (target) {
      const dx = target.tx - p.tx, dy = target.ty - p.ty;
      p.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    }
    p.attackUntil = performance.now() + 220;
    C.cdReady[key] = performance.now() + def.cooldown_ms;
    C.inflight = true;
    try {
      const r = await NA.api.call('combat_action', { skill_key: key, pos: NA.main.pos() });
      handle(r, key);
    } catch (e) {
      if (e.status === 401) { NA.main.sessionExpired(); return; }
      if (e.status === 429) { /* cooling down: stay quiet */ }
      else if (e.status === 409 && /not in a fight/i.test(e.message)) { setActive(null); }
      else NA.ui.toast(e.message, 'bad');
    } finally { C.inflight = false; }
  };

  C.tick = async function () {
    if (!C.active || C.inflight || !NA.S.state) return;
    C.inflight = true;
    try { handle(await NA.api.call('combat_tick', { pos: NA.main.pos() })); }
    catch (e) { if (e.status === 401) NA.main.sessionExpired(); }
    finally { C.inflight = false; }
  };

  C.flee = async function () {
    if (!C.active) return;
    try { const r = await NA.api.call('combat_flee', {}); NA.ui.updateVitals(r.player); } catch (e) { /* ignore */ }
    setActive(null);
  };

  /** Apply a server response (events, vitals, combat view, optional full state). */
  function handle(r, skillKey) {
    const W = NA.world, p = W.player;
    const prevActive = C.active;
    if (r.player) NA.ui.updateVitals(r.player);
    const target = prevActive ? W.enemyById(prevActive.spawn_id) : null;
    const defeatEvt = (r.events || []).some((e) => e.type === 'defeat');
    (r.events || []).forEach((ev) => {
      switch (ev.type) {
        case 'player_hit':
          if (target) {
            W.addFx(ev.fx, target.tx, target.ty);
            W.addFloat((ev.crit ? 'CRIT ' : '') + ev.damage, ev.crit ? '#ffd24a' : '#ffffff', target.tx, target.ty, ev.crit);
            W.hitEnemy(target.id, r.combat ? r.combat.enemy_hp / r.combat.enemy_max_hp : 0);
          }
          NA.audio.sfx(ev.fx === 'flame' ? 'fire' : (Math.random() < 0.5 ? 'slash' : 'slash2'));
          NA.audio.sfx('hit');
          W.kick(ev.crit ? 3 : 1);
          break;
        case 'enemy_hit':
          W.addFloat('-' + ev.damage, '#ff5a4e', p.tx, p.ty, false);
          p.hurtUntil = performance.now() + 220;
          NA.audio.sfx('hurt'); W.kick(2);
          break;
        case 'player_heal':
          W.addFx('aura', p.tx, p.ty); W.addFloat('+' + ev.amount, '#6fe07f', p.tx, p.ty, false); NA.audio.sfx('heal');
          break;
        case 'item_used':
          W.addFx('aura', p.tx, p.ty);
          W.addFloat(ev.hp ? '+' + ev.hp : '+' + ev.mp, ev.hp ? '#6fe07f' : '#7fb0ff', p.tx, p.ty, false); NA.audio.sfx('heal');
          break;
        case 'victory': {
          const sp = NA.S.area.spawns.find((s) => s.spawn_id === ev.spawn_id);
          W.killEnemy(ev.spawn_id, sp ? sp.respawn_seconds : 60);
          NA.audio.sfx('victory');
          NA.ui.toast(`${ev.enemy} defeated!  +${ev.xp} XP  +${ev.gold} gold`, 'good');
          ev.drops.forEach((d) => NA.ui.toast(d.bag_full ? `Bag full! Lost ${d.name}.` : `Loot: ${d.name} x${d.quantity}`, d.bag_full ? 'bad' : 'gold'));
          if (ev.gold) NA.audio.sfx('coin');
          break;
        }
        case 'level_up': NA.ui.banner('LEVEL UP!', 'You reached level ' + ev.level); NA.audio.sfx('levelup'); break;
        case 'skill_unlocked': NA.ui.toast('New skill learned: ' + ev.name, 'gold'); break;
        case 'fled': NA.ui.toast('You slipped away from the fight.', ''); break;
        case 'defeat':
          NA.audio.sfx('gameover');
          NA.ui.banner('DEFEATED', ev.lost_gold ? `You dropped ${ev.lost_gold} gold` : 'You wake at the shrine');
          break;
        default: break;
      }
    });
    setActive(r.combat || null);
    if (r.state) NA.main.setState(r.state, { reloadArea: defeatEvt });
    else if (r.player) NA.main.mergeVitals(r.player);
  }
  C.handle = handle;
})();
