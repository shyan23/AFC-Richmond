// AFC Richmond — headless simulation core (no DOM).
// Ordinary agents (noisy kicks, slow, myopic) vs a well-organized league defense.
// Swarm mode = Boids (Reynolds 1987) + ACO stigmergy (Dorigo 1992) + PSO (Kennedy & Eberhart 1995).

'use strict';

(function (root, factory) {
  const API = factory(
    typeof module !== 'undefined' && module.exports ? require('./src/engine') : root.SSSEngine
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (root) root.SSS = API;
})(typeof window !== 'undefined' ? window : null, function (engine) {
  if (!engine) return {};
  return {
    Sim: engine.Sim,
    kickSigma: engine.kickSigma,
    mulberry32: engine.mulberry32,
    W: engine.W,
    H: engine.H,
    GOAL_Y1: engine.GOAL_Y1,
    GOAL_Y2: engine.GOAL_Y2,
    PH_COLS: engine.PH_COLS,
    PH_ROWS: engine.PH_ROWS,
    KICK_RANGE: engine.KICK_RANGE,
  };
});