# Chapter 5: Images and Atlases

Runtimes never load loose image files. All artwork ships packed into atlas pages, and every
attachment references a named region within them. This chapter covers preparing art, packing,
and how textures are resolved and shipped.

## 5.1 Preparing source art

- **One part per file, transparent PNG.** Each independently movable or swappable piece is its
  own image: torso, head, each limb segment (or each whole limb if it will be a mesh), each
  mouth shape, each prop.
- **Author at final resolution or higher.** Attachments can scale down cleanly; scaling up
  invents pixels. For HD targets, author at 2x and let export profiles handle variants.
- **Overlap generously at joints.** Parts that meet at a joint should overlap by enough art to
  cover the joint at the deepest bend you will animate; a knee that shows background at full
  fold is an art problem no rig can fix.
- **Consistent registration for swap sets.** All mouth shapes (or hand poses, or eye states)
  for one slot should share a canvas and anchor so swapping never shifts the part.
- **Neutral pose art.** Draw parts in the pose the skeleton will treat as setup; the less
  setup-pose rotation attachments need, the easier every later edit becomes.

Layered vector sources (Illustrator, Figma, Inkscape) work beautifully with this model: export
each layer as its own PNG at a chosen resolution and the pieces automatically share one
coordinate space.

## 5.2 Packing an atlas

`atlas.pack` runs the whole pipeline headlessly: read a directory of PNGs, alpha-trim each
sprite, pack with a max-rects algorithm, write page images, and install the atlas reference
into the document in one undoable command.

```
atlas.pack { documentId, sourceDir: "parts", outputDir: "atlas",
             maxPageSize: 2048, padding: 2 }
```

- **Deterministic.** Sprites are sorted by trimmed area then name before packing, and rotation
  is disabled, so the same inputs always produce byte-identical pages and the same region
  table. Re-packing an unchanged project changes nothing, which keeps builds and diffs clean.
- **Trimming.** Transparent borders are trimmed for packing, and the trim offsets are recorded
  per region (`offsetX`, `offsetY`, `originalW`, `originalH`) so attachments behave as if the
  whitespace were still there. You never compensate for trim manually.
- **Pages.** Sprites that do not fit one page flow onto more (`atlas-0.png`, `atlas-1.png`,
  ...). Page size is capped at 4096; 2048 is the safe default for broad device support.
- **Padding** (default 2 px) prevents texture bleed between neighbors when textures are
  filtered or mipmapped.
- **Region names** are the source file base names and must be unique across all pages.

Typical failures are typed: a sprite larger than the page (`ATLAS_SPRITE_TOO_LARGE`),
duplicate names (`ATLAS_REGION_DUPLICATE`).

If you pack with an external tool instead, install the result with `atlas.set` using the same
pages-and-regions shape (Chapter 10.1).

In the editor, the Assets panel offers three ways to feed the same pack: **Import sprites** picks a
folder, **Add images** picks one or more PNG files, and **dragging** PNGs onto the panel imports
them directly. All three route through the identical deterministic pipeline, so the resulting atlas
is the same however the images arrived. Every imported region shows a thumbnail in the panel,
decoded once per page and cached, so you can see what you are attaching.

## 5.2a Textures across save and load

The atlas metadata (pages and region rectangles) lives in the document, but the page PIXELS do not:
they are editor state. When you save a project, the editor writes the atlas page PNGs into a sibling
`<project>.textures` directory next to the project file, and opening the project reads them back and
restores the textures automatically, so a saved-and-reopened project shows its art rather than
placeholders. Keep that textures directory alongside the project file when you move or copy a
project; if it is missing, the document still opens (the regions render as placeholders until you
re-import).

## 5.3 How runtimes resolve textures

The document's atlas reference describes pages and regions; the HOST owns loading page images
and hands the runtime a texture resolver:

```ts
const regionTextures = buildRegionTextures(doc.atlas, pageTextures);
view.setTextureResolver(makeRegionTextureResolver(regionTextures));
```

Region textures are sub-windows of the page texture (no pixel copies, one GPU upload per
page). A region whose page has not loaded yet renders as a tiny white placeholder rather than
crashing, so progressive loading works; `render_frame` similarly reports a `placeholders` list
naming any regions it had to stand in for, which makes missing-art bugs visible instead of
silent.

## 5.4 Export profiles and texture variants

Shipping configuration lives in a per-project `export-profile.json`, a versioned document of
its own (not part of the skeleton file, not part of editor state):

- **Atlas export**: page size (2048 or 4096), padding, rotation policy, how compressed
  textures travel (a universal KTX2 transcode or per-target sidecar files), and the compressed
  target list (`astc6x6`, `bc7`, `etc2`).
- **Particle profiles** per device class (mobile, desktop): particle budget caps and the
  ambient quality tier.
- **Cold-start budgets** the build gates against.

At load time on the web, the runtime picks the best texture variant for the actual GPU in a
fixed, deterministic order: ASTC, then BC7, then ETC2, then PNG fallback. The choice reads
static GPU capabilities only, so the same device always makes the same choice.

## 5.5 Practical sizing

- Keep a character's parts within one 2048 page when you can; page switches cost draw calls.
- Pack VFX textures into the effects document's own atlas rather than the character atlas;
  they ship and load independently (Chapter 6).
- Watch the trim savings: generous transparent margins in source art are free (trimmed at
  pack), but huge fully-opaque backgrounds are not; crop background plates to what the camera
  sees.
