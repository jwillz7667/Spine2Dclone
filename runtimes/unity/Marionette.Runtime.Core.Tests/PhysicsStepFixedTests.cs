using System.Collections.Generic;
using System.Globalization;
using System.IO;
using Marionette.Runtime.Core.Json;
using Marionette.Runtime.Core.Solve;
using Xunit;

namespace Marionette.Runtime.Core.Tests
{
    // The physics step-clock integer primitive (ADR-0014 section 2.2, PP-B7). PhysicsStepsFixed is the ONE
    // determinism surface the physics solve adds: the integer number of fixed steps a frame schedules against a
    // constraint's fixed timestep. The shared C# core must reproduce every value in the physicsStepFixed table
    // of packages/conformance/src/cross-language/seed-prng-crc-vectors.json bit for bit, or physics parity
    // across web, Unity, and Godot breaks. Keys are "frameDt,step"; a token is either "num/den" or a decimal.
    public sealed class PhysicsStepFixedTests
    {
        [Fact]
        public void PhysicsStepsFixed_matches_committed_vectors()
        {
            JsonValue physicsStepFixed = JsonParser
                .Parse(File.ReadAllText(RepoPaths.CrossLanguageVectors()))
                .Member("physicsStepFixed")!;

            foreach (KeyValuePair<string, JsonValue> entry in physicsStepFixed.Members())
            {
                if (entry.Key.StartsWith("_"))
                {
                    continue;
                }

                string[] parts = entry.Key.Split(',');
                double frameDt = ParseToken(parts[0]);
                double step = ParseToken(parts[1]);
                int expected = (int)entry.Value.AsNumber();

                Assert.Equal(expected, PhysicsConstraintSolve.PhysicsStepsFixed(frameDt, step));
            }
        }

        // Parse one "frameDt" / "step" token: a "num/den" fraction (e.g. "1/60") reproduces the TS `1 / 60`
        // division bit for bit, or a plain decimal (e.g. "0.02"). Any other form is a corpus authoring error.
        private static double ParseToken(string token)
        {
            int slash = token.IndexOf('/');
            if (slash < 0)
            {
                return double.Parse(token, CultureInfo.InvariantCulture);
            }

            double numerator = double.Parse(token.Substring(0, slash), CultureInfo.InvariantCulture);
            double denominator = double.Parse(token.Substring(slash + 1), CultureInfo.InvariantCulture);
            return numerator / denominator;
        }
    }
}
