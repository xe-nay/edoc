"""Converts the page-flattening model (UVDoc, MIT License, https://github.com/tanguymagne/UVDoc) to
Core ML for the iPhone. Run on a Mac (the cloud build does it before building the app):

  python3 scripts/export-flatten-coreml.py path/to/UVDoc PageFlatten.mlpackage

The model sees the page at 488 x 712 (input "input", 1 x 3 x 712 x 488, values 0 to 1) and gives
"grid", 1 x 2 x 45 x 31: where each point of the flat page lies in the photo, from -1 to 1.
Needs: torch, coremltools.
"""
import os
import sys

import coremltools as ct
import torch


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

    example = torch.rand(1, 3, 712, 488)
    traced = torch.jit.trace(Grid(model).eval(), example)
    converted = ct.convert(
        traced,
        inputs=[ct.TensorType(name="input", shape=example.shape)],
        outputs=[ct.TensorType(name="grid")],
        convert_to="mlprogram",
        compute_precision=ct.precision.FLOAT16,
        minimum_deployment_target=ct.target.iOS16,
    )
    converted.save(target)
    print(f"saved {target}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
