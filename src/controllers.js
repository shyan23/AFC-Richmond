'use strict';

(function (root, factory) {
  const API = factory(
    typeof module !== 'undefined' && module.exports ? require('./physics') : root.SSSPhysics
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (root) root.SSSControllers = API;
})(typeof window !== 'undefined' ? window : null, function (physics) {
  const { W, H, GOAL_C, KICK_RANGE, TEAM_SPEED, DRIBBLE_SPEED, dist } = physics;

  function chooseHolderAction(sim) {
    const h = sim.players[sim.ball.holder];
    const dGoal = dist(h.x, h.y, W, GOAL_C);
    sim.holdTicks++;

    if (sim.mode === 'selfish') {
      if (dGoal < KICK_RANGE) { sim.kick(W, sim.shootTargetY(), true, -1); return; }
      const ang = Math.atan2(GOAL_C - h.y, W - h.x);
      h.x += Math.cos(ang) * DRIBBLE_SPEED;
      h.y += Math.sin(ang) * DRIBBLE_SPEED;
      sim.ball.x = h.x;
      sim.ball.y = h.y;
      return;
    }

    const pressed = sim.defenders.some(d => dist(d.x, d.y, h.x, h.y) < 5);
    const inShotRange = dGoal < KICK_RANGE * sim.shootGate;
    if (sim.holdTicks < 3 && !pressed && !inShotRange) {
      sim.ball.x = h.x; sim.ball.y = h.y; return;
    }

    if (inShotRange) {
      const ty = sim.shootTargetY();
      const open = sim.laneOpenness(h.x, h.y, W, ty);
      if (open > 0.25 || dGoal < 12 || sim.holdTicks > 12 || pressed) { sim.kick(W, ty, true, -1); return; }
    }

    const cands = [];
    let wSum = 0, bestScore = 0;
    for (let i = 0; i < sim.players.length; i++) {
      if (i === sim.ball.holder) continue;
      const p = sim.players[i];
      const d = dist(h.x, h.y, p.x, p.y);
      if (d > KICK_RANGE || d < 3) continue;
      const open = sim.laneOpenness(h.x, h.y, p.x, p.y);
      const pher = Math.min(1, sim.pherAlong(h.x, h.y, p.x, p.y));
      const progress = (p.x - h.x) / KICK_RANGE;
      const short = 1 - d / KICK_RANGE;
      const score = Math.max(0.01,
        (0.4 + pher) * (0.45 + 0.55 * open) * (1 + 1.6 * progress + 0.4 * short + 0.6 * (p.x / W)));
      const w = score * score;
      cands.push({ i, p, w });
      wSum += w;
      if (score > bestScore) bestScore = score;
    }

    if (cands.length && (pressed || sim.holdTicks > 16 || bestScore > 0.45)) {
      let pick = sim.rng() * wSum, chosen = cands[cands.length - 1];
      for (const c of cands) { pick -= c.w; if (pick <= 0) { chosen = c; break; } }
      const lead = (chosen.i % 2) === 1 && chosen.p.x > h.x + 3 ? Math.min(3, W - 2 - chosen.p.x) : 0;
      sim.kick(chosen.p.x + lead, chosen.p.y, false, chosen.i);
      return;
    }

    const ang = Math.atan2(GOAL_C - h.y, W - h.x);
    const carry = pressed ? DRIBBLE_SPEED * 0.5 : DRIBBLE_SPEED;
    h.x += Math.cos(ang) * carry; h.y += Math.sin(ang) * carry;
    sim.ball.x = h.x; sim.ball.y = h.y;
  }

  function computeOffBallForce(sim, i, p) {
    const holder = sim.ball.holder;
    if (i === holder) return { fx: 0, fy: 0 };

    let fx = 0, fy = 0;
    if (sim.mode === 'selfish') {
      const dB = dist(p.x, p.y, sim.ball.x, sim.ball.y);
      if (dB < sim.vision || sim.ball.state === 'held') {
        fx = sim.ball.x - p.x; fy = sim.ball.y - p.y;
      } else { fx = (sim.rng() - 0.5); fy = (sim.rng() - 0.5); }
      return { fx, fy };
    }

    if (sim.ball.state !== 'held') {
      const isTarget = i === sim.ball.targetIdx;
      const dB = dist(p.x, p.y, sim.ball.x, sim.ball.y);
      if (isTarget || dB < 10 || i === sim.poacher) {
        const lead = 3;
        const tx = sim.ball.x + sim.ball.vx * lead, ty = sim.ball.y + sim.ball.vy * lead;
        fx = tx - p.x; fy = ty - p.y;
        const m0 = Math.sqrt(fx * fx + fy * fy) || 1;
        p.vx = 0.6 * p.vx + 0.4 * (fx / m0) * TEAM_SPEED;
        p.vy = 0.6 * p.vy + 0.4 * (fy / m0) * TEAM_SPEED;
        p.x = Math.max(1, Math.min(W - 1, p.x + p.vx));
        p.y = Math.max(1, Math.min(H - 1, p.y + p.vy));
        return { fx: 0, fy: 0 };
      }
    }

    let sepX = 0, sepY = 0, cohX = 0, cohY = 0;
    for (let j = 0; j < sim.players.length; j++) {
      if (j === i) continue;
      const q = sim.players[j];
      const d = dist(p.x, p.y, q.x, q.y);
      if (d < 9 && d > 0.01) { sepX += (p.x - q.x) / d; sepY += (p.y - q.y) / d; }
    }
    const braveW = (i % 2) === 1 ? 0.5 : 1.6;
    for (const d0 of sim.defenders) {
      const d = dist(p.x, p.y, d0.x, d0.y);
      if (d < 6 && d > 0.01) { sepX += braveW * (p.x - d0.x) / d; sepY += braveW * (p.y - d0.y) / d; }
    }
    const runner = (i % 2) === 1;
    const ax0 = Math.min(W - 6, sim.ball.x + 16), ay0 = sim.ball.y + (p.y - sim.ball.y) * 0.3;
    const dB = dist(p.x, p.y, ax0, ay0);
    if (dB > (runner ? 34 : 16)) { cohX = (ax0 - p.x) / dB; cohY = (ay0 - p.y) / dB; }
    else if (dB < 7) { cohX = (p.x - ax0) / dB; cohY = (p.y - ay0) / dB; }
    else if (runner && p.x < ax0) { cohX = 0.6; }
    const alignX = runner ? 0.6 : 0.35, alignY = 0;

    let psoX = 0, psoY = 0;
    const c1 = runner ? 0.8 : 0.3, c2 = runner ? 0.3 : 0.7;
    if (p.pbest) { psoX += c1 * sim.rng() * (p.pbest.x - p.x); psoY += c1 * sim.rng() * (p.pbest.y - p.y); }
    psoX += c2 * sim.rng() * (sim.gbest.x - p.x); psoY += c2 * sim.rng() * (sim.gbest.y - p.y);
    const pm = Math.sqrt(psoX * psoX + psoY * psoY);
    if (pm > 1) { psoX /= pm; psoY /= pm; }

    const psoW = runner ? 0.9 : 0.4;
    fx = 1.4 * sepX + 1.1 * cohX + alignX + psoW * psoX;
    fy = 1.4 * sepY + 1.1 * cohY + alignY + psoW * psoY;
    return { fx, fy };
  }

  return { chooseHolderAction, computeOffBallForce };
});
