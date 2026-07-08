using Marionette.Runtime.Core.Document;
using Marionette.Runtime.Core.MathCore;

namespace Marionette.Runtime.Core.Solve
{
    // Skinning (mirrors packages/runtime-core/src/solve/skin.ts, ADR-0003 section 9): solve step 5, before
    // deform. Both paths write (x, y) world space pairs into a caller provided pre allocated float[] and
    // allocate nothing. The output is float (System.Single) to mirror the TS Float32Array exactly, so the
    // committed fixtures (generated from a Float32Array) match to their stored precision.
    internal static class SkinSolve
    {
        // Weighted mesh skinning: for each logical vertex,
        //   pos = sum over influences of weight * (boneWorldMatrix[boneIndex] * (vx, vy)),
        // accumulated in STORED influence order (the accumulation order is part of the numerical contract).
        public static void SolveSkin(MeshAttachment mesh, double[] boneWorldMatrices, float[] output)
        {
            double[] stream = mesh.Vertices;
            int length = stream.Length;
            int cursor = 0;
            int outIndex = 0;
            while (cursor < length)
            {
                int influenceCount = (int)stream[cursor];
                cursor += 1;
                double px = 0;
                double py = 0;
                for (int i = 0; i < influenceCount; i += 1)
                {
                    int boneOffset = (int)stream[cursor] * Affine.Mat2x3Stride;
                    double vx = stream[cursor + 1];
                    double vy = stream[cursor + 2];
                    double weight = stream[cursor + 3];
                    cursor += 4;
                    double a = boneWorldMatrices[boneOffset];
                    double b = boneWorldMatrices[boneOffset + 1];
                    double c = boneWorldMatrices[boneOffset + 2];
                    double d = boneWorldMatrices[boneOffset + 3];
                    double tx = boneWorldMatrices[boneOffset + 4];
                    double ty = boneWorldMatrices[boneOffset + 5];
                    px += weight * ((a * vx) + (c * vy) + tx);
                    py += weight * ((b * vx) + (d * vy) + ty);
                }

                output[outIndex] = (float)px;
                output[outIndex + 1] = (float)py;
                outIndex += 2;
            }
        }

        // Unweighted mesh fast path: vertices is a flat [x0, y0, ...] stream of setup space positions
        // rigidly attached to the slot's bone, so pos = slotBoneWorld * (x, y).
        public static void SolveSkinUnweighted(MeshAttachment mesh, in Mat2x3 slotBoneWorld, float[] output)
        {
            double[] stream = mesh.Vertices;
            int length = stream.Length;
            double a = slotBoneWorld.A;
            double b = slotBoneWorld.B;
            double c = slotBoneWorld.C;
            double d = slotBoneWorld.D;
            double tx = slotBoneWorld.Tx;
            double ty = slotBoneWorld.Ty;
            for (int i = 0; i < length; i += 2)
            {
                double x = stream[i];
                double y = stream[i + 1];
                output[i] = (float)((a * x) + (c * y) + tx);
                output[i + 1] = (float)((b * x) + (d * y) + ty);
            }
        }
    }
}
