using System;
using System.Collections.Generic;
using Marionette.Runtime.Core.Document;

namespace Marionette.Runtime.Core.Skeleton
{
    // Sequence-attachment frame resolution (ADR-0009 section 3, ADR-0011 section 2; mirrors
    // packages/runtime-core/src/skeleton/sequence.ts). A region or mesh attachment may carry a sequence
    // block (Count frames, a SetupIndex, a naming template); a per-slot sequence timeline then drives which
    // frame is shown over time, in one of seven playback modes. The resolved frame is a DISCRETE integer in
    // [0, Count), computed by pure integer arithmetic so all three runtimes agree EXACTLY (no float
    // tolerance). This file resolves the integer frame; turning it into an atlas region name is a renderer
    // concern, not a solve concern.
    public static class Sequence
    {
        // Non-negative modulo (C# % keeps the sign of the dividend; sequence wrapping needs a non-negative
        // residue for the reverse modes where index - advanced can go negative).
        private static int Mod(int value, int n)
        {
            return ((value % n) + n) % n;
        }

        // Triangle wave over [0, count-1] with period 2*(count-1): 0,1,...,count-1,count-2,...,1,0,1,... It
        // maps a monotonically advancing position onto a bouncing frame index (pingpong). Symmetric, so
        // feeding it a descending position (index - advanced) yields the reverse-direction bounce.
        private static int Triangle(int position, int count)
        {
            int period = 2 * (count - 1);
            int m = Mod(position, period);
            return m <= count - 1 ? m : period - m;
        }

        // Resolve the frame index for an active sequence key. Elapsed is time since the key (>= 0), Delay is
        // seconds per frame, Index the key's starting frame, Count the sequence length. A non-positive delay
        // (or count 1) advances no frames (holds). Every branch returns an integer in [0, count).
        public static int ResolveSequenceFrame(
            SequenceMode mode,
            int index,
            double delay,
            int count,
            double elapsed)
        {
            if (count <= 1)
            {
                return 0;
            }

            int last = count - 1;
            int advanced = delay > 0 && elapsed > 0 ? (int)Math.Floor(elapsed / delay) : 0;
            switch (mode)
            {
                case SequenceMode.Hold:
                    return index < 0 ? 0 : index > last ? last : index;
                case SequenceMode.Once:
                    return Math.Min(index + advanced, last);
                case SequenceMode.Loop:
                    return Mod(index + advanced, count);
                case SequenceMode.Pingpong:
                    return Triangle(index + advanced, count);
                case SequenceMode.OnceReverse:
                    return Math.Max(index - advanced, 0);
                case SequenceMode.LoopReverse:
                    return Mod(index - advanced, count);
                case SequenceMode.PingpongReverse:
                    return Triangle(index - advanced, count);
                default:
                    return 0;
            }
        }

        // The sequence block (Count + SetupIndex) of the slot's ACTIVE attachment, searched across skins. A
        // region or mesh attachment may carry it; the first attachment named attachmentName under slotName
        // that has a sequence wins. Null when the active attachment has no sequence block.
        private static SequenceBlock? FindSequenceBlock(
            SkeletonDocument document,
            string slotName,
            string attachmentName)
        {
            foreach (Skin skin in document.Skins)
            {
                foreach (KeyValuePair<string, IReadOnlyList<KeyValuePair<string, Attachment>>> slotEntry in
                    skin.Attachments)
                {
                    if (slotEntry.Key != slotName)
                    {
                        continue;
                    }

                    foreach (KeyValuePair<string, Attachment> attachmentEntry in slotEntry.Value)
                    {
                        if (attachmentEntry.Key != attachmentName)
                        {
                            continue;
                        }

                        Attachment attachment = attachmentEntry.Value;
                        if ((attachment.Type == "region" || attachment.Type == "mesh")
                            && attachment.Sequence != null)
                        {
                            return attachment.Sequence;
                        }
                    }
                }
            }

            return null;
        }

        // Resolve the discrete sequence FRAME INDEX for a slot at time t. Reuses a pose already solved by
        // SampleSkeleton (it reads the slot's resolved active attachment). Returns -1 when the slot has no
        // active sequence attachment (nothing to resolve); the attachment's SetupIndex when the slot has a
        // sequence attachment but no active timeline key at t (before the first key, or no sequence
        // timeline); otherwise the mode-resolved frame from the active key.
        public static int SampleSlotSequenceFrame(
            SkeletonDocument document,
            string animationId,
            double t,
            Pose pose,
            string slotName)
        {
            int slotIndex = IndexOf(pose.SlotNames, slotName);
            if (slotIndex < 0)
            {
                return -1;
            }

            string? attachmentName = pose.SlotAttachment[slotIndex];
            if (attachmentName == null)
            {
                return -1;
            }

            SequenceBlock? block = FindSequenceBlock(document, slotName, attachmentName);
            if (block == null)
            {
                return -1;
            }

            Animation? animation = document.FindAnimation(animationId);
            if (animation == null)
            {
                throw new AnimationNotFoundException(animationId);
            }

            IReadOnlyList<SequenceKeyframe>? timeline = FindSlotSequenceTimeline(animation, slotName);
            if (timeline == null || timeline.Count == 0)
            {
                return block.Value.SetupIndex;
            }

            // The active key is the last one whose time is at or before t (keys are strict-ascending). Before
            // the first key the sequence shows its setup frame.
            SequenceKeyframe? active = null;
            for (int i = 0; i < timeline.Count; i += 1)
            {
                SequenceKeyframe key = timeline[i];
                if (key.Time <= t)
                {
                    active = key;
                }
                else
                {
                    break;
                }
            }

            if (active == null)
            {
                return block.Value.SetupIndex;
            }

            return ResolveSequenceFrame(active.Mode, active.Index, active.Delay, block.Value.Count, t - active.Time);
        }

        private static IReadOnlyList<SequenceKeyframe>? FindSlotSequenceTimeline(Animation animation, string slotName)
        {
            foreach (KeyValuePair<string, SlotTimelines> entry in animation.Slots)
            {
                if (entry.Key == slotName)
                {
                    return entry.Value.Sequence;
                }
            }

            return null;
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
