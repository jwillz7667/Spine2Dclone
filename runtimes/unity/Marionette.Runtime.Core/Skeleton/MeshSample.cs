using System;
using System.Collections.Generic;
using Marionette.Runtime.Core.Document;
using Marionette.Runtime.Core.MathCore;
using Marionette.Runtime.Core.Solve;

namespace Marionette.Runtime.Core.Skeleton
{
    public enum MeshAttachmentErrorReason
    {
        NotFound,
        NotAMesh,
    }

    // Why a mesh attachment could not be sampled (mirrors MeshAttachmentError in mesh-sample.ts). A typed
    // error carrying the exact (skin, slot, attachment) triple, never a bare throw.
    public sealed class MeshAttachmentException : Exception
    {
        public MeshAttachmentErrorReason Reason { get; }
        public string SkinName { get; }
        public string SlotName { get; }
        public string AttachmentName { get; }

        public MeshAttachmentException(
            MeshAttachmentErrorReason reason,
            string skinName,
            string slotName,
            string attachmentName)
            : base($"mesh attachment {reason}: {skinName}/{slotName}/{attachmentName}")
        {
            Reason = reason;
            SkinName = skinName;
            SlotName = slotName;
            AttachmentName = attachmentName;
        }
    }

    // Skinning and deform sampling (mirrors packages/runtime-core/src/skeleton/mesh-sample.ts): solve step
    // 5. It REUSES a pose just produced by SampleSkeleton, never re solving the skeleton.
    public static class MeshSample
    {
        // Skin a mesh into world space using the pose's CURRENT bone world matrices. Weighted meshes skin
        // through pose.World directly (the weighted vertex stream stores global bone indices); unweighted
        // meshes ride a single slot bone. Writes 2 world space lanes per logical vertex into output and
        // returns the vertex count.
        public static int SkinMeshInto(MeshAttachment mesh, Pose pose, int slotBoneIndex, float[] output)
        {
            int vertexCount = mesh.Uvs.Length / 2;
            bool weighted = mesh.Bones != null && mesh.Bones.Length > 0;
            if (weighted)
            {
                SkinSolve.SolveSkin(mesh, pose.World, output);
            }
            else
            {
                Mat2x3 slotBoneWorld = Affine.Read(pose.World, slotBoneIndex * Affine.Mat2x3Stride);
                SkinSolve.SolveSkinUnweighted(mesh, in slotBoneWorld, output);
            }

            return vertexCount;
        }

        // Sample a mesh attachment's FINAL world space vertices at time t (skin, then add deform). Writes 2
        // lanes per vertex into output and returns the vertex count.
        public static int SampleMeshVertices(
            SkeletonDocument document,
            string animationId,
            double t,
            Pose pose,
            string skinName,
            string slotName,
            string attachmentName,
            float[] output)
        {
            MeshAttachment mesh = ResolveMesh(document, skinName, slotName, attachmentName);
            Animation? animation = document.FindAnimation(animationId);
            if (animation == null)
            {
                throw new AnimationNotFoundException(animationId);
            }

            int slotIndex = IndexOf(pose.SlotNames, slotName);
            int slotBoneIndex = slotIndex >= 0 ? pose.SlotBoneIndices[slotIndex] : -1;
            int vertexCount = SkinMeshInto(mesh, pose, slotBoneIndex, output);

            PreparedAnimation prepared = Sample.GetPreparedAnimation(pose, animation);
            PreparedDeformChannel? channel =
                FindDeformChannel(prepared.DeformChannels, skinName, slotName, attachmentName);
            if (channel != null)
            {
                double[] offsets = EnsureDeformScratch(pose, channel.Track.ComponentCount);
                SampleDeformInto(channel.Track, t, offsets);
                Deform.ApplyDeform(output, offsets, output, vertexCount);
            }

            return vertexCount;
        }

        private static MeshAttachment ResolveMesh(
            SkeletonDocument document,
            string skinName,
            string slotName,
            string attachmentName)
        {
            Skin? skin = null;
            for (int i = 0; i < document.Skins.Count; i += 1)
            {
                if (document.Skins[i].Name == skinName)
                {
                    skin = document.Skins[i];
                    break;
                }
            }

            Attachment? attachment = skin == null ? null : FindAttachment(skin, slotName, attachmentName);
            if (attachment == null)
            {
                throw new MeshAttachmentException(
                    MeshAttachmentErrorReason.NotFound,
                    skinName,
                    slotName,
                    attachmentName);
            }

            if (attachment.Type != "mesh" || attachment.Mesh == null)
            {
                throw new MeshAttachmentException(
                    MeshAttachmentErrorReason.NotAMesh,
                    skinName,
                    slotName,
                    attachmentName);
            }

            return attachment.Mesh;
        }

        private static Attachment? FindAttachment(Skin skin, string slotName, string attachmentName)
        {
            for (int i = 0; i < skin.Attachments.Count; i += 1)
            {
                if (skin.Attachments[i].Key != slotName)
                {
                    continue;
                }

                IReadOnlyList<KeyValuePair<string, Attachment>> perSlot = skin.Attachments[i].Value;
                for (int j = 0; j < perSlot.Count; j += 1)
                {
                    if (perSlot[j].Key == attachmentName)
                    {
                        return perSlot[j].Value;
                    }
                }
            }

            return null;
        }

        private static PreparedDeformChannel? FindDeformChannel(
            IReadOnlyList<PreparedDeformChannel> channels,
            string skinName,
            string slotName,
            string attachmentName)
        {
            for (int i = 0; i < channels.Count; i += 1)
            {
                PreparedDeformChannel channel = channels[i];
                if (channel.Skin == skinName
                    && channel.Slot == slotName
                    && channel.Attachment == attachmentName)
                {
                    return channel;
                }
            }

            return null;
        }

        private static void SampleDeformInto(PreparedTrack track, double t, double[] output)
        {
            int i = Curves.FindSegmentIndex(track.Times, track.KeyCount, t);
            double f = Curves.SegmentFraction(track, i, t);
            int componentCount = track.ComponentCount;
            for (int c = 0; c < componentCount; c += 1)
            {
                output[c] = Curves.SegmentComponent(track, i, f, c);
            }
        }

        private static double[] EnsureDeformScratch(Pose pose, int length)
        {
            if (pose.DeformScratch.Length < length)
            {
                pose.DeformScratch = new double[length];
            }

            return pose.DeformScratch;
        }

        private static int IndexOf(IReadOnlyList<string> names, string name)
        {
            for (int i = 0; i < names.Count; i += 1)
            {
                if (names[i] == name)
                {
                    return i;
                }
            }

            return -1;
        }
    }
}
