'use strict';

(function (root, factory) {
  const API = factory(
    typeof module !== 'undefined' && module.exports ? require('./physics') : root.SSSPhysics,
    typeof module !== 'undefined' && module.exports ? require('./controllers') : root.SSSControllers
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (root) root.SSSEngine = API;
})(typeof window !== 'undefined' ? window : null, function (physics, controllers) {
  const { W, H, GOAL_Y1, GOAL_Y2, GOAL_C, KICK_RANGE, TEAM_SPEED, BALL_SPEED, SHOT_SPEED, EP_MAX_TICKS, PH_COLS, PH_ROWS, CELL_W, CELL_H, mulberry32, kickSigma, dist, segDist } = physics;
  const { chooseHolderAction, computeOffBallForce } = controllers;

  class Sim {
    constructor(opts = {}) {
      this.mode = opts.mode || 'swarm';
      this.nPlayers = opts.nPlayers || 10;
      this.kickNoise = opts.kickNoise != null ? opts.kickNoise : 1.0;
      this.vision = opts.vision || 15;
      this.evap = opts.evap != null ? opts.evap : 0.0015;
      this.defSkill = opts.defSkill != null ? opts.defSkill : 1.0;
      this.nDefenders = opts.nDefenders || 4;
      this.keeperReach = opts.keeperReach != null ? opts.keeperReach : 2.5;
      this.interceptP = opts.interceptP != null ? opts.interceptP : 0.22;
      this.shootGate = opts.shootGate != null ? opts.shootGate : 1.15;
      this.shotSpeed = opts.shotSpeed != null ? opts.shotSpeed : SHOT_SPEED;
      this.rng = mulberry32(opts.seed != null ? opts.seed : 42);
      this.pher = new Float32Array(PH_COLS * PH_ROWS);
      this.gbest = { x: 85, y: GOAL_C, val: 0.8 };
      this.stats = {
        episodes: 0, goals: 0, shots: 0, shotsOnTarget: 0, shotDistSum: 0, saves: 0,
        passAttempt: 0, passComplete: 0, possessionTicks: 0, epHistory: [],
      };
      this.events = [];
      this.resetEpisode();
    }

    gauss() {
      let u = 0, v = 0;
      while (u === 0) u = this.rng();
      while (v === 0) v = this.rng();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    resetEpisode() {
      const r = this.rng;
      const keepMemory = !!this.players;
      const old = this.players;
      this.players = [];
      for (let i = 0; i < this.nPlayers; i++) {
        const fwd = (i % 2) === 1;
        this.players.push({
          x: fwd ? 45 + r() * 17 : 15 + r() * 30, y: 4 + r() * (H - 8), vx: 0, vy: 0,
          pbest: keepMemory && old[i] ? old[i].pbest : { x: 72 + r() * 18, y: 8 + r() * (H - 16) },
          pbestVal: keepMemory && old[i] ? old[i].pbestVal : 0.65 + r() * 0.12,
        });
      }
      this.defenders = [];
      for (let i = 0; i < this.nDefenders; i++) {
        this.defenders.push({ x: 62 + r() * 20, y: 8 + (i + 0.5) * (H - 16) / this.nDefenders, vx: 0, vy: 0 });
      }
      this.keeper = { x: W - 1.5, y: GOAL_C };
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

    shootTargetY() { return this.keeper.y > GOAL_C ? GOAL_Y1 + 2.5 : GOAL_Y2 - 2.5; }

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
      this.ball.kickerIdx = this.ball.holder;
      this.ball.holder = -1;
      if (isShot) { this.stats.shots++; this.stats.shotDistSum += d; }
      else this.stats.passAttempt++;
    }

    movePlayers() {
      const holder = this.ball.holder;
      let poacher = -1;
      if (this.ball.state === 'loose' && this.mode === 'swarm') {
        let pd = Infinity;
        for (let i = 0; i < this.players.length; i++) {
          const d = dist(this.players[i].x, this.players[i].y, this.ball.x, this.ball.y);
          if (d < pd) { pd = d; poacher = i; }
        }
      }
      this.poacher = poacher;
      for (let i = 0; i < this.players.length; i++) {
        if (i === holder) continue;
        const p = this.players[i];
        const { fx, fy } = computeOffBallForce(this, i, p);
        const m = Math.sqrt(fx * fx + fy * fy) || 1;
        p.vx = 0.75 * p.vx + 0.25 * (fx / m) * TEAM_SPEED;
        p.vy = 0.75 * p.vy + 0.25 * (fy / m) * TEAM_SPEED;
        p.x = Math.max(1, Math.min(W - 1, p.x + p.vx));
        p.y = Math.max(1, Math.min(H - 1, p.y + p.vy));
      }
    }

    moveDefenders() {
      const spd = 0.68 * this.defSkill;
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
        else { const m = this.players[d.markIdx]; tx = m.x + 2.5; ty = m.y; }
        const dd = dist(d.x, d.y, tx, ty) || 1;
        d.x = Math.max(1, Math.min(W - 1, d.x + (tx - d.x) / dd * spd));
        d.y = Math.max(1, Math.min(H - 1, d.y + (ty - d.y) / dd * spd));
      });
      const ky = Math.max(GOAL_Y1 + 1, Math.min(GOAL_Y2 - 1, this.ball.y));
      this.keeper.y += Math.max(-0.45 * this.defSkill, Math.min(0.45 * this.defSkill, ky - this.keeper.y));
    }

    moveBall() {
      const b = this.ball;
      if (b.state === 'held') return;
      if (b.state === 'loose') {
        b.vx *= 0.90; b.vy *= 0.90;
        b.x += b.vx; b.y += b.vy;
        b.looseTicks = (b.looseTicks || 0) + 1;
        if (b.looseTicks > 120) { this.endEpisode(false); return; }
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
      if (b.x >= W) {
        if (b.y > GOAL_Y1 && b.y < GOAL_Y2 && b.isShot) {
          this.stats.shotsOnTarget++;
          if (Math.abs(this.keeper.y - b.y) < this.keeperReach * this.defSkill) {
            this.events.push('save'); this.stats.saves++;
            b.state = 'loose'; b.looseTicks = 0; b.isShot = false;
            b.x = W - 4; b.y = this.keeper.y + (this.rng() - 0.5) * 10;
            const ra = Math.PI * (0.75 + 0.5 * this.rng());
            b.vx = Math.cos(ra) * 1.2; b.vy = Math.sin(ra) * 1.2;
          } else {
            this.events.push('goal');
            this.depositAlong(b.fromX, b.fromY, W, b.y, 0.9);
            this.gbest = { x: b.fromX, y: b.fromY, val: 1 };
            this.endEpisode(true);
          }
        } else this.endEpisode(false);
        return;
      }
      if (b.x < 0 || b.y < 0 || b.y > H) { this.endEpisode(false); return; }
      if (b.travel > 2.5) {
        for (const d of this.defenders) {
          if (dist(d.x, d.y, b.x, b.y) < 1.25 * this.defSkill && this.rng() < this.interceptP * this.defSkill) {
            this.events.push('intercept'); this.endEpisode(false); return;
          }
        }
      }
      if (!b.isShot && b.travel > 2.5) {
        for (let i = 0; i < this.players.length; i++) {
          if (i === b.kickerIdx) continue;
          if (dist(this.players[i].x, this.players[i].y, b.x, b.y) < 3.0) { this.receive(i); return; }
        }
      }
      if (b.travel > b.maxTravel) {
        if (b.isShot) { this.endEpisode(false); return; }
        b.state = 'loose'; b.looseTicks = 0;
      }
    }

    receive(i) {
      const b = this.ball, p = this.players[i];
      b.state = 'held'; b.holder = i; this.holdTicks = 0;
      if (i === b.kickerIdx) return;
      this.stats.passComplete++;
      const w = 0.12 + 0.25 * (b.x / W);
      this.depositAlong(b.fromX, b.fromY, b.x, b.y, w);
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
        const h = this.players[this.ball.holder];
        for (const d of this.defenders) {
          if (dist(d.x, d.y, h.x, h.y) < 1.6 && this.rng() < 0.07 * this.defSkill) {
            this.events.push('tackle'); this.endEpisode(false); return;
          }
        }
        chooseHolderAction(this);
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

  return { Sim, kickSigma, mulberry32, W, H, GOAL_Y1, GOAL_Y2, PH_COLS, PH_ROWS, KICK_RANGE };
});
