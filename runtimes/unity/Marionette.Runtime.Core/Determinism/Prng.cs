using System.Text;

namespace Marionette.Runtime.Core.Determinism
{
    // The normative seeded PRNG and stream seed derivations (mirrors
    // packages/runtime-core/src/effects/prng.ts). Determinism relies on INTEGER arithmetic, which is bit
    // reproducible across TS, C#, and GDScript. In C# use uint with unchecked: Math.imul(x, y) equals
    // unchecked((uint)x * (uint)y), and the >>> logical shift is the uint >> operator. Every value is a
    // uint32; there is no float path in the emission seed chain.
    public sealed class PrngState
    {
        public uint S;

        public PrngState(uint seed)
        {
            S = seed;
        }
    }

    public static class Prng
    {
        private const uint Fnv1aOffsetBasis = 0x811c9dc5u;
        private const uint Fnv1aPrime = 0x01000193u;

        public static PrngState MakePrng(uint seed) => new PrngState(seed);

        // Advance the state and return the next uint32.
        public static uint NextU32(PrngState state)
        {
            unchecked
            {
                state.S = state.S + 0x6d2b79f5u;
                uint t = state.S;
                t = (t ^ (t >> 15)) * (t | 1u);
                t ^= t + ((t ^ (t >> 7)) * (t | 61u));
                return t ^ (t >> 14);
            }
        }

        // A double in [0, 1): exact, since dividing a uint32 by 2^32 is exact in f64. Never returns 1.0.
        public static double NextUnit(PrngState state) => NextU32(state) / 4294967296.0;

        // Derive an independent uint32 stream seed from two uint32 inputs (used to mint per emitter and
        // per bundle item seeds). All ops are uint32.
        public static uint Hash32(uint a, uint b)
        {
            unchecked
            {
                uint h = a ^ 0x9e3779b9u;
                h = (h ^ b) * 0x85ebca6bu;
                h = (h ^ (h >> 13)) * 0xc2b2ae35u;
                return h ^ (h >> 16);
            }
        }

        // The pinned string to uint32 derivation (FNV-1a 32 over the UTF-8 bytes of spinId). Operating on
        // UTF-8 BYTES (not UTF-16 code units) pins the derivation for non ASCII spinIds too.
        public static uint SpinSeed(string spinId)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(spinId);
            unchecked
            {
                uint h = Fnv1aOffsetBasis;
                for (int i = 0; i < bytes.Length; i += 1)
                {
                    h ^= bytes[i];
                    h *= Fnv1aPrime;
                }

                return h;
            }
        }
    }
}
