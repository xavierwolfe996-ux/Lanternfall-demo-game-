/* The order in which the playtest bot plays the CURRENT content. Edit this when the story changes. */
exports.run = async (B) => {
  const { accept, turnIn, hunt, levelTo, shop, load, questMap, inv, note } = B;
  const ready = (k) => async () => questMap(await load())[k].state === 'ready';
  const both = (...fs) => async () => { for (const f of fs) if (!(await f())) return false; return true; };
  const have = (item, n) => async () => inv(await load(), item) >= n;

  // Chapter 1: Lantern Trail (levels 1-3)
  await accept('trail_trouble'); await accept('honey_for_mei'); await accept('haru_wagon');
  await hunt('bamboo_sprite', both(ready('trail_trouble'), have('wild_honey', 4), have('bamboo_shoot', 5)));
  await turnIn('trail_trouble'); await turnIn('honey_for_mei'); await turnIn('haru_wagon'); await shop('haru');
  await levelTo(3, ['bamboo_sprite', 'bamboo_yellow']);
  await accept('sora_trial'); await hunt('bamboo_yellow', ready('sora_trial')); await turnIn('sora_trial'); await shop('haru');
  // Chapter 2: Bamboo Grove (levels 3-5)
  await levelTo(4, ['bamboo_sprite', 'spirit']);
  await accept('whispers_in_bamboo'); await accept('shoot_gathering');
  await hunt('spirit', both(ready('whispers_in_bamboo'), have('bamboo_shoot', 6)));
  await turnIn('whispers_in_bamboo'); await turnIn('shoot_gathering'); await shop('kenji');
  await levelTo(5, ['spirit']);
  await accept('mushroom_menace'); await accept('camp_stew');
  await hunt('mushroom', both(ready('mushroom_menace'), have('mushroom_cap', 4)));
  await turnIn('mushroom_menace'); await turnIn('camp_stew'); await shop('kenji');
  // Chapter 3: Misty Marsh (levels 5-7)
  await levelTo(6, ['spirit', 'mushroom']);
  await accept('marsh_jelly'); await shop('ume');
  await hunt('slime', ready('marsh_jelly')); await turnIn('marsh_jelly');
  await levelTo(7, ['slime']);
  await accept('snake_hunt'); await accept('slime_king'); await hunt('snake', ready('snake_hunt')); await turnIn('snake_hunt'); await shop('ume');
  for (let a = 0; a < 6 && questMap(await load()).slime_king.state !== 'ready'; a++) {
    await hunt('giant_slime', async () => questMap(await load()).slime_king.state === 'ready');
    if (questMap(await load()).slime_king.state !== 'ready') { note('retrying the Slime King after leveling'); await levelTo((await load()).character.level + 1, ['snake']); await shop('ume'); }
  }
  await turnIn('slime_king');
  // Chapter 4: Shadow Ridge (levels 7-9)
  await levelTo(8, ['snake', 'slime']); await shop('ume');
  await accept('ridge_scout'); await accept('bone_collector');
  await hunt('skull', both(ready('ridge_scout'), have('skull_shard', 4)));
  await turnIn('ridge_scout'); await turnIn('bone_collector');
  await accept('frost_hunt'); await hunt('skull_blue', ready('frost_hunt')); await turnIn('frost_hunt');
  await levelTo(10, ['skull', 'skull_blue']);
  await shop('ume', 6); await accept('bamboo_tyrant');
  for (let attempt = 0; attempt < 6 && !B.report.cleared; attempt++) {
    await hunt('giant_bamboo', async () => !!B.report.cleared);
    if (!B.report.cleared) { note('retrying the Tyrant after leveling'); await levelTo((await load()).character.level + 1, ['skull_blue']); await shop('ume', 7); }
  }
};
