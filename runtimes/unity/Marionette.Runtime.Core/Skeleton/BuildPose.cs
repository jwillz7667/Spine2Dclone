using System.Collections.Generic;
using Marionette.Runtime.Core.Document;
using Marionette.Runtime.Core.MathCore;
using Marionette.Runtime.Core.Solve;

namespace Marionette.Runtime.Core.Skeleton
{
    // Build a Pose from a rig document (mirrors packages/runtime-core/src/skeleton/build-pose.ts). It
    // allocates the buffers once, captures each bone's setup transform and each slot's setup color, active
    // attachment name, and driving bone, resolves parent/slot bone names to indices, and resolves the
    // IK/transform constraints to bone indices in document array order. A name that does not resolve is
    // captured as -1 and skipped by the solve rather than crashing.
    public static class BuildPose
    {
        public static Pose Build(SkeletonDocument document)
        {
            IReadOnlyList<Bone> bones = document.Bones;
            int boneCount = bones.Count;
            var boneNames = new string[boneCount];
            for (int i = 0; i < boneCount; i += 1)
            {
                boneNames[i] = bones[i].Name;
            }

            IReadOnlyList<Slot> slots = document.Slots;
            int slotCount = slots.Count;
            var slotNames = new string[slotCount];
            for (int i = 0; i < slotCount; i += 1)
            {
                slotNames[i] = slots[i].Name;
            }

            var indexByName = new Dictionary<string, int>();
            for (int i = 0; i < boneCount; i += 1)
            {
                indexByName[boneNames[i]] = i;
            }

            // Skin-scoping map (ADR-0009 section 5, ADR-0011 section 4): constraint name -> the skins that scope
            // it. A constraint listed in a skin's constraints is active only while one of those skins is active;
            // a constraint in no list is unscoped (always active). Built once here so the per-frame solve reads a
            // captured ScopeSkins. Mirrors buildPose's scopeByConstraint in build-pose.ts.
            var scopeByConstraint = new Dictionary<string, List<string>>();
            foreach (Skin skin in document.Skins)
            {
                foreach (string name in skin.Constraints)
                {
                    if (scopeByConstraint.TryGetValue(name, out List<string>? existing))
                    {
                        existing.Add(skin.Name);
                    }
                    else
                    {
                        scopeByConstraint[name] = new List<string> { skin.Name };
                    }
                }
            }

            var ikConstraints = new List<ResolvedIkConstraint>();
            foreach (IkConstraint constraint in document.IkConstraints)
            {
                ikConstraints.Add(ResolveIk(constraint, indexByName, ScopeFor(scopeByConstraint, constraint.Name)));
            }

            var transformConstraints = new List<ResolvedTransformConstraint>();
            foreach (TransformConstraint constraint in document.TransformConstraints)
            {
                transformConstraints.Add(
                    ResolveTransform(constraint, indexByName, ScopeFor(scopeByConstraint, constraint.Name)));
            }

            // Path constraints (ADR-0013, PP-B6). Their prepared spline geometry comes from the target slot's
            // setup default-skin path attachment (ADR-0013 section 7); a target slot that carries no resolvable
            // setup path attachment resolves to a no-op. Mirrors buildPose's slotBoneByName / setup-attachment
            // maps and defaultSkin lookup in build-pose.ts.
            var slotBoneByName = new Dictionary<string, int>();
            var slotSetupAttachmentByName = new Dictionary<string, string?>();
            for (int i = 0; i < slotCount; i += 1)
            {
                Slot slot = slots[i];
                slotBoneByName[slot.Name] = LookupOrMinusOne(indexByName, slot.SlotBone);
                slotSetupAttachmentByName[slot.Name] = slot.Attachment;
            }

            Skin? defaultSkin = null;
            foreach (Skin skin in document.Skins)
            {
                if (skin.Name == "default")
                {
                    defaultSkin = skin;
                    break;
                }
            }

            var pathConstraints = new List<ResolvedPathConstraint>();
            foreach (PathConstraint constraint in document.PathConstraints)
            {
                pathConstraints.Add(ResolvePath(
                    constraint,
                    indexByName,
                    slotBoneByName,
                    slotSetupAttachmentByName,
                    defaultSkin,
                    boneCount,
                    ScopeFor(scopeByConstraint, constraint.Name)));
            }

            var pose = new Pose(
                boneCount,
                boneNames,
                slotCount,
                slotNames,
                ikConstraints,
                transformConstraints,
                pathConstraints);

            for (int i = 0; i < boneCount; i += 1)
            {
                Bone bone = bones[i];
                pose.ParentIndices[i] =
                    bone.Parent == null ? -1 : LookupOrMinusOne(indexByName, bone.Parent);
                pose.TransformModes[i] = (sbyte)TransformModes.FromName(bone.TransformMode);
                pose.BoneLength[i] = bone.Length;
                int b = i * Pose.SetupStride;
                pose.Setup[b] = bone.X;
                pose.Setup[b + 1] = bone.Y;
                pose.Setup[b + 2] = bone.Rotation;
                pose.Setup[b + 3] = bone.ScaleX;
                pose.Setup[b + 4] = bone.ScaleY;
                pose.Setup[b + 5] = bone.ShearX;
                pose.Setup[b + 6] = bone.ShearY;
            }

            for (int i = 0; i < slotCount; i += 1)
            {
                Slot slot = slots[i];
                pose.SlotBoneIndices[i] = LookupOrMinusOne(indexByName, slot.SlotBone);
                int b = i * Pose.SlotColorStride;
                pose.SlotSetupColor[b] = slot.Color.R;
                pose.SlotSetupColor[b + 1] = slot.Color.G;
                pose.SlotSetupColor[b + 2] = slot.Color.B;
                pose.SlotSetupColor[b + 3] = slot.Color.A;

                // Setup two-color dark tint (ADR-0009 section 4.3, ADR-0011 section 3). Present only when the
                // slot enables two-color tinting; absent slots keep an inert (0, 0, 0, 1) so the reset is
                // well-defined but renderers skip it (SlotHasDarkColor is 0).
                Rgba? dark = slot.DarkColor;
                pose.SlotHasDarkColor[i] = (byte)(dark == null ? 0 : 1);
                pose.SlotSetupDarkColor[b] = dark?.R ?? 0;
                pose.SlotSetupDarkColor[b + 1] = dark?.G ?? 0;
                pose.SlotSetupDarkColor[b + 2] = dark?.B ?? 0;
                pose.SlotSetupDarkColor[b + 3] = dark?.A ?? 1;
                pose.SlotSetupAttachment[i] = slot.Attachment;
            }

            return pose;
        }

        private static int LookupOrMinusOne(Dictionary<string, int> indexByName, string name) =>
            indexByName.TryGetValue(name, out int value) ? value : -1;

        // The scoping skins for a constraint name, or null when no skin lists it (unscoped, always active).
        private static IReadOnlyList<string>? ScopeFor(Dictionary<string, List<string>> scope, string name) =>
            scope.TryGetValue(name, out List<string>? skins) ? skins : null;

        private static int[] ResolveBoneIndices(IReadOnlyList<string> names, Dictionary<string, int> indexByName)
        {
            var indices = new int[names.Count];
            for (int i = 0; i < names.Count; i += 1)
            {
                indices[i] = LookupOrMinusOne(indexByName, names[i]);
            }

            return indices;
        }

        private static ResolvedIkConstraint ResolveIk(
            IkConstraint constraint,
            Dictionary<string, int> indexByName,
            IReadOnlyList<string>? scopeSkins)
        {
            return new ResolvedIkConstraint(
                constraint.Name,
                ResolveBoneIndices(constraint.Bones, indexByName),
                LookupOrMinusOne(indexByName, constraint.Target),
                constraint.Mix,
                constraint.BendPositive,
                constraint.Softness,
                constraint.Stretch,
                constraint.Compress,
                constraint.Uniform,
                constraint.Order,
                scopeSkins);
        }

        private static ResolvedTransformConstraint ResolveTransform(
            TransformConstraint constraint,
            Dictionary<string, int> indexByName,
            IReadOnlyList<string>? scopeSkins)
        {
            var baseMix = new TransformMix(
                constraint.MixRotate,
                constraint.MixX,
                constraint.MixY,
                constraint.MixScaleX,
                constraint.MixScaleY,
                constraint.MixShearY);
            var offset = new TransformOffset(
                constraint.OffsetRotation,
                constraint.OffsetX,
                constraint.OffsetY,
                constraint.OffsetScaleX,
                constraint.OffsetScaleY,
                constraint.OffsetShearY);
            return new ResolvedTransformConstraint(
                constraint.Name,
                ResolveBoneIndices(constraint.Bones, indexByName),
                LookupOrMinusOne(indexByName, constraint.Target),
                baseMix,
                offset,
                constraint.Local,
                constraint.Relative,
                constraint.Order,
                scopeSkins);
        }

        // The logical control-point count of a path attachment (mirrors pathVertexCount in build-pose.ts):
        // unweighted is Vertices.Length / 2; weighted walks the ADR-0002 self-delimiting stream (each logical
        // vertex starts with its influence count, then that many [boneIndex, vx, vy, weight] quads), counting
        // logical vertices. A validated document's stream is total, so the walk lands exactly on Length.
        private static int PathVertexCount(PathAttachment attachment)
        {
            bool weighted = attachment.Bones != null && attachment.Bones.Length > 0;
            if (!weighted)
            {
                return attachment.Vertices.Length / 2;
            }

            double[] stream = attachment.Vertices;
            int cursor = 0;
            int count = 0;
            while (cursor < stream.Length)
            {
                int influenceCount = (int)stream[cursor];
                cursor += 1 + (influenceCount * 4);
                count += 1;
            }

            return count;
        }

        // Build the prepared spline geometry (ADR-0013 sections 1 to 3) from a path attachment and its slot
        // bone (mirrors preparePathGeometry in build-pose.ts). All per-frame scratch (world control points, the
        // per-curve arc-length LUT, and, for a weighted path, the packed on-demand world buffer) is allocated
        // ONCE here and reused every frame.
        private static PreparedPathGeometry PreparePathGeometry(
            PathAttachment attachment,
            int slotBoneIndex,
            int boneCount)
        {
            bool weighted = attachment.Bones != null && attachment.Bones.Length > 0;
            int vertexCount = PathVertexCount(attachment);
            int curveCount = attachment.Closed ? vertexCount / 3 : (vertexCount - 1) / 3;
            int stride = PathConstraintSolve.PathCurveSubdivisions + 1;
            return new PreparedPathGeometry(
                attachment.Closed,
                attachment.ConstantSpeed,
                curveCount,
                vertexCount,
                (double[])attachment.Lengths.Clone(),
                weighted,
                weighted ? System.Array.Empty<double>() : attachment.Vertices,
                weighted ? attachment.Vertices : System.Array.Empty<double>(),
                weighted ? attachment.Bones : null,
                slotBoneIndex,
                new double[vertexCount * 2],
                new double[curveCount * stride],
                weighted ? new double[boneCount * Affine.Mat2x3Stride] : null);
        }

        // Resolve a path constraint (ADR-0013). The target names a SLOT; its setup default-skin path attachment
        // supplies the geometry. A target slot that does not exist, has no setup attachment, or whose setup
        // attachment (in the default skin) is not a path resolves Path to null and the constraint solves
        // nothing. A curve count that does not fit the control-point count (an unvalidated document) also
        // resolves to null rather than producing a corrupt spline. Mirrors resolvePath in build-pose.ts.
        private static ResolvedPathConstraint ResolvePath(
            PathConstraint constraint,
            Dictionary<string, int> indexByName,
            Dictionary<string, int> slotBoneByName,
            Dictionary<string, string?> slotSetupAttachmentByName,
            Skin? defaultSkin,
            int boneCount,
            IReadOnlyList<string>? scopeSkins)
        {
            string targetSlot = constraint.Target;
            int slotBoneIndex = slotBoneByName.TryGetValue(targetSlot, out int boneIndex) ? boneIndex : -1;
            string? setupName = slotSetupAttachmentByName.TryGetValue(targetSlot, out string? name) ? name : null;
            PreparedPathGeometry? path = null;
            if (setupName != null && defaultSkin != null)
            {
                Attachment? attachment = LookupAttachment(defaultSkin, targetSlot, setupName);
                if (attachment != null && attachment.Type == "path" && attachment.Path != null)
                {
                    PathAttachment pathAttachment = attachment.Path;
                    int vertexCount = PathVertexCount(pathAttachment);
                    bool fits = pathAttachment.Closed
                        ? vertexCount >= 3 && vertexCount % 3 == 0
                        : vertexCount >= 4 && (vertexCount - 1) % 3 == 0;
                    if (fits && pathAttachment.Lengths.Length > 0)
                    {
                        path = PreparePathGeometry(pathAttachment, slotBoneIndex, boneCount);
                    }
                }
            }

            return new ResolvedPathConstraint(
                constraint.Name,
                ResolveBoneIndices(constraint.Bones, indexByName),
                constraint.PositionMode,
                constraint.SpacingMode,
                constraint.RotateMode,
                constraint.OffsetRotation,
                constraint.Position,
                constraint.Spacing,
                constraint.MixRotate,
                constraint.MixX,
                constraint.MixY,
                path,
                constraint.Order,
                scopeSkins);
        }

        // Look up an attachment by (slot, attachment) name in a skin's ordered members, or null when absent.
        // Mirrors the defaultSkin.attachments[targetSlot]?.[setupName] access in build-pose.ts.
        private static Attachment? LookupAttachment(Skin skin, string slotName, string attachmentName)
        {
            foreach (KeyValuePair<string, IReadOnlyList<KeyValuePair<string, Attachment>>> slotEntry in skin.Attachments)
            {
                if (slotEntry.Key != slotName)
                {
                    continue;
                }

                foreach (KeyValuePair<string, Attachment> attachmentEntry in slotEntry.Value)
                {
                    if (attachmentEntry.Key == attachmentName)
                    {
                        return attachmentEntry.Value;
                    }
                }
            }

            return null;
        }
    }
}
