# Ninja Adventure RPG (static version: HTML + CSS + JavaScript only)

No PHP, no MySQL, no server. Everything runs in the browser and uses the *Ninja Adventure* asset pack.

## Run it

**Easiest:** unzip, then double-click `index.html`. It works offline.

If your browser blocks something when opened from a file, serve the folder instead (any one of these):

```
python3 -m http.server 8000      # then open http://localhost:8000
npx serve .
```

You can also upload the folder to any static host (GitHub Pages, Netlify, itch.io, ...).

## How saving and accounts work (important)

* Accounts and saves are stored in your browser's **localStorage**, on **this device and browser only**.
  They do not follow you to another computer or browser.
* Each account has its own separate save. Two people can share one browser with two accounts and their
  progress stays separate (levels, items, gold, quests, unlocked areas, position, settings).
* Progress is saved automatically (every couple of seconds while you move, and on every fight, purchase,
  quest and shrine rest). Closing the tab and coming back keeps your save; you may need to sign in again.
* Passwords are stored as salted PBKDF2 hashes. This only separates profiles on the same device. **It is not
  security**: there is no server, so anyone with this browser's developer tools can edit or delete saves.
  Do not reuse a real password here.
* **Clearing site data / cookies, private browsing, or switching browser removes or hides saves.**
  To back up a save, copy the value of the `ninja_adventure_rpg_db_v1` key from your browser's
  developer tools (Application / Storage -> Local Storage).
* All game rules (combat, XP, loot, prices, quest rewards, cooldowns) still run inside `js/server.js`
  as one module, so they behave consistently, but a determined player can of course tamper with their own save.

## Game length

Designed as a **roughly 30-minute game** from a new character to the ending (the Bamboo Tyrant).
Measured with a scripted test player (`node tests/playtest_bot.js`, run through the real game rules with a fake clock):

| Player style | Time to the ending |
|---|---|
| Sharp player (fast reactions, no wandering) | about 21 minutes |
| Relaxed first-time player (`CASUAL=1 node tests/playtest_bot.js`) | about 30 minutes |

Real people will vary: reading every dialogue, exploring, dying and retrying all add time. The clear time shown on the
ending screen is your own play time. Lanternfall Town and its epilogue quests come after that.

## Game

* Sign in / create account, character creation (3 paths, 6 looks), title screen with Continue / New Game / Settings / Logout
* **5 areas:** Lantern Trail, Bamboo Grove, **Misty Marsh**, Shadow Ridge, and Lanternfall Town (after the ending). Areas open through quests and level.
* **13 NPCs, 20 quests** (9 main story, 11 side), journal and tracker, 5 shops (buy and sell), a rest-and-save shrine in every area
* **10 enemy types:** Bamboo Sprite, Yellow Sprite, Wandering Spirit, Marching Mushroom, Marsh Slime, Reed Snake, Restless Skull, Frost Skull, plus two bosses:
  the **Slime King** (mid-boss, opens Shadow Ridge) and the **Bamboo Tyrant** (final boss)
* **An ending:** when the Bamboo Tyrant falls you get a victory screen with your clear time (minutes and seconds), level, gold and defeats. The time is saved and shown on the title screen and the Hero tab. You can keep playing afterwards.
* Lanternfall Town: a safe town with houses, a market, a blacksmith, an alchemist, an innkeeper, the mayor, an elder and a child, plus an epilogue story and new gear
* Real-time combat: 4 skills with mana cost and cooldown, loot, XP, levels 1-20, potions and healing mid-fight matter on the bosses
* Bag (30 slots), equipment (weapon / armour / accessory), stats, pause menu, music/sound settings, keyboard and touch controls

### Controls

| Action | Keyboard | Touch |
|---|---|---|
| Move | Arrows / WASD | on-screen d-pad |
| Interact (talk, gate, shrine) | E or Enter | **E** button |
| Strike | Space or 1 | sword button |
| Skills | 2 Power Strike, 3 Fire Burst, 4 Healing Breath | tap skill icons |
| Potions | H healing, G mana | tap item slots |
| Bag / Quests / Skills / Hero | I / J / K / M | menu button |
| Pause | Esc or P | menu button |

**On phones and tablets** the layout adapts to portrait and landscape: the hero card (HP / MP / XP), enemy bar and quest tracker stack down the
left, the d-pad and **E** / sword buttons sit above the skill bar, and notches and home-bar areas are respected. Tap the **Quests** header to
collapse or expand the quest tracker (the choice is remembered on that device). Portrait view is zoomed out a little so more of the map is visible.

Suggested path: Master Sora (`!`) on Lantern Trail -> The Yellow Trial -> gate east to the Bamboo Grove -> Kenji's quests ->
the gate east to the Misty Marsh (level 6) -> Sage Ren and the Slime King -> gate east to Shadow Ridge (level 8) -> Captain Daichi ->
the Bamboo Tyrant (level 10 recommended, bring elixirs) = **the ending** -> the gate at the east end of the ridge -> Lanternfall Town and its epilogue.
Side quests give gear, elixirs and XP, and help you reach the level gates. Rest at a shrine to heal and set your respawn point.
The bosses stay defeated once beaten, and defeating a boss counts for its quest even if you did it before accepting the quest.
If you are defeated you wake at your last shrine and lose 10% of your gold.

## Files

```
index.html            game page
css/game.css          RPG UI theme
js/
  data.js             items, enemies, skills, NPCs, quests, areas, shops  (edit to add content)
  maps.js             tile maps (generated by tools/build_maps.py)
  server.js           the rules + accounts + save data (localStorage)
  api.js              tiny bridge between the game and server.js
  assets.js audio.js  asset loading, music and sound
  world.js            map drawing, movement, collision, enemies, effects
  combat.js ui.js main.js   combat client, HUD/menus/dialogs/shop, game flow and input
assets/               the original asset pack (unchanged)
tools/build_maps.py   regenerate js/maps.js (python3, optional); tools/layout.py holds the enemy spawn positions
tests/                test_server.js, check_assets.js, playtest_bot.js + playtest_plan.js (node, optional)
docs/ASSETS.md        which assets are used and how
```

## Adding content

Edit `js/data.js`: add entries to `item_defs`, `enemy_defs` (+ `enemy_spawns`), `skill_defs`, `npc_defs`,
`quest_defs`, `shop_stock`. Keep the same field names as the existing entries. Asset paths are relative to
`assets/Ninja Adventure - Asset Pack/`. New maps: add an entry to `AREAS` in `tools/build_maps.py`, run it, then add
the area in `area_defs` and its gates in `area_portals`.

## Tests (optional, need Node 18+)

```
node tests/test_server.js     # 112 rule checks with several accounts
node tests/check_assets.js    # every asset path in data.js exists
node tests/playtest_bot.js    # simulated playthrough: estimates the time to the ending (add CASUAL=1 for a relaxed player)
```

## What was actually tested

* `test_server.js`: 112 checks passed (including the quest chain and level gates, the Slime King mid-boss, the boss-before-quest fix, the ending clear time, the town gate and the blacksmith) - registration/login, two isolated accounts, tamper attempts rejected
  (teleport, walls, unlearned skills, far-away shops/enemies, client-supplied prices), a full quest (walk, talk,
  3 fights, loot, turn-in, reward once only, area unlock, level-up, skill unlock), shop and equipment,
  persistence across logout/login, New Game wiping only the caller, defeat/respawn with gold loss, area travel and locks.
* In headless Chromium opened from `file://`: register, create character, walk, talk, accept quest, fight and loot,
  reload the page (title screen showed the saved level/class), open the quest journal, sign out, register a second
  account that started fresh. No console errors.
* Also run in headless Chromium: a real keyboard-driven fight with the (now much tougher) Bamboo Tyrant using potions, the ending screen with the clear time, the new gate, a walk through Lanternfall Town, and screenshots of the Misty Marsh, the Slime King and Shadow Ridge.
* The 30-minute estimate comes from a scripted player, not from real people. If it feels too short or too long, tune enemy HP/attack in `js/data.js` and re-run `node tests/playtest_bot.js`.
* The UI/engine code is the same as the earlier PHP version, which was also checked on a phone-sized landscape screen,
  the shop, hero and pause menus, and the boss area.

## Known limitations

* Not tested: Safari, real touch devices, audible music/SFX (headless browser has no audio), very old browsers
  (without WebCrypto it falls back to a weak password hash).
* Single device, single character per account, no password reset, no cloud save.
* Enemy movement is simulated in the page; reach and cooldown limits are checked but this is a local game, not an
  anti-cheat system.
* Browsers block audio until the first click or key press.
* The PHP/SQL version of the game was not updated with the ending and the town; this static version is the up-to-date one.
* Older saves are upgraded automatically: if you had already beaten the Tyrant, the town is unlocked and the game counts as cleared (no clear time was recorded for that run).
* The clear time is your total play time in the game up to the Tyrant's defeat (time with the pause menu open counts too).
* The boss uses only its idle animation. *Healing Breath* only works during a fight (use items or the shrine otherwise).
