# Asset usage

All assets come from `assets/Ninja Adventure - Asset Pack/` and are **never modified**.
Paths below are relative to that folder. The paths are listed in `js/data.js`; they were all verified to exist on disk.


| Use | Asset(s) | How it is read |
|---|---|---|
| Ground | `Backgrounds/Tilesets/TilesetField.png` (flat tiles at 16,64 / 16,112 / 16,16 and variants), `TilesetWater.png` (16,16) | 16x16 slices drawn once into an offscreen canvas |
| Trees, rocks, bushes, flowers | `TilesetNature.png` | rectangle table in `js/assets.js` (`NA.tiles.props`) |
| Signposts | `TilesetElement.png` | same table |
| Player and NPC sprites | `Actor/Character/<Name>/SpriteSheet.png` (64x112) | columns = direction (down, up, left, right), rows = frames (0-3 walk, 4 attack) |
| Portraits | `Actor/Character/<Name>/Faceset.png`, `Actor/Monster/*/Faceset.png` | CSS background in HUD and dialog |
| Monsters | `Actor/Monster/{Bamboo,Spirit,Skull}/SpriteSheet.png` (64x64) | same layout as characters |
| Boss | `Actor/Boss/GiantBamboo/Idle.png` (372x62) | 6 frames of 62x62 |
| Effects | `FX/Attack/Cut` (4x 32x32), `FX/Elemental/Flam` (5x 40x30), `FX/Magic/Aura` (5x 25x24) | frame tables in `js/world.js` |
| Item icons | `Items/...` and `Ui/Skill Icon/...` | `<img>` with pixelated scaling |
| Skill icons | `Ui/Skill Icon/Spell/*`, `Items & Weapon/Kunai.png` | skill bar |
| UI font | `Ui/Font/NormalFont.ttf` | `@font-face` in `css/game.css` |
| Music | `Audio/Musics/{4 - Village, 37 - Dark Forest, 28 - Tension, 38 - Intro}.ogg` | one looping track per area / title |
| SFX | `Audio/Sounds/*` and `Audio/Jingles/*` (list in `js/audio.js`) | played on events |

Fallbacks: if an image fails to load the engine skips drawing it (nothing crashes); if a sound fails it stays silent.
No asset required by the game is missing from the pack. The pack's own README/licence files are left in place.
