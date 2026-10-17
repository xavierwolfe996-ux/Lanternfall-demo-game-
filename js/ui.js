/* HUD, dialog, menus (bag / hero / quests / skills / settings), shop, confirm dialogs.
   Every string that comes from the server is inserted with textContent (never innerHTML). */
(function () {
  'use strict';
  const NA = (window.NA = window.NA || {});
  const $ = (id) => document.getElementById(id);
  const U = (NA.ui = { sel: null, menuTab: 'inventory', shop: null, dialogOpen: false, typeTimer: null });

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  U.el = el;
  const icon = (rel) => NA.assets.url(rel);
  U.icon = icon;
  const DEF = () => NA.S.defs;
  const ST = () => NA.S.state;

  // -------------------------------------------------------------- toasts / banner / fade
  U.toast = function (text, kind) {
    for (const old of $('toasts').children) if (old.textContent === text) return;   // no duplicate spam
    const t = el('div', 'toast ' + (kind || ''), text);
    $('toasts').appendChild(t);
    while ($('toasts').children.length > 5) $('toasts').firstChild.remove();
    setTimeout(() => t.remove(), 3500);
  };
  U.banner = function (title, sub) {
    const b = $('banner');
    b.classList.add('hidden'); void b.offsetWidth;
    b.textContent = title;
    if (sub) b.appendChild(el('small', '', sub));
    b.classList.remove('hidden');
    clearTimeout(U._bt); U._bt = setTimeout(() => b.classList.add('hidden'), 2700);
  };
  U.fade = (on) => $('fade').classList.toggle('on', !!on);
  U.prompt = function (text) {
    const p = $('prompt');
    if (!text) { p.classList.add('hidden'); return; }
    if (p.dataset.t !== text) {
      p.dataset.t = text; p.textContent = '';
      const k = el('kbd', '', 'E'); p.appendChild(k); p.appendChild(document.createTextNode(text));
    }
    p.classList.remove('hidden');
  };

  // -------------------------------------------------------------- HUD
  function setBar(id, txtId, cur, max, label) {
    $(id).style.width = (max ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0) + '%';
    if (txtId) $(txtId).textContent = label || `${cur}/${max}`;
  }
  U.updateVitals = function (p) {
    if (!p) return;
    setBar('barHp', 'txtHp', p.hp, p.max_hp);
    setBar('barMp', 'txtMp', p.mp, p.max_mp);
    $('hudGold').textContent = p.gold;
    if (p.level !== undefined) {
      $('hudLevel').textContent = 'Lv ' + p.level;
      setBar('barXp', 'txtXp', p.xp, p.xp_next, p.xp_next ? `${p.xp}/${p.xp_next} XP` : 'MAX');
    }
  };

  U.updateHud = function () {
    const s = ST(), c = s.character;
    $('hudName').textContent = c.name;
    $('hudFace').style.backgroundImage = `url("${icon('Actor/Character/' + c.sprite_key + '/Faceset.png')}")`;
    $('goldIcon').src = icon('Ui/Skill Icon/Items & Weapon/Money.png'); $('shopGoldIcon').src = icon('Ui/Skill Icon/Items & Weapon/Money.png');
    U.updateVitals({ hp: c.hp, mp: c.mp, max_hp: s.stats.max_hp, max_mp: s.stats.max_mp, gold: c.gold, xp: c.xp, xp_next: c.xp_next, level: c.level });
    $('hudArea').textContent = NA.S.area ? NA.S.area.area.name : '';
    buildSkillBar(); updateQuick(); updateTracker(); updateNpcMarks();
    if (!$('menuModal').classList.contains('hidden')) U.renderMenu();
  };

  function buildSkillBar() {
    const box = $('skillSlots');
    const s = ST(), skills = Object.values(DEF().skills).sort((a, b) => a.slot - b.slot);
    box.textContent = '';
    skills.forEach((sk) => {
      const own = s.skills.find((x) => x.skill_key === sk.skill_key && x.unlocked);
      const b = el('button', 'slot ready' + (own ? '' : ' locked'));
      b.type = 'button'; b.dataset.skill = sk.skill_key;
      b.title = `${sk.name}${own ? '' : ' (level ' + sk.unlock_level + ')'}: ${sk.description}`;
      const im = el('img'); im.src = icon(sk.icon); im.alt = sk.name; b.appendChild(im);
      b.appendChild(el('b', '', sk.slot === 1 ? 'Spc' : String(sk.slot)));
      if (sk.mp_cost) b.appendChild(el('u', '', sk.mp_cost + 'mp'));
      b.appendChild(el('div', 'cd')); b.lastChild.style.transform = 'scaleY(0)';
      b.addEventListener('click', () => NA.combat.useSkill(sk.skill_key));
      box.appendChild(b);
    });
  }

  U.tickCooldowns = function () {
    const now = performance.now(), mp = ST().character.mp;
    document.querySelectorAll('#skillSlots .slot').forEach((b) => {
      const key = b.dataset.skill, def = DEF().skills[key];
      const left = Math.max(0, (NA.combat.cdReady[key] || 0) - now);
      b.lastChild.style.transform = 'scaleY(' + (def ? Math.min(1, left / def.cooldown_ms) : 0) + ')';
      b.classList.toggle('nomp', mp < def.mp_cost);
    });
  };

  function bestConsumable(kind) {
    const inv = ST().inventory, items = DEF().items;
    const list = inv.map((r) => items[r.item_key]).filter((i) => i && i.type === 'consumable' && i[kind] > 0);
    list.sort((a, b) => a[kind] - b[kind]);
    return list[0] || null;
  }
  function updateQuick() {
    [['quickHeal', 'heal_hp'], ['quickMp', 'heal_mp']].forEach(([id, kind]) => {
      const b = $(id), it = bestConsumable(kind);
      b.disabled = !it; b.dataset.item = it ? it.item_key : '';
      b.querySelector('img').src = it ? icon(it.icon) : '';
      b.querySelector('img').style.visibility = it ? 'visible' : 'hidden';
      const q = it ? ST().inventory.find((r) => r.item_key === it.item_key).quantity : '';
      b.querySelector('u').textContent = q;
      b.title = it ? `Use ${it.name}` : 'No item';
    });
  }

  function updateTracker() {
    const box = $('tracker');
    box.textContent = '';
    ST().quests.filter((q) => q.state === 'active' || q.state === 'ready').sort((a, b) => a.sort - b.sort).slice(0, 3).forEach((q) => {
      const d = el('div', 'q' + (q.state === 'ready' ? ' ready' : ''));
      d.appendChild(el('b', '', q.title));
      d.appendChild(el('span', '', q.state === 'ready' ? `Return to ${DEF().npcs[q.turn_in_npc].name}` : `${q.progress}/${q.target}  ${q.summary.split('.')[0]}`));
      box.appendChild(d);
    });
  }

  function updateNpcMarks() {
    const marks = {};
    ST().quests.forEach((q) => {
      if (q.state === 'ready') marks[q.turn_in_npc] = '?';
      else if (q.state === 'available' && !marks[q.giver_npc]) marks[q.giver_npc] = '!';
    });
    NA.world.npcMarks = marks;
  }

  U.showEnemyBar = function (view) {
    const b = $('enemyBar');
    if (!view) { b.classList.add('hidden'); return; }
    b.classList.remove('hidden');
    $('eName').textContent = view.enemy_name;
    setBar('eHp', 'eTxt', view.enemy_hp, view.enemy_max_hp);
  };

  // -------------------------------------------------------------- dialog
  U.dialog = function (npc, text, options) {
    U.dialogOpen = true;
    NA.world.setHeld([]);
    $('dialog').classList.remove('hidden');
    $('dFace').style.backgroundImage = `url("${icon(npc.face)}")`;
    $('dName').textContent = npc.name;
    if (npc.title) $('dName').appendChild(el('small', '', npc.title));
    const opts = $('dOpts'); opts.textContent = '';
    const txt = $('dText'); txt.textContent = '';
    let i = 0;
    clearInterval(U.typeTimer);
    const showOpts = () => {
      clearInterval(U.typeTimer); U.typeTimer = null; txt.textContent = text; opts.textContent = '';
      options.forEach((o) => {
        const b = el('button', 'btn' + (o.primary ? ' primary' : ''), o.label); b.type = 'button';
        b.addEventListener('click', () => { NA.audio.sfx('ok'); o.run(); });
        opts.appendChild(b);
      });
    };
    U._skipType = showOpts;
    U.typeTimer = setInterval(() => { i += 2; txt.textContent = text.slice(0, i); if (i >= text.length) showOpts(); }, 22);
  };
  U.closeDialog = function () {
    clearInterval(U.typeTimer); U.typeTimer = null;
    $('dialog').classList.add('hidden'); U.dialogOpen = false;
  };
  $('dialog').addEventListener('click', (e) => { if (U.typeTimer && U._skipType && e.target.tagName !== 'BUTTON') U._skipType(); });

  // -------------------------------------------------------------- generic modal helpers
  const modals = ['menuModal', 'shopModal', 'pauseModal', 'settingsModal', 'confirmModal'];
  U.anyModal = () => modals.some((m) => !$(m).classList.contains('hidden')) || U.dialogOpen;
  U.open = (id) => { NA.world.setHeld([]); $(id).classList.remove('hidden'); NA.audio.sfx('open'); };
  U.close = (id) => { $(id).classList.add('hidden'); NA.audio.sfx('cancel'); };
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => U.close(b.dataset.close)));

  // -------------------------------------------------------------- item detail
  function itemDetail(it, qty) {
    const d = el('div', 'detail');
    d.appendChild(el('h4', '', it.name + (qty ? ' x' + qty : '')));
    d.appendChild(el('div', 'meta', `${it.rarity} ${it.type}${it.req_level > 1 ? ' - needs level ' + it.req_level : ''}`));
    d.appendChild(el('p', '', it.description));
    const bits = [];
    if (it.atk) bits.push(`+${it.atk} Attack`); if (it.def) bits.push(`+${it.def} Defense`);
    if (it.hp && it.type !== 'consumable') bits.push(`+${it.hp} Max HP`); if (it.mp && it.type !== 'consumable') bits.push(`+${it.mp} Max MP`);
    if (it.heal_hp) bits.push(`Restores ${it.heal_hp} HP`); if (it.heal_mp) bits.push(`Restores ${it.heal_mp} MP`);
    bits.forEach((b) => d.appendChild(el('div', 'stat', b)));
    if (it.sell) d.appendChild(el('div', 'meta', `Sells for ${it.sell} gold`));
    return d;
  }
  function cell(it, qty, selected, onClick) {
    const c = el('button', 'cell' + (it ? ' rar-' + it.rarity : ' empty') + (selected ? ' sel' : ''));
    c.type = 'button';
    if (it) {
      const im = el('img'); im.src = icon(it.icon); im.alt = it.name; c.appendChild(im);
      if (qty > 1) c.appendChild(el('em', '', qty));
      c.title = it.name; c.addEventListener('click', onClick);
    }
    return c;
  }

  // -------------------------------------------------------------- menu tabs
  U.openMenu = function (tab) {
    if (tab) U.menuTab = tab;
    U.open('menuModal'); U.renderMenu();
  };
  document.querySelectorAll('#menuTabs .tab').forEach((t) => t.addEventListener('click', () => { U.menuTab = t.dataset.tab; NA.audio.sfx('move'); U.renderMenu(); }));

  U.renderMenu = function () {
    document.querySelectorAll('#menuTabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === U.menuTab));
    const body = $('menuBody'); body.textContent = '';
    ({ inventory: renderBag, character: renderHero, quests: renderQuests, skills: renderSkills, settings: (b) => renderSettings(b) })[U.menuTab](body);
  };

  function renderBag(body) {
    const s = ST(), items = DEF().items;
    const wrap = el('div', 'split'); body.appendChild(wrap);
    const left = el('div'); wrap.appendChild(left);
    left.appendChild(el('div', 'meta', `Bag ${s.inventory.length}/30`));
    const grid = el('div', 'grid-items'); left.appendChild(grid);
    s.inventory.forEach((r) => grid.appendChild(cell(items[r.item_key], r.quantity, U.sel === r.item_key, () => { U.sel = r.item_key; NA.audio.sfx('move'); U.renderMenu(); })));
    for (let i = s.inventory.length; i < 30; i++) grid.appendChild(cell(null));
    const right = el('div'); wrap.appendChild(right);
    const row = s.inventory.find((r) => r.item_key === U.sel);
    if (!row) { right.appendChild(el('div', 'detail', 'Select an item.')); return; }
    const it = items[row.item_key];
    right.appendChild(itemDetail(it, row.quantity));
    const acts = el('div'); right.appendChild(acts);
    if (it.type === 'consumable') acts.appendChild(actBtn('Use', () => NA.main.useItem(it.item_key)));
    if (['weapon', 'armor', 'accessory'].includes(it.type)) acts.appendChild(actBtn('Equip', () => NA.main.equip(it.item_key), s.character.level < it.req_level));
  }
  function actBtn(label, fn, disabled) {
    const b = el('button', 'btn primary', label); b.type = 'button'; b.disabled = !!disabled; b.addEventListener('click', fn); return b;
  }

  function renderHero(body) {
    const s = ST(), c = s.character, items = DEF().items;
    const wrap = el('div', 'split'); body.appendChild(wrap);
    const left = el('div'); wrap.appendChild(left);
    const eq = el('div', 'equip-row'); left.appendChild(eq);
    ['weapon', 'armor', 'accessory'].forEach((slot) => {
      const k = s.equipment[slot], it = k ? items[k] : null;
      const box = el('div', 'equip-slot'); box.appendChild(el('div', '', slot));
      box.appendChild(cell(it, 0, U.sel === 'eq:' + slot, () => { U.sel = 'eq:' + slot; U.renderMenu(); }));
      if (!it) box.lastChild.classList.add('empty');
      eq.appendChild(box);
    });
    const t = el('table', 'stats-table'); left.appendChild(t);
    [['Name', c.name], ['Path', c.class_name], ['Level', c.level], ['Experience', c.xp_next ? `${c.xp} / ${c.xp_next}` : 'MAX'], ['Max HP', s.stats.max_hp], ['Max MP', s.stats.max_mp],
      ['Attack', s.stats.attack], ['Defense', s.stats.defense], ['Gold', c.gold], ['Story chapters', s.quests.filter((q) => q.kind === 'main' && q.state === 'complete').length + ' / ' + s.quests.filter((q) => q.kind === 'main').length]].forEach(([a, b]) => {
      const tr = el('tr'); tr.appendChild(el('td', '', a)); tr.appendChild(el('td', '', String(b))); t.appendChild(tr);
    });
    const right = el('div'); wrap.appendChild(right);
    const slot = (U.sel || '').startsWith('eq:') ? U.sel.slice(3) : null;
    const key = slot ? s.equipment[slot] : null;
    if (key) { right.appendChild(itemDetail(items[key])); right.appendChild(actBtn('Unequip', () => NA.main.unequip(slot))); }
    else right.appendChild(el('div', 'detail', 'Select an equipped item to inspect it. Equip gear from your Bag.'));
  }

  function renderQuests(body) {
    const qs = ST().quests, npcs = DEF().npcs;
    [['main', 'Main story'], ['side', 'Side quests']].forEach(([kind, title]) => {
      const g = el('div', 'qgroup'); g.appendChild(el('h4', '', title));
      const list = qs.filter((q) => q.kind === kind && q.state !== 'locked').sort((a, b) => a.sort - b.sort);
      if (!list.length) g.appendChild(el('p', 'meta', 'Nothing yet. Explore and speak to people.'));
      list.forEach((q) => {
        const r = el('div', 'qrow ' + q.state);
        r.appendChild(el('span', 'tag', { available: 'Available', active: 'In progress', ready: 'Ready to turn in', complete: 'Done' }[q.state]));
        r.appendChild(el('b', '', q.title));
        r.appendChild(el('p', '', q.summary));
        if (q.state === 'available') r.appendChild(el('p', '', `Speak to ${npcs[q.giver_npc].name}.`));
        if (q.state === 'active' || q.state === 'ready') {
          const bar = el('div', 'mini-bar'); const i = el('i'); i.style.width = Math.min(100, q.progress / q.target * 100) + '%'; bar.appendChild(i); r.appendChild(bar);
          r.appendChild(el('p', '', `${q.progress}/${q.target}` + (q.state === 'ready' ? ` - return to ${npcs[q.turn_in_npc].name}` : '')));
        }
        const rw = [`${q.reward.xp} XP`, `${q.reward.gold} gold`];
        if (q.reward.item) rw.push(`${q.reward.item_qty > 1 ? q.reward.item_qty + 'x ' : ''}${q.reward.item}`);
        if (q.reward.unlock) rw.push(`unlocks ${q.reward.unlock}`);
        r.appendChild(el('p', '', 'Reward: ' + rw.join(', ')));
        g.appendChild(r);
      });
      body.appendChild(g);
    });
  }

  function renderSkills(body) {
    const s = ST();
    Object.values(DEF().skills).sort((a, b) => a.slot - b.slot).forEach((sk) => {
      const own = s.skills.find((x) => x.skill_key === sk.skill_key && x.unlocked);
      const r = el('div', 'skill-row' + (own ? '' : ' locked'));
      const im = el('img'); im.src = icon(sk.icon); r.appendChild(im);
      const t = el('div'); t.appendChild(el('b', '', `${sk.name}  [${sk.slot === 1 ? 'Space' : sk.slot}]`));
      t.appendChild(el('small', '', sk.description));
      t.appendChild(el('small', '', own ? `Cost ${sk.mp_cost} MP - Cooldown ${(sk.cooldown_ms / 1000).toFixed(1)}s` : `Unlocks at level ${sk.unlock_level}`));
      r.appendChild(t); body.appendChild(r);
    });
  }

  // -------------------------------------------------------------- settings
  function renderSettings(host) {
    const set = NA.S.state ? NA.S.state.settings : { music_on: true, music_volume: 40, sfx_on: true, sfx_volume: 60 };
    host.textContent = '';
    const mk = (label, onKey, volKey) => {
      const row = el('div', 'range-row');
      const chk = el('label', 'check'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!set[onKey]; chk.appendChild(cb); chk.appendChild(document.createTextNode(label)); row.appendChild(chk);
      const rg = el('input'); rg.type = 'range'; rg.min = 0; rg.max = 100; rg.value = set[volKey]; row.appendChild(rg);
      const apply = () => { set[onKey] = cb.checked; set[volKey] = parseInt(rg.value, 10); NA.audio.configure(set); NA.main.saveSettings(); };
      cb.addEventListener('change', apply); rg.addEventListener('input', apply);
      host.appendChild(row);
    };
    mk('Music', 'music_on', 'music_volume'); mk('Sound effects', 'sfx_on', 'sfx_volume');
    host.appendChild(el('p', 'meta', 'Controls: Arrows/WASD move, E interact, Space strike, 1-4 skills, H/G potions, I bag, J quests, Esc pause.'));
  }
  U.openSettings = function () { renderSettings($('settingsBody')); U.open('settingsModal'); };

  // -------------------------------------------------------------- shop
  U.openShop = function (npc, stock) {
    U.shop = { npc, stock, tab: 'buy' };
    $('shopTitle').textContent = npc.name + "'s wares";
    U.open('shopModal'); renderShop();
  };
  document.querySelectorAll('#shopTabs .tab').forEach((t) => t.addEventListener('click', () => { if (U.shop) { U.shop.tab = t.dataset.tab; renderShop(); } }));
  U.refreshShop = () => { if (U.shop && !$('shopModal').classList.contains('hidden')) renderShop(); };

  function renderShop() {
    const sh = U.shop, s = ST(), items = DEF().items, body = $('shopBody');
    document.querySelectorAll('#shopTabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === sh.tab));
    $('shopGold').textContent = s.character.gold;
    body.textContent = '';
    const rows = sh.tab === 'buy'
      ? sh.stock.map((k) => ({ it: items[k], qty: 0 }))
      : s.inventory.map((r) => ({ it: items[r.item_key], qty: r.quantity })).filter((r) => r.it.sell > 0);
    if (!rows.length) body.appendChild(el('p', 'meta', sh.tab === 'buy' ? 'Nothing for sale.' : 'You have nothing they want.'));
    rows.forEach(({ it, qty }) => {
      const r = el('div', 'shop-row');
      const im = el('img'); im.src = icon(it.icon); r.appendChild(im);
      const info = el('div', 'info'); info.appendChild(el('b', '', it.name + (qty ? ' x' + qty : '')));
      const bits = [];
      if (it.atk) bits.push(`+${it.atk} ATK`); if (it.def) bits.push(`+${it.def} DEF`); if (it.hp && it.type !== 'consumable') bits.push(`+${it.hp} HP`);
      if (it.heal_hp) bits.push(`heals ${it.heal_hp} HP`); if (it.heal_mp) bits.push(`+${it.heal_mp} MP`); if (it.req_level > 1) bits.push(`Lv ${it.req_level}`);
      info.appendChild(el('small', '', bits.join('  ') || it.description)); r.appendChild(info);
      const price = sh.tab === 'buy' ? it.buy : it.sell;
      r.appendChild(el('div', 'price', price + ' g'));
      if (sh.tab === 'buy') {
        const b = el('button', 'btn small primary', 'Buy'); b.type = 'button'; b.disabled = s.character.gold < price;
        b.addEventListener('click', () => NA.main.shopBuy(sh.npc.npc_key, it.item_key, 1)); r.appendChild(b);
      } else {
        const b1 = el('button', 'btn small', 'Sell 1'); b1.type = 'button'; b1.addEventListener('click', () => NA.main.shopSell(sh.npc.npc_key, it.item_key, 1)); r.appendChild(b1);
        if (qty > 1) { const b2 = el('button', 'btn small', 'All'); b2.type = 'button'; b2.addEventListener('click', () => NA.main.shopSell(sh.npc.npc_key, it.item_key, qty)); r.appendChild(b2); }
      }
      body.appendChild(r);
    });
  }

  // -------------------------------------------------------------- confirm
  U.confirm = function (title, text, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      $('confirmTitle').textContent = title; $('confirmText').textContent = text; $('confirmMsg').textContent = '';
      const inp = $('confirmInput'); inp.value = ''; inp.classList.toggle('hidden', !opts.password);
      $('confirmYes').textContent = opts.yes || 'Confirm';
      $('confirmModal').classList.remove('hidden'); if (opts.password) inp.focus();
      const done = (v) => { $('confirmModal').classList.add('hidden'); $('confirmYes').onclick = $('confirmNo').onclick = null; resolve(v); };
      $('confirmYes').onclick = async () => {
        const val = opts.password ? (inp.value || null) : true;
        if (opts.password && !val) { U.confirmError('Enter your password to confirm.'); return; }
        if (opts.validate) { const err = await opts.validate(val); if (err) { U.confirmError(err); return; } }
        done(val);
      };
      $('confirmNo').onclick = () => done(null);
    });
  };
  U.confirmError = (m) => { $('confirmMsg').textContent = m; };
})();
