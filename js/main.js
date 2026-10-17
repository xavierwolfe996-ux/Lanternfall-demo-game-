/* Game flow: boot, sign in, character creation, title screen, game session, input. */
(function () {
  'use strict';
  const NA = (window.NA = window.NA || {});
  const $ = (id) => document.getElementById(id);
  const S = (NA.S = { state: null, defs: null, area: null, username: '' });
  const M = (NA.main = {});
  const KEYS = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
  let held = [], syncDirty = false, lastSyncAt = performance.now(), loopsOn = false, settingsTimer = null, busy = false;

  function show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  }
  const say = (id, msg, ok) => { const n = $(id); n.textContent = msg || ''; n.classList.toggle('ok', !!ok); };

  // ------------------------------------------------------------------ helpers used by other modules
  M.pos = () => ({ x: NA.world.player.tx, y: NA.world.player.ty, dir: NA.world.player.dir });
  M.blocked = () => NA.ui.anyModal() || !$('screenGame').classList.contains('active');
  M.sessionExpired = function () {
    NA.world.stop(); NA.combat.reset(); NA.audio.music(null); S.state = null;
    show('screenAuth'); say('authMessage', 'Your session expired. Please sign in again.');
  };
  M.mergeVitals = function (p) {
    const c = S.state.character;
    c.hp = p.hp; c.mp = p.mp; c.gold = p.gold; c.xp = p.xp; c.level = p.level; c.xp_next = p.xp_next;
    S.state.stats.max_hp = p.max_hp; S.state.stats.max_mp = p.max_mp;
    NA.ui.updateVitals(p);
    if (!$('menuModal').classList.contains('hidden')) NA.ui.renderMenu();
  };

  M.setState = async function (state, opts) {
    S.state = state;
    const areaChanged = S.area && state.character.area_key !== S.area.area.area_key;
    if ((opts && opts.reloadArea) || areaChanged) await M.reloadArea();
    NA.audio.configure(state.settings);
    NA.ui.updateHud();
    NA.ui.refreshShop();
  };

  M.reloadArea = async function () {
    NA.ui.fade(true);
    await new Promise((r) => setTimeout(r, 250));
    const data = await NA.api.call('area');
    S.area = data;
    NA.combat.reset();
    await NA.world.loadArea(data, S.state.character);
    NA.world.playerAlive = true;
    NA.audio.music(data.area.music);
    NA.combat.setActive(data.combat);
    NA.ui.updateHud();
    NA.ui.fade(false);
  };

  // ------------------------------------------------------------------ auth screen
  let authMode = 'login';
  document.querySelectorAll('#screenAuth .tab').forEach((t) => t.addEventListener('click', () => {
    authMode = t.dataset.mode;
    document.querySelectorAll('#screenAuth .tab').forEach((x) => x.classList.toggle('active', x === t));
    $('emailField').classList.toggle('hidden', authMode !== 'register');
    $('authSubmit').textContent = authMode === 'login' ? 'Enter the valley' : 'Create account';
    $('authForm').password.autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
    say('authMessage', '');
  }));
  $('authForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (busy) return; busy = true;
    const f = ev.target;
    say('authMessage', '');
    try {
      const body = { username: f.username.value.trim(), password: f.password.value };
      if (authMode === 'register') body.email = f.email.value.trim();
      const r = await NA.api.call(authMode, body);
      f.password.value = '';
      S.username = r.username;
      await afterAuth(r.has_character);
    } catch (e) { say('authMessage', e.message); }
    finally { busy = false; }
  });

  async function afterAuth(hasChar) {
    if (!hasChar) { await showCreate(); return; }
    await loadAll();
    showTitle();
  }

  async function loadAll() {
    const r = await NA.api.call('load');
    S.state = r.state; S.defs = r.defs;
    NA.audio.configure(S.state.settings);
  }

  // ------------------------------------------------------------------ character creation
  const cr = { cls: 'shinobi', sprite: 'NinjaGreen', anim: null };
  async function showCreate() {
    show('screenCreate'); say('createMessage', '');
    const r = await NA.api.call('classes');
    const list = $('classList'); list.textContent = '';
    r.classes.forEach((c) => {
      const b = NA.ui.el('button', 'choice' + (c.class_key === cr.cls ? ' active' : '')); b.type = 'button';
      b.appendChild(document.createTextNode(c.name));
      b.appendChild(NA.ui.el('small', '', `HP ${c.hp}  MP ${c.mp}  ATK ${c.atk}  DEF ${c.def}`));
      b.addEventListener('click', () => { cr.cls = c.class_key; NA.audio.sfx('move'); list.querySelectorAll('.choice').forEach((x) => x.classList.toggle('active', x === b)); $('previewClass').textContent = c.description; });
      if (c.class_key === cr.cls) $('previewClass').textContent = c.description;
      list.appendChild(b);
    });
    const sw = $('spriteList'); sw.textContent = '';
    Object.keys(r.sprites).forEach((k) => {
      const b = NA.ui.el('button', 'swatch' + (k === cr.sprite ? ' active' : '')); b.type = 'button'; b.title = r.sprites[k];
      const cv = document.createElement('canvas'); cv.width = 16; cv.height = 16; b.appendChild(cv);
      const im = NA.assets.img(`Actor/Character/${k}/SpriteSheet.png`);
      im.ready.then(() => { const c = cv.getContext('2d'); c.imageSmoothingEnabled = false; NA.drawChar(c, im, 'down', 0, 0, 0, 16); });
      b.addEventListener('click', () => { cr.sprite = k; NA.audio.sfx('move'); sw.querySelectorAll('.swatch').forEach((x) => x.classList.toggle('active', x === b)); });
      sw.appendChild(b);
    });
    if (cr.anim) cancelAnimationFrame(cr.anim);
    const cv = $('previewCanvas'), c = cv.getContext('2d'); c.imageSmoothingEnabled = false;
    const dirs = ['down', 'right', 'up', 'left'];
    const tick = (t) => {
      if (!$('screenCreate').classList.contains('active')) return;
      c.clearRect(0, 0, 64, 64);
      NA.drawChar(c, NA.assets.img(`Actor/Character/${cr.sprite}/SpriteSheet.png`), dirs[Math.floor(t / 1400) % 4], Math.floor(t / 180) % 4, 0, 0, 64);
      cr.anim = requestAnimationFrame(tick);
    };
    cr.anim = requestAnimationFrame(tick);
  }
  $('createBack').addEventListener('click', async () => { if (S.state) showTitle(); else { await NA.api.call('logout', {}); show('screenAuth'); } });
  $('createGo').addEventListener('click', async () => {
    if (busy) return; busy = true; say('createMessage', '');
    try {
      await NA.api.call('create_character', { name: $('charName').value.trim(), class_key: cr.cls, sprite_key: cr.sprite });
      await loadAll();
      await startGame(true);
    } catch (e) { say('createMessage', e.message); }
    finally { busy = false; }
  });

  // ------------------------------------------------------------------ title screen
  function showTitle() {
    NA.audio.music('Audio/Musics/38 - Intro.ogg');
    const c = S.state.character;
    $('titleWho').textContent = `${c.name} - Level ${c.level} ${c.class_name}`;
    say('titleMsg', '');
    show('screenTitle');
  }
  $('tContinue').addEventListener('click', () => { NA.audio.sfx('ok'); startGame(false).catch((e) => say('titleMsg', e.message)); });
  $('tSettings').addEventListener('click', () => NA.ui.openSettings());
  $('tLogout').addEventListener('click', () => logout());
  $('tNew').addEventListener('click', async () => {
    const pw = await NA.ui.confirm('Start a new game?', 'This permanently erases your current character, items and quest progress. Your account stays. Enter your password to confirm.', {
      password: true, yes: 'Erase and restart',
      validate: async (v) => { try { await NA.api.call('new_game', { password: v }); return null; } catch (e) { return e.message; } },
    });
    if (pw) { S.state = null; S.area = null; await showCreate(); }
  });

  async function logout() {
    try { await NA.api.call('logout', {}); } catch (e) { /* already gone */ }
    NA.world.stop(); NA.combat.reset(); NA.audio.music(null);
    S.state = null; S.area = null;
    ['menuModal', 'shopModal', 'pauseModal', 'settingsModal'].forEach((m) => $(m).classList.add('hidden'));
    NA.ui.closeDialog();
    show('screenAuth');
    const r = await NA.api.call('session'); NA.api.csrf = r.csrf;
  }

  // ------------------------------------------------------------------ game session
  async function startGame(isNew) {
    NA.ui.fade(true);
    await new Promise((r) => setTimeout(r, 200));
    show('screenGame');
    NA.world.init($('gameCanvas'));
    NA.world.resize();
    S.area = null;
    const data = await NA.api.call('area');
    S.area = data;
    await NA.world.loadArea(data, S.state.character);
    NA.world.playerAlive = true;
    NA.world.onStep = () => { syncDirty = true; };
    NA.world.onContact = (e) => { if (!NA.combat.active) NA.combat.start(e); };
    NA.combat.reset(); NA.combat.setActive(data.combat);
    NA.audio.configure(S.state.settings);
    NA.audio.music(data.area.music);
    NA.ui.updateHud();
    NA.world.start();
    lastSyncAt = performance.now(); syncDirty = false;
    startLoops();
    NA.ui.fade(false);
    NA.ui.toast(isNew ? 'Welcome! Speak to Master Sora (!) near the shrine.' : 'Welcome back, ' + S.state.character.name + '.', 'gold');
    NA.ui.toast('Move: arrows/WASD   Interact: E   Strike: Space   Skills: 1-4', '');
  }

  function startLoops() {
    if (loopsOn) return; loopsOn = true;
    setInterval(() => {
      if (!$('screenGame').classList.contains('active') || !S.state) return;
      NA.ui.tickCooldowns();
      const n = NA.world.nearest();
      NA.ui.prompt(n && !NA.ui.anyModal() ? n.label : null);
    }, 90);
    setInterval(heartbeat, 2000);
    document.addEventListener('visibilitychange', () => { if (document.hidden) heartbeat(true); });
    window.addEventListener('pagehide', () => { if (S.state) heartbeat(true, true); });
  }

  async function heartbeat(force, keepalive) {
    if (!S.state || !$('screenGame').classList.contains('active')) return;
    const now = performance.now();
    if (!force && !syncDirty && now - lastSyncAt < 15000) return;
    const secs = Math.round((now - lastSyncAt) / 1000);
    lastSyncAt = now; syncDirty = false;
    try {
      if (keepalive) { NA.api.call('sync', { pos: M.pos(), play_seconds: secs }); return; }   // local save is synchronous
      const r = await NA.api.call('sync', { pos: M.pos(), play_seconds: secs });
      if (r.accepted === false) { NA.world.snapTo(r.x, r.y); NA.ui.toast('Position corrected by the server.', 'bad'); }
      if (r.player) M.mergeVitals(r.player);
    } catch (e) { if (e.status === 401) M.sessionExpired(); }
  }

  // ------------------------------------------------------------------ interactions
  M.interact = async function () {
    if (M.blocked() || busy) return;
    const n = NA.world.nearest();
    if (!n) return;
    busy = true;
    try {
      if (n.type === 'npc') await talk(n.ref);
      else if (n.type === 'portal') await travel(n.ref);
      else if (n.type === 'shrine') {
        if (NA.combat.active) { NA.ui.toast('You cannot rest during a fight.', 'bad'); return; }
        const r = await NA.api.call('rest', { pos: M.pos() });
        M.mergeVitals(r.player); NA.audio.sfx('heal'); NA.world.addFx('aura', NA.world.player.tx, NA.world.player.ty);
        NA.ui.toast(r.message, 'good');
      }
    } catch (e) { if (e.status === 401) M.sessionExpired(); else { NA.ui.toast(e.message, 'bad'); NA.audio.sfx('cancel'); } }
    finally { busy = false; }
  };

  async function talk(npc) {
    const r = await NA.api.call('talk', { npc_key: npc.npc_key, pos: M.pos() });
    NA.audio.sfx('open');
    const info = { name: r.npc.name, title: r.npc.title, face: r.npc.face, npc_key: r.npc.npc_key };
    const bye = { label: 'Goodbye', run: () => NA.ui.closeDialog() };
    const opts = r.options.map((o) => ({
      label: o.label, primary: o.type !== 'shop',
      run: async () => {
        try {
          if (o.type === 'shop') { NA.ui.closeDialog(); NA.ui.openShop(info, r.stock); return; }
          const res = await NA.api.call(o.type === 'accept' ? 'quest_accept' : 'quest_complete', { npc_key: info.npc_key, quest_key: o.quest_key, pos: M.pos() });
          await M.setState(res.state);
          NA.ui.toast(res.message, 'good'); NA.audio.sfx(o.type === 'accept' ? 'ok' : 'quest');
          (res.events || []).forEach((ev) => {
            if (ev.type === 'level_up') { NA.ui.banner('LEVEL UP!', 'You reached level ' + ev.level); NA.audio.sfx('levelup'); }
            if (ev.type === 'skill_unlocked') NA.ui.toast('New skill learned: ' + ev.name, 'gold');
            if (ev.type === 'area_unlocked') { NA.ui.toast('New area unlocked: ' + ev.name, 'gold'); NA.audio.sfx('unlock'); refreshPortals(); }
          });
          NA.ui.dialog(info, res.text, [bye]);
        } catch (e) { NA.ui.toast(e.message, 'bad'); NA.audio.sfx('cancel'); }
      },
    }));
    opts.push(bye);
    NA.ui.dialog(info, r.text, opts);
  }

  async function refreshPortals() {
    try { const d = await NA.api.call('area'); S.area.portals = d.portals; NA.world.portals = d.portals; } catch (e) { /* ignore */ }
  }

  async function travel(portal) {
    if (portal.locked) { NA.ui.toast('This path is not open to you yet. Finish the quests in this area.', 'bad'); NA.audio.sfx('cancel'); return; }
    const r = await NA.api.call('travel', { portal_id: portal.id, pos: M.pos() });
    NA.audio.sfx('unlock');
    await M.setState(r.state, { reloadArea: true });
    NA.ui.banner(S.area.area.name, S.area.area.description);
  }

  M.useItem = async function (key) {
    if (!key || busy) return; busy = true;
    try { const r = await NA.api.call('use_item', { item_key: key }); NA.combat.handle(r); NA.audio.sfx('heal'); }
    catch (e) { if (e.status === 401) M.sessionExpired(); else NA.ui.toast(e.message, 'bad'); }
    finally { busy = false; }
  };
  M.equip = async function (key) {
    try { const r = await NA.api.call('equip', { item_key: key }); NA.audio.sfx('equip'); await M.setState(r.state); NA.ui.toast(r.message, 'good'); NA.ui.sel = null; NA.ui.renderMenu(); }
    catch (e) { NA.ui.toast(e.message, 'bad'); NA.audio.sfx('cancel'); }
  };
  M.unequip = async function (slot) {
    try { const r = await NA.api.call('unequip', { slot }); NA.audio.sfx('ok'); await M.setState(r.state); NA.ui.toast(r.message, 'good'); NA.ui.sel = null; NA.ui.renderMenu(); }
    catch (e) { NA.ui.toast(e.message, 'bad'); NA.audio.sfx('cancel'); }
  };
  M.shopBuy = async function (npc, item, qty) {
    try { const r = await NA.api.call('shop_buy', { npc_key: npc, item_key: item, quantity: qty, pos: M.pos() }); NA.audio.sfx('buy'); await M.setState(r.state); NA.ui.toast(r.message, 'gold'); }
    catch (e) { NA.ui.toast(e.message, 'bad'); NA.audio.sfx('cancel'); }
  };
  M.shopSell = async function (npc, item, qty) {
    try { const r = await NA.api.call('shop_sell', { npc_key: npc, item_key: item, quantity: qty, pos: M.pos() }); NA.audio.sfx('coin'); await M.setState(r.state); NA.ui.toast(r.message, 'gold'); }
    catch (e) { NA.ui.toast(e.message, 'bad'); NA.audio.sfx('cancel'); }
  };
  M.saveSettings = function () {
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => { if (S.state) NA.api.call('settings', S.state.settings).catch(() => {}); }, 500);
  };

  // ------------------------------------------------------------------ pause menu
  function openPause() { NA.ui.open('pauseModal'); }
  $('pResume').addEventListener('click', () => NA.ui.close('pauseModal'));
  $('pMenu').addEventListener('click', () => { NA.ui.close('pauseModal'); NA.ui.openMenu('inventory'); });
  $('pSettings').addEventListener('click', () => { NA.ui.close('pauseModal'); NA.ui.openSettings(); });
  $('pSave').addEventListener('click', async () => {
    try { const r = await NA.api.call('save', { pos: M.pos(), play_seconds: 0 }); NA.ui.toast(r.message, 'good'); NA.audio.sfx('ok'); }
    catch (e) { NA.ui.toast(e.message, 'bad'); }
  });
  $('pTitle').addEventListener('click', async () => {
    await heartbeat(true);
    NA.ui.close('pauseModal'); NA.world.stop(); NA.combat.reset();
    await loadAll(); showTitle();
  });
  $('pLogout').addEventListener('click', () => logout());
  $('btnMenu').addEventListener('click', () => NA.ui.openMenu());
  $('quickHeal').addEventListener('click', () => M.useItem($('quickHeal').dataset.item));
  $('quickMp').addEventListener('click', () => M.useItem($('quickMp').dataset.item));

  // ------------------------------------------------------------------ keyboard + touch
  function strike() { NA.combat.useSkill('strike'); }
  window.addEventListener('keydown', (e) => {
    if (!$('screenGame').classList.contains('active') || e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const dir = KEYS[e.code];
    if (dir) { e.preventDefault(); if (!NA.ui.anyModal() && !held.includes(dir)) { held.push(dir); NA.world.setHeld(held.slice()); } return; }
    const modalOpen = NA.ui.anyModal();
    if (e.code === 'Escape') {
      e.preventDefault();
      if (!$('confirmModal').classList.contains('hidden')) return;
      for (const id of ['settingsModal', 'shopModal', 'menuModal', 'pauseModal']) if (!$(id).classList.contains('hidden')) { NA.ui.close(id); return; }
      if (NA.ui.dialogOpen) { NA.ui.closeDialog(); return; }
      openPause(); return;
    }
    if (NA.ui.dialogOpen) { if (['KeyE', 'Enter', 'Space'].includes(e.code) && NA.ui._skipType && NA.ui.typeTimer) { e.preventDefault(); NA.ui._skipType(); } return; }
    if (modalOpen) return;
    switch (e.code) {
      case 'KeyE': case 'Enter': e.preventDefault(); M.interact(); break;
      case 'Space': e.preventDefault(); strike(); break;
      case 'Digit1': strike(); break;
      case 'Digit2': NA.combat.useSkill('power_strike'); break;
      case 'Digit3': NA.combat.useSkill('fire_burst'); break;
      case 'Digit4': NA.combat.useSkill('healing_breath'); break;
      case 'KeyH': M.useItem($('quickHeal').dataset.item); break;
      case 'KeyG': M.useItem($('quickMp').dataset.item); break;
      case 'KeyI': NA.ui.openMenu('inventory'); break;
      case 'KeyJ': NA.ui.openMenu('quests'); break;
      case 'KeyK': NA.ui.openMenu('skills'); break;
      case 'KeyM': case 'KeyC': NA.ui.openMenu('character'); break;
      case 'KeyP': openPause(); break;
      default: break;
    }
  });
  window.addEventListener('keyup', (e) => {
    const dir = KEYS[e.code];
    if (dir) { held = held.filter((d) => d !== dir); NA.world.setHeld(held.slice()); }
  });
  window.addEventListener('blur', () => { held = []; NA.world.setHeld([]); });

  document.querySelectorAll('.dpad button').forEach((b) => {
    const dir = b.dataset.dir;
    const down = (e) => { e.preventDefault(); if (!NA.ui.anyModal() && !held.includes(dir)) { held.push(dir); NA.world.setHeld(held.slice()); } };
    const up = (e) => { e.preventDefault(); held = held.filter((d) => d !== dir); NA.world.setHeld(held.slice()); };
    b.addEventListener('pointerdown', down); b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up);
  });
  $('touchAct').addEventListener('pointerdown', (e) => { e.preventDefault(); M.interact(); });
  $('touchHit').addEventListener('pointerdown', (e) => { e.preventDefault(); strike(); });

  // ------------------------------------------------------------------ boot
  async function boot() {
    try {
      const r = await NA.api.call('session');
      NA.api.csrf = r.csrf;
      if (r.authenticated) { S.username = r.username; await afterAuth(r.has_character); }
      else show('screenAuth');
    } catch (e) {
      $('bootText').textContent = 'Could not start the game: ' + e.message;
    }
  }
  boot();
})();
