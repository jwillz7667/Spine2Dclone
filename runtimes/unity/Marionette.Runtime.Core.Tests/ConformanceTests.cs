using System.Collections.Generic;
using System.Linq;
using Xunit;
using Xunit.Abstractions;

namespace Marionette.Runtime.Core.Tests
{
    // The skeleton conformance suite: the shared C# core must reproduce every committed fixture within the
    // A.5 tolerance (INV-2). One case per rig, driven directly from packages/conformance/src.
    public sealed class ConformanceTests
    {
        private readonly ITestOutputHelper _output;

        public ConformanceTests(ITestOutputHelper output)
        {
            _output = output;
        }

        // The seven committed skeleton rigs (packages/conformance/src/registry.ts RIG_IDS).
        public static IEnumerable<object[]> Rigs()
        {
            yield return new object[] { "rig-2bone" };
            yield return new object[] { "rig-rigid-mesh" };
            yield return new object[] { "rig-weighted-mesh" };
            yield return new object[] { "rig-one-bone-ik" };
            yield return new object[] { "rig-two-bone-ik" };
            yield return new object[] { "rig-transform-constraint" };
            yield return new object[] { "rig-deform" };
        }

        [Theory]
        [MemberData(nameof(Rigs))]
        public void Rig_matches_committed_fixture_within_tolerance(string rigId)
        {
            ConformanceResult result = ConformanceHarness.Run(rigId);

            _output.WriteLine(
                $"{rigId}: {result.LaneComparisons} lane comparisons, "
                + $"maxBasis={result.MaxBasisError:E3}, maxTranslation={result.MaxTranslationError:E3}, "
                + $"maxVertex={result.MaxVertexError:E3}");

            Assert.True(
                result.Ok,
                $"{rigId} drifted from the committed fixture:\n"
                + string.Join("\n", result.Failures.Take(25)));
        }
    }
}
