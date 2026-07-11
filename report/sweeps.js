// Parameter sweeps for lab report graphs. node sweeps.js > sweeps.txt
'use strict';
const { Sim } = require('../sim.js');
const SEEDS = [3, 4, 5], EP = 100;

function run(mode, opts) {
  let g = 0, sh = 0, sot = 0, pc = 0, pa = 0;
  for (const seed of SEEDS) {
    const s = new Sim(Object.assign({ mode, seed }, opts)).runEpisodes(EP);
    g += s.goals; sh += s.shots; sot += s.shotsOnTarget; pc += s.passComplete; pa += s.passAttempt;
  }
  return { g, sh, sot, pcr: pa ? (100 * pc / pa) : 0 };
}

console.log('== kick noise sweep (goals/300) ==');
for (const n of [0.5, 0.75, 1.0, 1.5, 2.0, 3.0]) {
  const a = run('swarm', { kickNoise: n }), b = run('selfish', { kickNoise: n });
  console.log(`noise=${n} swarm=${a.g} selfish=${b.g} swarmPass=${a.pcr.toFixed(1)}`);
}

console.log('== evaporation sweep (swarm goals/300) ==');
for (const e of [0, 0.0005, 0.0015, 0.005, 0.02, 0.08]) {
  const a = run('swarm', { evap: e });
  console.log(`evap=${e} swarm=${a.g} pass=${a.pcr.toFixed(1)}`);
}

console.log('== team size sweep (goals/300) ==');
for (const n of [4, 6, 8, 10, 12]) {
  const a = run('swarm', { nPlayers: n }), b = run('selfish', { nPlayers: n });
  console.log(`n=${n} swarm=${a.g} selfish=${b.g}`);
}

console.log('== defender skill sweep (goals/300) ==');
for (const k of [0.7, 0.85, 1.0, 1.15, 1.3]) {
  const a = run('swarm', { defSkill: k }), b = run('selfish', { defSkill: k });
  console.log(`skill=${k} swarm=${a.g} selfish=${b.g}`);
}

console.log('== cumulative goals over episodes (3-seed sum) ==');
for (const mode of ['swarm', 'selfish']) {
  const hist = new Array(EP).fill(0);
  for (const seed of SEEDS) {
    const s = new Sim({ mode, seed });
    s.runEpisodes(EP);
    s.stats.epHistory.forEach((v, i) => { if (i < EP) hist[i] += v; });
  }
  let cum = 0;
  const pts = hist.map((v, i) => { cum += v; return `(${i + 1},${cum})`; });
  console.log(`${mode}: ${pts.filter((_, i) => i % 5 === 4 || i === 0).join(' ')}`);
}

console.log('== headline stats ==');
const a = run('swarm', {}), b = run('selfish', {});
console.log(`swarm: goals=${a.g} shots=${a.sh} onTarget=${a.sot} pass=${a.pcr.toFixed(1)}%`);
console.log(`selfish: goals=${b.g} shots=${b.sh} onTarget=${b.sot} pass=${b.pcr.toFixed(1)}%`);
