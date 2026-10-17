/* Asset loading + sprite helpers for the Ninja Adventure pack. */
(function () {
  'use strict';
  const NA = (window.NA = window.NA || {});
  const PACK = 'assets/Ninja Adventure - Asset Pack/';
  const cache = new Map();
  const DIR = { down: 0, up: 1, left: 2, right: 3 };

  NA.assets = {
    PACK, DIR,
    url(rel) { return encodeURI(PACK + rel); },
    img(rel) {
      if (!cache.has(rel)) {
        const im = new Image();
        im.decoding = 'async';
        im.src = NA.assets.url(rel);
        im.ready = new Promise((res) => { im.onload = () => res(im); im.onerror = () => { im.failed = true; res(im); }; });
        cache.set(rel, im);
      }
      return cache.get(rel);
    },
    async preload(list) { await Promise.all(list.map((p) => NA.assets.img(p).ready)); },
    ok(im) { return im && im.complete && im.naturalWidth > 0 && !im.failed; },
  };

  // Tileset source rectangles (all inside the original pack sheets).
  const FIELD = 'Backgrounds/Tilesets/TilesetField.png';
  const NATURE = 'Backgrounds/Tilesets/TilesetNature.png';
  const ELEMENT = 'Backgrounds/Tilesets/TilesetElement.png';
  const WATER = 'Backgrounds/Tilesets/TilesetWater.png';
  NA.tiles = {
    sheets: { field: FIELD, nature: NATURE, element: ELEMENT, water: WATER },
    ground: {
      g: [[FIELD, 16, 64], [FIELD, 16, 64], [FIELD, 16, 64], [FIELD, 48, 48]],
      d: [[FIELD, 16, 112], [FIELD, 16, 112], [FIELD, 16, 112], [FIELD, 48, 96]],
      p: [[FIELD, 16, 16], [FIELD, 16, 16], [FIELD, 48, 0]],
      w: [[WATER, 16, 16]],
    },
    // prop type -> [sheet, sx, sy, sw, sh]
    props: {
      tree: [NATURE, 0, 0, 32, 32], pine: [NATURE, 32, 0, 32, 32], dead: [NATURE, 64, 0, 32, 32], round: [NATURE, 256, 0, 32, 32],
      grayrock: [NATURE, 256, 80, 64, 48], brownrock: [NATURE, 192, 80, 64, 48],
      bush: [NATURE, 0, 160, 16, 16], flower: [NATURE, 0, 176, 16, 16], flower2: [NATURE, 16, 176, 16, 16],
      tuft: [NATURE, 48, 160, 16, 16], tuft2: [NATURE, 64, 160, 16, 16], sign: [ELEMENT, 80, 32, 16, 16],
    },
  };

  /** Draw one 16x16 frame from a 4-column character/monster sheet (columns = direction, rows = frame). */
  NA.drawChar = function (ctx, im, dir, row, x, y, size) {
    if (!NA.assets.ok(im)) return;
    ctx.drawImage(im, (DIR[dir] || 0) * 16, row * 16, 16, 16, Math.round(x), Math.round(y), size || 16, size || 16);
  };
})();
