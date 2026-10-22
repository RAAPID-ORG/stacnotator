# Magic wand

Click-, box- and text-prompted segmentation that runs in the annotator's
browser. Nothing is computed on the server: the backend only stores two label
settings, and the model weights are static files.

## Using it

An admin turns it on per polygon label in the campaign's labels editor
(**Magic wand**), optionally with a prompt such as `building` or
`solar panel, greenhouse`. In Explore the wand tool (`W`) then appears, and
offers only those labels.

- **Click** - inside a field, roof or water body; the region around the click
  is grown out to the edges that enclose it. No model and no download, and an
  answer in a fraction of a second. `[` and `]` (or − / + beside the outline)
  shrink and grow it.
- **The object in the box** - drag a box around one object; the model
  outlines it.
- **Every "prompt"** - only for labels with a prompt; drag a box over an
  area and every match inside it is outlined.

Outlines are proposals, drawn dashed over the map until decided. A click on one
leaves it out, `Enter` (or **Accept** beside them) saves the rest in one batch
with the label and the current form answers, `Esc` discards them. Boxes drawn
before deciding add to the same set.

## Click: region growing

The model-free path (`shared/segmentation/regionGrow.ts`, run in
`grow.worker.ts`) follows the classical field-delineation recipe - edge
strength, then a marker-based flood from the click, as in watershed:

1. A 768 native-pixel window around the click is fetched and converted to
   CIELAB.
2. A 5x5 median (separable) flattens texture inside fields - crop rows, pivot
   rings, blotches - while keeping the step at a field's edge.
3. Sobel gradient magnitude in ΔE, then a 3x3 maximum so a one-pixel road is
   a closed wall.
4. With **Clicks use edges from several dates** on, the edges of up to four
   dates of the same source (the cover slices of other collections) are
   averaged. Neighbouring fields that look alike on one date usually differ in
   crop stage on another; this is the multi-date edge approach that did best
   among the classical methods in a Sentinel-2 comparison (Canny on several
   growing-season images, then watershed).
5. A minimax flood from the click records, for every pixel, the weakest edge
   it can be reached across; pixels more than 20 ΔE from the click's colour
   never join. Any tolerance is then a threshold on that map, which is why
   grow and shrink are instant.
6. The stops: the level before each jump in area, with a step for every ~25%
   of growth in between. The first one shown is the level before the first
   jump that looks like a spill (area at least triples and the added pixels
   differ in colour), else before the biggest jump.

Measured on a 10 m NAIP farmland scene (centre pivots, strip cropping, blotchy
fields) and a 0.6 m residential scene:

- About half of the fields came out right on the first click. Through grow
  and shrink about three quarters could be outlined cleanly; the default
  leans small, so the usual correction is one or two `]`.
- Clean pivots, strips and rectangles bounded by roads work well, and rows of
  roofs. Gabled roofs start at one roof plane (the ridge is an edge) and take
  a few `]` to cover the whole roof.
- It fails where the literature says classical methods fail: touching fields
  of the same colour merge, and dark pivots with strong ring texture leak into
  a neighbour before they fill. For those the box mode is the answer.
- The multi-date path is unit-tested but has not been validated on a real
  time series yet.

In headless Chromium on a 4-core machine a click took 0.3-0.4 s including
fetching the tiles; a grow or shrink step only re-thresholds the stored flood.

## Pipeline

1. The box is turned into the raster the main map is showing (`mainRaster` in
   `features/annotation/map/compose.ts` - the slice, or the basemap when it is
   selected).
2. `shared/segmentation/mosaic.ts` fetches that source's XYZ tiles under the
   box and stitches them into one image, at the source's `max_native_zoom`
   (or the map's zoom when it declares none). If that would exceed 1536 px the
   zoom steps down, because both models resize their input to about 1024 px
   anyway. Single-object boxes get context around them: 20% padding and at
   least 384 native pixels a side, without which the outline bleeds.
3. A dedicated worker (`segment.worker.ts`) runs the model on onnxruntime-web,
   WebGPU first and the wasm build when the browser has none, then traces the
   masks into polygons (`contours.ts`: simple rings with holes, simplified to
   about a pixel).
4. The polygons are georeferenced back to lon/lat and become proposals
   (`features/annotation/stores/wand.ts`).

The image is not cut into patches. One forward pass covers the box, which
keeps the result free of seams and duplicate objects along patch edges; the
cost is that a very large "every match" box is downsampled, so small objects
call for a smaller box. The panel reports the ground resolution each run
worked at.

## Models

| Mode | Model | Download | Why |
| --- | --- | --- | --- |
| One object | SAM 2.1 Hiera-Tiny, fp32 | 155 MB | Light and fast. Strong zero-shot box-prompted masks on aerial and satellite imagery. At 4-bit its outlines of small buildings degraded (IoU 0.75 against fp32), so it stays fp32. |
| Every match | SAM 3, 4-bit weights | 620 MB | The open model that segments every instance of a noun phrase. On a 0.6 m aerial scene it found all 14 houses for "building", and 4-bit quantisation left the detections unchanged. |

SAM 3's text encoder is only needed once per prompt: its output is kept in
Cache Storage, and the encoder is loaded for a prompt this browser has not
seen and released straight after. The model files are kept in Cache Storage
too, so each is downloaded once per browser.

Two 2026 evaluations of SAM 3 on remote sensing found text prompts to be its
weaker side on overhead imagery, since its words carry ground-level meaning. Prompts naming
what the object looks like from above (`roof`, `swimming pool`) tend to do
better than functional names, and comma-separated alternatives are each run
and merged.

## Hosting the weights

The weights are not in the repository or the bundle.

```bash
uv run frontend/scripts/prepare_segmentation_models.py            # -> frontend/models/segmentation
uv run frontend/scripts/prepare_segmentation_models.py /some/dir  # anywhere else
```

The script downloads the ONNX exports X-AnyLabeling publishes, quantises SAM 3
and fixes what onnxruntime-web refuses to load. The dev server serves the
default output at the wand's default URL; it is kept out of `public/`, so a
build never carries the weights. In production, upload the folder to any host that
serves it with CORS (a storage container works) and build the frontend with
`VITE_SEGMENTATION_MODELS_URL` pointing at it. If that host is not the app's
own origin, add it to `connect-src` where the CSP is set (`frontend/default.conf`;
the Static Web App's policy already allows any https origin).

The CSP's `script-src` carries `'wasm-unsafe-eval'`, which WebAssembly needs
to compile; without it the wand cannot start.

Licences: SAM 2.1 is Apache-2.0. SAM 3 is released under Meta's own SAM
License rather than an OSI licence; check its terms before hosting the weights
publicly.

## Performance

Measured in headless Chromium on a 4-core machine without a GPU, so on the
single-threaded wasm fallback: about 15 s per box for SAM 2.1, and about
5.5 minutes for a first SAM 3 run including its text encoder. WebGPU is the
path this is built for and has not been timed on real GPU hardware yet; the
panel reports each run's time, and says when a browser has fallen back to
the CPU. Multi-threaded wasm would need the page to be cross-origin isolated,
which the Firebase sign-in popup and third-party tiles rule out.

## Tests

`frontend/e2e/magic-wand.spec.ts` runs the whole flow against stand-in models
with SAM 2.1's exact inputs and outputs
(`e2e/fixtures/segmentation/make_fake_sam2.py`), so CI needs no weights.
The pure parts (tiling, tracing, tokenizer) have unit tests next to them.
