"""Exports the page-flattening model (UVDoc, "Neural Grid-based Document Unwarping", MIT License,
https://github.com/tanguymagne/UVDoc) to an ONNX file that OpenCV's dnn module runs on the phone.

  python scripts/export-flatten-model.py path/to/UVDoc page-flatten.onnx

path/to/UVDoc is a checkout of the UVDoc repository (its model.py and model/best_model.pkl).
The model sees the page at 488 x 712 and gives a 45 x 31 grid saying where each point of the flat
page lies in the photo; the app resamples the photo along that grid. Weights are stored in half
precision (half the size, the grid moves by under a third of a pixel). Needs: torch, onnx, numpy.
"""
import os
import sys

import numpy as np
import onnx
import torch
from onnx import numpy_helper


def main(repository, target):
    sys.path.insert(0, repository)
    from model import UVDocnet

    model = UVDocnet(num_filter=32, kernel_size=5)
    checkpoint = torch.load(os.path.join(repository, "model", "best_model.pkl"), map_location="cpu", weights_only=False)
    model.load_state_dict(checkpoint["model_state"])
    model.eval()

    class Grid(torch.nn.Module):
        def __init__(self, inner):
            super().__init__()
            self.inner = inner

        def forward(self, x):
            return self.inner(x)[0]

    torch.onnx.export(
        Grid(model), torch.rand(1, 3, 712, 488), target,
        input_names=["input"], output_names=["grid"], opset_version=17, dynamo=False,
    )
    exported = onnx.load(target)
    for tensor in exported.graph.initializer:
        if tensor.data_type == onnx.TensorProto.FLOAT and len(tensor.dims) >= 2:
            tensor.CopyFrom(numpy_helper.from_array(numpy_helper.to_array(tensor).astype(np.float16), tensor.name))
    onnx.save(exported, target)
    print(f"{target}: {os.path.getsize(target) / 2**20:.1f} MB")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
