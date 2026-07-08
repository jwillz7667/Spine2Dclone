using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using Marionette.Runtime.Core.Determinism;
using Marionette.Runtime.Core.Json;
using Xunit;

namespace Marionette.Runtime.Core.Tests
{
    // The cross language integer determinism corpus (WP-5.5): the shared C# core must reproduce every
    // value in packages/conformance/src/cross-language/seed-prng-crc-vectors.json bit for bit. Particle
    // emission parity across web, Unity, and Godot rests entirely on this integer surface.
    public sealed class CrossLanguageVectorTests
    {
        private static JsonValue LoadVectors() =>
            JsonParser.Parse(File.ReadAllText(RepoPaths.CrossLanguageVectors()));

        [Fact]
        public void SpinSeed_matches_committed_vectors()
        {
            JsonValue spinSeed = LoadVectors().Member("spinSeed")!;
            foreach (KeyValuePair<string, JsonValue> entry in spinSeed.Members())
            {
                if (entry.Key.StartsWith("_"))
                {
                    continue;
                }

                uint expected = (uint)entry.Value.AsNumber();
                Assert.Equal(expected, Prng.SpinSeed(entry.Key));
            }
        }

        [Fact]
        public void Hash32_matches_committed_vectors()
        {
            JsonValue hash32 = LoadVectors().Member("hash32")!;
            foreach (KeyValuePair<string, JsonValue> entry in hash32.Members())
            {
                if (entry.Key.StartsWith("_"))
                {
                    continue;
                }

                string[] parts = entry.Key.Split(',');
                uint a = uint.Parse(parts[0], CultureInfo.InvariantCulture);
                uint b = uint.Parse(parts[1], CultureInfo.InvariantCulture);
                uint expected = (uint)entry.Value.AsNumber();
                Assert.Equal(expected, Prng.Hash32(a, b));
            }
        }

        [Fact]
        public void InstanceSeed_chain_matches_committed_vectors()
        {
            JsonValue samples = LoadVectors().Member("instanceSeed")!.Member("samples")!;
            foreach (JsonValue sample in samples.AsArray())
            {
                string spinId = sample.Member("spinId")!.AsString();
                uint expectedTriggerSeed = (uint)sample.Member("triggerSeed")!.AsNumber();
                uint layerIndex = (uint)sample.Member("layerIndex")!.AsNumber();
                uint expectedInstanceSeed = (uint)sample.Member("instanceSeed")!.AsNumber();

                uint triggerSeed = Prng.Hash32(Prng.SpinSeed(spinId), 0);
                Assert.Equal(expectedTriggerSeed, triggerSeed);

                uint instanceSeed = Prng.Hash32(triggerSeed, layerIndex);
                Assert.Equal(expectedInstanceSeed, instanceSeed);
            }
        }

        [Fact]
        public void Mulberry32_stream_matches_committed_vectors()
        {
            JsonValue mulberry = LoadVectors().Member("mulberry32")!;
            uint seed = (uint)mulberry.Member("seed")!.AsNumber();
            IReadOnlyList<JsonValue> expected = mulberry.Member("nextU32_first16")!.AsArray();

            PrngState state = Prng.MakePrng(seed);
            for (int i = 0; i < expected.Count; i += 1)
            {
                Assert.Equal((uint)expected[i].AsNumber(), Prng.NextU32(state));
            }
        }

        [Fact]
        public void Crc32_check_value_matches()
        {
            JsonValue crc = LoadVectors().Member("crc32")!;
            uint expected = (uint)crc.Member("check_123456789")!.AsNumber();
            byte[] bytes = Encoding.ASCII.GetBytes("123456789");
            Assert.Equal(expected, Crc32.Compute(bytes));
        }

        [Fact]
        public void Crc32_twin_body_matches_each_binary_rig()
        {
            JsonValue twinBody = LoadVectors().Member("crc32")!.Member("twinBody")!;
            foreach (KeyValuePair<string, JsonValue> entry in twinBody.Members())
            {
                if (entry.Key.StartsWith("_"))
                {
                    continue;
                }

                string rigId = entry.Key;
                uint expected = (uint)entry.Value.AsNumber();
                byte[] bytes = File.ReadAllBytes(RepoPaths.RigBin(rigId));

                // twinBody is the CRC over the container EXCLUDING its 4 byte trailer (the trailer is the
                // little endian CRC the decoder recomputes and matches).
                uint actual = Crc32.Compute(bytes, 0, bytes.Length - 4);
                Assert.Equal(expected, actual);
            }
        }
    }
}
