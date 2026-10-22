# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "onnx", "onnx-ir", "onnxruntime>=1.20"]
# ///
"""Build the folder the magic wand loads its models from.

    uv run frontend/scripts/prepare_segmentation_models.py [OUT_DIR]

OUT_DIR defaults to frontend/models/segmentation, which the dev server serves
at the wand's default URL. It is kept out of public/ so builds never carry the
weights: in production, upload the folder anywhere that serves it with CORS (a
storage container works) and build the frontend with
VITE_SEGMENTATION_MODELS_URL pointing at it.

Starting from the ONNX exports X-AnyLabeling publishes:

- SAM 2.1 Hiera-Tiny keeps its fp32 weights - at 4 bits its outlines lose
  small buildings - and only loses the stale shape annotations
  onnxruntime-web refuses to load.
- SAM 3 is quantised to 4-bit weights (MatMulNBits), which brings 3.6 GB to
  about 620 MB with the same detections on aerial imagery. Its text encoder
  also carries the token table twice in fp32 and runs its projections as Gemm,
  which the quantiser skips: the table is stored once in int8 and the Gemms
  become MatMul + Add first.
"""

import sys
import urllib.request
from pathlib import Path

import numpy as np
import onnx
from onnx import helper
from onnx import numpy_helper as nh
from onnxruntime.quantization.matmul_nbits_quantizer import (
    DefaultWeightOnlyQuantConfig,
    MatMulNBitsQuantizer,
)

RELEASES = "https://github.com/CVHub520/X-AnyLabeling/releases/download"
SAM2_FILES = ["sam2.1_hiera_tiny.encoder.onnx", "sam2.1_hiera_tiny.decoder.onnx"]
SAM3_MODELS = ["sam3_image_encoder", "sam3_decoder", "sam3_language_encoder"]
VOCABULARY = "https://raw.githubusercontent.com/openai/CLIP/main/clip/bpe_simple_vocab_16e6.txt.gz"


def download(url: str, dest: Path) -> Path:
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"downloading {url}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    urllib.request.urlretrieve(url, tmp)
    tmp.rename(dest)
    return dest


def save(model: onnx.ModelProto, path: Path) -> None:
    """With external weights next to the graph. onnx appends to an existing
    weights file rather than replacing it, so any old one goes first."""
    data = path.with_name(path.name + ".data")
    path.unlink(missing_ok=True)
    data.unlink(missing_ok=True)
    onnx.save_model(
        model,
        str(path),
        save_as_external_data=True,
        all_tensors_to_one_file=True,
        location=data.name,
        size_threshold=1024,
    )


def quantize(model: onnx.ModelProto) -> onnx.ModelProto:
    config = DefaultWeightOnlyQuantConfig(block_size=32, is_symmetric=True, bits=4)
    quantizer = MatMulNBitsQuantizer(model, block_size=32, is_symmetric=True, algo_config=config)
    quantizer.process()
    return quantizer.model.model


def shrink_language_encoder(model: onnx.ModelProto) -> onnx.ModelProto:
    graph = model.graph
    inits = {t.name: t for t in graph.initializer}
    gathers = [
        n
        for n in graph.node
        if n.op_type == "Gather"
        and inits.get(n.input[0]) is not None
        and len(inits[n.input[0]].dims) == 2
        and inits[n.input[0]].dims[0] == 49408
    ]
    table = nh.to_array(inits[gathers[0].input[0]])
    for node in gathers[1:]:
        if not np.array_equal(nh.to_array(inits[node.input[0]]), table):
            raise SystemExit("token tables differ; this export is not the one expected")
    scale = (np.abs(table).max(axis=1, keepdims=True) / 127).astype(np.float32)
    scale[scale == 0] = 1
    quantized = np.round(table / scale).astype(np.int8)

    dropped = {n.input[0] for n in gathers}
    keep = [t for t in graph.initializer if t.name not in dropped]
    del graph.initializer[:]
    graph.initializer.extend(keep)
    graph.initializer.extend([nh.from_array(quantized, "emb_q"), nh.from_array(scale, "emb_scale")])
    inits = {t.name: t for t in graph.initializer}

    nodes = []
    for node in graph.node:
        out = node.output[0]
        if node in gathers:
            ids = node.input[1]
            nodes += [
                helper.make_node("Gather", ["emb_q", ids], [out + "_q"], axis=0),
                helper.make_node("Cast", [out + "_q"], [out + "_f"], to=onnx.TensorProto.FLOAT),
                helper.make_node("Gather", ["emb_scale", ids], [out + "_s"], axis=0),
                helper.make_node("Mul", [out + "_f", out + "_s"], [out]),
            ]
        elif node.op_type == "Gemm":
            attrs = {a.name: helper.get_attribute_value(a) for a in node.attribute}
            if (
                attrs.get("transA", 0)
                or attrs.get("alpha", 1.0) != 1
                or attrs.get("beta", 1.0) != 1
            ):
                raise SystemExit(f"unexpected Gemm {node.name}")
            weight = inits[node.input[1]]
            matrix = nh.to_array(weight)
            if attrs.get("transB", 0):
                matrix = matrix.T.copy()
            graph.initializer.remove(weight)
            graph.initializer.append(nh.from_array(matrix, weight.name))
            nodes += [
                helper.make_node("MatMul", [node.input[0], node.input[1]], [out + "_mm"]),
                helper.make_node("Add", [out + "_mm", node.input[2]], [out]),
            ]
        else:
            nodes.append(node)
    del graph.node[:]
    graph.node.extend(nodes)
    return model


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "models/segmentation"
    downloads = out / ".downloads"

    sam2 = out / "sam2.1-hiera-tiny"
    sam2.mkdir(parents=True, exist_ok=True)
    for name in SAM2_FILES:
        model = onnx.load(str(download(f"{RELEASES}/v2.5.0/{name}", downloads / name)))
        del model.graph.value_info[:]
        onnx.save(model, str(sam2 / name))
        print(f"wrote {sam2 / name}")

    sam3 = out / "sam3-q4"
    sam3.mkdir(parents=True, exist_ok=True)
    for name in SAM3_MODELS:
        for suffix in (".onnx", ".onnx.data"):
            download(f"{RELEASES}/v3.0.0/{name}{suffix}", downloads / f"{name}{suffix}")
        model = onnx.load(str(downloads / f"{name}.onnx"))
        if name == "sam3_language_encoder":
            model = shrink_language_encoder(model)
        save(quantize(model), sam3 / f"{name}.onnx")
        print(f"wrote {sam3 / name}.onnx")
    download(VOCABULARY, sam3 / "bpe_simple_vocab_16e6.txt.gz")

    print(f"done. Delete {downloads} to reclaim the 3.8 GB of source files.")


if __name__ == "__main__":
    main()
