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

        // The committed skeleton rigs the native harness mirrors, enumerated from the conformance corpus
        // (RepoPaths.AllRigIds discovers every packages/conformance/src/fixtures/*.fixture.json) rather than
        // a hardcoded list, so the full registry.ts landed-rig set runs and any newly landed rig is picked
        // up automatically. Covers the affine, mesh, slot (blendMode + color), draw-order, and fired-event
        // lanes across all rigs (rig-transform-modes, rig-blendmodes, rig-events-draworder, rig-events-loop
        // included).
        public static IEnumerable<object[]> Rigs()
        {
            foreach (string rigId in RepoPaths.AllRigIds())
            {
                yield return new object[] { rigId };
            }
        }

        [Theory]
        [MemberData(nameof(Rigs))]
        public void Rig_matches_committed_fixture_within_tolerance(string rigId)
        {
            ConformanceResult result = ConformanceHarness.Run(rigId);

            _output.WriteLine(
                $"{rigId}: {result.LaneComparisons} lane comparisons, "
                + $"maxBasis={result.MaxBasisError:E3}, maxTranslation={result.MaxTranslationError:E3}, "
                + $"maxVertex={result.MaxVertexError:E3}, maxColor={result.MaxColorError:E3}");

            Assert.True(
                result.Ok,
                $"{rigId} drifted from the committed fixture:\n"
                + string.Join("\n", result.Failures.Take(25)));
        }
    }
}
