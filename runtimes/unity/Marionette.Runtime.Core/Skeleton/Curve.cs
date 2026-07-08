using System;
using System.Collections.Generic;
using Marionette.Runtime.Core.Document;

namespace Marionette.Runtime.Core.Skeleton
{
    // Timeline curve evaluation and the solve side track representation (mirrors
    // packages/runtime-core/src/skeleton/curve.ts, LAW 4). This is our first principles bezier easing:
    // the cubic is sampled on build into a fixed (x, y) table; sampling brackets by x and lerps y. No
    // iterative root finding, deterministic.
    public static class Curves
    {
        // The piecewise linear resolution of the bezier easing curve. A committed design constant: raising
        // it changes solve output, so it is a deliberate fixture regenerating change, not an ad hoc tunable.
        public const int BezierSegments = 10;

        private const int BezierPoints = BezierSegments + 1;

        private const byte CurveLinear = 0;
        private const byte CurveStepped = 1;
        private const byte CurveBezier = 2;

        // A cubic bezier coordinate at parameter s, expanded form (no fused multiply add reassociation, so
        // other runtimes match the operation order). P0 and P3 are the implicit easing endpoints (0 and 1).
        private static double Bezier1d(double p0, double p1, double p2, double p3, double s)
        {
            double u = 1.0 - s;
            return (u * u * u * p0) + (3.0 * u * u * s * p1) + (3.0 * u * s * s * p2) + (s * s * s * p3);
        }

        private static void AppendBezierTable(List<double> outLanes, double cx1, double cy1, double cx2, double cy2)
        {
            double previousX = double.NegativeInfinity;
            for (int k = 0; k <= BezierSegments; k += 1)
            {
                double s = (double)k / BezierSegments;
                double x = Bezier1d(0, cx1, cx2, 1, s);
                double y = Bezier1d(0, cy1, cy2, 1, s);
                if (x < previousX)
                {
                    throw new InvalidOperationException(
                        $"bezier x table is not non-decreasing at s={s} (x={x} < previous {previousX}); "
                        + "control x must be within [0, 1] (validator CURVE_BEZIER_X_RANGE)");
                }

                previousX = x;
                outLanes.Add(x);
                outLanes.Add(y);
            }
        }

        // Evaluate the eased y for normalized input nx in (0, 1], reading the packed (x, y) table at base.
        public static double EvalBezierY(double[] table, int baseIndex, double nx)
        {
            int lo = 0;
            int hi = BezierPoints - 1;
            while (lo < hi)
            {
                int mid = (lo + hi) >> 1;
                if (table[baseIndex + (mid * 2)] >= nx)
                {
                    hi = mid;
                }
                else
                {
                    lo = mid + 1;
                }
            }

            int j = lo == 0 ? 1 : lo;
            int k = j - 1;
            double x0 = table[baseIndex + (k * 2)];
            double x1 = table[baseIndex + (j * 2)];
            double y0 = table[baseIndex + (k * 2) + 1];
            double y1 = table[baseIndex + (j * 2) + 1];
            double span = x1 - x0;
            if (span <= 0)
            {
                return y0;
            }

            return y0 + (((y1 - y0) * (nx - x0)) / span);
        }

        // Build a standalone packed bezier table (BezierPoints (x, y) pairs). Used by the unit tests.
        public static double[] BuildBezierTable(double cx1, double cy1, double cx2, double cy2)
        {
            var lanes = new List<double>();
            AppendBezierTable(lanes, cx1, cy1, cx2, cy2);
            return lanes.ToArray();
        }

        private static PreparedTrack BuildTrack(
            int keyCount,
            int componentCount,
            double[] times,
            Curve[] curves,
            double[] values)
        {
            var curveKinds = new byte[keyCount];
            var bezierBase = new int[keyCount];
            for (int i = 0; i < keyCount; i += 1)
            {
                bezierBase[i] = -1;
            }

            var bezierLanes = new List<double>();
            for (int i = 0; i < keyCount; i += 1)
            {
                CurveKind kind = curves[i].Kind;
                if (kind == CurveKind.Bezier)
                {
                    curveKinds[i] = CurveBezier;
                    // Only a non final keyframe has an outgoing segment to ease; the last curve is ignored.
                    if (i < keyCount - 1)
                    {
                        bezierBase[i] = bezierLanes.Count;
                        AppendBezierTable(bezierLanes, curves[i].Cx1, curves[i].Cy1, curves[i].Cx2, curves[i].Cy2);
                    }
                }
                else if (kind == CurveKind.Stepped)
                {
                    curveKinds[i] = CurveStepped;
                }
                else
                {
                    curveKinds[i] = CurveLinear;
                }
            }

            return new PreparedTrack(
                keyCount,
                componentCount,
                times,
                values,
                curveKinds,
                bezierBase,
                bezierLanes.ToArray());
        }

        public static PreparedTrack BuildScalarTrack(IReadOnlyList<ScalarKeyframe> keys)
        {
            int keyCount = keys.Count;
            var times = new double[keyCount];
            var values = new double[keyCount];
            var curves = new Curve[keyCount];
            for (int i = 0; i < keyCount; i += 1)
            {
                times[i] = keys[i].Time;
                values[i] = keys[i].Value;
                curves[i] = keys[i].Curve;
            }

            return BuildTrack(keyCount, 1, times, curves, values);
        }

        public static PreparedTrack BuildVec2Track(IReadOnlyList<Vec2Keyframe> keys)
        {
            int keyCount = keys.Count;
            var times = new double[keyCount];
            var values = new double[keyCount * 2];
            var curves = new Curve[keyCount];
            for (int i = 0; i < keyCount; i += 1)
            {
                times[i] = keys[i].Time;
                values[i * 2] = keys[i].X;
                values[(i * 2) + 1] = keys[i].Y;
                curves[i] = keys[i].Curve;
            }

            return BuildTrack(keyCount, 2, times, curves, values);
        }

        public static PreparedTrack BuildColorTrack(IReadOnlyList<ColorKeyframe> keys)
        {
            int keyCount = keys.Count;
            var times = new double[keyCount];
            var values = new double[keyCount * 4];
            var curves = new Curve[keyCount];
            for (int i = 0; i < keyCount; i += 1)
            {
                times[i] = keys[i].Time;
                Rgba color = keys[i].Color;
                values[i * 4] = color.R;
                values[(i * 4) + 1] = color.G;
                values[(i * 4) + 2] = color.B;
                values[(i * 4) + 3] = color.A;
                curves[i] = keys[i].Curve;
            }

            return BuildTrack(keyCount, 4, times, curves, values);
        }

        public static PreparedTrack BuildIkMixTrack(IReadOnlyList<IkKeyframe> frames)
        {
            int keyCount = frames.Count;
            var times = new double[keyCount];
            var values = new double[keyCount];
            var curves = new Curve[keyCount];
            for (int i = 0; i < keyCount; i += 1)
            {
                times[i] = frames[i].Time;
                values[i] = frames[i].Mix;
                curves[i] = frames[i].Curve;
            }

            return BuildTrack(keyCount, 1, times, curves, values);
        }

        // The bendPositive channel is stepped (ADR-0003 section 7): no curve, no eased value, only the
        // 0/1 flag held until the next key.
        public static PreparedStepBoolTrack BuildBendTrack(IReadOnlyList<IkKeyframe> frames)
        {
            int keyCount = frames.Count;
            var times = new double[keyCount];
            var values = new byte[keyCount];
            for (int i = 0; i < keyCount; i += 1)
            {
                times[i] = frames[i].Time;
                values[i] = (byte)(frames[i].BendPositive ? 1 : 0);
            }

            return new PreparedStepBoolTrack(keyCount, times, values);
        }

        public enum TransformMixChannel
        {
            MixRotate,
            MixX,
            MixY,
            MixScaleX,
            MixScaleY,
            MixShearY,
        }

        // One mix channel of a transform constraint timeline, built from ONLY the keyframes that key it.
        // A channel no keyframe keys yields null, and step 2 then holds the constraint's base value for it.
        public static PreparedTrack? BuildTransformMixTrack(
            IReadOnlyList<TransformKeyframe> frames,
            TransformMixChannel channel)
        {
            var present = new List<TransformKeyframe>();
            for (int i = 0; i < frames.Count; i += 1)
            {
                if (SelectChannel(frames[i], channel) != null)
                {
                    present.Add(frames[i]);
                }
            }

            if (present.Count == 0)
            {
                return null;
            }

            int keyCount = present.Count;
            var times = new double[keyCount];
            var values = new double[keyCount];
            var curves = new Curve[keyCount];
            for (int i = 0; i < keyCount; i += 1)
            {
                times[i] = present[i].Time;
                values[i] = SelectChannel(present[i], channel) ?? 0;
                curves[i] = present[i].Curve;
            }

            return BuildTrack(keyCount, 1, times, curves, values);
        }

        private static double? SelectChannel(TransformKeyframe frame, TransformMixChannel channel)
        {
            switch (channel)
            {
                case TransformMixChannel.MixRotate:
                    return frame.MixRotate;
                case TransformMixChannel.MixX:
                    return frame.MixX;
                case TransformMixChannel.MixY:
                    return frame.MixY;
                case TransformMixChannel.MixScaleX:
                    return frame.MixScaleX;
                case TransformMixChannel.MixScaleY:
                    return frame.MixScaleY;
                default:
                    return frame.MixShearY;
            }
        }

        public static PreparedTrack BuildDeformTrack(IReadOnlyList<DeformKeyframe> frames)
        {
            int componentCount = frames.Count > 0 ? frames[0].Offsets.Length : 0;
            int keyCount = frames.Count;
            var times = new double[keyCount];
            var values = new double[keyCount * componentCount];
            var curves = new Curve[keyCount];
            for (int i = 0; i < keyCount; i += 1)
            {
                times[i] = frames[i].Time;
                double[] offsets = frames[i].Offsets;
                for (int c = 0; c < componentCount; c += 1)
                {
                    values[(i * componentCount) + c] = offsets[c];
                }

                curves[i] = frames[i].Curve;
            }

            return BuildTrack(keyCount, componentCount, times, curves, values);
        }

        public static PreparedAttachmentTrack BuildAttachmentTrack(IReadOnlyList<AttachmentKeyframe> frames)
        {
            int keyCount = frames.Count;
            var times = new double[keyCount];
            var names = new string?[keyCount];
            for (int i = 0; i < keyCount; i += 1)
            {
                times[i] = frames[i].Time;
                names[i] = frames[i].Name;
            }

            return new PreparedAttachmentTrack(keyCount, times, names);
        }

        // The segment index for time t: the greatest i with times[i] <= t, clamped to [0, keyCount - 1].
        public static int FindSegmentIndex(double[] times, int keyCount, double t)
        {
            int last = keyCount - 1;
            if (t <= times[0])
            {
                return 0;
            }

            if (t >= times[last])
            {
                return last;
            }

            int lo = 0;
            int hi = last;
            while (hi - lo > 1)
            {
                int mid = (lo + hi) >> 1;
                if (times[mid] <= t)
                {
                    lo = mid;
                }
                else
                {
                    hi = mid;
                }
            }

            return lo;
        }

        // The interpolation fraction within segment i at time t, honoring the segment's curve.
        public static double SegmentFraction(PreparedTrack track, int i, double t)
        {
            if (i + 1 >= track.KeyCount)
            {
                return 0;
            }

            byte kind = track.CurveKinds[i];
            if (kind == CurveStepped)
            {
                return 0;
            }

            double t0 = track.Times[i];
            double span = track.Times[i + 1] - t0;
            double nx = span > 0 ? (t - t0) / span : 0;
            if (nx <= 0)
            {
                return 0;
            }

            if (nx > 1)
            {
                nx = 1;
            }

            if (kind == CurveBezier)
            {
                return EvalBezierY(track.BezierTable, track.BezierBase[i], nx);
            }

            return nx;
        }

        // Component c of segment i interpolated by fraction f.
        public static double SegmentComponent(PreparedTrack track, int i, double f, int c)
        {
            int cc = track.ComponentCount;
            double a = track.Values[(i * cc) + c];
            if (i + 1 >= track.KeyCount)
            {
                return a;
            }

            double b = track.Values[((i + 1) * cc) + c];
            return a + ((b - a) * f);
        }

        public static string? SampleAttachmentName(PreparedAttachmentTrack track, double t)
        {
            int i = FindSegmentIndex(track.Times, track.KeyCount, t);
            return track.Names[i];
        }

        public static bool SampleStepBool(PreparedStepBoolTrack track, double t)
        {
            int i = FindSegmentIndex(track.Times, track.KeyCount, t);
            return track.Values[i] == 1;
        }
    }
}
