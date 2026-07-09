using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

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

        // The clip-geometry cross-language golden vectors (PP-B2, ADR-0012 section 3): the Sutherland-Hodgman
        // triangle-clip corpus every runtime must reproduce, read directly from the one committed tree.
        public static string ClipGeometryVectors() =>
            Path.Combine(ConformanceSrc, "cross-language", "clip-geometry-vectors.json");

        // Every committed skeleton rig, discovered from the fixtures directory rather than a hardcoded
        // list, so the harness runs EXACTLY the landed corpus (the materialized projection of
        // registry.ts LANDED_RIG_IDS: the generator writes one <rigId>.fixture.json per landed rig and the
        // .fixtures.lock gate enforces the set). A newly landed rig is picked up automatically here (its
        // fixture must then pass), so corpus growth is caught, never silently skipped. Sorted for a
        // deterministic, filesystem-order-independent run order.
        public static IReadOnlyList<string> AllRigIds()
        {
            string fixturesDir = Path.Combine(ConformanceSrc, "fixtures");
            List<string> rigIds = Directory
                .EnumerateFiles(fixturesDir, "*.fixture.json")
                .Select(Path.GetFileName)
                .Where(name => name != null)
                .Select(name => name!.Substring(0, name!.Length - ".fixture.json".Length))
                .OrderBy(id => id, StringComparer.Ordinal)
                .ToList();

            if (rigIds.Count == 0)
            {
                throw new InvalidDataException(
                    "no committed fixtures found under " + fixturesDir + "; the conformance corpus is empty");
            }

            return rigIds;
        }

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
