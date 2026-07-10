using System;
using Marionette.Runtime.Core.Document;
using Marionette.Runtime.Core.MathCore;
using Marionette.Runtime.Core.Skeleton;

namespace Marionette.Runtime.Core.Solve
{
    // Physics constraint SOLVE (mirrors packages/runtime-core/src/solve/physics-constraint.ts, ADR-0014,
    // PP-B7). A physics constraint drives ONE bone with a per-channel damped-driven harmonic oscillator so
    // secondary motion (tails, ropes, jiggle) emerges deterministically from the animated pose plus world
    // forces. It solves in step 3 alongside the other constraints, LAST by default (IK, then transform, then
    // path, then physics), writing LOCAL only, so the step-4 world pass reproduces the intended world. It is
    // the ONE constraint kind that steps over time, so it uses the fixed-timestep integer step clock and
    // semi-implicit (symplectic) Euler EXACTLY as the TS oracle pins them: bit-reproducible within a runtime,
    // tolerance-parity across TS/C#/GDScript. Seedless (no PRNG, no clock, no allocation per frame; all state
    // is the pre-allocated per-constraint arrays created at skeleton build).
    internal static class PhysicsConstraintSolve
    {
        // Fixed-point one (2^16) for the integer step accumulator, IDENTICAL to the emitter (SPAWN_FIXED_ONE).
        // The step count is an integer-exact function of accumulated time, so two runtimes stepping the same
        // frameDt sequence run the identical number of steps and cannot drift by a fractional step.
        public const int PhysicsStepFixedOne = 65536;

        // The teleport reset threshold (ADR-0014 section 6), in the bone's LOCAL translation units. A per-frame
        // setpoint TRANSLATION jump larger than this is treated as a cut / skin swap, not motion: the bone
        // snaps to the new pose at rest rather than whipping across the gap.
        public const double PhysicsResetDistance = 1000.0;

        // Channel codes (ADR-0014 section 1), the simulated subset of a bone's LOCAL pose channels. The value
        // is the code stored per simulated channel in ResolvedPhysicsConstraint.ChannelCodes.
        public const int PhysicsChannelX = 0;
        public const int PhysicsChannelY = 1;
        public const int PhysicsChannelRotation = 2;
        public const int PhysicsChannelScaleX = 3;
        public const int PhysicsChannelShearX = 4;

        // Map a channel code to its lane in the decomposed local-transform scratch [x, y, rotationDeg, scaleX,
        // scaleY, shearXDeg, shearYDeg] (SetupStride layout). rotation/scaleX/shearX are DEGREES/linear
        // scalars, exactly the format's stored fields, so the write-back is a local delta on that bone
        // property. shearX is lane 5 (lane 4 is the held scaleY), which is why this indirection exists.
        private static readonly int[] ChannelScratchLane = { 0, 1, 2, 3, 5 };

        // Solver-owned scratch, reused across calls so the solve allocates nothing. ThreadStatic and never
        // re-entrant (no physics constraint nests inside another), matching the ResolveWorld convention.
        [ThreadStatic]
        private static double[]? _localScratch;

        [ThreadStatic]
        private static double[]? _targetScratch;

        [ThreadStatic]
        private static double[]? _worldScratch;

        private static double[] LocalScratch => _localScratch ??= new double[Pose.SetupStride];

        private static double[] TargetScratch => _targetScratch ??= new double[5];

        private static double[] WorldScratch => _worldScratch ??= new double[Affine.Mat2x3Stride];

        // Round-half-away-from-zero, the SAME single rounding rule the emitter uses. frameDt and step are
        // non-negative here (validated), so the tie case never bends, but the explicit rule is pinned so a
        // native runtime matches bit-for-bit.
        private static double RoundHalfAwayFromZero(double value) =>
            value < 0 ? -Math.Floor(-value + 0.5) : Math.Floor(value + 0.5);

        // The integer number of fixed steps a frame of frameDt seconds schedules against a step-second clock,
        // in fixed-point (>> 16 to recover the integer step count, the remainder carried in the accumulator).
        // One divide, one multiply, one round (ADR section 2.2). The cross-language integer primitive
        // (seed-prng-crc-vectors.json physicsStepFixed): a native runtime asserts its own value equals this.
        public static int PhysicsStepsFixed(double frameDt, double step) =>
            (int)RoundHalfAwayFromZero((frameDt / step) * PhysicsStepFixedOne);

        // Decompose a bone's LOCAL matrix into the seven format channels [x, y, rotationDeg, scaleX, scaleY,
        // shearXDeg, shearYDeg], written into LocalScratch. This is the TRS+shear parameterization (shearY
        // fixed to 0), computed allocation-free and with Sqrt(a*a+b*b) rather than Hypot so the TS/C#/GDScript
        // mirrors use the identical formula (DecomposeWorld already uses sqrt, not hypot). A ComposeInto of the
        // result reproduces the matrix to f64 round-off.
        private static void DecomposeLocalInto(double[] local, int offset, double[] localScratch)
        {
            double a = local[offset];
            double b = local[offset + 1];
            double c = local[offset + 2];
            double d = local[offset + 3];
            double scaleX = Math.Sqrt((a * a) + (b * b));
            double xAxisAngle = Math.Atan2(b, a); // == rotation (shearY fixed to 0)
            double yAxisAngle = Math.Atan2(d, c);
            double shearX = xAxisAngle + (Math.PI / 2.0) - yAxisAngle;
            double scaleY = Math.Sqrt((c * c) + (d * d)) * Math.Cos(shearX);
            localScratch[0] = local[offset + 4]; // x
            localScratch[1] = local[offset + 5]; // y
            localScratch[2] = xAxisAngle * Affine.RadToDeg; // rotation, degrees
            localScratch[3] = scaleX;
            localScratch[4] = scaleY;
            localScratch[5] = shearX * Affine.RadToDeg; // shearX, degrees
            localScratch[6] = 0; // shearY (held at the decomposition convention)
        }

        private static double Clamp01(double value)
        {
            if (value < 0)
            {
                return 0;
            }

            if (value > 1)
            {
                return 1;
            }

            return value;
        }

        // Initialize (or re-initialize) a constraint's simulation state to REST on the current animated pose
        // (ADR section 2.1): p_c = target_c, v_c = 0, targetPrev_c = target_c, AccFixed = 0. Called on the
        // first evaluation and on any activation edge (skin change / re-activation, ADR section 6).
        private static void InitToRest(ResolvedPhysicsConstraint constraint, int channelCount, double[] targetScratch)
        {
            for (int ci = 0; ci < channelCount; ci += 1)
            {
                double target = targetScratch[ci];
                constraint.P[ci] = target;
                constraint.V[ci] = 0;
                constraint.TargetPrev[ci] = target;
            }

            constraint.AccFixed = 0;
            constraint.Initialized = true;
        }

        // Solve one physics constraint against the pose for a frame of frameDt seconds (ADR-0014 section 2).
        // Reads the bone's current LOCAL channels (the setpoint the earlier constraints produced), steps the
        // per-channel damped spring on the integer step clock, and writes the mixed result back to LOCAL. The
        // per-frame sampled scratch (mix/inertia/strength/damping/wind/gravity) was written by step 2; step/
        // mass are static. Allocation-free: decompose/target/world go into thread scratch, the (p, v,
        // targetPrev) state and accumulator live on the pre-allocated constraint.
        public static void Solve(Pose pose, ResolvedPhysicsConstraint constraint, double frameDt)
        {
            int boneIndex = constraint.BoneIndex;
            if (boneIndex < 0)
            {
                return;
            }

            sbyte[] channelCodes = constraint.ChannelCodes;
            int channelCount = channelCodes.Length;

            double[] localScratch = LocalScratch;
            double[] targetScratch = TargetScratch;

            int localOffset = boneIndex * Affine.Mat2x3Stride;
            DecomposeLocalInto(pose.Local, localOffset, localScratch);

            // The setpoint per simulated channel (the current animated + earlier-constraint local value).
            bool nonFinite = false;
            for (int ci = 0; ci < channelCount; ci += 1)
            {
                double target = localScratch[ChannelScratchLane[channelCodes[ci]]];
                targetScratch[ci] = target;
                if (!double.IsFinite(target))
                {
                    nonFinite = true;
                }
            }

            // Combine the sampled per-constraint knobs with the skeleton globals (ADR section 2.3 / section 5).
            double strength = constraint.SampledStrength;
            double damping = constraint.SampledDamping;
            double inertia = constraint.SampledInertia;
            double mass = constraint.BaseMass;
            double step = constraint.BaseStep;
            PhysicsSettings settings = pose.PhysicsSettings;
            double windEff = settings.Wind + constraint.SampledWind;
            double gravityEff = settings.Gravity + constraint.SampledGravity;
            double mixEff = Clamp01(settings.Mix * constraint.SampledMix);

            // Activation / (re)start: initialize to rest on the pose, then this frame runs its steps from rest
            // (ADR section 6). Under conformance frame 0 has frameDt 0, so the bone sits exactly on its pose.
            bool justInit = false;
            if (!constraint.Initialized)
            {
                InitToRest(constraint, channelCount, targetScratch);
                justInit = true;
            }

            // Teleport reset (ADR section 6): a setpoint TRANSLATION jump larger than PhysicsResetDistance (or a
            // non-finite setpoint) is a cut / skin swap, not motion. Snap to the new pose at rest and skip the
            // inertia carry this frame. Measured BEFORE the inertia carry, only on an already-initialized frame.
            bool teleport = false;
            if (!justInit)
            {
                double d;
                if (constraint.SimulatesX && constraint.SimulatesY)
                {
                    double dx = targetScratch[constraint.ChannelX] - constraint.TargetPrev[constraint.ChannelX];
                    double dy = targetScratch[constraint.ChannelY] - constraint.TargetPrev[constraint.ChannelY];
                    d = Math.Sqrt((dx * dx) + (dy * dy));
                }
                else if (constraint.SimulatesX)
                {
                    d = Math.Abs(targetScratch[constraint.ChannelX] - constraint.TargetPrev[constraint.ChannelX]);
                }
                else if (constraint.SimulatesY)
                {
                    d = Math.Abs(targetScratch[constraint.ChannelY] - constraint.TargetPrev[constraint.ChannelY]);
                }
                else
                {
                    // No translation channel simulated: the proxy jump is the bone's local setup-to-pose (x, y)
                    // delta.
                    int setupBase = boneIndex * Pose.SetupStride;
                    double dx = localScratch[0] - pose.Setup[setupBase];
                    double dy = localScratch[1] - pose.Setup[setupBase + 1];
                    d = Math.Sqrt((dx * dx) + (dy * dy));
                }

                if (nonFinite || d > PhysicsResetDistance)
                {
                    for (int ci = 0; ci < channelCount; ci += 1)
                    {
                        double target = targetScratch[ci];
                        constraint.P[ci] = target;
                        constraint.V[ci] = 0;
                        constraint.TargetPrev[ci] = target;
                    }

                    teleport = true;
                }
            }

            // Per-frame inertia carry (ADR section 2.4): the bone lags its own animated motion by (1 - inertia)
            // of the pose delta. Skipped on the init frame (targetPrev == target, a no-op anyway) and teleport.
            if (!justInit && !teleport)
            {
                for (int ci = 0; ci < channelCount; ci += 1)
                {
                    double target = targetScratch[ci];
                    double delta = target - constraint.TargetPrev[ci];
                    constraint.P[ci] = constraint.P[ci] + (delta * (1 - inertia));
                    constraint.TargetPrev[ci] = target;
                }
            }

            // Per-frame external-force precompute (ADR section 2.3): project world wind (+x) and gravity (-y)
            // into the bone's local frame using its CURRENT world rotation (post-animation, pre-physics), ONCE
            // per frame. External forces feed the x and y channels only; rotation/scaleX/shearX are pure
            // spring+inertia oscillators (aExt 0). Skipped entirely when no translation channel is simulated.
            double aExtX = 0;
            double aExtY = 0;
            if (constraint.SimulatesX || constraint.SimulatesY)
            {
                double[] worldScratch = WorldScratch;
                ResolveWorld.Resolve(pose, boneIndex, worldScratch, 0);
                // theta is the bone's world X-axis angle: DecomposeWorld's rotation = atan2(c, a) with a = m0,
                // c = m1.
                double theta = Math.Atan2(worldScratch[1], worldScratch[0]);
                double cs = Math.Cos(theta);
                double sn = Math.Sin(theta);
                double fx = windEff; // world +x
                double fy = -gravityEff; // world -y (positive gravity pulls down)
                double fLocalX = (fx * cs) + (fy * sn);
                double fLocalY = (-fx * sn) + (fy * cs);
                aExtX = fLocalX / mass;
                aExtY = fLocalY / mass;
            }

            // The integer step clock (ADR section 2.2): schedule an integer number of fixed steps, carry the
            // exact fractional remainder. n is an integer-exact function of accumulated time (no drift). These
            // are 32-bit int operations, matching the TS `>> 16` / `<< 16` which coerce to int32.
            int stepsFixed = PhysicsStepsFixed(frameDt, step);
            int accFixed = constraint.AccFixed + stepsFixed;
            int n = accFixed >> 16;
            constraint.AccFixed = accFixed - (n << 16);

            // Integrate and write back per channel. Each numbered op is a single f64 op (NO fused multiply-add:
            // a native runtime MUST NOT contract a*b+c into an FMA, which changes rounding and would desync).
            // This is the identical semi-implicit (symplectic) Euler order as the emitter's per-particle step.
            for (int ci = 0; ci < channelCount; ci += 1)
            {
                int code = channelCodes[ci];
                double target = targetScratch[ci];
                double aExt = code == PhysicsChannelX ? aExtX : code == PhysicsChannelY ? aExtY : 0;
                double p = constraint.P[ci];
                double v = constraint.V[ci];
                for (int stepIndex = 0; stepIndex < n; stepIndex += 1)
                {
                    double disp = target - p; // 1. displacement from the setpoint
                    double acc = disp * strength; // 2. spring acceleration
                    acc = acc + aExt; // 3. add the external acceleration (0 for rotation/scaleX/shearX)
                    v = v + (acc * step); // 4. symplectic velocity integrate (uses the NEW acceleration)
                    v = v * damping; // 5. per-step velocity retention
                    p = p + (v * step); // 6. symplectic position integrate (uses the NEW velocity)
                }

                constraint.P[ci] = p;
                constraint.V[ci] = v;
                // Output write-back (ADR section 2.6): lerp(target, p, mixEff), pinned as target + (p-target)*mix.
                localScratch[ChannelScratchLane[code]] = target + ((p - target) * mixEff);
            }

            // Recompose the LOCAL matrix from the (physics-adjusted) channels (ADR section 2.6): step 4
            // recomputes the world from this local, so physics stays a pure local write.
            Affine.ComposeInto(
                pose.Local,
                localOffset,
                localScratch[0],
                localScratch[1],
                localScratch[2],
                localScratch[3],
                localScratch[4],
                localScratch[5],
                localScratch[6]);
        }
    }
}
