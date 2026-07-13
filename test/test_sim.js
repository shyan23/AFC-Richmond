// node test_sim.js — smallest checks that fail if the thesis breaks.
'use strict';
const assert = require('assert');
const { Sim, kickSigma } = require('../sim.js');
const { chooseHolderAction, computeOffBallForce } = require('../src/controllers.js');

// 1. physics premise: aim error grows with distance
assert(kickSigma(25, 1) > kickSigma(8, 1) * 2, 'kick error must grow with distance');

// 2. pheromone evaporates
{
  const s = new Sim({ seed: 1, evap: 0.01 });
  s.pher[10] = 1.0;
  for (let i = 0; i < 100; i++) s.evaporate();
  assert(s.pher[10] < 0.4, 'pheromone should evaporate');
}

// 3. determinism: same seed, same outcome
{
  const a = new Sim({ mode: 'swarm', seed: 7 }).runEpisodes(30);
  const b = new Sim({ mode: 'swarm', seed: 7 }).runEpisodes(30);
  assert.strictEqual(a.goals, b.goals, 'seeded runs must match');
}

// 4. THE claim: bad individuals, good collective — swarm scores, selfish barely does.
// Aggregated over 3 seeds so one lucky/unlucky seed can't flip the verdict.
{
  const EP = 100, SEEDS = [3, 4, 5];
  let swarm = 0, selfish = 0, passC = 0, passA = 0;
  for (const seed of SEEDS) {
    const a = new Sim({ mode: 'swarm', seed }).runEpisodes(EP);
    const b = new Sim({ mode: 'selfish', seed }).runEpisodes(EP);
    swarm += a.goals; selfish += b.goals;
    passC += a.passComplete; passA += a.passAttempt;
  }
  const total = EP * SEEDS.length;
  console.log(`selfish: ${selfish}/${total} goals, swarm: ${swarm}/${total} goals`);
  console.log(`swarm pass completion: ${(passC / Math.max(1, passA) * 100).toFixed(1)}%`);
  assert(swarm >= 15 && swarm >= 5 * Math.max(1, selfish),
    `swarm (${swarm}) must clearly beat selfish (${selfish})`);
}

console.log('all tests pass');
