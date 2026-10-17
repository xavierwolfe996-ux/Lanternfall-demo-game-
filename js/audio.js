/* Music + sound effects using the pack's own audio files. */
(function () {
  'use strict';
  const NA = (window.NA = window.NA || {});
  const S = 'Audio/Sounds/';
  const SFX = {
    slash: S + 'Whoosh & Slash/Slash.wav', slash2: S + 'Whoosh & Slash/Slash2.wav', hit: S + 'Hit & Impact/Hit1.wav',
    hurt: S + 'Hit & Impact/Hit5.wav', fire: S + 'Elemental/Fireball.wav', heal: S + 'Magic & Skill/Heal.wav',
    magic: S + 'Magic & Skill/Magic1.wav', coin: S + 'Bonus/Coin.wav', levelup: 'Audio/Jingles/LevelUp1.wav',
    victory: 'Audio/Jingles/Success1.wav', quest: 'Audio/Jingles/Success2.wav', gameover: 'Audio/Jingles/GameOver.wav',
    ok: S + 'Menu/Accept.wav', open: S + 'Menu/Accept2.wav', cancel: S + 'Menu/Cancel.wav', move: S + 'Menu/Move1.wav',
    equip: S + 'Bonus/PowerUp1.wav', unlock: 'Audio/Jingles/Secret1.wav', buy: S + 'Bonus/Bonus.wav',
  };
  const st = { music: null, track: '', musicOn: true, musicVol: 0.4, sfxOn: true, sfxVol: 0.6, wantPlay: false };

  function applyMusic() {
    if (!st.music) return;
    st.music.volume = Math.max(0, Math.min(1, st.musicVol));
    if (st.musicOn && st.wantPlay) st.music.play().catch(() => {});
    else st.music.pause();
  }
  NA.audio = {
    configure(s) {
      st.musicOn = !!s.music_on; st.musicVol = s.music_volume / 100;
      st.sfxOn = !!s.sfx_on; st.sfxVol = s.sfx_volume / 100;
      applyMusic();
    },
    music(rel) {
      st.wantPlay = !!rel;
      if (!rel) { applyMusic(); return; }
      if (st.track !== rel) {
        if (st.music) st.music.pause();
        st.music = new Audio(NA.assets.url(rel));
        st.music.loop = true;
        st.track = rel;
      }
      applyMusic();
    },
    sfx(name) {
      if (!st.sfxOn || !SFX[name]) return;
      const a = new Audio(NA.assets.url(SFX[name]));
      a.volume = Math.max(0, Math.min(1, st.sfxVol));
      a.play().catch(() => {});
    },
    /** Browsers block audio until the first click/keypress; call this from a user gesture. */
    unlock() { applyMusic(); },
  };
  ['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, () => NA.audio.unlock(), { passive: true }));
})();
