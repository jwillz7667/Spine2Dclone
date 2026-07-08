namespace Marionette.Runtime.Core.Solve
{
    // Deform (mirrors packages/runtime-core/src/solve/deform.ts, ADR-0003 section 9): solve step 5, AFTER
    // skinning. The per vertex (dx, dy) offsets are ADDED to the POST SKIN world space positions:
    // final_i = skinned_i + (dx_i, dy_i). World space, post skin, additive. output may alias skinned
    // (each lane is read before its matching write, so in place is safe).
    internal static class Deform
    {
        public static void ApplyDeform(float[] skinned, double[] offsets, float[] output, int count)
        {
            for (int i = 0; i < count; i += 1)
            {
                int x = i * 2;
                int y = x + 1;
                output[x] = (float)(skinned[x] + offsets[x]);
                output[y] = (float)(skinned[y] + offsets[y]);
            }
        }
    }
}
