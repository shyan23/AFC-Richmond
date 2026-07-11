// Shaolin Swarm Soccer — headless simulation core (no DOM).
// Individually-bad agents (noisy kicks, slow, myopic) vs strong defenders.
// Swarm mode = Boids (Reynolds 1987) + ACO stigmergy (Dorigo 1992) + PSO (Kennedy & Eberhart 1995).

'use strict';

// ---------- deterministic RNG ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- constants ----------
const W = 100, H = 64;
const GOAL_Y1 = 24, GOAL_Y2 = 40, GOAL_C = 32;
const KICK_RANGE = 30;
const SHAOLIN_SPEED = 0.5, DRIBBLE_SPEED = 0.38;
const BALL_SPEED = 1.7;       // pass speed
const SHOT_SPEED = 2.6;       // shots are struck harder — keeper gets less time
const VISION_DEFAULT = 15;
const EP_MAX_TICKS = 1200;
const PH_COLS = 25, PH_ROWS = 16;
const CELL_W = W / PH_COLS, CELL_H = H / PH_ROWS;

// Aim error: sigma (radians) grows linearly with kick distance.
// This single physical fact is why short-pass relays beat long solo shots.
function kickSigma(dist, noise) { return 0.011 * dist * noise; }

function dist(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }

// min distance from point p to segment ab
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const L2 = dx * dx + dy * dy;
  if (L2 === 0) return dist(px, py, ax, ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  return dist(px, py, ax + t * dx, ay + t * dy);
}

class Sim {
  constructor(opts = {}) {
    this.mode = opts.mode || 'swarm';            // 'swarm' | 'selfish'
    this.nPlayers = opts.nPlayers || 10;
    this.kickNoise = opts.kickNoise != null ? opts.kickNoise : 1.0;
    this.vision = opts.vision || VISION_DEFAULT;
    this.evap = opts.evap != null ? opts.evap : 0.0015; // per tick
    this.defSkill = opts.defSkill != null ? opts.defSkill : 1.0;
    this.nDefenders = opts.nDefenders || 4;
    // tunable dials (exposed for UI sliders + experiments)
    this.keeperReach = opts.keeperReach != null ? opts.keeperReach : 2.5;
    this.interceptP = opts.interceptP != null ? opts.interceptP : 0.22;
    this.shootGate = opts.shootGate != null ? opts.shootGate : 1.15; // ×KICK_RANGE shoot radius
    this.shotSpeed = opts.shotSpeed != null ? opts.shotSpeed : SHOT_SPEED;
    this.rng = mulberry32(opts.seed != null ? opts.seed : 42);
    this.pher = new Float32Array(PH_COLS * PH_ROWS);
    // optimistic init: assume good spots exist deep in the enemy half;
    // only receptions genuinely deeper displace it (avoids midfield anchor)
    this.gbest = { x: 85, y: GOAL_C, val: 0.8 };
    this.stats = {
      episodes: 0, goals: 0, shots: 0, shotsOnTarget: 0, shotDistSum: 0, saves: 0,
      passAttempt: 0, passComplete: 0, possessionTicks: 0, epHistory: [],
    };
    this.events = []; // per-tick visual events for UI ('goal','save','tackle',...)
    this.resetEpisode();
  }

  gauss() { // Box-Muller
    let u = 0, v = 0;
    while (u === 0) u = this.rng();
    while (v === 0) v = this.rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  resetEpisode() {
    const r = this.rng;
    const keepMemory = !!this.players; // pbest/gbest learning persists across episodes
    const old = this.players;
    this.players = [];
    for (let i = 0; i < this.nPlayers; i++) {
      const fwd = (i % 2) === 1; // runners start as forwards, support behind
      this.players.push({
        x: fwd ? 45 + r() * 17 : 15 + r() * 30, y: 4 + r() * (H - 8), vx: 0, vy: 0,
        // optimistic + diverse init: each player "believes" in their own spot
        // in the final third — classic PSO diversity against premature collapse
        pbest: keepMemory && old[i] ? old[i].pbest : { x: 72 + r() * 18, y: 8 + r() * (H - 16) },
        // floor 0.65 ≈ final-third value: ordinary midfield receptions can't overwrite it
        pbestVal: keepMemory && old[i] ? old[i].pbestVal : 0.65 + r() * 0.12,
      });
    }
    this.defenders = [];
    for (let i = 0; i < this.nDefenders; i++) {
      this.defenders.push({ x: 62 + r() * 20, y: 8 + (i + 0.5) * (H - 16) / this.nDefenders, vx: 0, vy: 0 });
    }
    this.keeper = { x: W - 1.5, y: GOAL_C };
    // ball to player nearest midfield
    let hi = 0, hd = Infinity;
    this.players.forEach((p, i) => { const d = dist(p.x, p.y, 50, GOAL_C); if (d < hd) { hd = d; hi = i; } });
    this.ball = { x: this.players[hi].x, y: this.players[hi].y, state: 'held', holder: hi, vx: 0, vy: 0, fromX: 0, fromY: 0, travel: 0, targetIdx: -1, isShot: false };
    this.holdTicks = 0;
    this.epTick = 0;
  }

  endEpisode(goal) {
    this.stats.episodes++;
    if (goal) this.stats.goals++;
    this.stats.epHistory.push(goal ? 1 : 0);
    this.resetEpisode();
  }

  // ---------- pheromone (ACO stigmergy) ----------
  phIdx(x, y) {
    const c = Math.max(0, Math.min(PH_COLS - 1, Math.floor(x / CELL_W)));
    const rw = Math.max(0, Math.min(PH_ROWS - 1, Math.floor(y / CELL_H)));
    return rw * PH_COLS + c;
  }
  depositAlong(ax, ay, bx, by, amount) {
    const steps = Math.max(2, Math.ceil(dist(ax, ay, bx, by) / 2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const i = this.phIdx(ax + (bx - ax) * t, ay + (by - ay) * t);
      this.pher[i] = Math.min(3, this.pher[i] + amount);
    }
  }
  pherAlong(ax, ay, bx, by) {
    const steps = 6; let sum = 0;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      sum += this.pher[this.phIdx(ax + (bx - ax) * t, ay + (by - ay) * t)];
    }
    return sum / (steps + 1);
  }
  evaporate() {
    const k = 1 - this.evap;
    for (let i = 0; i < this.pher.length; i++) this.pher[i] *= k;
  }

  laneOpenness(ax, ay, bx, by) {
    let m = Infinity;
    for (const d of this.defenders) m = Math.min(m, segDist(d.x, d.y, ax, ay, bx, by));
    return Math.max(0, Math.min(1, m / 7));
  }

  // ---------- holder decision ----------
  shootTargetY() { // aim at the side the keeper is not covering
    return this.keeper.y > GOAL_C ? GOAL_Y1 + 2.5 : GOAL_Y2 - 2.5;
  }

  kick(toX, toY, isShot, targetIdx) {
    const h = this.players[this.ball.holder];
    const d = dist(h.x, h.y, toX, toY);
    const ang = Math.atan2(toY - h.y, toX - h.x) + this.gauss() * kickSigma(d, this.kickNoise);
    const spd = isShot ? this.shotSpeed : BALL_SPEED;
    this.ball.state = 'flying';
    this.ball.fromX = h.x; this.ball.fromY = h.y;
    this.ball.vx = Math.cos(ang) * spd; this.ball.vy = Math.sin(ang) * spd;
    this.ball.spd = spd;
    this.ball.travel = 0; this.ball.maxTravel = Math.min(d * 1.35 + 3, isShot ? 200 : KICK_RANGE * 1.4);
    this.ball.isShot = isShot; this.ball.targetIdx = targetIdx;
    this.ball.holder = -1;
    if (isShot) { this.stats.shots++; this.stats.shotDistSum += d; }
    else this.stats.passAttempt++;
  }

  holderAct() {
    const h = this.players[this.ball.holder];
    const dGoal = dist(h.x, h.y, W, GOAL_C);
    this.holdTicks++;

    if (this.mode === 'selfish') {
      // greedy: dribble straight at goal, shoot as soon as "in range"
      if (dGoal < KICK_RANGE) { this.kick(W, this.shootTargetY(), true, -1); return; }
      const ang = Math.atan2(GOAL_C - h.y, W - h.x);
      h.x += Math.cos(ang) * DRIBBLE_SPEED; h.y += Math.sin(ang) * DRIBBLE_SPEED;
      this.ball.x = h.x; this.ball.y = h.y;
      return;
    }

    // swarm: score pass lanes by pheromone x openness x progress (ACO decision rule)
    const pressed = this.defenders.some(d => dist(d.x, d.y, h.x, h.y) < 5);
    const inShotRange = dGoal < KICK_RANGE * this.shootGate;
    // one-touch inside shot range: a control touch lets the keeper recover
    if (this.holdTicks < 3 && !pressed && !inShotRange) {
      this.ball.x = h.x; this.ball.y = h.y; return;
    }
    // shooting is a hard rule near goal — otherwise pheromone pass-loops circulate forever.
    // pressure near goal means SHOOT (you lose the ball otherwise), not pass.
    if (inShotRange) {
      const ty = this.shootTargetY();
      const open = this.laneOpenness(h.x, h.y, W, ty);
      if (open > 0.25 || dGoal < 12 || this.holdTicks > 12 || pressed) { this.kick(W, ty, true, -1); return; }
    }
    // ACO probabilistic construction: candidate lanes weighted by pheromone/heuristic,
    // chosen by roulette (beta=2) — exploration finds risky vertical balls argmax never tries
    const cands = [];
    let wSum = 0, bestScore = 0;
    for (let i = 0; i < this.players.length; i++) {
      if (i === this.ball.holder) continue;
      const p = this.players[i];
      const d = dist(h.x, h.y, p.x, p.y);
      if (d > KICK_RANGE || d < 3) continue;
      const open = this.laneOpenness(h.x, h.y, p.x, p.y);
      const pher = Math.min(1, this.pherAlong(h.x, h.y, p.x, p.y)); // cap: avoid runaway loops
      const progress = (p.x - h.x) / KICK_RANGE; // -1..1
      const short = 1 - d / KICK_RANGE;          // shorter = more accurate
      // depth bonus: balls toward the final third are disproportionately valuable
      const score = Math.max(0.01,
        (0.4 + pher) * (0.45 + 0.55 * open) * (1 + 1.6 * progress + 0.4 * short + 0.6 * (p.x / W)));
      const w = score * score;
      cands.push({ i, p, w });
      wSum += w;
      if (score > bestScore) bestScore = score;
    }
    if (cands.length && (pressed || this.holdTicks > 16 || bestScore > 0.45)) {
      let pick = this.rng() * wSum, chosen = cands[cands.length - 1];
      for (const c of cands) { pick -= c.w; if (pick <= 0) { chosen = c; break; } }
      // small lead into space for forward runners — the ball outruns defenders
      const lead = (chosen.i % 2) === 1 && chosen.p.x > h.x + 3 ? Math.min(3, W - 2 - chosen.p.x) : 0;
      this.kick(chosen.p.x + lead, chosen.p.y, false, chosen.i);
      return;
    }
    // nothing good yet: carry the ball forward (full speed if nobody presses)
    const ang = Math.atan2(GOAL_C - h.y, W - h.x);
    const carry = pressed ? DRIBBLE_SPEED * 0.5 : DRIBBLE_SPEED;
    h.x += Math.cos(ang) * carry; h.y += Math.sin(ang) * carry;
    this.ball.x = h.x; this.ball.y = h.y;
  }

  // ---------- off-ball movement ----------
  movePlayers() {
    const holder = this.ball.holder;
    // loose ball: nearest attacker always poaches, even from far away —
    // otherwise keeper parries die untouched and rebounds are wasted
    let poacher = -1;
    if (this.ball.state === 'loose' && this.mode === 'swarm') {
      let pd = Infinity;
      for (let i = 0; i < this.players.length; i++) {
        const d = dist(this.players[i].x, this.players[i].y, this.ball.x, this.ball.y);
        if (d < pd) { pd = d; poacher = i; }
      }
    }
    for (let i = 0; i < this.players.length; i++) {
      if (i === holder) continue;
      const p = this.players[i];
      let fx = 0, fy = 0;

      if (this.mode === 'selfish') {
        // everyone myopically chases the ball (if they can even see it)
        const dB = dist(p.x, p.y, this.ball.x, this.ball.y);
        if (dB < this.vision || this.ball.state === 'held') {
          fx = this.ball.x - p.x; fy = this.ball.y - p.y;
        } else { fx = (this.rng() - 0.5); fy = (this.rng() - 0.5); } // lost: wander
      } else {
        // receiver duty: intended target (or nearest teammate) chases a moving ball
        if (this.ball.state !== 'held') {
          const isTarget = i === this.ball.targetIdx;
          const dB = dist(p.x, p.y, this.ball.x, this.ball.y);
          if (isTarget || dB < 10 || i === poacher) {
            // run at short lead of the ball's path
            const lead = 3;
            const tx = this.ball.x + this.ball.vx * lead, ty = this.ball.y + this.ball.vy * lead;
            fx = tx - p.x; fy = ty - p.y;
            const m0 = Math.sqrt(fx * fx + fy * fy) || 1;
            p.vx = 0.6 * p.vx + 0.4 * (fx / m0) * SHAOLIN_SPEED;
            p.vy = 0.6 * p.vy + 0.4 * (fy / m0) * SHAOLIN_SPEED;
            p.x = Math.max(1, Math.min(W - 1, p.x + p.vx));
            p.y = Math.max(1, Math.min(H - 1, p.y + p.vy));
            continue;
          }
        }
        // --- Boids (Reynolds 1987) ---
        let sepX = 0, sepY = 0, cohX = 0, cohY = 0;
        for (let j = 0; j < this.players.length; j++) {
          if (j === i) continue;
          const q = this.players[j];
          const d = dist(p.x, p.y, q.x, q.y);
          if (d < 9 && d > 0.01) { sepX += (p.x - q.x) / d; sepY += (p.y - q.y) / d; }
        }
        // separation from markers — support escapes, runners hold their ground
        const braveW = (i % 2) === 1 ? 0.5 : 1.6;
        for (const d0 of this.defenders) {
          const d = dist(p.x, p.y, d0.x, d0.y);
          if (d < 6 && d > 0.01) { sepX += braveW * (p.x - d0.x) / d; sepY += braveW * (p.y - d0.y) / d; }
        }
        // cohesion: support ring centred AHEAD of the ball — structure forms downfield.
        // caste split (like ant workers/soldiers): even indices = support (keep the ring),
        // odd = runners (never pulled back, they stretch the defense deep)
        const runner = (i % 2) === 1;
        const ax0 = Math.min(W - 6, this.ball.x + 16), ay0 = this.ball.y + (p.y - this.ball.y) * 0.3;
        const dB = dist(p.x, p.y, ax0, ay0);
        if (dB > (runner ? 34 : 16)) { cohX = (ax0 - p.x) / dB; cohY = (ay0 - p.y) / dB; }
        else if (dB < 7) { cohX = (p.x - ax0) / dB; cohY = (p.y - ay0) / dB; }
        else if (runner && p.x < ax0) { cohX = 0.6; } // runners keep pushing deep
        // alignment: drift toward attacking end (runners push harder)
        const alignX = runner ? 0.6 : 0.35, alignY = 0;

        // --- PSO (Kennedy & Eberhart 1995) ---
        // runners trust their own pbest (diversity), support follows gbest (consensus)
        let psoX = 0, psoY = 0;
        const c1 = runner ? 0.8 : 0.3, c2 = runner ? 0.3 : 0.7;
        if (p.pbest) { psoX += c1 * this.rng() * (p.pbest.x - p.x); psoY += c1 * this.rng() * (p.pbest.y - p.y); }
        psoX += c2 * this.rng() * (this.gbest.x - p.x); psoY += c2 * this.rng() * (this.gbest.y - p.y);
        // normalize: PSO is a direction hint, it must not overpower boids forces
        const pm = Math.sqrt(psoX * psoX + psoY * psoY);
        if (pm > 1) { psoX /= pm; psoY /= pm; }

        const psoW = runner ? 0.9 : 0.4;
        fx = 1.4 * sepX + 1.1 * cohX + alignX + psoW * psoX;
        fy = 1.4 * sepY + 1.1 * cohY + alignY + psoW * psoY;
      }

      const m = Math.sqrt(fx * fx + fy * fy) || 1;
      p.vx = 0.75 * p.vx + 0.25 * (fx / m) * SHAOLIN_SPEED;
      p.vy = 0.75 * p.vy + 0.25 * (fy / m) * SHAOLIN_SPEED;
      p.x = Math.max(1, Math.min(W - 1, p.x + p.vx));
      p.y = Math.max(1, Math.min(H - 1, p.y + p.vy));
    }
  }

  moveDefenders() {
    const spd = 0.68 * this.defSkill;
    // reaction delay: marks are re-assigned only every REACT ticks — quick pass
    // sequences dislocate the defense between its decision cycles
    const REACT = Math.max(3, Math.round(14 / this.defSkill));
    if (this.epTick % REACT === 1 || !this.defenders[0].hasTarget) {
      let pressIdx = 0, pd = Infinity;
      this.defenders.forEach((d, i) => { const dd = dist(d.x, d.y, this.ball.x, this.ball.y); if (dd < pd) { pd = dd; pressIdx = i; } });
      const marked = new Set();
      this.defenders.forEach((d, i) => {
        d.hasTarget = true;
        d.press = i === pressIdx;
        if (d.press) { d.markIdx = -1; return; }
        let mi = -1, md = Infinity;
        this.players.forEach((p, j) => {
          if (marked.has(j) || j === this.ball.holder) return;
          const dd = dist(d.x, d.y, p.x, p.y);
          if (dd < md) { md = dd; mi = j; }
        });
        marked.add(mi); d.markIdx = mi;
      });
    }
    this.defenders.forEach((d) => {
      let tx, ty;
      if (d.press || d.markIdx < 0 || d.markIdx >= this.players.length) { tx = this.ball.x; ty = this.ball.y; }
      else { const m = this.players[d.markIdx]; tx = m.x + 2.5; ty = m.y; } // goal-side
      const dd = dist(d.x, d.y, tx, ty) || 1;
      d.x = Math.max(1, Math.min(W - 1, d.x + (tx - d.x) / dd * spd));
      d.y = Math.max(1, Math.min(H - 1, d.y + (ty - d.y) / dd * spd));
    });
    // keeper tracks ball y along goal mouth
    const ky = Math.max(GOAL_Y1 + 1, Math.min(GOAL_Y2 - 1, this.ball.y));
    this.keeper.y += Math.max(-0.45 * this.defSkill, Math.min(0.45 * this.defSkill, ky - this.keeper.y));
  }

  // ---------- ball flight ----------
  moveBall() {
    const b = this.ball;
    if (b.state === 'held') return;
    if (b.state === 'loose') {
      b.vx *= 0.90; b.vy *= 0.90;
      b.x += b.vx; b.y += b.vy;
      b.looseTicks = (b.looseTicks || 0) + 1;
      if (b.looseTicks > 120) { this.endEpisode(false); return; }
      // anyone can pick up a loose ball; defenders win = turnover
      for (const d of this.defenders) {
        if (dist(d.x, d.y, b.x, b.y) < 1.4 * this.defSkill) { this.events.push('intercept'); this.endEpisode(false); return; }
      }
      for (let i = 0; i < this.players.length; i++) {
        const p = this.players[i];
        if (dist(p.x, p.y, b.x, b.y) < 2.6) { this.receive(i); return; }
      }
      if (b.x < 0 || b.x >= W || b.y < 0 || b.y > H) this.endEpisode(false);
      return;
    }
    b.x += b.vx; b.y += b.vy; b.travel += b.spd || BALL_SPEED;

    // goal / out
    if (b.x >= W) {
      if (b.y > GOAL_Y1 && b.y < GOAL_Y2 && b.isShot) {
        this.stats.shotsOnTarget++;
        if (Math.abs(this.keeper.y - b.y) < this.keeperReach * this.defSkill) {
          // parry: rebound spills into the box — poachers can pounce (very Shaolin)
          this.events.push('save'); this.stats.saves++;
          b.state = 'loose'; b.looseTicks = 0; b.isShot = false;
          b.x = W - 4; b.y = this.keeper.y + (this.rng() - 0.5) * 10;
          const ra = Math.PI * (0.75 + 0.5 * this.rng()); // back into the field
          b.vx = Math.cos(ra) * 1.2; b.vy = Math.sin(ra) * 1.2;
        }
        else {
          this.events.push('goal');
          // goal reinforces its origin corridor strongly + updates gbest (PSO social memory)
          this.depositAlong(b.fromX, b.fromY, W, b.y, 0.9);
          this.gbest = { x: b.fromX, y: b.fromY, val: 1 };
          this.endEpisode(true);
        }
      } else this.endEpisode(false);
      return;
    }
    if (b.x < 0 || b.y < 0 || b.y > H) { this.endEpisode(false); return; }

    // defender interception (after the ball clears the kicker) — probabilistic:
    // a moving ball is hard to cut out, so through-balls can thread a crowd
    if (b.travel > 2.5) {
      for (const d of this.defenders) {
        if (dist(d.x, d.y, b.x, b.y) < 1.25 * this.defSkill && this.rng() < this.interceptP * this.defSkill) {
          this.events.push('intercept'); this.endEpisode(false); return;
        }
      }
    }
    // reception by any teammate
    if (!b.isShot && b.travel > 2.5) {
      for (let i = 0; i < this.players.length; i++) {
        if (dist(this.players[i].x, this.players[i].y, b.x, b.y) < 3.0) { this.receive(i); return; }
      }
    }
    // overhit pass becomes a loose rolling ball instead of a dead episode
    if (b.travel > b.maxTravel) {
      if (b.isShot) { this.endEpisode(false); return; }
      b.state = 'loose'; b.looseTicks = 0;
    }
  }

  receive(i) {
    const b = this.ball, p = this.players[i];
    b.state = 'held'; b.holder = i; this.holdTicks = 0;
    this.stats.passComplete++;
    // ACO: successful pass lays pheromone, weighted by field progress
    const w = 0.12 + 0.25 * (b.x / W);
    this.depositAlong(b.fromX, b.fromY, b.x, b.y, w);
    // PSO: reception spot value = closeness to goal
    const val = 1 - dist(p.x, p.y, W, GOAL_C) / 110;
    if (val > p.pbestVal) { p.pbestVal = val; p.pbest = { x: p.x, y: p.y }; }
    if (val > this.gbest.val) this.gbest = { x: p.x, y: p.y, val };
  }

  step() {
    this.events.length = 0;
    this.epTick++;
    if (this.epTick > EP_MAX_TICKS) { this.endEpisode(false); return; }
    if (this.ball.state === 'held') {
      this.stats.possessionTicks++;
      // tackle: defender close to holder
      const h = this.players[this.ball.holder];
      for (const d of this.defenders) {
        if (dist(d.x, d.y, h.x, h.y) < 1.6 && this.rng() < 0.07 * this.defSkill) {
          this.events.push('tackle'); this.endEpisode(false); return;
        }
      }
      this.holderAct();
    }
    this.movePlayers();
    this.moveDefenders();
    this.moveBall();
    this.evaporate();
  }

  runEpisodes(n) {
    const target = this.stats.episodes + n;
    let guard = 0;
    while (this.stats.episodes < target && guard++ < n * (EP_MAX_TICKS + 5)) this.step();
    return this.stats;
  }
}

const API = { Sim, kickSigma, mulberry32, W, H, GOAL_Y1, GOAL_Y2, PH_COLS, PH_ROWS, KICK_RANGE };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.SSS = API;
