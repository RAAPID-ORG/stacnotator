# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "onnx"]
# ///
"""Stand-ins for the SAM 2.1 encoder/decoder with the real inputs and outputs.

The decoder "segments" the inner 70% of the prompted box, so the magic wand
E2E spec exercises the worker, onnxruntime-web, mask tracing and the
proposal flow without the 155 MB weights.

    uv run frontend/e2e/fixtures/segmentation/make_fake_sam2.py
"""

from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper
from onnx import numpy_helper as nh

HERE = Path(__file__).resolve().parent
F = TensorProto.FLOAT


def const(name, value, dtype=np.float32):
    return helper.make_node(
        "Constant", [], [name], value=nh.from_array(np.asarray(value, dtype=dtype), name)
    )


def encoder():
    outputs = {
        "high_res_feats_0": [1, 32, 256, 256],
        "high_res_feats_1": [1, 64, 128, 128],
        "image_embed": [1, 256, 64, 64],
    }
    nodes = []
    for name, shape in outputs.items():
        nodes += [
            const(f"{name}_shape", shape, np.int64),
            helper.make_node("ConstantOfShape", [f"{name}_shape"], [name]),
        ]
    graph = helper.make_graph(
        nodes,
        "fake_sam2_encoder",
        [helper.make_tensor_value_info("image", F, [1, 3, 1024, 1024])],
        [helper.make_tensor_value_info(n, F, s) for n, s in outputs.items()],
    )
    return graph


def decoder():
    inputs = [
        helper.make_tensor_value_info("image_embed", F, [1, 256, 64, 64]),
        helper.make_tensor_value_info("high_res_feats_0", F, [1, 32, 256, 256]),
        helper.make_tensor_value_info("high_res_feats_1", F, [1, 64, 128, 128]),
        helper.make_tensor_value_info("point_coords", F, ["n", "p", 2]),
        helper.make_tensor_value_info("point_labels", F, ["n", "p"]),
        helper.make_tensor_value_info("mask_input", F, ["n", 1, 256, 256]),
        helper.make_tensor_value_info("has_mask_input", F, ["n"]),
    ]
    centres = (np.arange(256, dtype=np.float32) + 0.5) * 4  # low-res cell centres in 1024 space
    nodes = [
        const("xs", centres.reshape(1, 256)),
        const("ys", centres.reshape(256, 1)),
        const("idx0", [0], np.int64),
        const("idx1", [1], np.int64),
        # corners [2, 2] of the first prompt: rows top-left, bottom-right
        const("idx0_s", 0, np.int64),
        helper.make_node("Gather", ["point_coords", "idx0_s"], ["corners"], axis=0),
        helper.make_node("Gather", ["corners", "idx0"], ["tl"], axis=0),
        helper.make_node("Gather", ["corners", "idx1"], ["br"], axis=0),
        # shrink by 15% on each side
        helper.make_node("Sub", ["br", "tl"], ["size"]),
        const("inset", 0.15),
        helper.make_node("Mul", ["size", "inset"], ["pad"]),
        helper.make_node("Add", ["tl", "pad"], ["lo"]),
        helper.make_node("Sub", ["br", "pad"], ["hi"]),
        helper.make_node("Gather", ["lo", "idx0"], ["x0"], axis=1),
        helper.make_node("Gather", ["lo", "idx1"], ["y0"], axis=1),
        helper.make_node("Gather", ["hi", "idx0"], ["x1"], axis=1),
        helper.make_node("Gather", ["hi", "idx1"], ["y1"], axis=1),
        helper.make_node("GreaterOrEqual", ["xs", "x0"], ["gx0"]),
        helper.make_node("Less", ["xs", "x1"], ["lx1"]),
        helper.make_node("GreaterOrEqual", ["ys", "y0"], ["gy0"]),
        helper.make_node("Less", ["ys", "y1"], ["ly1"]),
        helper.make_node("And", ["gx0", "lx1"], ["inx"]),
        helper.make_node("And", ["gy0", "ly1"], ["iny"]),
        helper.make_node("And", ["inx", "iny"], ["inside"]),
        const("pos", 8.0),
        const("neg", -8.0),
        helper.make_node("Where", ["inside", "pos", "neg"], ["logits"]),
        const("mask_shape", [1, 3, 256, 256], np.int64),
        helper.make_node("Expand", ["logits", "mask_shape"], ["masks"]),
        const("iou_predictions", [[0.9, 0.5, 0.4]]),
    ]
    return helper.make_graph(
        nodes,
        "fake_sam2_decoder",
        inputs,
        [
            helper.make_tensor_value_info("masks", F, [1, 3, 256, 256]),
            helper.make_tensor_value_info("iou_predictions", F, [1, 3]),
        ],
    )


for graph, name in [(encoder(), "encoder"), (decoder(), "decoder")]:
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    model.ir_version = 8
    onnx.checker.check_model(model)
    onnx.save(model, str(HERE / f"sam2.1_hiera_tiny.{name}.onnx"))
