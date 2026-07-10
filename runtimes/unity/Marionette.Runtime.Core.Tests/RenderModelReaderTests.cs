using System.IO;
using Marionette.Runtime.View;
using Xunit;

namespace Marionette.Runtime.Core.Tests
{
    // The render-model reader parses the RENDER-only projection (region/mesh/linkedmesh attachments plus the
    // atlas) the solve reader skips, validating on import with a typed error (Law 3, applied to the render
    // boundary). Positive cases read committed rigs; the negative case asserts a malformed attachment raises
    // the typed RenderModelReadException.
    public sealed class RenderModelReaderTests
    {
        [Fact]
        public void ReadsRegionAttachmentsAndTheAtlasFromABlendModeRig()
        {
            RenderModel model = RenderModelReader.Parse(File.ReadAllText(RepoPaths.RigJson("rig-blendmodes")));

            RenderSkin? skin = model.FindSkin("default");
            Assert.NotNull(skin);
            Assert.Single(model.Atlas.Pages);

            RenderAttachment? attachment = skin!.Find("slot_normal", "region_normal");
            Assert.NotNull(attachment);
            Assert.Equal(RenderAttachmentKind.Region, attachment!.Kind);
            Assert.NotNull(attachment.Region);
            Assert.False(string.IsNullOrEmpty(attachment.Region!.Path));
            Assert.True(attachment.Region.Width > 0);
            Assert.True(attachment.Region.Height > 0);
        }

        [Fact]
        public void ReadsMeshTrianglesAndUvsFromARigidMeshRig()
        {
            RenderModel model = RenderModelReader.Parse(File.ReadAllText(RepoPaths.RigJson("rig-rigid-mesh")));

            RenderAttachment? attachment = model.FindSkin("default")!.Find("mesh_slot", "panel");
            Assert.NotNull(attachment);
            Assert.Equal(RenderAttachmentKind.Mesh, attachment!.Kind);
            RenderMesh mesh = attachment.Mesh!;
            Assert.True(mesh.Uvs.Length >= 6);
            Assert.True(mesh.Triangles.Length >= 3);
            Assert.Equal(0, mesh.Triangles.Length % 3);
        }

        [Fact]
        public void ReadsTheSequenceBlockNamingInputs()
        {
            RenderModel model = RenderModelReader.Parse(File.ReadAllText(RepoPaths.RigJson("rig-sequences")));

            RenderAttachment? attachment = model.FindSkin("default")!.Find("slot0", "frames");
            Assert.NotNull(attachment);
            RenderSequence sequence = attachment!.Sequence!.Value;
            Assert.Equal(4, sequence.Count);
            Assert.Equal(2, sequence.SetupIndex);
            Assert.Equal(0, sequence.Start);
            Assert.Equal(2, sequence.Digits);
        }

        [Fact]
        public void ReadsLinkedMeshRenderFields()
        {
            RenderModel model = RenderModelReader.Parse(File.ReadAllText(RepoPaths.RigJson("rig-linked-mesh")));

            bool foundLinked = false;
            RenderSkin skin = model.FindSkin("default")!;
            foreach (var slot in skin.Slots)
            {
                foreach (var attachment in slot.Value)
                {
                    if (attachment.Value.Kind == RenderAttachmentKind.LinkedMesh)
                    {
                        foundLinked = true;
                        Assert.False(string.IsNullOrEmpty(attachment.Value.LinkedMesh!.Parent));
                    }
                }
            }

            Assert.True(foundLinked, "rig-linked-mesh has no linkedmesh attachment in the default skin");
        }

        [Fact]
        public void RejectsARegionAttachmentMissingItsPathWithTheTypedError()
        {
            const string malformed =
                "{\"skins\":[{\"name\":\"default\",\"attachments\":"
                + "{\"s\":{\"a\":{\"type\":\"region\",\"x\":0}}}}]}";

            Assert.Throws<RenderModelReadException>(() => RenderModelReader.Parse(malformed));
        }
    }
}
