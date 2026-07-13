'use strict';

(function (root, factory) {
  const API = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (root) root.SSSPhysics = API;
})(typeof window !== 'undefined' ? window : null, function () {
  const W = 100, H = 64;
  const GOAL_Y1 = 24, GOAL_Y2 = 40, GOAL_C = 32;
  const KICK_RANGE = 30;
  const TEAM_SPEED = 0.5, DRIBBLE_SPEED = 0.38;
  const BALL_SPEED = 1.7;
  const SHOT_SPEED = 2.6;
  const VISION_DEFAULT = 15;
  const EP_MAX_TICKS = 1200;
  const PH_COLS = 25, PH_ROWS = 16;
  const CELL_W = W / PH_COLS, CELL_H = H / PH_ROWS;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function kickSigma(d, noise) { return 0.011 * d * noise; }
  function dist(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    if (L2 === 0) return dist(px, py, ax, ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    return dist(px, py, ax + t * dx, ay + t * dy);
  }

  return {
    W: W, H: H, GOAL_Y1: GOAL_Y1, GOAL_Y2: GOAL_Y2, GOAL_C: GOAL_C,
    KICK_RANGE: KICK_RANGE, TEAM_SPEED: TEAM_SPEED, DRIBBLE_SPEED: DRIBBLE_SPEED,
    BALL_SPEED: BALL_SPEED, SHOT_SPEED: SHOT_SPEED, VISION_DEFAULT: VISION_DEFAULT,
    EP_MAX_TICKS: EP_MAX_TICKS, PH_COLS: PH_COLS, PH_ROWS: PH_ROWS,
    CELL_W: CELL_W, CELL_H: CELL_H,
    mulberry32: mulberry32, kickSigma: kickSigma, dist: dist, segDist: segDist,
  };
});
