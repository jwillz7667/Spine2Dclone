using System;
using Marionette.Runtime.Core.MathCore;

namespace Marionette.Runtime.Core.Skeleton
{
    // Bone transformMode inheritance (mirrors packages/runtime-core/src/skeleton/transform-mode.ts).
    // transformMode controls HOW a bone inherits its parent's WORLD transform at solve step 4. normal is
    // full inheritance; the other four selectively suppress part of the parent's rotation, scale, or
    // reflection. These semantics are our own first principles contract (LAW 4). All seven committed rigs
    // use normal; the four non normal modes are ported faithfully for completeness and future fixtures.
    public static class TransformModes
    {
        public const int Normal = 0;
        public const int OnlyTranslation = 1;
        public const int NoRotationOrReflection = 2;
        public const int NoScale = 3;
        public const int NoScaleOrReflection = 4;

        public static int FromName(string mode)
        {
            switch (mode)
            {
                case "normal":
                    return Normal;
                case "onlyTranslation":
                    return OnlyTranslation;
                case "noRotationOrReflection":
                    return NoRotationOrReflection;
                case "noScale":
                    return NoScale;
                case "noScaleOrReflection":
                    return NoScaleOrReflection;
                default:
                    throw new ArgumentException($"unknown transformMode '{mode}'");
            }
        }

        // Write a child bone's world matrix from its parent's world slice and its own local slice,
        // honoring mode. Allocation free. For Normal this is byte identical to Affine.MultiplyInto.
        public static void WorldFromParentByMode(
            double[] world,
            int worldOffset,
            double[] parentWorld,
            int parentOffset,
            double[] local,
            int localOffset,
            int mode)
        {
            double pa = parentWorld[parentOffset];
            double pb = parentWorld[parentOffset + 1];
            double pc = parentWorld[parentOffset + 2];
            double pd = parentWorld[parentOffset + 3];
            double ptx = parentWorld[parentOffset + 4];
            double pty = parentWorld[parentOffset + 5];
            double la = local[localOffset];
            double lb = local[localOffset + 1];
            double lc = local[localOffset + 2];
            double ld = local[localOffset + 3];
            double lx = local[localOffset + 4];
            double ly = local[localOffset + 5];

            double ea;
            double eb;
            double ec;
            double ed;
            double wtx;
            double wty;

            if (mode == OnlyTranslation)
            {
                ea = 1;
                eb = 0;
                ec = 0;
                ed = 1;
                wtx = ptx + lx;
                wty = pty + ly;
            }
            else
            {
                wtx = (pa * lx) + (pc * ly) + ptx;
                wty = (pb * lx) + (pd * ly) + pty;
                if (mode == Normal)
                {
                    ea = pa;
                    eb = pb;
                    ec = pc;
                    ed = pd;
                }
                else if (mode == NoRotationOrReflection)
                {
                    ea = Affine.Hypot(pa, pb);
                    eb = 0;
                    ec = 0;
                    ed = Affine.Hypot(pc, pd);
                }
                else
                {
                    double psx = Affine.Hypot(pa, pb);
                    double psy = Affine.Hypot(pc, pd);
                    double ix = psx == 0 ? 0 : 1.0 / psx;
                    double iy = psy == 0 ? 0 : 1.0 / psy;
                    ea = pa * ix;
                    eb = pb * ix;
                    ec = pc * iy;
                    ed = pd * iy;
                    if (mode == NoScaleOrReflection && ((ea * ed) - (eb * ec)) < 0)
                    {
                        ec = -eb;
                        ed = ea;
                    }
                }
            }

            world[worldOffset] = (ea * la) + (ec * lb);
            world[worldOffset + 1] = (eb * la) + (ed * lb);
            world[worldOffset + 2] = (ea * lc) + (ec * ld);
            world[worldOffset + 3] = (eb * lc) + (ed * ld);
            world[worldOffset + 4] = wtx;
            world[worldOffset + 5] = wty;
        }
    }
}
