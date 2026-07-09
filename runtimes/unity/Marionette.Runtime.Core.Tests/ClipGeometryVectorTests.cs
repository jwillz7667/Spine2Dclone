using System.Collections.Generic;
using System.IO;
using Marionette.Runtime.Core.Document;
using Marionette.Runtime.Core.Json;
using Marionette.Runtime.Core.Skeleton;
using Xunit;

namespace Marionette.Runtime.Core.Tests
{
    // The clip-geometry cross-language golden vectors (PP-B2, ADR-0012 section 3, the a2-coverage compensating
    // control): the shared C# core's Sutherland-Hodgman triangle clip must reproduce every case in
    // packages/conformance/src/cross-language/clip-geometry-vectors.json that runtime-core (TS) produced.
    // The convex flag, ringCount, and per-ring sourceTri + vertexCount compare EXACT; positions and
    // barycentrics ride the VERTEX tolerance. Read directly from the one committed tree (no copy).
    public sealed class ClipGeometryVectorTests
    {
        [Fact]
        public void ClipTriangleList_matches_committed_vectors()
        {
            JsonValue root = JsonParser.Parse(File.ReadAllText(RepoPaths.ClipGeometryVectors()));
            IReadOnlyList<JsonValue> cases = root.Member("cases")!.AsArray();
            Assert.NotEmpty(cases);

            foreach (JsonValue vectorCase in cases)
            {
                string name = vectorCase.Member("name")!.AsString();
                double[] polygon = ReadNumbers(vectorCase.Member("polygon")!);
                bool expectedConvex = vectorCase.Member("convex")!.AsBool();
                double[] triVerts = ReadNumbers(vectorCase.Member("triVerts")!);
                List<int> triIndices = ReadInts(vectorCase.Member("triIndices")!);

                var clip = new ClippingAttachment(string.Empty, polygon);
                AttachmentGeometry.PreparedClip prepared = AttachmentGeometry.PrepareClipping(clip);
                Assert.True(
                    expectedConvex == prepared.Convex,
                    $"case '{name}' convex flag mismatch: expected {expectedConvex}, actual {prepared.Convex}");

                AttachmentGeometry.ClipBuffers buffers = AttachmentGeometry.MakeClipBuffers();
                // The clip polygon doubles as both the local (convexity/ear-clip decision, done in Prepare) and
                // the world polygon fed to the clip, exactly as the golden generator does.
                AttachmentGeometry.ClipResult result =
                    AttachmentGeometry.ClipTriangleList(prepared, polygon, triVerts, triIndices, buffers);

                JsonValue expected = vectorCase.Member("expected")!;
                int expectedRingCount = (int)expected.Member("ringCount")!.AsNumber();
                Assert.True(
                    expectedRingCount == result.RingCount,
                    $"case '{name}' ringCount mismatch: expected {expectedRingCount}, actual {result.RingCount}");

                IReadOnlyList<JsonValue> expectedRings = expected.Member("rings")!.AsArray();
                Assert.Equal(expectedRingCount, expectedRings.Count);

                int vertexBase = 0;
                for (int r = 0; r < expectedRings.Count; r += 1)
                {
                    JsonValue expectedRing = expectedRings[r];
                    int expectedSourceTri = (int)expectedRing.Member("sourceTri")!.AsNumber();
                    int expectedVertexCount = (int)expectedRing.Member("vertexCount")!.AsNumber();

                    Assert.True(
                        expectedVertexCount == buffers.RingVertexCount[r],
                        $"case '{name}' ring {r} vertexCount mismatch: expected {expectedVertexCount}, "
                        + $"actual {buffers.RingVertexCount[r]}");
                    Assert.True(
                        expectedSourceTri == buffers.RingSourceTri[r],
                        $"case '{name}' ring {r} sourceTri mismatch: expected {expectedSourceTri}, "
                        + $"actual {buffers.RingSourceTri[r]}");

                    double[] expectedPositions = ReadNumbers(expectedRing.Member("positions")!);
                    double[] expectedBary = ReadNumbers(expectedRing.Member("bary")!);
                    Assert.Equal(expectedVertexCount * 2, expectedPositions.Length);
                    Assert.Equal(expectedVertexCount * 3, expectedBary.Length);

                    for (int v = 0; v < expectedVertexCount; v += 1)
                    {
                        int outVertex = vertexBase + v;
                        AssertWithin(
                            name, r, v, "position x",
                            buffers.Positions[outVertex * 2], expectedPositions[v * 2]);
                        AssertWithin(
                            name, r, v, "position y",
                            buffers.Positions[(outVertex * 2) + 1], expectedPositions[(v * 2) + 1]);
                        AssertWithin(name, r, v, "bary b0", buffers.Bary[outVertex * 3], expectedBary[v * 3]);
                        AssertWithin(
                            name, r, v, "bary b1", buffers.Bary[(outVertex * 3) + 1], expectedBary[(v * 3) + 1]);
                        AssertWithin(
                            name, r, v, "bary b2", buffers.Bary[(outVertex * 3) + 2], expectedBary[(v * 3) + 2]);
                    }

                    vertexBase += expectedVertexCount;
                }
            }
        }

        private static void AssertWithin(string name, int ring, int vertex, string lane, double actual, double expected)
        {
            Assert.True(
                Tolerances.Vertex.Within(actual, expected),
                $"case '{name}' ring {ring} vertex {vertex} {lane} drifts: expected {expected:R}, actual {actual:R}");
        }

        private static double[] ReadNumbers(JsonValue array)
        {
            IReadOnlyList<JsonValue> items = array.AsArray();
            var result = new double[items.Count];
            for (int i = 0; i < items.Count; i += 1)
            {
                result[i] = items[i].AsNumber();
            }

            return result;
        }

        private static List<int> ReadInts(JsonValue array)
        {
            IReadOnlyList<JsonValue> items = array.AsArray();
            var result = new List<int>(items.Count);
            for (int i = 0; i < items.Count; i += 1)
            {
                result.Add((int)items[i].AsNumber());
            }

            return result;
        }
    }
}
