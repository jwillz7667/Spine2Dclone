using System;
using System.IO;

namespace Marionette.Runtime.Core.Tests
{
    // Locates the committed conformance sources by walking up from the test assembly to the repository
    // root (the first ancestor that contains packages/conformance/src). The natives read the fixtures,
    // sample specs, rigs, and integer vectors DIRECTLY from that one tree (single source of truth, never
    // copied), so a fixture regeneration in the TS oracle is seen here without any sync step.
    public static class RepoPaths
    {
        private static readonly string ConformanceSrc = ResolveConformanceSrc();

        public static string RigJson(string rigId) => Path.Combine(ConformanceSrc, "rigs", rigId + ".json");

        public static string RigBin(string rigId) => Path.Combine(ConformanceSrc, "rigs", rigId + ".bin");

        public static string SampleSpec(string rigId) =>
            Path.Combine(ConformanceSrc, "sample-spec", rigId + ".sample-spec.json");

        public static string Fixture(string rigId) =>
            Path.Combine(ConformanceSrc, "fixtures", rigId + ".fixture.json");

        public static string CrossLanguageVectors() =>
            Path.Combine(ConformanceSrc, "cross-language", "seed-prng-crc-vectors.json");

        private static string ResolveConformanceSrc()
        {
            var directory = new DirectoryInfo(AppContext.BaseDirectory);
            while (directory != null)
            {
                string candidate = Path.Combine(directory.FullName, "packages", "conformance", "src");
                if (Directory.Exists(candidate))
                {
                    return candidate;
                }

                directory = directory.Parent;
            }

            throw new DirectoryNotFoundException(
                "could not locate packages/conformance/src walking up from " + AppContext.BaseDirectory);
        }
    }
}
