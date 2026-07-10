using System.Collections.Generic;
using Marionette.Runtime.View;
using Xunit;

namespace Marionette.Runtime.Core.Tests
{
    // The buffer assembler flattens draw items (in draw order) into pooled batches grouped by (blend mode,
    // atlas page). These assert the batching invariants a host relies on: a batch never spans a blend-mode
    // change, indices stay within their batch's own vertex range, the total geometry is conserved, and
    // reusing a RenderBatchSet across frames does not change the produced counts (the pooling contract).
    public sealed class MeshBufferAssemblerTests
    {
        [Fact]
        public void BlendModeRigProducesOneBatchPerDistinctAdjacentBlendMode()
        {
            const string rigId = "rig-blendmodes";
            ViewScene scene = ViewScene.Load(rigId);
            SampleSpec spec = SampleSpec.Load(RepoPaths.SampleSpec(rigId));
            Fixture fixture = Fixture.Load(RepoPaths.Fixture(rigId));

            FixtureSample sample = fixture.Samples[0];
            scene.Sample(spec, sample, 0);
            SkeletonDrawList items = scene.GatherDrawItems(spec.Animation, sample.Time);

            var batches = new RenderBatchSet();
            MeshBufferAssembler.Assemble(items, batches);

            // rig-blendmodes has four region slots with four DISTINCT consecutive blend modes, so no two
            // adjacent items share a batch key: four single-quad batches.
            Assert.Equal(4, batches.Count);
            for (int b = 0; b < batches.Count; b += 1)
            {
                Assert.Equal(4, batches[b].VertexCount);
                Assert.Equal(6, batches[b].IndexCount);
            }
        }

        [Theory]
        [InlineData("rig-blendmodes")]
        [InlineData("rig-rigid-mesh")]
        [InlineData("rig-clipping")]
        public void BatchingConservesGeometryAndKeepsIndicesInRange(string rigId)
        {
            ViewScene scene = ViewScene.Load(rigId);
            SampleSpec spec = SampleSpec.Load(RepoPaths.SampleSpec(rigId));
            Fixture fixture = Fixture.Load(RepoPaths.Fixture(rigId));

            var batches = new RenderBatchSet();
            for (int s = 0; s < fixture.Samples.Count; s += 1)
            {
                FixtureSample sample = fixture.Samples[s];
                scene.Sample(spec, sample, s);
                SkeletonDrawList items = scene.GatherDrawItems(spec.Animation, sample.Time);
                MeshBufferAssembler.Assemble(items, batches);

                int itemVertices = 0;
                int itemIndices = 0;
                for (int i = 0; i < items.Count; i += 1)
                {
                    if (items[i].VertexCount == 0 || items[i].TriangleIndexCount == 0)
                    {
                        continue;
                    }

                    itemVertices += items[i].VertexCount;
                    itemIndices += items[i].TriangleIndexCount;
                }

                int batchVertices = 0;
                int batchIndices = 0;
                for (int b = 0; b < batches.Count; b += 1)
                {
                    RenderBatch batch = batches[b];
                    batchVertices += batch.VertexCount;
                    batchIndices += batch.IndexCount;
                    for (int t = 0; t < batch.IndexCount; t += 1)
                    {
                        Assert.InRange(batch.Indices[t], 0, batch.VertexCount - 1);
                    }
                }

                Assert.Equal(itemVertices, batchVertices);
                Assert.Equal(itemIndices, batchIndices);
            }
        }

        [Fact]
        public void ReusingABatchSetAcrossFramesProducesTheSameCounts()
        {
            const string rigId = "rig-rigid-mesh";
            ViewScene scene = ViewScene.Load(rigId);
            SampleSpec spec = SampleSpec.Load(RepoPaths.SampleSpec(rigId));
            Fixture fixture = Fixture.Load(RepoPaths.Fixture(rigId));

            var reused = new RenderBatchSet();
            var counts = new List<int>();
            for (int pass = 0; pass < 2; pass += 1)
            {
                for (int s = 0; s < fixture.Samples.Count; s += 1)
                {
                    FixtureSample sample = fixture.Samples[s];
                    scene.Sample(spec, sample, s);
                    SkeletonDrawList items = scene.GatherDrawItems(spec.Animation, sample.Time);
                    MeshBufferAssembler.Assemble(items, reused);
                    if (pass == 0)
                    {
                        counts.Add(reused.Count);
                    }
                    else
                    {
                        Assert.Equal(counts[s], reused.Count);
                    }
                }
            }
        }
    }
}
