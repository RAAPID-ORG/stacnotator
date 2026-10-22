/**
 * The models the magic wand runs, and where their files are served from.
 *
 * - `box` - SAM 2.1 Hiera-Tiny. Segments the one object inside a drawn box.
 *   Small and fast enough to answer while the box is still on screen.
 * - `text` - SAM 3, weights quantised to 4 bits. Finds every instance of a
 *   label's prompt ("building", "car") inside the drawn area. Several times
 *   larger, so it is only fetched when a label with a prompt asks for it.
 *
 * The files are not part of the app bundle: `VITE_SEGMENTATION_MODELS_URL`
 * points at wherever they are hosted (the same origin by default), and the
 * browser keeps them in Cache Storage after the first download.
 * `frontend/scripts/prepare_segmentation_models.py` builds that folder.
 */

export type SegmentationModelId = 'box' | 'text';

export interface ModelFile {
  /** The ONNX graph. */
  graph: string;
  /** Its external weights file, named exactly as the graph refers to it. */
  data?: string;
}

export interface SegmentationModel {
  title: string;
  folder: string;
  /** Approximate download, for the first-use notice. */
  megabytes: number;
  encoder: ModelFile;
  decoder: ModelFile;
  language?: ModelFile;
  vocabulary?: string;
}

export const SEGMENTATION_MODELS: Record<SegmentationModelId, SegmentationModel> = {
  box: {
    title: 'SAM 2.1 Tiny',
    folder: 'sam2.1-hiera-tiny',
    megabytes: 155,
    encoder: { graph: 'sam2.1_hiera_tiny.encoder.onnx' },
    decoder: { graph: 'sam2.1_hiera_tiny.decoder.onnx' },
  },
  text: {
    title: 'SAM 3',
    folder: 'sam3-q4',
    megabytes: 620,
    encoder: { graph: 'sam3_image_encoder.onnx', data: 'sam3_image_encoder.onnx.data' },
    decoder: { graph: 'sam3_decoder.onnx', data: 'sam3_decoder.onnx.data' },
    language: { graph: 'sam3_language_encoder.onnx', data: 'sam3_language_encoder.onnx.data' },
    vocabulary: 'bpe_simple_vocab_16e6.txt.gz',
  },
};

export const segmentationModelsUrl = (): string =>
  (
    (import.meta.env.VITE_SEGMENTATION_MODELS_URL as string | undefined) ?? '/models/segmentation'
  ).replace(/\/+$/, '');
