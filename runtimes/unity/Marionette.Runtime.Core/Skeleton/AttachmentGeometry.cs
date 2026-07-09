using System;
using System.Collections.Generic;
using Marionette.Runtime.Core.Document;
using Marionette.Runtime.Core.MathCore;

namespace Marionette.Runtime.Core.Skeleton
{
    // Non-drawing geometry attachments (ADR-0012, PP-B2): clipping evaluation, bounding-box hit testing, and
    // point resolution. Mirrors packages/runtime-core/src/skeleton/attachment-geometry.ts function-for-
    // function so the three runtimes (TS, C#, GDScript) compute identical results and the conformance corpus
    // can lock it. These READ the solved pose (Pose.World written by the world pass, Pose.DrawOrder written by
    // the sampler) and never write it, so they are post-step-4 accessors that change no existing fixture.
    //
    // In our format a clipping/boundingbox vertex stream is ALWAYS unweighted (no bones manifest, unlike a
    // mesh, ADR-0002), so a polygon vertex's world position is slotBoneWorld * (x, y), exactly the unweighted
    // mesh transform. A point is a single local (x, y, rotation) composed with the slot bone's world. World
    // polygons are double[] (f64), matching the TS Float64Array, to minimize cross-language reordering noise.
    public static class AttachmentGeometry
    {
        private const double RadToDeg = 180.0 / Math.PI;

        // The world matrix offset of the bone a slot rides, or -1 when the slot or its bone is unknown (a
        // defensive value for an unvalidated document; a validated rig always resolves it).
        private static int SlotBoneOffset(Pose pose, int slotIndex)
        {
            if (slotIndex < 0 || slotIndex >= pose.SlotCount)
            {
                return -1;
            }

            int boneIndex = pose.SlotBoneIndices[slotIndex];
            return boneIndex < 0 ? -1 : boneIndex * Affine.Mat2x3Stride;
        }

        // Transform a flat unweighted local vertex stream [x0, y0, x1, y1, ...] into world space by the world
        // matrix at world[boneOffset ..]: world_i = slotBoneWorld * (x_i, y_i). Writes 2 world lanes per
        // logical vertex into `output` (sized >= vertices.Length) and returns the vertex count. Allocation-free.
        public static int TransformUnweightedVerticesInto(
            IReadOnlyList<double> vertices,
            double[] world,
            int boneOffset,
            double[] output)
        {
            double a = world[boneOffset];
            double b = world[boneOffset + 1];
            double c = world[boneOffset + 2];
            double d = world[boneOffset + 3];
            double tx = world[boneOffset + 4];
            double ty = world[boneOffset + 5];
            int length = vertices.Count;
            for (int i = 0; i < length; i += 2)
            {
                double x = vertices[i];
                double y = vertices[i + 1];
                output[i] = (a * x) + (c * y) + tx;
                output[i + 1] = (b * x) + (d * y) + ty;
            }

            return length / 2;
        }

        // ---------------------------------------------------------------------------------------------------
        // Point attachment (ADR-0012 section 2)
        // ---------------------------------------------------------------------------------------------------

        // A point attachment's resolved world state: world position and world rotation in degrees.
        public readonly struct PointWorld
        {
            public readonly double X;
            public readonly double Y;
            public readonly double RotationDeg;

            public PointWorld(double x, double y, double rotationDeg)
            {
                X = x;
                Y = y;
                RotationDeg = rotationDeg;
            }
        }

        // Resolve a point attachment's world position (slotBoneWorld * (x, y)) and world rotation (point.rotation
        // + the bone's world x-axis angle, ADR-0012 section 2). `boneOffset` is the slot bone's world matrix offset.
        public static PointWorld ResolvePointWorld(PointAttachment point, double[] world, int boneOffset)
        {
            double a = world[boneOffset];
            double b = world[boneOffset + 1];
            double c = world[boneOffset + 2];
            double d = world[boneOffset + 3];
            double tx = world[boneOffset + 4];
            double ty = world[boneOffset + 5];
            double x = (a * point.X) + (c * point.Y) + tx;
            double y = (b * point.X) + (d * point.Y) + ty;
            double boneRotationDeg = Math.Atan2(b, a) * RadToDeg;
            return new PointWorld(x, y, point.Rotation + boneRotationDeg);
        }

        // Resolve a point attachment for the slot it rides, reading the slot bone's world matrix from the solved
        // pose. Returns false (and a default PointWorld) when the slot's bone is unknown (a defensive path for an
        // unvalidated document).
        public static bool ResolvePointWorldForSlot(
            Pose pose,
            int slotIndex,
            PointAttachment point,
            out PointWorld world)
        {
            int offset = SlotBoneOffset(pose, slotIndex);
            if (offset < 0)
            {
                world = default;
                return false;
            }

            world = ResolvePointWorld(point, pose.World, offset);
            return true;
        }

        // ---------------------------------------------------------------------------------------------------
        // Bounding-box hit testing (ADR-0012 section 4)
        // ---------------------------------------------------------------------------------------------------

        // Transform a bounding-box attachment's polygon into world space for the slot it rides, into `output`
        // (sized >= box.Vertices.Length). Returns the vertex count, or -1 when the slot's bone is unknown.
        public static int BoundingBoxWorldVerticesForSlot(
            Pose pose,
            int slotIndex,
            BoundingBoxAttachment box,
            double[] output)
        {
            int offset = SlotBoneOffset(pose, slotIndex);
            if (offset < 0)
            {
                return -1;
            }

            return TransformUnweightedVerticesInto(box.Vertices, pose.World, offset, output);
        }

        // Even-odd (crossing-number) point-in-polygon test over a world-space polygon (ADR-0012 section 4). The
        // polygon is `worldVertices` (flat [x0, y0, ...], `vertexCount` logical vertices). A point is inside iff a
        // ray toward +x crosses an odd number of edges; the half-open [yMin, yMax) span convention avoids
        // double-counting a shared vertex. Orientation-independent; allocation-free; the boolean is deterministic.
        public static bool HitTestPolygon(double[] worldVertices, int vertexCount, double px, double py)
        {
            bool inside = false;
            int j = vertexCount - 1;
            for (int i = 0; i < vertexCount; i += 1)
            {
                double ax = worldVertices[i * 2];
                double ay = worldVertices[(i * 2) + 1];
                double bx = worldVertices[j * 2];
                double by = worldVertices[(j * 2) + 1];
                if ((ay > py) != (by > py) && px < (((bx - ax) * (py - ay)) / (by - ay)) + ax)
                {
                    inside = !inside;
                }

                j = i;
            }

            return inside;
        }

        // Hit-test a world point against a bounding-box attachment for the slot it rides: transform the box into
        // `scratch` (sized >= box.Vertices.Length) then run the even-odd test. Returns false when the slot's bone
        // is unknown. Allocation-free given a reused scratch buffer.
        public static bool HitTestBoundingBox(
            Pose pose,
            int slotIndex,
            BoundingBoxAttachment box,
            double px,
            double py,
            double[] scratch)
        {
            int count = BoundingBoxWorldVerticesForSlot(pose, slotIndex, box, scratch);
            if (count < 3)
            {
                return false;
            }

            return HitTestPolygon(scratch, count, px, py);
        }

        // ---------------------------------------------------------------------------------------------------
        // Clipping evaluation (ADR-0012 section 3)
        // ---------------------------------------------------------------------------------------------------

        // The precomputed, pose-independent data for one clip attachment (ADR-0012 section 3.2/3.3): the polygon
        // convexity (decided once on the LOCAL polygon, affine invariant) and, for a concave polygon, the ear-clip
        // triangle topology (indices into the polygon vertices) reused every frame with world vertices. PieceCount
        // is 1 (convex) or V-2 (concave); the worst-case bounds size a caller's output pool.
        public sealed class PreparedClip
        {
            public int VertexCount { get; }
            public bool Convex { get; }

            // Concave only: (V-2)*3 vertex indices, three per ear triangle. Empty for a convex polygon.
            public int[] EarTriangles { get; }
            public int PieceCount { get; }

            // Worst-case output vertices and rings PER INPUT TRIANGLE (ADR-0012 section 3.3).
            public int MaxOutputVerticesPerTri { get; }
            public int MaxRingsPerTri { get; }

            public PreparedClip(
                int vertexCount,
                bool convex,
                int[] earTriangles,
                int pieceCount,
                int maxOutputVerticesPerTri,
                int maxRingsPerTri)
            {
                VertexCount = vertexCount;
                Convex = convex;
                EarTriangles = earTriangles;
                PieceCount = pieceCount;
                MaxOutputVerticesPerTri = maxOutputVerticesPerTri;
                MaxRingsPerTri = maxRingsPerTri;
            }
        }

        // Twice the signed area of a flat polygon [x0, y0, ...] over `count` vertices via the shoelace sum;
        // positive for a counter-clockwise ring. Used to decide winding for ear-clipping (local) and the
        // per-frame convex-piece reorientation (world).
        private static double SignedArea2(double[] vertices, int offset, int count)
        {
            double sum = 0;
            for (int i = 0; i < count; i += 1)
            {
                int next = (i + 1) % count;
                double ix = vertices[offset + (i * 2)];
                double iy = vertices[offset + (i * 2) + 1];
                double nx = vertices[offset + (next * 2)];
                double ny = vertices[offset + (next * 2) + 1];
                sum += (ix * ny) - (nx * iy);
            }

            return sum;
        }

        // True iff the local polygon is convex: every consecutive-edge cross product shares one sign (collinear
        // zeros allowed). A reflection flips all signs together, so this decision is affine invariant.
        private static bool IsConvexPolygon(double[] vertices, int count)
        {
            int sign = 0;
            for (int i = 0; i < count; i += 1)
            {
                double ax = vertices[i * 2];
                double ay = vertices[(i * 2) + 1];
                double bx = vertices[(((i + 1) % count) * 2)];
                double by = vertices[(((i + 1) % count) * 2) + 1];
                double cx = vertices[(((i + 2) % count) * 2)];
                double cy = vertices[(((i + 2) % count) * 2) + 1];
                double cross = ((bx - ax) * (cy - by)) - ((by - ay) * (cx - bx));
                if (cross > 0)
                {
                    if (sign < 0)
                    {
                        return false;
                    }

                    sign = 1;
                }
                else if (cross < 0)
                {
                    if (sign > 0)
                    {
                        return false;
                    }

                    sign = -1;
                }
            }

            return true;
        }

        // Point-in-triangle by three same-side cross-product signs (inclusive of the boundary), for the ear guard.
        private static bool PointInTriangle(
            double px,
            double py,
            double ax,
            double ay,
            double bx,
            double by,
            double cx,
            double cy)
        {
            double d1 = ((px - bx) * (ay - by)) - ((ax - bx) * (py - by));
            double d2 = ((px - cx) * (by - cy)) - ((bx - cx) * (py - cy));
            double d3 = ((px - ax) * (cy - ay)) - ((cx - ax) * (py - ay));
            bool hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
            bool hasPos = d1 > 0 || d2 > 0 || d3 > 0;
            return !(hasNeg && hasPos);
        }

        // Ear-clip a concave (or convex) local polygon into triangle index triples (ADR-0012 section 3.2). Standard
        // O(V^2) ear clipping over a CCW-normalized index ring; a point-in-triangle guard rejects a candidate ear
        // that contains any other polygon vertex. Deterministic (fixed scan order). Returns a flat (V-2)*3 index
        // array referencing the ORIGINAL vertex indices, so the topology is reused every frame with world vertices.
        private static int[] EarClip(double[] vertices, int count)
        {
            var triangles = new int[Math.Max(0, count - 2) * 3];
            if (count < 3)
            {
                return triangles;
            }

            // Normalize to CCW so the "convex vertex" test (positive cross) is consistent.
            bool ccw = SignedArea2(vertices, 0, count) > 0;
            var indices = new List<int>(count);
            for (int i = 0; i < count; i += 1)
            {
                indices.Add(ccw ? i : count - 1 - i);
            }

            double Px(int k) => vertices[indices[k] * 2];
            double Py(int k) => vertices[(indices[k] * 2) + 1];

            int outIndex = 0;
            int remaining = indices.Count;
            int guard = 0;
            int guardLimit = (count * count) + 1;
            while (remaining > 3 && guard < guardLimit)
            {
                guard += 1;
                bool clipped = false;
                for (int k = 0; k < remaining; k += 1)
                {
                    int prev = ((k - 1 + remaining) % remaining);
                    int next = (k + 1) % remaining;
                    double ax = Px(prev);
                    double ay = Py(prev);
                    double bx = Px(k);
                    double by = Py(k);
                    double cx = Px(next);
                    double cy = Py(next);
                    double cross = ((bx - ax) * (cy - ay)) - ((by - ay) * (cx - ax));
                    if (cross <= 0)
                    {
                        continue; // reflex or collinear: not an ear tip
                    }

                    bool containsOther = false;
                    for (int m = 0; m < remaining; m += 1)
                    {
                        if (m == prev || m == k || m == next)
                        {
                            continue;
                        }

                        if (PointInTriangle(Px(m), Py(m), ax, ay, bx, by, cx, cy))
                        {
                            containsOther = true;
                            break;
                        }
                    }

                    if (containsOther)
                    {
                        continue;
                    }

                    triangles[outIndex] = indices[prev];
                    triangles[outIndex + 1] = indices[k];
                    triangles[outIndex + 2] = indices[next];
                    outIndex += 3;
                    indices.RemoveAt(k);
                    remaining -= 1;
                    clipped = true;
                    break;
                }

                if (!clipped)
                {
                    break; // degenerate polygon: stop rather than spin
                }
            }

            if (remaining == 3)
            {
                triangles[outIndex] = indices[0];
                triangles[outIndex + 1] = indices[1];
                triangles[outIndex + 2] = indices[2];
            }

            return triangles;
        }

        // Prepare a clip attachment once: decide convexity on the LOCAL polygon (affine invariant) and, when
        // concave, ear-clip its topology (ADR-0012 section 3.2/3.3). Records the worst-case output bounds a caller
        // uses to size the clip output pool. A polygon with V < 3 yields PieceCount 0 (no clip region).
        public static PreparedClip PrepareClipping(ClippingAttachment clip)
        {
            int vertexCount = clip.Vertices.Length / 2;
            if (vertexCount < 3)
            {
                return new PreparedClip(vertexCount, true, Array.Empty<int>(), 0, 0, 0);
            }

            bool convex = IsConvexPolygon(clip.Vertices, vertexCount);
            if (convex)
            {
                return new PreparedClip(vertexCount, true, Array.Empty<int>(), 1, 3 + vertexCount, 1);
            }

            int[] earTriangles = EarClip(clip.Vertices, vertexCount);
            int pieceCount = vertexCount - 2;
            // Each ear-clip piece is a 3-edge convex triangle, so a clipped subject triangle has at most 6 verts.
            return new PreparedClip(vertexCount, false, earTriangles, pieceCount, 6 * pieceCount, pieceCount);
        }

        // Resolve a clip attachment's world-space polygon for the slot it rides, into `output` (sized >= 2*V).
        // Returns the vertex count, or -1 when the slot's bone is unknown. Allocation-free.
        public static int ResolveClipWorldPolygonForSlot(
            Pose pose,
            int slotIndex,
            ClippingAttachment clip,
            double[] output)
        {
            int offset = SlotBoneOffset(pose, slotIndex);
            if (offset < 0)
            {
                return -1;
            }

            return TransformUnweightedVerticesInto(clip.Vertices, pose.World, offset, output);
        }

        // The render position of a slot index within the current draw order (Pose.DrawOrder maps render position
        // -> slot index), or -1 if absent. Linear scan; the slot count is small.
        private static int RenderPositionOf(Pose pose, int slotIndex)
        {
            for (int position = 0; position < pose.SlotCount; position += 1)
            {
                if (pose.DrawOrder[position] == slotIndex)
                {
                    return position;
                }
            }

            return -1;
        }

        // Compute the clipped slot set for a clip attachment (ADR-0012 section 3.1): the slots at render positions
        // pClip+1 .. pEnd inclusive in the CURRENT draw order. Fills `outSlotIndices` (sized >= pose.SlotCount)
        // with those slot indices in ascending render-position order and returns the count. Empty (returns 0) when
        // the end slot is at or before the clip slot, or when either slot is unresolved. Allocation-free.
        public static int ComputeClippedSlotRange(
            Pose pose,
            int clipSlotIndex,
            int endSlotIndex,
            int[] outSlotIndices)
        {
            int pClip = RenderPositionOf(pose, clipSlotIndex);
            int pEnd = RenderPositionOf(pose, endSlotIndex);
            if (pClip < 0 || pEnd < 0 || pEnd <= pClip)
            {
                return 0;
            }

            int count = 0;
            for (int position = pClip + 1; position <= pEnd; position += 1)
            {
                outSlotIndices[count] = pose.DrawOrder[position];
                count += 1;
            }

            return count;
        }

        // Pooled output for ClipTriangleList (ADR-0012 section 3.3): the flat output vertex positions and their
        // barycentric coordinates (with respect to the source input triangle), the per-ring vertex counts, and the
        // per-ring source-triangle index. ScratchA/ScratchB are the Sutherland-Hodgman ping-pong buffers, each
        // stride SubjectStride (x, y, b0, b1, b2). Every buffer grows only when a larger job than any before
        // appears (size-keyed), so steady-state clipping of same-or-smaller streams allocates nothing.
        public sealed class ClipBuffers
        {
            public double[] Positions;
            public double[] Bary;
            public int[] RingVertexCount;
            public int[] RingSourceTri;
            public double[] ScratchA;
            public double[] ScratchB;

            public ClipBuffers()
            {
                Positions = Array.Empty<double>();
                Bary = Array.Empty<double>();
                RingVertexCount = Array.Empty<int>();
                RingSourceTri = Array.Empty<int>();
                ScratchA = Array.Empty<double>();
                ScratchB = Array.Empty<double>();
            }
        }

        // The result of one clip: how many rings and how many total output vertices were written (the caller reads
        // RingVertexCount[0..RingCount) and walks Positions/Bary in step).
        public readonly struct ClipResult
        {
            public readonly int RingCount;
            public readonly int VertexCount;

            public ClipResult(int ringCount, int vertexCount)
            {
                RingCount = ringCount;
                VertexCount = vertexCount;
            }
        }

        private const int SubjectStride = 5; // x, y, b0, b1, b2

        // Allocate empty clip buffers; ClipTriangleList grows them to the job's worst case on first use.
        public static ClipBuffers MakeClipBuffers() => new ClipBuffers();

        // Grow the clip buffers to hold a triangle stream of `triangleCount` triangles clipped by `prepared`
        // (ADR-0012 section 3.3 worst case). Size-keyed: only reallocates a buffer that is too small.
        private static void EnsureClipCapacity(ClipBuffers buffers, PreparedClip prepared, int triangleCount)
        {
            int maxVertices = triangleCount * prepared.MaxOutputVerticesPerTri;
            int maxRings = triangleCount * prepared.MaxRingsPerTri;
            // The largest per-pass subject size: 3 + (whole polygon edges) in the convex case, else 6 for a triangle.
            int maxSubject = prepared.Convex ? 3 + prepared.VertexCount : 6;
            if (buffers.Positions.Length < maxVertices * 2)
            {
                buffers.Positions = new double[maxVertices * 2];
            }

            if (buffers.Bary.Length < maxVertices * 3)
            {
                buffers.Bary = new double[maxVertices * 3];
            }

            if (buffers.RingVertexCount.Length < maxRings)
            {
                buffers.RingVertexCount = new int[maxRings];
            }

            if (buffers.RingSourceTri.Length < maxRings)
            {
                buffers.RingSourceTri = new int[maxRings];
            }

            if (buffers.ScratchA.Length < maxSubject * SubjectStride)
            {
                buffers.ScratchA = new double[maxSubject * SubjectStride];
                buffers.ScratchB = new double[maxSubject * SubjectStride];
            }
        }

        // Clip a world-space triangle stream against a clip attachment's world polygon (ADR-0012 section 3), the
        // geometry operation a CPU rasterizer needs. `worldPolygon` is filled by ResolveClipWorldPolygonForSlot;
        // `triVerts` is the flat world xy of the source geometry; `triIndices` is the flat 3-per-triangle index
        // array. Writes, per input triangle, one convex output ring (convex polygon) or, for a concave clip
        // polygon, one ring per ear-clip piece it intersects, into the pooled `buffers`, and returns ring/vertex
        // counts. Each output vertex carries its barycentric coordinates with respect to its source triangle.
        public static ClipResult ClipTriangleList(
            PreparedClip prepared,
            double[] worldPolygon,
            double[] triVerts,
            IReadOnlyList<int> triIndices,
            ClipBuffers buffers)
        {
            int triangleCount = triIndices.Count / 3;
            if (prepared.PieceCount == 0 || triangleCount == 0)
            {
                return new ClipResult(0, 0);
            }

            EnsureClipCapacity(buffers, prepared, triangleCount);

            int ringCount = 0;
            int vertexCount = 0;
            int v = prepared.VertexCount;

            for (int t = 0; t < triangleCount; t += 1)
            {
                int i0 = triIndices[t * 3];
                int i1 = triIndices[(t * 3) + 1];
                int i2 = triIndices[(t * 3) + 2];

                if (prepared.Convex)
                {
                    SeedSubjectTriangle(triVerts, i0, i1, i2, buffers.ScratchA);
                    // Result is normalized into ScratchB, so EmitRing always reads ScratchB.
                    int outLen = ClipSubjectAgainstConvex(buffers, 3, worldPolygon, 0, v);
                    int written = EmitRing(buffers, buffers.ScratchB, outLen, t, ringCount, vertexCount);
                    if (written > 0)
                    {
                        vertexCount += written;
                        ringCount += 1;
                    }
                }
                else
                {
                    for (int piece = 0; piece < prepared.PieceCount; piece += 1)
                    {
                        // Re-seed the subject triangle into ScratchA for each piece (the previous piece's ping-pong
                        // overwrote it); each piece intersects the SAME source triangle against a different clip tri.
                        SeedSubjectTriangle(triVerts, i0, i1, i2, buffers.ScratchA);
                        int outLen = ClipSubjectAgainstTriangle(buffers, 3, worldPolygon, prepared.EarTriangles, piece);
                        int written = EmitRing(buffers, buffers.ScratchB, outLen, t, ringCount, vertexCount);
                        if (written > 0)
                        {
                            vertexCount += written;
                            ringCount += 1;
                        }
                    }
                }
            }

            return new ClipResult(ringCount, vertexCount);
        }

        // Write the three source-triangle corners (positions + canonical barycentrics) into a subject scratch.
        private static void SeedSubjectTriangle(double[] triVerts, int i0, int i1, int i2, double[] subject)
        {
            WriteSubject(subject, 0, triVerts[i0 * 2], triVerts[(i0 * 2) + 1], 1, 0, 0);
            WriteSubject(subject, 1, triVerts[i1 * 2], triVerts[(i1 * 2) + 1], 0, 1, 0);
            WriteSubject(subject, 2, triVerts[i2 * 2], triVerts[(i2 * 2) + 1], 0, 0, 1);
        }

        private static void WriteSubject(
            double[] buffer,
            int vertexIndex,
            double x,
            double y,
            double b0,
            double b1,
            double b2)
        {
            int baseIndex = vertexIndex * SubjectStride;
            buffer[baseIndex] = x;
            buffer[baseIndex + 1] = y;
            buffer[baseIndex + 2] = b0;
            buffer[baseIndex + 3] = b1;
            buffer[baseIndex + 4] = b2;
        }

        // Clip the subject polygon (seeded in buffers.ScratchA, `subjectLen` vertices) against a whole convex clip
        // polygon poly[polyOffset ..] over `polyCount` vertices, ping-ponging between ScratchA and ScratchB. The
        // clip polygon is reoriented CCW per pass by its signed area (ADR-0012 winding rule) so the left-of-edge
        // inside test is correct even under a reflecting transform. The result is NORMALIZED into buffers.ScratchB.
        private static int ClipSubjectAgainstConvex(
            ClipBuffers buffers,
            int subjectLen,
            double[] poly,
            int polyOffset,
            int polyCount)
        {
            bool ccw = SignedArea2(poly, polyOffset, polyCount) >= 0;
            double[] src = buffers.ScratchA;
            double[] dst = buffers.ScratchB;
            int len = subjectLen;
            for (int e = 0; e < polyCount; e += 1)
            {
                int ai = ccw ? e : polyCount - 1 - e;
                int bi = ccw ? (e + 1) % polyCount : ((polyCount - 2 - e + polyCount) % polyCount);
                double ax = poly[polyOffset + (ai * 2)];
                double ay = poly[polyOffset + (ai * 2) + 1];
                double bx = poly[polyOffset + (bi * 2)];
                double by = poly[polyOffset + (bi * 2) + 1];
                len = ClipAgainstEdge(src, len, ax, ay, bx, by, dst);
                double[] swap = src;
                src = dst;
                dst = swap;
                if (len == 0)
                {
                    break;
                }
            }

            return FinishInScratchB(buffers, src, len);
        }

        // Clip the subject polygon (seeded in buffers.ScratchA) against one ear-clip triangle piece (three polygon
        // vertices named by earTriangles[piece*3 ..]), ping-ponging between ScratchA and ScratchB. Same
        // CCW-reorient-then-left-of-edge rule as the convex path; the result is normalized into buffers.ScratchB.
        private static int ClipSubjectAgainstTriangle(
            ClipBuffers buffers,
            int subjectLen,
            double[] poly,
            int[] earTriangles,
            int piece)
        {
            int t0 = earTriangles[piece * 3];
            int t1 = earTriangles[(piece * 3) + 1];
            int t2 = earTriangles[(piece * 3) + 2];
            double x0 = poly[t0 * 2];
            double y0 = poly[(t0 * 2) + 1];
            double x1 = poly[t1 * 2];
            double y1 = poly[(t1 * 2) + 1];
            double x2 = poly[t2 * 2];
            double y2 = poly[(t2 * 2) + 1];
            double area2 = ((x1 - x0) * (y2 - y0)) - ((y1 - y0) * (x2 - x0));
            // A zero-area (collinear or unfilled) ear piece has no clip region: emit nothing rather than let the
            // zero-length edges pass every subject vertex through as a spurious full ring.
            if (area2 == 0)
            {
                return 0;
            }

            bool ccw = area2 >= 0;
            // Edge endpoints in CCW order (0 -> 1 -> 2 -> 0), reversed when the world piece is CW.
            double px1 = ccw ? x1 : x2;
            double py1 = ccw ? y1 : y2;
            double px2 = ccw ? x2 : x1;
            double py2 = ccw ? y2 : y1;

            double[] src = buffers.ScratchA;
            double[] dst = buffers.ScratchB;
            int len = subjectLen;
            len = ClipAgainstEdge(src, len, x0, y0, px1, py1, dst);
            double[] swap = src;
            src = dst;
            dst = swap;
            if (len > 0)
            {
                len = ClipAgainstEdge(src, len, px1, py1, px2, py2, dst);
                swap = src;
                src = dst;
                dst = swap;
            }

            if (len > 0)
            {
                len = ClipAgainstEdge(src, len, px2, py2, x0, y0, dst);
                swap = src;
                src = dst;
                dst = swap;
            }

            return FinishInScratchB(buffers, src, len);
        }

        // Ensure the final clipped ring lives in buffers.ScratchB (copying it from ScratchA if the last pass landed
        // there), so the emitter always reads ScratchB. Returns the vertex count unchanged.
        private static int FinishInScratchB(ClipBuffers buffers, double[] resultBuffer, int len)
        {
            if (!ReferenceEquals(resultBuffer, buffers.ScratchB) && len > 0)
            {
                int total = len * SubjectStride;
                for (int i = 0; i < total; i += 1)
                {
                    buffers.ScratchB[i] = resultBuffer[i];
                }
            }

            return len;
        }

        // Sutherland-Hodgman single-edge clip: keep the part of the subject polygon on the LEFT of (or on) the
        // directed edge A -> B. Emits kept vertices and edge-crossing intersections (barycentrics lerped by the
        // same t) into `output`; returns the output vertex count. Left-of test: cross(B-A, P-A) >= 0. `output`
        // must be a distinct buffer from `subject` (the ping-pong guarantees this).
        private static int ClipAgainstEdge(
            double[] subject,
            int subjectLen,
            double ax,
            double ay,
            double bx,
            double by,
            double[] output)
        {
            double ex = bx - ax;
            double ey = by - ay;
            int outLen = 0;
            int sBase = (subjectLen - 1) * SubjectStride;
            bool sInside = (ex * (subject[sBase + 1] - ay)) - (ey * (subject[sBase] - ax)) >= 0;
            for (int i = 0; i < subjectLen; i += 1)
            {
                int eBase = i * SubjectStride;
                double px = subject[eBase];
                double py = subject[eBase + 1];
                bool eInside = (ex * (py - ay)) - (ey * (px - ax)) >= 0;
                if (eInside)
                {
                    if (!sInside)
                    {
                        outLen = EmitIntersection(subject, sBase, eBase, ax, ay, ex, ey, output, outLen);
                    }

                    CopyVertex(subject, eBase, output, outLen * SubjectStride);
                    outLen += 1;
                }
                else if (sInside)
                {
                    outLen = EmitIntersection(subject, sBase, eBase, ax, ay, ex, ey, output, outLen);
                }

                sBase = eBase;
                sInside = eInside;
            }

            return outLen;
        }

        // Emit the intersection of subject edge (S -> E) with the clip line through A along (ex, ey), lerping all
        // five subject lanes (x, y, b0, b1, b2) by t = dS / (dS - dE), where d is the signed left-of distance.
        private static int EmitIntersection(
            double[] subject,
            int sBase,
            int eBase,
            double ax,
            double ay,
            double ex,
            double ey,
            double[] output,
            int outLen)
        {
            double dS = (ex * (subject[sBase + 1] - ay)) - (ey * (subject[sBase] - ax));
            double dE = (ex * (subject[eBase + 1] - ay)) - (ey * (subject[eBase] - ax));
            double denom = dS - dE;
            double t = denom != 0 ? dS / denom : 0;
            int outBase = outLen * SubjectStride;
            for (int lane = 0; lane < SubjectStride; lane += 1)
            {
                double s = subject[sBase + lane];
                double e = subject[eBase + lane];
                output[outBase + lane] = s + (t * (e - s));
            }

            return outLen + 1;
        }

        private static void CopyVertex(double[] src, int srcBase, double[] dst, int dstBase)
        {
            for (int lane = 0; lane < SubjectStride; lane += 1)
            {
                dst[dstBase + lane] = src[srcBase + lane];
            }
        }

        // Emit one clipped ring (from the SH scratch) into the pooled output buffers, dropping degenerate rings
        // (fewer than 3 vertices, no area). Returns the number of vertices written (0 if dropped).
        private static int EmitRing(
            ClipBuffers buffers,
            double[] ringScratch,
            int ringLen,
            int sourceTri,
            int ringIndex,
            int vertexBase)
        {
            if (ringLen < 3)
            {
                return 0;
            }

            for (int v = 0; v < ringLen; v += 1)
            {
                int baseIndex = v * SubjectStride;
                int outVertex = vertexBase + v;
                buffers.Positions[outVertex * 2] = ringScratch[baseIndex];
                buffers.Positions[(outVertex * 2) + 1] = ringScratch[baseIndex + 1];
                buffers.Bary[outVertex * 3] = ringScratch[baseIndex + 2];
                buffers.Bary[(outVertex * 3) + 1] = ringScratch[baseIndex + 3];
                buffers.Bary[(outVertex * 3) + 2] = ringScratch[baseIndex + 4];
            }

            buffers.RingVertexCount[ringIndex] = ringLen;
            buffers.RingSourceTri[ringIndex] = sourceTri;
            return ringLen;
        }
    }
}
