"""Converts the page-corner model (DocQuadNet-256 from the MakeACopy project, Apache License 2.0)
from ONNX Runtime's .ort format into a plain ONNX file that OpenCV's dnn module runs, so the app
needs no separate inference runtime.

  python scripts/convert-page-model.py docquadnet256_trained_opset17.ort page-corners.onnx

Steps: rebuild the graph as standard ONNX (ONNX Runtime's fused convolutions become a convolution
plus its activation), order the nodes, stretch the channel scales of the squeeze-and-excitation
blocks to full size before they multiply (OpenCV 4 broadcasts that multiplication wrongly), and
store the weights in half precision (half the size, no visible change in the result).
Needs: onnxruntime, onnx, numpy.
"""
import sys

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper, shape_inference
from onnxruntime.tools.ort_format_model.ort_flatbuffers_py import fbs

ATTR = fbs.AttributeType.AttributeType


def attribute(a):
    name = a.Name().decode()
    kind = a.Type()
    if kind == ATTR.FLOAT:
        return helper.make_attribute(name, a.F())
    if kind == ATTR.INT:
        return helper.make_attribute(name, a.I())
    if kind == ATTR.STRING:
        return helper.make_attribute(name, a.S().decode())
    if kind == ATTR.FLOATS:
        values = [float(v) for v in a.FloatsAsNumpy()] if a.FloatsLength() else []
        return helper.make_attribute(name, values, attr_type=onnx.AttributeProto.FLOATS)
    if kind == ATTR.INTS:
        values = [int(v) for v in a.IntsAsNumpy()] if a.IntsLength() else []
        return helper.make_attribute(name, values, attr_type=onnx.AttributeProto.INTS)
    if kind == ATTR.STRINGS:
        return helper.make_attribute(name, [a.Strings(i).decode() for i in range(a.StringsLength())])
    raise ValueError(f"attribute {name} of type {kind} is not handled")


def tensor(t):
    dims = [int(d) for d in t.DimsAsNumpy()] if t.DimsLength() else []
    name = t.Name().decode()
    if t.RawDataLength():
        return helper.make_tensor(name, t.DataType(), dims, t.RawDataAsNumpy().tobytes(), raw=True)
    if t.DataType() == TensorProto.INT64 and t.Int64DataLength():
        return helper.make_tensor(name, t.DataType(), dims, [int(v) for v in t.Int64DataAsNumpy()])
    if t.DataType() == TensorProto.FLOAT and t.FloatDataLength():
        return helper.make_tensor(name, t.DataType(), dims, [float(v) for v in t.FloatDataAsNumpy()])
    return helper.make_tensor(name, t.DataType(), dims, b"", raw=True)


def activation_nodes(name, current, outputs, activation, params, extra):
    if activation in (None, "", "Identity"):
        return [helper.make_node("Identity", [current], outputs, name=name + "_act")]
    if activation in ("Relu", "Sigmoid", "Tanh"):
        return [helper.make_node(activation, [current], outputs, name=name + "_act")]
    if activation == "HardSigmoid":
        return [helper.make_node("HardSigmoid", [current], outputs, alpha=params[0], beta=params[1], name=name + "_act")]
    if activation == "LeakyRelu":
        return [helper.make_node("LeakyRelu", [current], outputs, alpha=params[0], name=name + "_act")]
    if activation == "Clip":
        low = numpy_helper.from_array(np.array(params[0], np.float32), name + "_min")
        high = numpy_helper.from_array(np.array(params[1], np.float32), name + "_max")
        extra += [low, high]
        return [helper.make_node("Clip", [current, low.name, high.name], outputs, name=name + "_act")]
    raise ValueError(f"activation {activation} is not handled")


def rebuild(path):
    data = open(path, "rb").read()
    model = fbs.InferenceSession.InferenceSession.GetRootAsInferenceSession(data, 0).Model()
    graph = model.Graph()
    opset = {model.OpsetImport(i).Domain().decode(): model.OpsetImport(i).Version() for i in range(model.OpsetImportLength())}
    extra = []
    nodes = []
    for i in range(graph.NodesLength()):
        n = graph.Nodes(i)
        op, domain = n.OpType().decode(), n.Domain().decode()
        inputs = [n.Inputs(j).decode() for j in range(n.InputsLength())]
        outputs = [n.Outputs(j).decode() for j in range(n.OutputsLength())]
        attrs = [attribute(n.Attributes(k)) for k in range(n.AttributesLength())]
        name = n.Name().decode() or f"node{i}"
        if op == "FusedConv" and domain == "com.microsoft":
            activation, params, conv_attrs = None, [], []
            for a in attrs:
                if a.name == "activation":
                    activation = a.s.decode()
                elif a.name == "activation_params":
                    params = list(a.floats)
                else:
                    conv_attrs.append(a)
            conv = helper.NodeProto()
            conv.op_type, conv.name = "Conv", name
            conv.input.extend(inputs[:3])
            conv.output.append(outputs[0] + "_conv")
            conv.attribute.extend(conv_attrs)
            nodes.append(conv)
            current = outputs[0] + "_conv"
            if len(inputs) > 3 and inputs[3]:
                nodes.append(helper.make_node("Add", [current, inputs[3]], [outputs[0] + "_sum"], name=name + "_sum"))
                current = outputs[0] + "_sum"
            nodes += activation_nodes(name, current, outputs, activation, params, extra)
            continue
        node = helper.NodeProto()
        node.op_type, node.name = op, name
        if domain:
            node.domain = domain
        node.input.extend(inputs)
        node.output.extend(outputs)
        node.attribute.extend(attrs)
        nodes.append(node)

    initializers = [tensor(graph.Initializers(i)) for i in range(graph.InitializersLength())] + extra
    known = {t.name for t in initializers}
    graph_inputs = [graph.Inputs(i).decode() for i in range(graph.InputsLength())]
    graph_outputs = [graph.Outputs(i).decode() for i in range(graph.OutputsLength())]

    # Each node after the nodes that produce its inputs.
    available = known | set(graph_inputs) | {""}
    ordered, pending = [], nodes
    while pending:
        ready = [n for n in pending if all(i in available for i in n.input)]
        if not ready:
            raise ValueError("the graph has a cycle or a missing input")
        for n in ready:
            ordered.append(n)
            available.update(n.output)
        pending = [n for n in pending if n not in ready]

    shapes = {"corner_heatmaps": [1, 4, 64, 64], "mask_logits": [1, 1, 64, 64]}
    result = helper.make_model(
        helper.make_graph(
            ordered,
            "docquad",
            [helper.make_tensor_value_info(n, TensorProto.FLOAT, [1, 3, 256, 256]) for n in graph_inputs if n not in known],
            [helper.make_tensor_value_info(n, TensorProto.FLOAT, shapes.get(n)) for n in graph_outputs],
            initializers,
        ),
        opset_imports=[helper.make_opsetid("", opset.get("", 17))],
    )
    result.ir_version = 8
    onnx.checker.check_model(result)
    return result


def expand_channel_scales(model):
    model = shape_inference.infer_shapes(model)
    shapes = {}
    for v in list(model.graph.value_info) + list(model.graph.input) + list(model.graph.output):
        dims = [d.dim_value for d in v.type.tensor_type.shape.dim]
        if dims and all(dims):
            shapes[v.name] = dims
    nodes = []
    for n in list(model.graph.node):
        if n.op_type == "Mul" and len(n.input) == 2 and all(i in shapes for i in n.input):
            a, b = n.input
            if np.prod(shapes[a]) != np.prod(shapes[b]):
                big, small = (a, b) if np.prod(shapes[a]) > np.prod(shapes[b]) else (b, a)
                target = numpy_helper.from_array(np.array(shapes[big], np.int64), small + "_shape")
                model.graph.initializer.append(target)
                nodes.append(helper.make_node("Expand", [small, target.name], [small + "_full"], name=n.name + "_expand"))
                n.input[0], n.input[1] = big, small + "_full"
        nodes.append(n)
    del model.graph.node[:]
    model.graph.node.extend(nodes)
    del model.graph.value_info[:]
    return model


def half_precision(model):
    for t in model.graph.initializer:
        if t.data_type == TensorProto.FLOAT and len(t.dims) >= 2:
            t.CopyFrom(numpy_helper.from_array(numpy_helper.to_array(t).astype(np.float16), t.name))
    return model


def main(source, target):
    model = half_precision(expand_channel_scales(rebuild(source)))
    onnx.save(model, target)
    print(f"{target}: {len(model.graph.node)} nodes")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
