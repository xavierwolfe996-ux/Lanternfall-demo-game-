/* Verifies every asset path in js/data.js exists.   Run: node tests/check_assets.js */
const fs = require('fs'), path = require('path');
globalThis.window = globalThis;
require('../js/data.js');
const D = globalThis.NA_DATA, pack = path.join(__dirname, '../assets/Ninja Adventure - Asset Pack/');
const paths = new Set();
Object.values(D.item_defs).forEach((i) => paths.add(i.icon));
Object.values(D.enemy_defs).forEach((e) => { paths.add(e.sprite_path); if (e.face_path) paths.add(e.face_path); });
Object.values(D.npc_defs).forEach((n) => { paths.add(n.sprite_path); paths.add(n.face_path); });
Object.values(D.skill_defs).forEach((s) => paths.add(s.icon));
Object.values(D.area_defs).forEach((a) => a.music && paths.add(a.music));
['NinjaGreen', 'NinjaBlue2', 'NinjaRed', 'NinjaDark', 'NinjaYellow', 'NinjaGray'].forEach((k) => { paths.add(`Actor/Character/${k}/SpriteSheet.png`); paths.add(`Actor/Character/${k}/Faceset.png`); });
let bad = 0;
paths.forEach((p) => { if (!fs.existsSync(pack + p)) { bad++; console.log('MISSING', p); } });
console.log(bad ? bad + ' missing' : 'OK - all ' + paths.size + ' asset paths exist');
process.exit(bad ? 1 : 0);
