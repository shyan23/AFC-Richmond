# ⚽ Shaolin Swarm Soccer

**Ten terrible players. Four elite defenders. One thesis: intelligence lives in the interaction structure, not in the agents.**

> Lab 04 — Population-Based Approach / Swarm Intelligence
> Boids (1987) + Ant Colony Optimization (1992) + Particle Swarm Optimization (1995), fused into one soccer controller.

---

## The Bet

Team Shaolin's attackers are hopeless on purpose:

| Attribute | Shaolin attacker | Team Evil defender |
|---|---|---|
| Speed | 0.5 u/tick | **0.68 u/tick** |
| Kick accuracy | error grows with distance: `σ = 0.011 · dist · noise` | — |
| Vision | myopic (radius 15) | full field |
| Marking | none | goal-side man-marking + keeper |

Every episode: ball at midfield, Shaolin attacks, defense punishes. Goal, turnover, or timeout ends it.

Same bodies, two brains:

- **Selfish mode** — every player greedily chases the ball; the holder dribbles at goal and shoots when "in range". Individual optimization.
- **Swarm mode** — nobody gets faster or more accurate. Three classic population-based mechanisms coordinate them instead.

## The Result

```
node test_sim.js

selfish:  1 / 300 goals
swarm:   20 / 300 goals     ← 20× with identical bodies
pass completion: 97.1%
all tests pass
```

Across 8 seeds: swarm averages **9 ± 3 goals / 150 episodes**; selfish gets 0–1. The individual stayed weak. The collective became a striker.

## Quick Start

```bash
node test_sim.js        # assert-based proof, no frameworks, ~5 s
```

Then open `index.html` in any browser (double-click works — zero dependencies, zero build). You get:

- live canvas pitch with the **pheromone heatmap** glowing over learned corridors
- **Swarm / Selfish** toggle — watch the same players go from mob to machine
- sliders: team size, kick noise, vision, evaporation, defender skill
- playback speed **1x → 4x**, live metrics, and a one-click **300-episode benchmark chart**

Try this: crank **kick noise** up. Selfish mode dies instantly (long shots spray wide); swarm barely notices — short passes tolerate noise. That's the whole thesis in one slider.

## Three Algorithms, One Team

| Mechanism | Origin | Role here |
|---|---|---|
| **Boids** | Reynolds 1987 | Off-ball shape: separation from teammates & markers, cohesion toward a support ring held *ahead of* the ball, alignment drifting goalward. Caste split (ant workers/soldiers style): odd-index **runners** stretch the defense deep, even-index **support** keep the passing ring. |
| **ACO stigmergy** | Dorigo 1992 | 25×16 pheromone grid. Completed passes deposit along their corridor (weighted by field progress), goals deposit heavily, everything evaporates each tick. The holder scores pass lanes by `pheromone × openness × progress` and picks by **roulette wheel** (weight = score², β = 2). The team literally learns corridors the defense fails to cover — you can *see* them in the heatmap. |
| **PSO** | Kennedy & Eberhart 1995 | Each player's off-ball target is a particle. `pbest` = best spot they ever received a pass (valued by closeness to goal), `gbest` = team-wide best. Runners weight pbest (diversity), support weights gbest (consensus). |

## Why the Collective Wins (physics, not magic)

1. **Aim error ∝ distance.** Five 12-unit passes stay accurate where one 60-unit punt sprays wide. Short-hop relay beats hero ball.
2. **The ball outruns everyone.** Passes fly at 1.7, shots at 2.6, best player runs 0.68. Pass chains move faster than any defense can.
3. **Defenders re-mark every ~14 ticks.** Quick pass sequences dislocate the defense *between its decision cycles*.
4. **10 spread attackers vs 4+1 defenders.** Numerical superiority is created by positioning, not skill.
5. **One-touch finishing.** Inside shot range a control touch just gives the keeper time to reset — so there isn't one.

## Hard-Won Tuning Lessons (emergence is fragile)

- Unnormalized PSO pull collapses the whole team onto midfield `gbest`. Normalize it to a direction *hint*.
- Optimistic, diverse `pbest` init (final-third spots) prevents a midfield anchor.
- **Argmax lane choice = sterile sideways circulation.** Roulette exploration finds the risky vertical balls that actually penetrate. Exploration isn't optional; it's the offense.
- "Pressed near goal → shoot, don't pass" must be a hard rule, or pheromone pass-loops circulate forever.
- Spawning runners already upfield was the single biggest structural unlock (shots ×2).
- Faster shots (2.6 vs 1.7) beat every "smarter aiming" idea we tried. Physics > cleverness.
- Measured dead end: 143/153 keeper rebounds die to faster defenders — poaching helps less than it looks.

## Files

```
Lab_04/
├── sim.js           # headless simulation core (no DOM) — shared by page and tests
├── test_sim.js      # node assert suite: physics premise, evaporation, determinism, THE claim
├── index.html       # single-file UI: canvas, heatmap, sliders, benchmark chart
├── references.docx  # reference list (hand-rolled OOXML via python stdlib zipfile)
└── README.md
```

Deterministic seeded RNG (mulberry32) throughout — every run reproducible, every claim testable. The headline test aggregates 3 seeds × 100 episodes so no lucky seed can flip the verdict.

## References

1. Reynolds, C. W. (1987). Flocks, herds and schools: A distributed behavioral model. *SIGGRAPH '87*, 25–34.
2. Dorigo, M. (1992). *Optimization, Learning and Natural Algorithms.* PhD thesis, Politecnico di Milano.
3. Kennedy, J., & Eberhart, R. (1995). Particle swarm optimization. *Proc. IEEE ICNN*, 1942–1948.
4. Kitano, H., Asada, M., Kuniyoshi, Y., Noda, I., & Osawa, E. (1997). RoboCup: The robot world cup initiative. *Proc. Agents '97*, 340–347.
