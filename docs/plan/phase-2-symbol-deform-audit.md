# WP-2.0: Symbol-design deform-necessity audit (DECISION-2.0)

> Risk-first validation spike. Plan of record: `docs/plan/phase-2-rigging.md` section 4.
> This document MUST exist and record DECISION-2.0 before any WP-2.1 (mesh) code lands (Law 5).

| Field | Value |
|---|---|
| WP | WP-2.0 |
| Status | COMPLETE (decision recorded) |
| Decision | DECISION-2.0 = FULL Phase 2 |
| Decision status | PROVISIONAL (real designs pending; see RECHECK-2.0) |
| Input used | Representative stand-in set (no real Gemini-pipeline assets exist yet) |
| Date | 2026-06-27 |

---

## 1. Purpose and the risk this gates

Risk R2.2 (plan section 12): "mesh deform was never actually needed (sprite-on-bone suffices)." WP-2.1, WP-2.3,
WP-2.4, and WP-2.9 (mesh creation, skinning, weight painting, deform) are the most expensive packages in the
entire project. If the target game's animated elements are overwhelmingly rigid sprite-on-bone, those packages
could be deferred and Phase 2 reduced to IK + transform constraints + skins only, saving roughly two months.

This audit answers one question per animated element: does it need surface deformation (bending limbs,
squash/stretch, cloth/jelly/flag) or is rigid sprite-on-bone sufficient?

## 2. External prerequisite and the fallback actually taken

The ideal input is the first real game's character designs from the Gemini asset pipeline. Those designs do not
exist in this greenfield repo (they are produced near Phase 4). Per the plan section 4 FALLBACK, this audit runs
against a REPRESENTATIVE stand-in set: the intended hero-character concept plus a sample of typical
Pragmatic-Play-class slot symbols. DECISION-2.0 is therefore marked PROVISIONAL and carries a mandatory Phase 4
re-check (RECHECK-2.0) when the real designs land. The audit is neither skipped nor fabricated: the verdicts below
are reasoned from the established visual grammar of top-tier 2D slot games (the explicit target class, handoff
section 1.2), not from invented specific art.

## 3. Representative stand-in inventory and per-element verdict (TASK-2.0.1)

The stand-in set models a typical Pragmatic-class game: a small set of animated high-value symbols, a larger set
of low-value card-royal symbols, a hero/mascot used for big-win and intro moments, and ambient frame/UI motion.
Verdict legend: `sprite-on-bone` (rigid attachment riding a bone; no surface deformation) vs `needs-mesh-deform`
(per-vertex surface deformation required for the intended motion).

| # | Element | Typical motion | Verdict | Rationale |
|---|---|---|---|---|
| 1 | Hero character: torso/head | idle breathing, lean, anticipation before a win | needs-mesh-deform | Breathing and squash/stretch on the torso read as cheap and rigid-looking with pure sprite-on-bone; a weighted mesh sells the volume change. This is the marquee asset. |
| 2 | Hero character: upper + lower arm (limb) | wave, point, celebrate; elbow bend | needs-mesh-deform | A bending elbow with a continuous sleeve/skin cannot be two rigid sprites without a visible seam at the joint. Weighted mesh across the elbow plus two-bone IK is the canonical solution. This is the DoD limb (section 5). |
| 3 | Hero character: cape / scarf / loincloth | secondary flowing motion, follow-through | needs-mesh-deform | Cloth follow-through is per-vertex deform (a deform timeline layered on a light skin), the textbook deform use case. |
| 4 | Hero character: hand / prop (held coin, staff) | rigid swing with the forearm | sprite-on-bone | A held rigid prop rides the hand bone; no surface deformation. |
| 5 | High-value symbol A (animal/creature bust) | idle bob, blink, win bounce with squash/stretch | needs-mesh-deform | The win bounce uses squash/stretch; a rigid bob alone looks static next to competitors. |
| 6 | High-value symbol B (gem/treasure object) | idle sparkle, win pulse/scale | sprite-on-bone | A gem pulses via bone scale + a VFX sparkle (Phase 3); the solid object does not surface-deform. |
| 7 | High-value symbol C (portrait/face card premium) | idle micro-motion, win shine | sprite-on-bone | Rigid sprite plus a shine overlay (Phase 3 blend) suffices; no deformation. |
| 8 | Low-value royals: 10, J, Q, K, A (5 symbols) | win glow, slight tilt/scale, shimmer | sprite-on-bone | Card royals are flat rigid sprites; their win treatment is tint/blend/scale and VFX, never surface deform. Counts as 5 rigid elements. |
| 9 | Wild symbol | expanding/celebration, often a character cameo | needs-mesh-deform | A character wild reuses the hero rig class (limb/torso deform). A purely typographic wild would be rigid; the hero-cameo form (common at this tier) needs deform. |
| 10 | Scatter / bonus symbol | spin-in, win celebration | sprite-on-bone | Typically a rigid emblem with VFX; scale/rotate on bones. |
| 11 | Frame / reel border accents | ambient idle shimmer | sprite-on-bone | Rigid decorative sprites; motion is tint/VFX. |
| 12 | Big-win mascot full-body sequence | jump, cheer, full-body squash/stretch | needs-mesh-deform | The signature big-win moment; reuses the hero rig class with the most aggressive deform. |
| 13 | Coin-shower / particle assets | emitter-driven | n/a (Phase 3) | Particles are Layer B (Phase 3), not skeletal; excluded from this count. |
| 14 | Background parallax layers | slow pan/scale | sprite-on-bone | Rigid layers on slow-moving bones. |

## 4. Count and threshold test (TASK-2.0.2)

Animated SKELETAL elements counted (excluding the Phase 3 particle row 13): rows 1, 2, 3, 4, 5, 6, 7, 8 (x5), 9,
10, 11, 12, 14 = 18 distinct elements.

- `needs-mesh-deform`: rows 1, 2, 3, 5, 9, 12 = **6 elements**.
- `sprite-on-bone`: rows 4, 6, 7, 8 (x5), 10, 11, 14 = **12 elements**.

Mesh-deform share: 6 / 18 = **33%**, comfortably above the ~15% defer threshold in TASK-2.0.2. Moreover, the share
is concentrated in the HIGHEST-VALUE assets (the hero character and the marquee high-value symbol and the big-win
sequence), which are precisely the elements a player looks at longest and which most differentiate a Pragmatic-class
game from a budget one. The milestone hero character CANNOT be done convincingly sprite-on-bone (a bending,
skinned limb plus cloth follow-through is the entire point).

Threshold verdict: do NOT downgrade scope. The reduced-Phase-2 path (IK + transform + skins only) is not taken.

## 5. DoD rig pin (TASK-2.0.3)

Per TASK-2.0.3, the Definition-of-Done rig that exercises the full Phase 2 surface is pinned here so the rest of
the phase builds toward a concrete artifact:

**DoD rig name: `mesh-limb-rig`** (a humanoid arm and torso fragment of the hero character). It exercises:

- A weighted MESH on the arm limb, bound to the upper-arm and lower-arm bones and weight-painted across the elbow
  (WP-2.1, WP-2.2, WP-2.3, WP-2.4).
- A two-bone IK constraint driving the limb from a target bone, with a controllable bend direction
  (WP-2.5, WP-2.6).
- A transform constraint so a secondary bone (a shoulder pad / accessory) follows a driver bone in world space
  (WP-2.7).
- A deform timeline animating a per-vertex wobble on the mesh (a cloth/skin ripple), applied after skinning
  (WP-2.9).
- An idle/wave animation tying it together for the milestone walkthrough (WP-2.11).

**Source assets.** No real art exists. The rig's source bitmap is a SYNTHETIC stand-in generated procedurally
(consistent with how Phase 1 sourced synthetic atlas pixels via `apps/editor/src/main/atlas/synthetic.ts`), so the
geometry, weights, IK, transform, and deform behavior can be authored and conformance-locked today without
blocking on the Gemini pipeline. The committed rig and its expected-output fixtures live under
`packages/conformance/` (the rig document under `assets/mesh-limb-rig/` and the cross-runtime fixtures generated by
WP-2.10). When real hero-character art lands (Phase 4), the rig's geometry/UVs are re-skinned onto the real sprite;
the SOLVE behavior (and therefore the fixtures) is unchanged because solve is texture-independent (handoff 8.9 and
the Phase 1 `sizeForTexture` separation).

## 6. Gate decisions (recorded)

- [x] **DECISION-2.0 = FULL Phase 2** (mesh + skinning + weight paint + IK + transform + skins + deform).
      Status: **PROVISIONAL** (input was a representative stand-in, not real Gemini-pipeline designs).
      Sign-off: senior reviewer (this session), reasoned from the target class's established visual grammar.
- [x] **RECHECK-2.0** (mandatory because DECISION-2.0 is PROVISIONAL): when the real character designs land in
      Phase 4, re-run TASK-2.0.1 and TASK-2.0.2 against them and confirm or revise scope. Tracked in
      `docs/plan/phase-4-slot-composer.md` as a Phase 4 entry obligation. If the real designs turn out to be
      overwhelmingly rigid (mesh-deform share below ~15% AND the hero doable sprite-on-bone), the deform-specific
      authoring polish can be trimmed in a later pass; the Phase 2 mesh/skin/IK/transform/deform CODE already
      shipped and conformance-locked stays (it is correct and reusable), so the recheck can only REDUCE future
      authoring effort, never invalidate landed solve code.

## 7. Consequence for the rest of Phase 2

FULL Phase 2 proceeds in the plan's dependency order: WP-2.1 (mesh) -> WP-2.2 (skinning math + codec) -> WP-2.3
(binding) -> WP-2.4 (weight paint) -> WP-2.9 (deform), with the constraint stack WP-2.5 (IK solve) -> WP-2.6 (IK
authoring) / WP-2.7 (transform) developed against disjoint code, WP-2.8 (skins) startable early, WP-2.10
(conformance fixtures) added incrementally as each runtime-core path goes green, and WP-2.11 assembling the
`mesh-limb-rig` DoD milestone.
