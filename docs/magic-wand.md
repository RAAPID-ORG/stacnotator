# Magic wand

Box-prompted and text-prompted segmentation that runs in the annotator's
browser. Nothing is computed on the server: the backend only stores two label
settings, and the model weights are static files.

## Using it

An admin turns it on per polygon label in the campaign's labels editor
(**Magic wand**), optionally with a prompt such as `building` or
`solar panel, greenhouse`. In Explore the wand tool (`W`) then appears, and
offers only those labels.

- **The object in the box** - drag a box around one object; it is outlined.
- **Every "prompt"** - only for labels with a prompt; drag a box over an
  area and every match inside it is outlined.

Outlines are proposals, drawn dashed over the map until decided. A click on one
leaves it out, `Enter` (or **Accept** beside them) saves the rest in one batch
with the label and the current form answers, `Esc` discards them. Boxes drawn
before deciding add to the same set.

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
uv run frontend/scripts/prepare_segmentation_models.py            # -> frontend/public/models/segmentation
uv run frontend/scripts/prepare_segmentation_models.py /some/dir  # anywhere else
```

The script downloads the ONNX exports X-AnyLabeling publishes, quantises SAM 3
and fixes what onnxruntime-web refuses to load. The dev server serves the
default output directly. In production, upload the folder to any host that
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
