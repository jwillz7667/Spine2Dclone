using System;
using System.Collections.Generic;
using Marionette.Runtime.Core.Document;
using Marionette.Runtime.Core.MathCore;
using Marionette.Runtime.Core.Solve;

namespace Marionette.Runtime.Core.Skeleton
{
    // Thrown when SampleSkeleton is asked for an animation id the document does not define. A typed error
    // carrying the offending id, mirroring AnimationNotFoundError in sample.ts.
    public sealed class AnimationNotFoundException : Exception
    {
        public string AnimationId { get; }

        public AnimationNotFoundException(string animationId)
            : base($"animation not found: {animationId}")
        {
            AnimationId = animationId;
        }
    }

    // The single animation sampler and the ADR-0005 blend layer it drives at full weight (mirrors
    // packages/runtime-core/src/skeleton/sample.ts). Runs the LOCKED solve order: (1) reset to setup pose,
    // (2) apply animation timelines, (3) solve constraints, (4) world transforms. Steps 5 and 6 are not
    // here. After the first call for a given animation (which builds and caches its prepared form on the
    // pose) it allocates nothing per call.
    public static class Sample
    {
        // Solver owned scratch for an on demand target world matrix (step 3 reads the target's world
        // origin). ThreadStatic and reused so the constraint solve adds no per frame allocation.
        [ThreadStatic]
        private static double[]? _targetWorldScratch;

        private static double[] TargetWorldScratch =>
            _targetWorldScratch ??= new double[Affine.Mat2x3Stride];

        public static void SampleSkeleton(SkeletonDocument document, string animationId, double t, Pose outPose)
        {
            Animation? animation = document.FindAnimation(animationId);
            if (animation == null)
            {
                throw new AnimationNotFoundException(animationId);
            }

            PreparedAnimation prepared = GetPreparedAnimation(outPose, animation);

            // Step 1: reset to setup pose (bones, slots, constraints), then arm the blend scratch.
            WorldTransform.ResetToSetupPose(outPose);
            ResetSlotsToSetup(outPose);
            ResetConstraintsToBase(outPose);
            BeginBlend(outPose);

            // Step 2: apply the single animation at full weight (alpha 1, non additive, discrete wins).
            ApplyAnimationAt(outPose, prepared, t, 1, false, true);
            ComposeTouchedBones(outPose);

            // Step 3: solve constraints: ALL IK first, then ALL transform, each in document array order.
            SolveConstraints(outPose);

            // Step 4: world transforms (single forward pass, parents before children).
            WorldTransform.ComputeWorldTransforms(outPose);
        }

        public static void BeginBlend(Pose pose)
        {
            Array.Copy(pose.Setup, pose.BlendLocal, pose.Setup.Length);
            Array.Clear(pose.BoneTouched, 0, pose.BoneTouched.Length);
            Fill(pose.SlotAttachmentWinWeight, -1);
            Fill(pose.IkBendWinWeight, -1);
            Fill(pose.IkStretchWinWeight, -1);
            Fill(pose.IkCompressWinWeight, -1);
            pose.DrawOrderWinWeight[0] = -1;
        }

        public static void ComposeTouchedBones(Pose pose)
        {
            double[] blendLocal = pose.BlendLocal;
            byte[] boneTouched = pose.BoneTouched;
            double[] local = pose.Local;
            int boneCount = pose.BoneCount;
            for (int i = 0; i < boneCount; i += 1)
            {
                if (boneTouched[i] == 0)
                {
                    continue;
                }

                int s = i * Pose.SetupStride;
                Affine.ComposeInto(
                    local,
                    i * Affine.Mat2x3Stride,
                    blendLocal[s],
                    blendLocal[s + 1],
                    blendLocal[s + 2],
                    blendLocal[s + 3],
                    blendLocal[s + 4],
                    blendLocal[s + 5],
                    blendLocal[s + 6]);
            }
        }

        // Normalize an angle delta (degrees) into (-180, 180], the shortest signed arc.
        private static double NormalizeDeltaDeg(double delta)
        {
            double r = delta % 360.0;
            if (r > 180.0)
            {
                r -= 360.0;
            }
            else if (r <= -180.0)
            {
                r += 360.0;
            }

            return r;
        }

        private static double BlendReplaceLinear(double current, double sampled, double w)
        {
            if (w >= 1)
            {
                return sampled;
            }

            if (w <= 0)
            {
                return current;
            }

            return current + ((sampled - current) * w);
        }

        private static double BlendReplaceRotation(double current, double sampled, double w)
        {
            if (w >= 1)
            {
                return sampled;
            }

            if (w <= 0)
            {
                return current;
            }

            return current + (NormalizeDeltaDeg(sampled - current) * w);
        }

        private static double BlendAddLinear(double current, double setupValue, double sampled, double w) =>
            current + ((sampled - setupValue) * w);

        private static double BlendAddRotation(double current, double setupValue, double sampled, double w) =>
            current + (NormalizeDeltaDeg(sampled - setupValue) * w);

        // Solve step 3 (ADR-0003 section 3, ordering per ADR-0009 section 1.3 / ADR-0010 section 1). Default
        // (pose.SolveOrder null): all IK constraints in document order, then all transform constraints in
        // document order, the exact ADR-0003 two-phase path. When the rig assigns an explicit order,
        // pose.SolveOrder is the precomputed dense schedule and step 3 walks it, dispatching each code to the
        // SAME per-constraint helper the default path uses (so an IK constraint is bit-identical either way).
        public static void SolveConstraints(Pose pose)
        {
            IReadOnlyList<ResolvedIkConstraint> ikConstraints = pose.IkConstraints;
            IReadOnlyList<ResolvedTransformConstraint> transformConstraints = pose.TransformConstraints;
            int[]? solveOrder = pose.SolveOrder;

            if (solveOrder == null)
            {
                for (int i = 0; i < ikConstraints.Count; i += 1)
                {
                    SolveOneIkConstraint(pose, ikConstraints[i]);
                }

                for (int i = 0; i < transformConstraints.Count; i += 1)
                {
                    SolveOneTransformConstraint(pose, transformConstraints[i]);
                }

                return;
            }

            int ikCount = ikConstraints.Count;
            for (int p = 0; p < solveOrder.Length; p += 1)
            {
                int code = solveOrder[p];
                if (code < ikCount)
                {
                    SolveOneIkConstraint(pose, ikConstraints[code]);
                }
                else
                {
                    SolveOneTransformConstraint(pose, transformConstraints[code - ikCount]);
                }
            }
        }

        // Solve one IK constraint against the pose (ADR-0003 section 4, depth per ADR-0010 section 2). Reads
        // the target world origin into the thread scratch and dispatches one/two-bone. A constraint with an
        // unresolved bone/target index (-1) or non-positive mix is a no-op. The per-constraint sampled scratch
        // (mix, bend, softness, stretch, compress) was written by step 2; Uniform is the static definition flag.
        private static void SolveOneIkConstraint(Pose pose, ResolvedIkConstraint constraint)
        {
            int targetIndex = constraint.TargetIndex;
            if (targetIndex < 0)
            {
                return;
            }

            if (constraint.SampledMix <= 0)
            {
                return;
            }

            int[] boneIndices = constraint.BoneIndices;
            double[] targetWorldScratch = TargetWorldScratch;
            ResolveWorld.Resolve(pose, targetIndex, targetWorldScratch, 0);
            double targetX = targetWorldScratch[4];
            double targetY = targetWorldScratch[5];

            if (boneIndices.Length == 1)
            {
                int boneIndex = boneIndices[0];
                if (boneIndex < 0)
                {
                    return;
                }

                Ik.SolveIkOneBone(
                    pose,
                    boneIndex,
                    targetX,
                    targetY,
                    constraint.SampledMix,
                    constraint.SampledStretch,
                    constraint.SampledCompress);
            }
            else
            {
                int parentIndex = boneIndices[0];
                int childIndex = boneIndices[1];
                if (parentIndex < 0 || childIndex < 0)
                {
                    return;
                }

                Ik.SolveIkTwoBone(
                    pose,
                    parentIndex,
                    childIndex,
                    targetX,
                    targetY,
                    constraint.SampledBendPositive,
                    constraint.SampledMix,
                    constraint.SampledSoftness,
                    constraint.SampledStretch,
                    constraint.SampledCompress,
                    constraint.Uniform);
            }
        }

        // Solve one transform constraint against the pose (ADR-0003 section 5). Applies to each constrained
        // bone in stored order; an unresolved bone/target index is skipped.
        private static void SolveOneTransformConstraint(Pose pose, ResolvedTransformConstraint constraint)
        {
            int targetIndex = constraint.TargetIndex;
            if (targetIndex < 0)
            {
                return;
            }

            int[] boneIndices = constraint.BoneIndices;
            for (int b = 0; b < boneIndices.Length; b += 1)
            {
                int boneIndex = boneIndices[b];
                if (boneIndex < 0)
                {
                    continue;
                }

                TransformConstraintSolve.Solve(
                    pose,
                    boneIndex,
                    targetIndex,
                    constraint.SampledMix,
                    constraint.Offset,
                    constraint.Local,
                    constraint.Relative);
            }
        }

        public static void ResetConstraintsToBase(Pose pose)
        {
            IReadOnlyList<ResolvedIkConstraint> ikConstraints = pose.IkConstraints;
            IReadOnlyList<ResolvedTransformConstraint> transformConstraints = pose.TransformConstraints;
            for (int i = 0; i < ikConstraints.Count; i += 1)
            {
                ResolvedIkConstraint constraint = ikConstraints[i];
                constraint.SampledMix = constraint.BaseMix;
                constraint.SampledBendPositive = constraint.BaseBendPositive;
                constraint.SampledSoftness = constraint.BaseSoftness;
                constraint.SampledStretch = constraint.BaseStretch;
                constraint.SampledCompress = constraint.BaseCompress;
            }

            for (int i = 0; i < transformConstraints.Count; i += 1)
            {
                ResolvedTransformConstraint constraint = transformConstraints[i];
                constraint.SampledMix.CopyFrom(constraint.BaseMix);
            }
        }

        private static double SampleScalarTrack(PreparedTrack track, double t)
        {
            int i = Curves.FindSegmentIndex(track.Times, track.KeyCount, t);
            double f = Curves.SegmentFraction(track, i, t);
            return Curves.SegmentComponent(track, i, f, 0);
        }

        public static void ResetSlotsToSetup(Pose pose)
        {
            Array.Copy(pose.SlotSetupColor, pose.SlotColor, pose.SlotSetupColor.Length);
            // Reset the two-color dark tint to its setup (ADR-0009 section 4.3, ADR-0011 section 3).
            Array.Copy(pose.SlotSetupDarkColor, pose.SlotDarkColor, pose.SlotSetupDarkColor.Length);
            // Step 1 also resets the render order to the setup (identity) draw order (ADR-0008, PP-B4).
            Array.Copy(pose.SlotSetupDrawOrder, pose.DrawOrder, pose.SlotSetupDrawOrder.Length);
            for (int i = 0; i < pose.SlotCount; i += 1)
            {
                pose.SlotAttachment[i] = pose.SlotSetupAttachment[i];
            }
        }

        // Apply ONE prepared animation at time t and blend weight alpha onto the running blend scratch.
        public static void ApplyAnimationAt(
            Pose pose,
            PreparedAnimation prepared,
            double t,
            double alpha,
            bool additive,
            bool discreteWins)
        {
            ApplyBoneEntry(pose, prepared, t, alpha, additive);
            ApplySlotEntry(pose, prepared, t, alpha, additive, discreteWins);
            ApplyConstraintEntry(pose, prepared, t, alpha, additive, discreteWins);
            ApplyDrawOrderEntry(pose, prepared, t, alpha, discreteWins);
        }

        // Apply this animation's active draw-order key as a discrete, whole-skeleton greater-weight-wins
        // channel (ADR-0008, PP-B4; the draw-order analogue of the attachment swap). Mirrors
        // applyDrawOrderEntry in sample.ts.
        private static void ApplyDrawOrderEntry(
            Pose pose,
            PreparedAnimation prepared,
            double t,
            double alpha,
            bool discreteWins)
        {
            PreparedDrawOrderTimeline? timeline = prepared.DrawOrder;
            if (timeline == null || !discreteWins)
            {
                return;
            }

            if (alpha < pose.DrawOrderWinWeight[0])
            {
                return;
            }

            int i = Curves.FindDrawOrderKeyIndex(timeline, t);
            if (i < 0)
            {
                return;
            }

            Array.Copy(timeline.Orders[i], pose.DrawOrder, timeline.Orders[i].Length);
            pose.DrawOrderWinWeight[0] = alpha;
        }

        private static void ApplyBoneEntry(
            Pose pose,
            PreparedAnimation prepared,
            double t,
            double alpha,
            bool additive)
        {
            IReadOnlyList<PreparedBoneChannels> boneChannels = prepared.BoneChannels;
            double[] setup = pose.Setup;
            double[] blendLocal = pose.BlendLocal;
            byte[] boneTouched = pose.BoneTouched;
            for (int bc = 0; bc < boneChannels.Count; bc += 1)
            {
                PreparedBoneChannels channels = boneChannels[bc];
                int boneIndex = channels.BoneIndex;
                if (boneIndex < 0)
                {
                    continue;
                }

                int s = boneIndex * Pose.SetupStride;
                bool touched = false;

                PreparedTrack? rotate = channels.Rotate;
                if (rotate != null)
                {
                    int i = Curves.FindSegmentIndex(rotate.Times, rotate.KeyCount, t);
                    double f = Curves.SegmentFraction(rotate, i, t);
                    double sampled = setup[s + 2] + Curves.SegmentComponent(rotate, i, f, 0);
                    blendLocal[s + 2] = additive
                        ? BlendAddRotation(blendLocal[s + 2], setup[s + 2], sampled, alpha)
                        : BlendReplaceRotation(blendLocal[s + 2], sampled, alpha);
                    touched = true;
                }

                PreparedTrack? translate = channels.Translate;
                if (translate != null)
                {
                    int i = Curves.FindSegmentIndex(translate.Times, translate.KeyCount, t);
                    double f = Curves.SegmentFraction(translate, i, t);
                    double sx = setup[s] + Curves.SegmentComponent(translate, i, f, 0);
                    double sy = setup[s + 1] + Curves.SegmentComponent(translate, i, f, 1);
                    blendLocal[s] = additive
                        ? BlendAddLinear(blendLocal[s], setup[s], sx, alpha)
                        : BlendReplaceLinear(blendLocal[s], sx, alpha);
                    blendLocal[s + 1] = additive
                        ? BlendAddLinear(blendLocal[s + 1], setup[s + 1], sy, alpha)
                        : BlendReplaceLinear(blendLocal[s + 1], sy, alpha);
                    touched = true;
                }

                PreparedTrack? scale = channels.Scale;
                if (scale != null)
                {
                    int i = Curves.FindSegmentIndex(scale.Times, scale.KeyCount, t);
                    double f = Curves.SegmentFraction(scale, i, t);
                    double sx = setup[s + 3] * Curves.SegmentComponent(scale, i, f, 0);
                    double sy = setup[s + 4] * Curves.SegmentComponent(scale, i, f, 1);
                    blendLocal[s + 3] = additive
                        ? BlendAddLinear(blendLocal[s + 3], setup[s + 3], sx, alpha)
                        : BlendReplaceLinear(blendLocal[s + 3], sx, alpha);
                    blendLocal[s + 4] = additive
                        ? BlendAddLinear(blendLocal[s + 4], setup[s + 4], sy, alpha)
                        : BlendReplaceLinear(blendLocal[s + 4], sy, alpha);
                    touched = true;
                }

                PreparedTrack? shear = channels.Shear;
                if (shear != null)
                {
                    int i = Curves.FindSegmentIndex(shear.Times, shear.KeyCount, t);
                    double f = Curves.SegmentFraction(shear, i, t);
                    double sx = setup[s + 5] + Curves.SegmentComponent(shear, i, f, 0);
                    double sy = setup[s + 6] + Curves.SegmentComponent(shear, i, f, 1);
                    blendLocal[s + 5] = additive
                        ? BlendAddLinear(blendLocal[s + 5], setup[s + 5], sx, alpha)
                        : BlendReplaceLinear(blendLocal[s + 5], sx, alpha);
                    blendLocal[s + 6] = additive
                        ? BlendAddLinear(blendLocal[s + 6], setup[s + 6], sy, alpha)
                        : BlendReplaceLinear(blendLocal[s + 6], sy, alpha);
                    touched = true;
                }

                // Per-component split tracks (ADR-0009 section 4.1, ADR-0011 section 3). Each writes ONE local
                // component with the same math as the corresponding joint component (translate/shear are
                // setup + value, scale is setup * value). The format's coexistence ban guarantees a channel's
                // joint and split forms never both key, so applying every present track cannot double-write.
                if (ApplyBoneScalar(channels.TranslateX, blendLocal, setup, s, false, t, alpha, additive))
                {
                    touched = true;
                }

                if (ApplyBoneScalar(channels.TranslateY, blendLocal, setup, s + 1, false, t, alpha, additive))
                {
                    touched = true;
                }

                if (ApplyBoneScalar(channels.ScaleX, blendLocal, setup, s + 3, true, t, alpha, additive))
                {
                    touched = true;
                }

                if (ApplyBoneScalar(channels.ScaleY, blendLocal, setup, s + 4, true, t, alpha, additive))
                {
                    touched = true;
                }

                if (ApplyBoneScalar(channels.ShearX, blendLocal, setup, s + 5, false, t, alpha, additive))
                {
                    touched = true;
                }

                if (ApplyBoneScalar(channels.ShearY, blendLocal, setup, s + 6, false, t, alpha, additive))
                {
                    touched = true;
                }

                if (touched)
                {
                    boneTouched[boneIndex] = 1;
                }
            }
        }

        // Apply one split scalar bone track to a single local-component lane, matching the joint channel's
        // math: multiplicative (scale) composes as setup * value, else (translate, shear) as setup + value;
        // the result blends onto blendLocal by alpha (additive adds the delta from setup). Returns whether the
        // track applied (null tracks are absent). Mirrors applyBoneScalar in sample.ts.
        private static bool ApplyBoneScalar(
            PreparedTrack? track,
            double[] blendLocal,
            double[] setup,
            int lane,
            bool multiplicative,
            double t,
            double alpha,
            bool additive)
        {
            if (track == null)
            {
                return false;
            }

            int i = Curves.FindSegmentIndex(track.Times, track.KeyCount, t);
            double f = Curves.SegmentFraction(track, i, t);
            double raw = Curves.SegmentComponent(track, i, f, 0);
            double sampled = multiplicative ? setup[lane] * raw : setup[lane] + raw;
            blendLocal[lane] = additive
                ? BlendAddLinear(blendLocal[lane], setup[lane], sampled, alpha)
                : BlendReplaceLinear(blendLocal[lane], sampled, alpha);
            return true;
        }

        private static void ApplySlotEntry(
            Pose pose,
            PreparedAnimation prepared,
            double t,
            double alpha,
            bool additive,
            bool discreteWins)
        {
            IReadOnlyList<PreparedSlotChannels> slotChannels = prepared.SlotChannels;
            double[] slotColor = pose.SlotColor;
            double[] slotSetupColor = pose.SlotSetupColor;
            double[] slotDarkColor = pose.SlotDarkColor;
            double[] slotSetupDarkColor = pose.SlotSetupDarkColor;
            string?[] slotAttachment = pose.SlotAttachment;
            double[] slotAttachmentWinWeight = pose.SlotAttachmentWinWeight;
            for (int sc = 0; sc < slotChannels.Count; sc += 1)
            {
                PreparedSlotChannels channels = slotChannels[sc];
                int slotIndex = channels.SlotIndex;
                if (slotIndex < 0)
                {
                    continue;
                }

                int baseIndex = slotIndex * Pose.SlotColorStride;

                PreparedTrack? color = channels.Color;
                if (color != null)
                {
                    int i = Curves.FindSegmentIndex(color.Times, color.KeyCount, t);
                    double f = Curves.SegmentFraction(color, i, t);
                    for (int k = 0; k < Pose.SlotColorStride; k += 1)
                    {
                        double sampled = Curves.SegmentComponent(color, i, f, k);
                        slotColor[baseIndex + k] = additive
                            ? BlendAddLinear(slotColor[baseIndex + k], slotSetupColor[baseIndex + k], sampled, alpha)
                            : BlendReplaceLinear(slotColor[baseIndex + k], sampled, alpha);
                    }
                }

                // Split color (ADR-0009 section 4.2, ADR-0011 section 3): rgb writes lanes 0..2, alpha lane 3.
                // The coexistence ban means these never run alongside the joint color on the same slot.
                PreparedTrack? rgb = channels.Rgb;
                if (rgb != null)
                {
                    int i = Curves.FindSegmentIndex(rgb.Times, rgb.KeyCount, t);
                    double f = Curves.SegmentFraction(rgb, i, t);
                    for (int k = 0; k < 3; k += 1)
                    {
                        double sampled = Curves.SegmentComponent(rgb, i, f, k);
                        slotColor[baseIndex + k] = additive
                            ? BlendAddLinear(slotColor[baseIndex + k], slotSetupColor[baseIndex + k], sampled, alpha)
                            : BlendReplaceLinear(slotColor[baseIndex + k], sampled, alpha);
                    }
                }

                PreparedTrack? alphaTrack = channels.Alpha;
                if (alphaTrack != null)
                {
                    int i = Curves.FindSegmentIndex(alphaTrack.Times, alphaTrack.KeyCount, t);
                    double f = Curves.SegmentFraction(alphaTrack, i, t);
                    double sampled = Curves.SegmentComponent(alphaTrack, i, f, 0);
                    slotColor[baseIndex + 3] = additive
                        ? BlendAddLinear(slotColor[baseIndex + 3], slotSetupColor[baseIndex + 3], sampled, alpha)
                        : BlendReplaceLinear(slotColor[baseIndex + 3], sampled, alpha);
                }

                // Keyable two-color dark tint (ADR-0009 section 4.3, ADR-0011 section 3): blends into the
                // pose's dark-color lane like the RGBA color, over the setup dark tint.
                PreparedTrack? dark = channels.Dark;
                if (dark != null)
                {
                    int i = Curves.FindSegmentIndex(dark.Times, dark.KeyCount, t);
                    double f = Curves.SegmentFraction(dark, i, t);
                    for (int k = 0; k < Pose.SlotColorStride; k += 1)
                    {
                        double sampled = Curves.SegmentComponent(dark, i, f, k);
                        slotDarkColor[baseIndex + k] = additive
                            ? BlendAddLinear(slotDarkColor[baseIndex + k], slotSetupDarkColor[baseIndex + k], sampled, alpha)
                            : BlendReplaceLinear(slotDarkColor[baseIndex + k], sampled, alpha);
                    }
                }

                PreparedAttachmentTrack? attachment = channels.Attachment;
                if (attachment != null && discreteWins && alpha >= slotAttachmentWinWeight[slotIndex])
                {
                    slotAttachment[slotIndex] = Curves.SampleAttachmentName(attachment, t);
                    slotAttachmentWinWeight[slotIndex] = alpha;
                }
            }
        }

        private static void ApplyConstraintEntry(
            Pose pose,
            PreparedAnimation prepared,
            double t,
            double alpha,
            bool additive,
            bool discreteWins)
        {
            IReadOnlyList<PreparedIkChannel> ikChannels = prepared.IkChannels;
            IReadOnlyList<PreparedTransformChannel> transformChannels = prepared.TransformChannels;
            IReadOnlyList<ResolvedIkConstraint> ikConstraints = pose.IkConstraints;
            IReadOnlyList<ResolvedTransformConstraint> transformConstraints = pose.TransformConstraints;
            double[] ikBendWinWeight = pose.IkBendWinWeight;
            double[] ikStretchWinWeight = pose.IkStretchWinWeight;
            double[] ikCompressWinWeight = pose.IkCompressWinWeight;

            for (int c = 0; c < ikChannels.Count; c += 1)
            {
                PreparedIkChannel channel = ikChannels[c];
                int index = channel.ConstraintIndex;
                if (index < 0)
                {
                    continue;
                }

                ResolvedIkConstraint constraint = ikConstraints[index];
                if (channel.Mix != null)
                {
                    double value = SampleScalarTrack(channel.Mix, t);
                    constraint.SampledMix = additive
                        ? BlendAddLinear(constraint.SampledMix, constraint.BaseMix, value, alpha)
                        : BlendReplaceLinear(constraint.SampledMix, value, alpha);
                }

                // softness blends like mix (a continuous world-unit distance); a negative additive result is
                // floored at 0 to keep the non-negative contract the solve's soft-reach remap relies on.
                if (channel.Softness != null)
                {
                    double value = SampleScalarTrack(channel.Softness, t);
                    double blended = additive
                        ? BlendAddLinear(constraint.SampledSoftness, constraint.BaseSoftness, value, alpha)
                        : BlendReplaceLinear(constraint.SampledSoftness, value, alpha);
                    constraint.SampledSoftness = blended < 0 ? 0 : blended;
                }

                if (channel.BendPositive != null && discreteWins && alpha >= ikBendWinWeight[index])
                {
                    constraint.SampledBendPositive = Curves.SampleStepBool(channel.BendPositive, t);
                    ikBendWinWeight[index] = alpha;
                }

                // stretch/compress are discrete flags: the track with the greatest alpha this frame wins
                // (ADR-0005 rule 5), exactly like the bend direction, each with its own per-constraint weight.
                if (channel.Stretch != null && discreteWins && alpha >= ikStretchWinWeight[index])
                {
                    constraint.SampledStretch = Curves.SampleStepBool(channel.Stretch, t);
                    ikStretchWinWeight[index] = alpha;
                }

                if (channel.Compress != null && discreteWins && alpha >= ikCompressWinWeight[index])
                {
                    constraint.SampledCompress = Curves.SampleStepBool(channel.Compress, t);
                    ikCompressWinWeight[index] = alpha;
                }
            }

            for (int c = 0; c < transformChannels.Count; c += 1)
            {
                PreparedTransformChannel channel = transformChannels[c];
                int index = channel.ConstraintIndex;
                if (index < 0)
                {
                    continue;
                }

                ResolvedTransformConstraint constraint = transformConstraints[index];
                TransformMix mix = constraint.SampledMix;
                TransformMix baseMix = constraint.BaseMix;
                if (channel.MixRotate != null)
                {
                    mix.Rotate = BlendMix(mix.Rotate, baseMix.Rotate, channel.MixRotate, t, alpha, additive);
                }

                if (channel.MixX != null)
                {
                    mix.X = BlendMix(mix.X, baseMix.X, channel.MixX, t, alpha, additive);
                }

                if (channel.MixY != null)
                {
                    mix.Y = BlendMix(mix.Y, baseMix.Y, channel.MixY, t, alpha, additive);
                }

                if (channel.MixScaleX != null)
                {
                    mix.ScaleX = BlendMix(mix.ScaleX, baseMix.ScaleX, channel.MixScaleX, t, alpha, additive);
                }

                if (channel.MixScaleY != null)
                {
                    mix.ScaleY = BlendMix(mix.ScaleY, baseMix.ScaleY, channel.MixScaleY, t, alpha, additive);
                }

                if (channel.MixShearY != null)
                {
                    mix.ShearY = BlendMix(mix.ShearY, baseMix.ShearY, channel.MixShearY, t, alpha, additive);
                }
            }
        }

        private static double BlendMix(
            double current,
            double baseValue,
            PreparedTrack track,
            double t,
            double alpha,
            bool additive)
        {
            double value = SampleScalarTrack(track, t);
            return additive
                ? BlendAddLinear(current, baseValue, value, alpha)
                : BlendReplaceLinear(current, value, alpha);
        }

        public static PreparedAnimation GetPreparedAnimation(Pose pose, Animation animation)
        {
            if (pose.PreparedAnimations.TryGetValue(animation, out PreparedAnimation? cached))
            {
                return cached;
            }

            PreparedAnimation prepared = PrepareAnimation(pose, animation);
            pose.PreparedAnimations[animation] = prepared;
            return prepared;
        }

        private static PreparedAnimation PrepareAnimation(Pose pose, Animation animation)
        {
            Dictionary<string, int> boneIndexByName = NameIndex(pose.BoneNames);
            Dictionary<string, int> slotIndexByName = NameIndex(pose.SlotNames);

            var boneChannels = new List<PreparedBoneChannels>();
            foreach (KeyValuePair<string, BoneTimelines> entry in animation.Bones)
            {
                BoneTimelines timelines = entry.Value;
                boneChannels.Add(new PreparedBoneChannels(
                    LookupOrMinusOne(boneIndexByName, entry.Key),
                    HasKeys(timelines.Rotate) ? Curves.BuildScalarTrack(timelines.Rotate!) : null,
                    HasKeys(timelines.Translate) ? Curves.BuildVec2Track(timelines.Translate!) : null,
                    HasKeys(timelines.Scale) ? Curves.BuildVec2Track(timelines.Scale!) : null,
                    HasKeys(timelines.Shear) ? Curves.BuildVec2Track(timelines.Shear!) : null,
                    // Per-component split tracks (ADR-0009 section 4.1, ADR-0011 section 3): each is one scalar
                    // lane, so it reuses BuildScalarTrack (matching the TS buildComponentTrack, `{ value }`).
                    HasKeys(timelines.TranslateX) ? Curves.BuildScalarTrack(timelines.TranslateX!) : null,
                    HasKeys(timelines.TranslateY) ? Curves.BuildScalarTrack(timelines.TranslateY!) : null,
                    HasKeys(timelines.ScaleX) ? Curves.BuildScalarTrack(timelines.ScaleX!) : null,
                    HasKeys(timelines.ScaleY) ? Curves.BuildScalarTrack(timelines.ScaleY!) : null,
                    HasKeys(timelines.ShearX) ? Curves.BuildScalarTrack(timelines.ShearX!) : null,
                    HasKeys(timelines.ShearY) ? Curves.BuildScalarTrack(timelines.ShearY!) : null));
            }

            var slotChannels = new List<PreparedSlotChannels>();
            foreach (KeyValuePair<string, SlotTimelines> entry in animation.Slots)
            {
                SlotTimelines timelines = entry.Value;
                slotChannels.Add(new PreparedSlotChannels(
                    LookupOrMinusOne(slotIndexByName, entry.Key),
                    HasKeys(timelines.Color) ? Curves.BuildColorTrack(timelines.Color!) : null,
                    HasKeys(timelines.Attachment) ? Curves.BuildAttachmentTrack(timelines.Attachment!) : null,
                    // Split color (ADR-0009 section 4.2): rgb is a 3-lane track, alpha reuses BuildScalarTrack
                    // (1 lane), dark reuses BuildColorTrack (4-lane RGBA over the setup dark tint).
                    HasKeys(timelines.Rgb) ? Curves.BuildRgbTrack(timelines.Rgb!) : null,
                    HasKeys(timelines.Alpha) ? Curves.BuildScalarTrack(timelines.Alpha!) : null,
                    HasKeys(timelines.Dark) ? Curves.BuildColorTrack(timelines.Dark!) : null));
            }

            Dictionary<string, int> ikIndexByName = NameIndexOf(pose.IkConstraints);
            var ikChannels = new List<PreparedIkChannel>();
            foreach (KeyValuePair<string, IReadOnlyList<IkKeyframe>> entry in animation.Ik)
            {
                IReadOnlyList<IkKeyframe> frames = entry.Value;
                if (frames.Count == 0)
                {
                    continue;
                }

                ikChannels.Add(new PreparedIkChannel(
                    LookupOrMinusOne(ikIndexByName, entry.Key),
                    Curves.BuildIkMixTrack(frames),
                    Curves.BuildBendTrack(frames),
                    Curves.BuildIkSoftnessTrack(frames),
                    Curves.BuildIkDepthBoolTrack(frames, Curves.IkDepthChannel.Stretch),
                    Curves.BuildIkDepthBoolTrack(frames, Curves.IkDepthChannel.Compress)));
            }

            Dictionary<string, int> transformIndexByName = NameIndexOf(pose.TransformConstraints);
            var transformChannels = new List<PreparedTransformChannel>();
            foreach (KeyValuePair<string, IReadOnlyList<TransformKeyframe>> entry in animation.Transform)
            {
                IReadOnlyList<TransformKeyframe> frames = entry.Value;
                if (frames.Count == 0)
                {
                    continue;
                }

                transformChannels.Add(new PreparedTransformChannel(
                    LookupOrMinusOne(transformIndexByName, entry.Key),
                    Curves.BuildTransformMixTrack(frames, Curves.TransformMixChannel.MixRotate),
                    Curves.BuildTransformMixTrack(frames, Curves.TransformMixChannel.MixX),
                    Curves.BuildTransformMixTrack(frames, Curves.TransformMixChannel.MixY),
                    Curves.BuildTransformMixTrack(frames, Curves.TransformMixChannel.MixScaleX),
                    Curves.BuildTransformMixTrack(frames, Curves.TransformMixChannel.MixScaleY),
                    Curves.BuildTransformMixTrack(frames, Curves.TransformMixChannel.MixShearY)));
            }

            var deformChannels = new List<PreparedDeformChannel>();
            foreach (DeformEntry entry in animation.Deform)
            {
                if (entry.Frames.Count == 0)
                {
                    continue;
                }

                deformChannels.Add(new PreparedDeformChannel(
                    entry.Skin,
                    entry.Slot,
                    entry.Attachment,
                    Curves.BuildDeformTrack(entry.Frames)));
            }

            PreparedDrawOrderTimeline? drawOrder = animation.DrawOrder.Count > 0
                ? Curves.BuildDrawOrderTimeline(animation.DrawOrder, slotIndexByName, pose.SlotCount)
                : null;

            return new PreparedAnimation(
                boneChannels,
                slotChannels,
                ikChannels,
                transformChannels,
                deformChannels,
                drawOrder);
        }

        private static bool HasKeys<T>(IReadOnlyList<T>? keys) => keys != null && keys.Count > 0;

        private static int LookupOrMinusOne(Dictionary<string, int> index, string name) =>
            index.TryGetValue(name, out int value) ? value : -1;

        private static Dictionary<string, int> NameIndex(IReadOnlyList<string> names)
        {
            var index = new Dictionary<string, int>();
            for (int i = 0; i < names.Count; i += 1)
            {
                index[names[i]] = i;
            }

            return index;
        }

        private static Dictionary<string, int> NameIndexOf(IReadOnlyList<ResolvedIkConstraint> items)
        {
            var index = new Dictionary<string, int>();
            for (int i = 0; i < items.Count; i += 1)
            {
                index[items[i].Name] = i;
            }

            return index;
        }

        private static Dictionary<string, int> NameIndexOf(IReadOnlyList<ResolvedTransformConstraint> items)
        {
            var index = new Dictionary<string, int>();
            for (int i = 0; i < items.Count; i += 1)
            {
                index[items[i].Name] = i;
            }

            return index;
        }

        private static void Fill(double[] array, double value)
        {
            for (int i = 0; i < array.Length; i += 1)
            {
                array[i] = value;
            }
        }
    }
}
