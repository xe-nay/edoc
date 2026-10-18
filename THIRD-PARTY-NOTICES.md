# Third-party notices

eDoc's Android app includes the following works.

## OpenCV

Image processing and the on-device inference used by the document scanner.
https://opencv.org — Apache License 2.0.

## DocQuadNet-256 page-corner model

The trained model that finds pages in the scanner (`modules/edoc-kit/android/src/main/assets/page-corners.onnx`)
comes from the MakeACopy project, https://github.com/egdels/makeacopy, Copyright 2026 Christian Kierdorf,
licensed under the Apache License, Version 2.0 (https://www.apache.org/licenses/LICENSE-2.0).

Modifications: converted from ONNX Runtime's `.ort` format to plain ONNX, with fused convolutions written out
as convolution plus activation, channel scales expanded before multiplication, and weights stored in half
precision (`scripts/convert-page-model.py`). The model's predictions are unchanged.

## CameraX

Android Jetpack camera library. https://developer.android.com/jetpack/androidx/releases/camera — Apache License 2.0.
