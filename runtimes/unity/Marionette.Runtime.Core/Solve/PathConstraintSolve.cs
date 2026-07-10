using System;
using Marionette.Runtime.Core.Document;
using Marionette.Runtime.Core.MathCore;
using Marionette.Runtime.Core.Skeleton;

namespace Marionette.Runtime.Core.Solve
{
    // The prepared, pose-independent geometry of one path attachment (mirrors PreparedPathGeometry in
    // packages/runtime-core/src/solve/path-constraint.ts, ADR-0013 sections 1 to 3). Built ONCE at BuildPose
    // from the target slot's setup default-skin path attachment. It carries the control-point layout
    // (weighted or unweighted, ADR-0002 codec), the derived curve/vertex counts, the committed cumulative
    // arc-length table, and the per-frame scratch (world control points, the per-curve arc-length LUT, and,
    // for a weighted path, the packed on-demand world buffer). All scratch is allocated here and reused every
    // frame, so the per-frame solve allocates nothing.
    public sealed class PreparedPathGeometry
    {
        public bool Closed { get; }
        public bool ConstantSpeed { get; }
        public int CurveCount { get; }

        // The logical control-point count V (3C+1 open, 3C closed). The world scratch is 2V lanes.
        public int VertexCount { get; }

        // The committed cumulative arc length to the END of each curve (ADR-0011); Length == CurveCount.
        public double[] Lengths { get; }
        public bool Weighted { get; }

        // Unweighted: the flat setup-space control points [x0, y0, x1, y1, ...]. Weighted: unused (the stream
        // is walked instead), left as an empty array.
        public double[] LocalVertices { get; }

        // Weighted: the ADR-0002 self-delimiting vertex stream (boneCount, (globalBoneIndex, vx, vy, weight) x
        // boneCount per logical control point). Unweighted: an empty array.
        public double[] Stream { get; }

        // Weighted: the ascending referenced-bone manifest (global bone indices), resolved once per frame into
        // BoneWorldScratch. Null for an unweighted path.
        public int[]? ManifestBones { get; }

        // The slot bone index the unweighted control points ride (-1 when unresolved). Unused for weighted.
        public int SlotBoneIndex { get; }

        // Scratch (allocated once, reused per frame): world control points (2V), the per-curve cumulative-chord
        // LUT (CurveCount * (PathCurveSubdivisions + 1)), and, weighted only, the packed on-demand world buffer
        // indexed by GLOBAL bone index (boneCount * Mat2x3Stride).
        public double[] WorldPoints { get; }
        public double[] CurveLut { get; }
        public double[]? BoneWorldScratch { get; }

        public PreparedPathGeometry(
            bool closed,
            bool constantSpeed,
            int curveCount,
            int vertexCount,
            double[] lengths,
            bool weighted,
            double[] localVertices,
            double[] stream,
            int[]? manifestBones,
            int slotBoneIndex,
            double[] worldPoints,
            double[] curveLut,
            double[]? boneWorldScratch)
        {
            Closed = closed;
            ConstantSpeed = constantSpeed;
            CurveCount = curveCount;
            VertexCount = vertexCount;
            Lengths = lengths;
            Weighted = weighted;
            LocalVertices = localVertices;
            Stream = stream;
            ManifestBones = manifestBones;
            SlotBoneIndex = slotBoneIndex;
            WorldPoints = worldPoints;
            CurveLut = curveLut;
            BoneWorldScratch = boneWorldScratch;
        }
    }

    // Path constraint solve (mirrors packages/runtime-core/src/solve/path-constraint.ts, ADR-0013, PP-B6). A
    // path constraint distributes a list of bones ALONG a target slot's path attachment (a piecewise cubic
    // Bezier spline) and orients them, blended per channel by mixRotate/mixX/mixY. It runs at solve-order step
    // 3 (before the step-4 world pass), so it resolves the path's WORLD control points ON DEMAND from current
    // local state (ResolveWorld), exactly like IK/transform read their target world, never from pose.World
    // (not yet written at step 3). It writes bone LOCAL x/y, rotation, and (chainScale only) scaleX; step 4
    // then reproduces the intended world.
    internal static class PathConstraintSolve
    {
        // Below this a length or curve span is degenerate and skipped, so no division by zero leaves the solver.
        private const double Epsilon = 1e-12;

        // The pinned per-curve subdivision for the constant-speed world arc-length LUT (ADR-0013 section 3b). A
        // fixed count, applied identically in all three runtimes, is the cross-language contract: the LUT is a
        // fixed sum of chord lengths plus one linear interpolation, so no iteration count or convergence test
        // can drift across language math libraries.
        public const int PathCurveSubdivisions = 64;

        // Solver-owned scratch, reused across calls so the solve allocates nothing. The solve is single
        // threaded and never re-entrant (the harness disables test parallelization), so ThreadStatic scratch is
        // safe. Mirrors the module-level scratch in path-constraint.ts (slotWorldScratch, pointScratch, and the
        // growable per-bone position/tangent/offset buffers).
        [ThreadStatic]
        private static double[]? _slotWorldScratch;

        [ThreadStatic]
        private static double[]? _pointScratch;

        [ThreadStatic]
        private static double[]? _positionScratch;

        [ThreadStatic]
        private static double[]? _tangentScratch;

        [ThreadStatic]
        private static double[]? _offsetScratch;

        private static double[] SlotWorldScratch => _slotWorldScratch ??= new double[Affine.Mat2x3Stride];

        private static double[] PointScratch => _pointScratch ??= new double[3];

        private static void EnsureBoneScratch(int n)
        {
            if (_positionScratch == null || _positionScratch.Length < n * 2)
            {
                _positionScratch = new double[n * 2];
            }

            if (_tangentScratch == null || _tangentScratch.Length < n)
            {
                _tangentScratch = new double[n];
            }

            if (_offsetScratch == null || _offsetScratch.Length < n)
            {
                _offsetScratch = new double[n];
            }
        }

        // Solve one path constraint against the pose (ADR-0013). Resolves world control points, distributes the
        // bones along the arc, orients them per rotateMode, and writes each bone's local, all blended by the
        // per-frame sampled mix channels. A constraint with no prepared path (no resolvable setup path
        // attachment), a non-positive-length path, or all-zero mix is a no-op.
        public static void Solve(Pose pose, ResolvedPathConstraint constraint)
        {
            PreparedPathGeometry? geom = constraint.Path;
            if (geom == null)
            {
                return;
            }

            int[] bones = constraint.BoneIndices;
            int n = bones.Length;
            if (n == 0)
            {
                return;
            }

            double mixRotate = constraint.SampledMixRotate;
            double mixX = constraint.SampledMixX;
            double mixY = constraint.SampledMixY;
            if (mixRotate <= 0 && mixX <= 0 && mixY <= 0)
            {
                return;
            }

            double totalLength = geom.Lengths[geom.CurveCount - 1];
            if (totalLength <= Epsilon)
            {
                return;
            }

            ComputeWorldControlPoints(pose, geom);
            if (geom.ConstantSpeed)
            {
                BuildCurveLut(geom);
            }

            EnsureBoneScratch(n);
            double[] positions = _positionScratch!;
            double[] tangents = _tangentScratch!;
            double[] offsets = _offsetScratch!;
            double[] point = PointScratch;

            double basePosition = constraint.PositionMode == PathPositionMode.Percent
                ? constraint.SampledPosition * totalLength
                : constraint.SampledPosition;
            ComputeSpacingOffsets(pose, constraint, totalLength, constraint.SampledSpacing, offsets);

            // Pass 1: sample the world path position and tangent angle for every bone (pure path samples,
            // independent of the local writes, so chain rotation can read a neighbour's position safely).
            for (int b = 0; b < n; b += 1)
            {
                double s = NormalizePosition(basePosition + offsets[b], totalLength, geom.Closed);
                MapPosition(geom, s, out int curve, out double t);
                EvalCurve(geom, curve, t, point);
                positions[b * 2] = point[0];
                positions[(b * 2) + 1] = point[1];
                tangents[b] = point[2];
            }

            // Pass 2: orient and write each bone.
            PathRotateMode rotateMode = constraint.RotateMode;
            double offsetRad = constraint.OffsetRotation * Scalar.DegToRad;
            for (int b = 0; b < n; b += 1)
            {
                int boneIndex = bones[b];
                if (boneIndex < 0)
                {
                    continue;
                }

                double px = positions[b * 2];
                double py = positions[(b * 2) + 1];

                double angle = tangents[b];
                double scaleXMul = 1.0;
                if (rotateMode != PathRotateMode.Tangent && b < n - 1)
                {
                    double nx = positions[(b + 1) * 2];
                    double ny = positions[((b + 1) * 2) + 1];
                    double dx = nx - px;
                    double dy = ny - py;
                    if ((dx * dx) + (dy * dy) > Epsilon)
                    {
                        angle = Math.Atan2(dy, dx);
                        if (rotateMode == PathRotateMode.ChainScale)
                        {
                            double desired = Affine.Hypot(dx, dy);
                            double natural = NaturalLength(pose, boneIndex) * WorldXScale(pose, boneIndex);
                            scaleXMul = natural > Epsilon ? desired / natural : 1.0;
                        }
                    }
                }

                WriteBoneLocal(pose, boneIndex, px, py, angle + offsetRad, scaleXMul, mixRotate, mixX, mixY);
            }
        }

        // Fill geom.WorldPoints (2V lanes) with the WORLD positions of the path's control points at solve-order
        // step 3, resolving bone worlds on demand (ADR-0013 section 2). Allocation-free.
        private static void ComputeWorldControlPoints(Pose pose, PreparedPathGeometry geom)
        {
            double[] outPoints = geom.WorldPoints;
            if (geom.Weighted)
            {
                // Resolve each referenced bone's world once into the packed scratch (indexed by global bone
                // index), then walk the ADR-0002 stream exactly as SolveSkin does, accumulating in stored
                // influence order.
                int[] manifest = geom.ManifestBones!;
                double[] world = geom.BoneWorldScratch!;
                for (int i = 0; i < manifest.Length; i += 1)
                {
                    int boneIndex = manifest[i];
                    if (boneIndex >= 0)
                    {
                        ResolveWorld.Resolve(pose, boneIndex, world, boneIndex * Affine.Mat2x3Stride);
                    }
                }

                double[] stream = geom.Stream;
                int length = stream.Length;
                int cursor = 0;
                int outIndex = 0;
                while (cursor < length)
                {
                    int influenceCount = (int)stream[cursor];
                    cursor += 1;
                    double px = 0;
                    double py = 0;
                    for (int k = 0; k < influenceCount; k += 1)
                    {
                        int boneOffset = (int)stream[cursor] * Affine.Mat2x3Stride;
                        double vx = stream[cursor + 1];
                        double vy = stream[cursor + 2];
                        double weight = stream[cursor + 3];
                        cursor += 4;
                        double a = world[boneOffset];
                        double b = world[boneOffset + 1];
                        double c = world[boneOffset + 2];
                        double d = world[boneOffset + 3];
                        double tx = world[boneOffset + 4];
                        double ty = world[boneOffset + 5];
                        px += weight * ((a * vx) + (c * vy) + tx);
                        py += weight * ((b * vx) + (d * vy) + ty);
                    }

                    outPoints[outIndex] = px;
                    outPoints[outIndex + 1] = py;
                    outIndex += 2;
                }

                return;
            }

            // Unweighted: every control point rides the slot's bone: worldPoint = slotBoneWorld * (x, y).
            int slotBoneIndex = geom.SlotBoneIndex;
            if (slotBoneIndex < 0)
            {
                return;
            }

            double[] slotWorld = SlotWorldScratch;
            ResolveWorld.Resolve(pose, slotBoneIndex, slotWorld, 0);
            double ma = slotWorld[0];
            double mb = slotWorld[1];
            double mc = slotWorld[2];
            double md = slotWorld[3];
            double mtx = slotWorld[4];
            double mty = slotWorld[5];
            double[] verts = geom.LocalVertices;
            int count = verts.Length;
            for (int i = 0; i < count; i += 2)
            {
                double x = verts[i];
                double y = verts[i + 1];
                outPoints[i] = (ma * x) + (mc * y) + mtx;
                outPoints[i + 1] = (mb * x) + (md * y) + mty;
            }
        }

        // Evaluate the world cubic Bezier of curve `i` at parameter t into (outArr[0], outArr[1]) and its
        // tangent ANGLE (radians) into outArr[2] (ADR-0013 section 1). The four control points are cp[3i ..
        // 3i+3]; the end anchor wraps modulo V, which for a closed spline returns curve C-1's end to control
        // point 0 and for an open spline is a no-op. Reads geom.WorldPoints directly (no allocation).
        private static void EvalCurve(PreparedPathGeometry geom, int i, double t, double[] outArr)
        {
            double[] wp = geom.WorldPoints;
            int v = geom.VertexCount;
            int b0 = i * 3;
            int p0 = b0 % v;
            int p1 = (b0 + 1) % v;
            int p2 = (b0 + 2) % v;
            int p3 = (b0 + 3) % v;
            double x0 = wp[p0 * 2];
            double y0 = wp[(p0 * 2) + 1];
            double x1 = wp[p1 * 2];
            double y1 = wp[(p1 * 2) + 1];
            double x2 = wp[p2 * 2];
            double y2 = wp[(p2 * 2) + 1];
            double x3 = wp[p3 * 2];
            double y3 = wp[(p3 * 2) + 1];
            double u = 1 - t;
            double c0 = u * u * u;
            double c1 = 3 * u * u * t;
            double c2 = 3 * u * t * t;
            double c3 = t * t * t;
            outArr[0] = (c0 * x0) + (c1 * x1) + (c2 * x2) + (c3 * x3);
            outArr[1] = (c0 * y0) + (c1 * y1) + (c2 * y2) + (c3 * y3);
            double d0 = 3 * u * u;
            double d1 = 6 * u * t;
            double d2 = 3 * t * t;
            double dx = (d0 * (x1 - x0)) + (d1 * (x2 - x1)) + (d2 * (x3 - x2));
            double dy = (d0 * (y1 - y0)) + (d1 * (y2 - y1)) + (d2 * (y3 - y2));
            outArr[2] = Math.Atan2(dy, dx);
        }

        // Build the per-curve cumulative-chord LUT in WORLD space (ADR-0013 section 3b), used only for constant
        // speed. For each curve, PathCurveSubdivisions+1 samples of the world Bezier are chorded and
        // accumulated; CurveLut[curve * stride + k] is the cumulative chord length to sub-sample k (entry 0 is
        // always 0). Allocation-free (writes into geom.CurveLut, evaluates through the point scratch).
        private static void BuildCurveLut(PreparedPathGeometry geom)
        {
            int stride = PathCurveSubdivisions + 1;
            double[] lut = geom.CurveLut;
            double[] point = PointScratch;
            for (int i = 0; i < geom.CurveCount; i += 1)
            {
                int baseIndex = i * stride;
                lut[baseIndex] = 0;
                EvalCurve(geom, i, 0, point);
                double prevX = point[0];
                double prevY = point[1];
                double acc = 0;
                for (int k = 1; k <= PathCurveSubdivisions; k += 1)
                {
                    EvalCurve(geom, i, (double)k / PathCurveSubdivisions, point);
                    double x = point[0];
                    double y = point[1];
                    acc += Affine.Hypot(x - prevX, y - prevY);
                    lut[baseIndex + k] = acc;
                    prevX = x;
                    prevY = y;
                }
            }
        }

        // Map an already-normalized arc-length position `s` in [0, L] to a curve index and Bezier parameter t
        // (ADR-0013 section 3). Cross-curve selection reads the committed cumulative Lengths; the within-curve
        // fraction becomes t directly (naive per-curve t) or, for constant speed, inverts the world LUT.
        private static void MapPosition(PreparedPathGeometry geom, double s, out int curve, out double t)
        {
            double[] lengths = geom.Lengths;
            int curveCount = geom.CurveCount;
            // Smallest curve whose cumulative end length reaches s (a monotone scan over the committed table,
            // ADR-0013 section 3a; curve counts are small and this ports trivially).
            int c = 0;
            while (c < curveCount - 1 && lengths[c] < s)
            {
                c += 1;
            }

            double curveStart = c == 0 ? 0 : lengths[c - 1];
            double curveLen = lengths[c] - curveStart;
            double curveFraction = curveLen > Epsilon ? Scalar.Clamp((s - curveStart) / curveLen, 0, 1) : 0;
            curve = c;
            if (!geom.ConstantSpeed)
            {
                t = curveFraction;
                return;
            }

            t = InvertCurveLut(geom, c, curveFraction);
        }

        // Invert the world arc-length LUT of `curve` for a target fraction-of-curve in [0, 1], returning the
        // Bezier parameter t (ADR-0013 section 3b). Linear interpolation inside the bracketing sub-segment; a
        // zero-length curve or sub-segment resolves to the segment start (no division by zero).
        private static double InvertCurveLut(PreparedPathGeometry geom, int curve, double fraction)
        {
            int stride = PathCurveSubdivisions + 1;
            int baseIndex = curve * stride;
            double[] lut = geom.CurveLut;
            double total = lut[baseIndex + PathCurveSubdivisions];
            if (total <= Epsilon)
            {
                return fraction;
            }

            double targetLen = fraction * total;
            int k = 0;
            while (k < PathCurveSubdivisions - 1 && lut[baseIndex + k + 1] < targetLen)
            {
                k += 1;
            }

            double segStart = lut[baseIndex + k];
            double segLen = lut[baseIndex + k + 1] - segStart;
            double segFraction = segLen > Epsilon ? (targetLen - segStart) / segLen : 0;
            return (k + segFraction) / PathCurveSubdivisions;
        }

        // Normalize a target arc-length position for an open (clamp to [0, L]) or closed (floored-modulo wrap
        // into [0, L)) path (ADR-0013 section 4.1).
        private static double NormalizePosition(double s, double totalLength, bool closed)
        {
            if (closed)
            {
                return ((s % totalLength) + totalLength) % totalLength;
            }

            return Scalar.Clamp(s, 0, totalLength);
        }

        // The setup natural length of a constrained bone (ADR-0013 section 4). pose.BoneLength holds each
        // bone's setup length; an unresolved bone index contributes 0.
        private static double NaturalLength(Pose pose, int boneIndex) =>
            boneIndex >= 0 ? pose.BoneLength[boneIndex] : 0;

        // Compute the cumulative arc-length offset from bone 0 to bone b for spacingMode (ADR-0013 section 4).
        // gap[b] is the increment from bone b-1 to bone b. Returns the offset array filled into `offsets` (N
        // entries).
        private static void ComputeSpacingOffsets(
            Pose pose,
            ResolvedPathConstraint constraint,
            double totalLength,
            double spacing,
            double[] offsets)
        {
            int[] bones = constraint.BoneIndices;
            int n = bones.Length;
            PathSpacingMode mode = constraint.SpacingMode;
            // proportional needs the natural total of the N-1 gap-contributing bones (bones 0 .. N-2).
            double scale = 0;
            if (mode == PathSpacingMode.Proportional)
            {
                double naturalTotal = 0;
                for (int b = 0; b < n - 1; b += 1)
                {
                    naturalTotal += NaturalLength(pose, bones[b]);
                }

                scale = naturalTotal > Epsilon ? spacing / naturalTotal : 0;
            }

            offsets[0] = 0;
            for (int b = 1; b < n; b += 1)
            {
                double gap;
                if (mode == PathSpacingMode.Fixed)
                {
                    gap = spacing;
                }
                else if (mode == PathSpacingMode.Percent)
                {
                    gap = spacing * totalLength;
                }
                else if (mode == PathSpacingMode.Length)
                {
                    gap = NaturalLength(pose, bones[b - 1]);
                }
                else
                {
                    // proportional
                    gap = NaturalLength(pose, bones[b - 1]) * scale;
                }

                offsets[b] = offsets[b - 1] + gap;
            }
        }

        // Write a bone's blended local from a target world position and world rotation, expressed in the bone's
        // parent world frame and mix-blended per channel (ADR-0013 section 5). mix* = 0 leaves the bone's
        // current local exactly; mix* = 1 lands on the target. scaleXMul = 1 (every mode but chainScale) leaves
        // scaleX.
        private static void WriteBoneLocal(
            Pose pose,
            int boneIndex,
            double worldX,
            double worldY,
            double worldAngleRad,
            double scaleXMul,
            double mixRotate,
            double mixX,
            double mixY)
        {
            Mat2x3 parentWorld = ResolveWorld.ParentWorldMat(pose, boneIndex);
            Mat2x3 inv = Affine.Invert(parentWorld);
            double localX = (inv.A * worldX) + (inv.C * worldY) + inv.Tx;
            double localY = (inv.B * worldX) + (inv.D * worldY) + inv.Ty;
            double solvedRotDeg = Ik.WorldDirToLocalRotDeg(in parentWorld, worldAngleRad);
            DecomposedTransform current = Affine.Decompose(ResolveWorld.LocalMat(pose, boneIndex));
            double x = current.X + (mixX * (localX - current.X));
            double y = current.Y + (mixY * (localY - current.Y));
            double rot = current.RotationDeg + (mixRotate * Scalar.WrapDegrees(solvedRotDeg - current.RotationDeg));
            double scaleX = current.ScaleX * (1.0 + (mixRotate * (scaleXMul - 1.0)));
            Affine.ComposeInto(
                pose.Local,
                boneIndex * Affine.Mat2x3Stride,
                x,
                y,
                rot,
                scaleX,
                current.ScaleY,
                current.ShearXDeg,
                0);
        }

        // The current world X-axis magnitude of a bone (its world segment scale), for chainScale length
        // preservation.
        private static double WorldXScale(Pose pose, int boneIndex)
        {
            Mat2x3 world = ResolveWorld.ResolveMat(pose, boneIndex);
            return Affine.Hypot(world.A, world.B);
        }
    }
}
