import Accelerate
import CoreImage
import CoreML
import ExpoModulesCore
import PDFKit
import UIKit
import Vision
import VisionKit

private let jpegQuality: CGFloat = 0.82

private func fileURL(_ value: String) -> URL {
  if value.hasPrefix("file://") {
    if let url = URL(string: value) {
      return url
    }
    let path = String(value.dropFirst("file://".count))
    return URL(fileURLWithPath: path.removingPercentEncoding ?? path)
  }
  return URL(fileURLWithPath: value)
}

private func pageInfo(_ url: URL, _ width: Int, _ height: Int) -> [String: Any] {
  return ["uri": url.absoluteString, "width": width, "height": height]
}

private func visionOrientation(_ orientation: UIImage.Orientation) -> CGImagePropertyOrientation {
  switch orientation {
  case .up: return .up
  case .down: return .down
  case .left: return .left
  case .right: return .right
  case .upMirrored: return .upMirrored
  case .downMirrored: return .downMirrored
  case .leftMirrored: return .leftMirrored
  case .rightMirrored: return .rightMirrored
  @unknown default: return .up
  }
}

// Redraws the image upright at 1x, optionally scaled down and rotated by a multiple of 90 degrees.
private func redraw(_ image: UIImage, maxDimension: CGFloat, quarterTurns: Int) -> UIImage {
  var width = image.size.width * image.scale
  var height = image.size.height * image.scale
  let longest = max(width, height)
  if maxDimension > 0 && longest > maxDimension {
    let ratio = maxDimension / longest
    width = (width * ratio).rounded()
    height = (height * ratio).rounded()
  }
  let turns = ((quarterTurns % 4) + 4) % 4
  let swapped = turns % 2 == 1
  let canvas = swapped ? CGSize(width: height, height: width) : CGSize(width: width, height: height)

  let format = UIGraphicsImageRendererFormat()
  format.scale = 1
  format.opaque = true
  return UIGraphicsImageRenderer(size: canvas, format: format).image { context in
    UIColor.white.setFill()
    context.fill(CGRect(origin: .zero, size: canvas))
    let cg = context.cgContext
    cg.translateBy(x: canvas.width / 2, y: canvas.height / 2)
    cg.rotate(by: CGFloat(turns) * .pi / 2)
    image.draw(in: CGRect(x: -width / 2, y: -height / 2, width: width, height: height))
  }
}

// Clean-up styles, the same as on Android: "flex", like CamScanner, turns the paper pure white
// (no shadows, no wrinkle shading, no colour cast), deepens the ink and keeps coloured ink such as
// stamps vivid; "enhance" evens out the light more gently and keeps the paper's natural look;
// "gray" is flex in greyscale; "bw" is black on white; anything else keeps the photo.
//
// The paper's light is measured on a small copy: a local maximum over a few stroke widths leaves
// only paper, then a blur at about a sixtieth of the page smooths it while still following
// wrinkles. Each pixel is divided by that light, then a tone curve sends the paper to white and
// the ink towards black. Large dark areas (a photo) are not mistaken for shadow.
// How strongly a style whitens: where the tone curve starts and how wide it is, its power, the power
// for coloured ink, how much more vivid colour gets (and coloured ink on top), sharpening.
private struct Tone {
  let low: Float
  let span: Float
  let power: Double
  let inkPower: Double
  let vivid: Float
  let inkVivid: Float
  let sharpen: Float
}

private let strongTone = Tone(low: 0.40, span: 0.42, power: 1.6, inkPower: 2.2, vivid: 1.25, inkVivid: 0.6, sharpen: 0.7)
private let gentleTone = Tone(low: 0.12, span: 0.82, power: 1.25, inkPower: 1.5, vivid: 1.12, inkVivid: 0.3, sharpen: 0.35)

private func filtered(_ image: UIImage, filter: String) -> UIImage {
  guard ["flex", "enhance", "gray", "bw"].contains(filter), let source = image.cgImage else {
    return image
  }
  let tone = filter == "enhance" ? gentleTone : strongTone
  let width = source.width
  let height = source.height
  let space = CGColorSpaceCreateDeviceRGB()
  let info = CGImageAlphaInfo.noneSkipLast.rawValue

  func pixels(of cg: CGImage, width: Int, height: Int) -> [UInt8] {
    var bytes = [UInt8](repeating: 0, count: width * height * 4)
    bytes.withUnsafeMutableBytes { buffer in
      if let context = CGContext(
        data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
        bytesPerRow: width * 4, space: space, bitmapInfo: info)
      {
        context.interpolationQuality = .high
        context.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
      }
    }
    return bytes
  }

  // The paper's light, per colour channel, on a copy about 512 pixels on its short side.
  let scale = min(1.0, 512.0 / Double(min(width, height)))
  let smallWidth = max(1, Int((Double(width) * scale).rounded()))
  let smallHeight = max(1, Int((Double(height) * scale).rounded()))
  let small = pixels(of: source, width: smallWidth, height: smallHeight)
  let side = Double(min(smallWidth, smallHeight))
  var reach = max(3, Int((side / 45).rounded()))
  if reach % 2 == 0 { reach += 1 }
  // Three box blurs of this width come close to a Gaussian blur of a sixtieth of the side.
  let sigma = side / 60
  var box = max(3, Int((4 * sigma * sigma + 1).squareRoot().rounded()))
  if box % 2 == 0 { box += 1 }

  let count = smallWidth * smallHeight
  var light = [Float](repeating: 0, count: count * 3)
  var plane = [UInt8](repeating: 0, count: count)
  var work = [UInt8](repeating: 0, count: count)
  for channel in 0..<3 {
    for index in 0..<count { plane[index] = small[index * 4 + channel] }
    plane.withUnsafeMutableBytes { planeBytes in
      work.withUnsafeMutableBytes { workBytes in
        var a = vImage_Buffer(
          data: planeBytes.baseAddress, height: vImagePixelCount(smallHeight),
          width: vImagePixelCount(smallWidth), rowBytes: smallWidth)
        var b = vImage_Buffer(
          data: workBytes.baseAddress, height: vImagePixelCount(smallHeight),
          width: vImagePixelCount(smallWidth), rowBytes: smallWidth)
        let flags = vImage_Flags(kvImageEdgeExtend)
        vImageMax_Planar8(&a, &b, nil, 0, 0, vImagePixelCount(reach), vImagePixelCount(reach), flags)
        vImageBoxConvolve_Planar8(&b, &a, nil, 0, 0, UInt32(box), UInt32(box), 0, flags)
        vImageBoxConvolve_Planar8(&a, &b, nil, 0, 0, UInt32(box), UInt32(box), 0, flags)
        vImageBoxConvolve_Planar8(&b, &a, nil, 0, 0, UInt32(box), UInt32(box), 0, flags)
      }
    }
    var values = [Float](repeating: 0, count: count)
    for index in 0..<count { values[index] = Float(plane[index]) / 255 }
    let sorted = values.sorted()
    let floor = 0.5 * sorted[Int(Double(count - 1) * 0.9)]
    for index in 0..<count { light[index * 3 + channel] = max(values[index], max(floor, 1.0 / 255)) }
  }

  // Tone curves as tables: paper to white, ink deeper; coloured ink deepened gently.
  let steps = 1024
  let paperCurve = (0...steps).map { Float(pow(Double($0) / Double(steps), tone.power)) }
  let inkCurve = (0...steps).map { Float(pow(Double($0) / Double(steps), tone.inkPower)) }

  var bytes = pixels(of: source, width: width, height: height)
  var even = [Float](repeating: 0, count: 3)
  var out = [Float](repeating: 0, count: 3)
  for y in 0..<height {
    let sy = min(max((Double(y) + 0.5) * scale - 0.5, 0), Double(smallHeight - 1))
    let y0 = Int(sy)
    let y1 = min(y0 + 1, smallHeight - 1)
    let fy = Float(sy - Double(y0))
    for x in 0..<width {
      let sx = min(max((Double(x) + 0.5) * scale - 0.5, 0), Double(smallWidth - 1))
      let x0 = Int(sx)
      let x1 = min(x0 + 1, smallWidth - 1)
      let fx = Float(sx - Double(x0))
      let base = (y * width + x) * 4
      for channel in 0..<3 {
        let a = light[(y0 * smallWidth + x0) * 3 + channel]
        let b = light[(y0 * smallWidth + x1) * 3 + channel]
        let c = light[(y1 * smallWidth + x0) * 3 + channel]
        let d = light[(y1 * smallWidth + x1) * 3 + channel]
        let top = a + (b - a) * fx
        let paper = top + ((c + (d - c) * fx) - top) * fy
        even[channel] = (Float(bytes[base + channel]) / 255) / paper
      }
      let luma = (even[0] + even[1] + even[2]) / 3
      let t = min(max((luma - tone.low) / tone.span, 0), 1)
      let gain = paperCurve[Int(t * Float(steps))] / max(luma, 1e-3)
      let r = min(max(even[0], 0), 1)
      let g = min(max(even[1], 0), 1)
      let bl = min(max(even[2], 0), 1)
      let colour = min(max(((max(r, g, bl) - min(r, g, bl)) - 0.06) / 0.12, 0), 1)
      for channel in 0..<3 {
        let inked = inkCurve[Int(min(max(even[channel], 0), 1) * Float(steps))]
        out[channel] = even[channel] * gain * (1 - colour) + inked * colour
      }
      // Colour a little more vivid, coloured ink much more.
      let mean = (out[0] + out[1] + out[2]) / 3
      let vivid = tone.vivid + tone.inkVivid * colour
      for channel in 0..<3 {
        let value = mean + (out[channel] - mean) * vivid
        bytes[base + channel] = UInt8(min(max(value, 0), 1) * 255 + 0.5)
      }
    }
  }

  // Light sharpening for crisp text.
  var soft = [UInt8](repeating: 0, count: bytes.count)
  bytes.withUnsafeMutableBytes { sharpBytes in
    soft.withUnsafeMutableBytes { softBytes in
      var a = vImage_Buffer(
        data: sharpBytes.baseAddress, height: vImagePixelCount(height), width: vImagePixelCount(width),
        rowBytes: width * 4)
      var b = vImage_Buffer(
        data: softBytes.baseAddress, height: vImagePixelCount(height), width: vImagePixelCount(width),
        rowBytes: width * 4)
      let kernel: [Int16] = [1, 2, 1, 2, 4, 2, 1, 2, 1]
      vImageConvolve_ARGB8888(&a, &b, nil, 0, 0, kernel, 3, 3, 16, nil, vImage_Flags(kvImageEdgeExtend))
    }
  }
  let keep = 1 + tone.sharpen
  for index in stride(from: 0, to: bytes.count, by: 4) {
    for channel in 0..<3 {
      let value = keep * Float(bytes[index + channel]) - tone.sharpen * Float(soft[index + channel])
      bytes[index + channel] = UInt8(min(max(value, 0), 255))
    }
    bytes[index + 3] = 255
  }

  if filter != "enhance" {
    // Slightly bolder strokes, like a printed page: half a 2 x 2 local minimum blended in.
    let copy = bytes
    for y in 0..<height {
      let below = min(y + 1, height - 1)
      for x in 0..<width {
        let right = min(x + 1, width - 1)
        let base = (y * width + x) * 4
        for channel in 0..<3 {
          let lowest = min(
            copy[base + channel], copy[(y * width + right) * 4 + channel],
            copy[(below * width + x) * 4 + channel], copy[(below * width + right) * 4 + channel])
          bytes[base + channel] = UInt8((UInt16(copy[base + channel]) + UInt16(lowest) + 1) / 2)
        }
      }
    }
  }

  // Fingers holding the page go white, and so does a thin rim where the page's edge shows.
  let hands = fingerMask(bytes, width: width, height: height)
  let rim = max(2, Int((0.006 * Double(min(width, height))).rounded()))
  for y in 0..<height {
    for x in 0..<width {
      let pixel = y * width + x
      if hands[pixel] != 0 || x < rim || y < rim || x >= width - rim || y >= height - rim {
        bytes[pixel * 4] = 255
        bytes[pixel * 4 + 1] = 255
        bytes[pixel * 4 + 2] = 255
      }
    }
  }

  if filter == "gray" || filter == "bw" {
    for index in stride(from: 0, to: bytes.count, by: 4) {
      var gray = 0.299 * Float(bytes[index]) + 0.587 * Float(bytes[index + 1]) + 0.114 * Float(bytes[index + 2])
      if filter == "bw" { gray = gray >= 152 ? 255 : 0 }
      let value = UInt8(min(max(gray, 0), 255))
      bytes[index] = value
      bytes[index + 1] = value
      bytes[index + 2] = value
    }
  }

  let result: CGImage? = bytes.withUnsafeMutableBytes { buffer in
    CGContext(
      data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
      space: space, bitmapInfo: info)?.makeImage()
  }
  guard let cleaned = result else {
    return image
  }
  return UIImage(cgImage: cleaned, scale: 1, orientation: .up)
}
// Fingers holding the page: skin-coloured areas reaching in from the edge of the picture, grown a
// little to take in their soft rim and shadow. Returns one byte per pixel, non-zero on a finger.
private func fingerMask(_ bytes: [UInt8], width: Int, height: Int) -> [UInt8] {
  let count = width * height
  var skin = [UInt8](repeating: 0, count: count)
  for pixel in 0..<count {
    let r = Float(bytes[pixel * 4])
    let g = Float(bytes[pixel * 4 + 1])
    let b = Float(bytes[pixel * 4 + 2])
    let luma = 0.299 * r + 0.587 * g + 0.114 * b
    let cr = (r - luma) * 0.713 + 128
    let cb = (b - luma) * 0.564 + 128
    if luma >= 40 && cr >= 135 && cr <= 175 && cb >= 80 && cb <= 128 {
      skin[pixel] = 255
    }
  }

  func morph(_ grow: Bool, _ size: Int, _ from: inout [UInt8], _ to: inout [UInt8]) {
    from.withUnsafeMutableBytes { a in
      to.withUnsafeMutableBytes { b in
        var source = vImage_Buffer(
          data: a.baseAddress, height: vImagePixelCount(height), width: vImagePixelCount(width), rowBytes: width)
        var target = vImage_Buffer(
          data: b.baseAddress, height: vImagePixelCount(height), width: vImagePixelCount(width), rowBytes: width)
        let flags = vImage_Flags(kvImageEdgeExtend)
        if grow {
          vImageMax_Planar8(&source, &target, nil, 0, 0, vImagePixelCount(size), vImagePixelCount(size), flags)
        } else {
          vImageMin_Planar8(&source, &target, nil, 0, 0, vImagePixelCount(size), vImagePixelCount(size), flags)
        }
      }
    }
  }

  // Specks and thin lines are not fingers: an opening with a 5 x 5 square removes them.
  var work = [UInt8](repeating: 0, count: count)
  morph(false, 5, &skin, &work)
  morph(true, 5, &work, &skin)

  // Keep the skin regions that touch the edge and are big enough to be a finger.
  var mask = [UInt8](repeating: 0, count: count)
  var seen = [Bool](repeating: false, count: count)
  var queue = [Int]()
  let edge = max(2, Int(0.01 * Double(min(width, height))))
  let minimum = Int(0.0015 * Double(count))
  for start in 0..<count where skin[start] != 0 && !seen[start] {
    queue.removeAll(keepingCapacity: true)
    queue.append(start)
    seen[start] = true
    var head = 0
    var touches = false
    while head < queue.count {
      let pixel = queue[head]
      head += 1
      let x = pixel % width
      let y = pixel / width
      if x <= edge || y <= edge || x >= width - 1 - edge || y >= height - 1 - edge {
        touches = true
      }
      let neighbours = [
        x > 0 ? pixel - 1 : -1, x < width - 1 ? pixel + 1 : -1,
        y > 0 ? pixel - width : -1, y < height - 1 ? pixel + width : -1,
      ]
      for next in neighbours where next >= 0 && skin[next] != 0 && !seen[next] {
        seen[next] = true
        queue.append(next)
      }
    }
    if touches && queue.count > minimum {
      for pixel in queue {
        mask[pixel] = 255
      }
    }
  }
  var grown = [UInt8](repeating: 0, count: count)
  let size = 2 * max(3, Int(0.012 * Double(min(width, height)))) + 1
  morph(true, size, &mask, &grown)
  return grown
}

// The page-flattening model (UVDoc, MIT License), compiled for Core ML by the cloud build.
private let flattenModel: MLModel? = {
  guard let url = Bundle.main.url(forResource: "PageFlatten", withExtension: "mlmodelc") else {
    return nil
  }
  let configuration = MLModelConfiguration()
  configuration.computeUnits = .all
  return try? MLModel(contentsOf: url, configuration: configuration)
}()

// Flattens a bent or curled page so its lines come out straight. The scanner's page is set on a
// dark margin (the model expects some surroundings), the model says on a 45 x 31 grid where each
// point of the flat page lies, and the picture is resampled along that grid at full size.
private func flattenPage(_ image: UIImage) -> UIImage {
  guard let model = flattenModel, let source = image.cgImage else {
    return image
  }
  let space = CGColorSpaceCreateDeviceRGB()
  let info = CGImageAlphaInfo.noneSkipLast.rawValue
  let margin = Int(0.07 * Double(max(source.width, source.height)))
  let width = source.width + 2 * margin
  let height = source.height + 2 * margin

  func picture(of bytes: inout [UInt8], width: Int, height: Int) -> CGImage? {
    return bytes.withUnsafeMutableBytes { buffer in
      CGContext(
        data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
        space: space, bitmapInfo: info)?.makeImage()
    }
  }

  var padded = [UInt8](repeating: 40, count: width * height * 4)
  padded.withUnsafeMutableBytes { buffer in
    if let context = CGContext(
      data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
      space: space, bitmapInfo: info)
    {
      context.draw(source, in: CGRect(x: margin, y: margin, width: source.width, height: source.height))
    }
  }
  guard let paddedImage = picture(of: &padded, width: width, height: height) else {
    return image
  }

  // The model's view of the page: 488 x 712, colour planes from 0 to 1.
  let inWidth = 488
  let inHeight = 712
  var small = [UInt8](repeating: 0, count: inWidth * inHeight * 4)
  small.withUnsafeMutableBytes { buffer in
    if let context = CGContext(
      data: buffer.baseAddress, width: inWidth, height: inHeight, bitsPerComponent: 8, bytesPerRow: inWidth * 4,
      space: space, bitmapInfo: info)
    {
      context.interpolationQuality = .high
      context.draw(paddedImage, in: CGRect(x: 0, y: 0, width: inWidth, height: inHeight))
    }
  }
  guard
    let input = try? MLMultiArray(
      shape: [1, 3, NSNumber(value: inHeight), NSNumber(value: inWidth)], dataType: .float32)
  else {
    return image
  }
  let plane = inWidth * inHeight
  let values = input.dataPointer.bindMemory(to: Float32.self, capacity: 3 * plane)
  for pixel in 0..<plane {
    for channel in 0..<3 {
      values[channel * plane + pixel] = Float32(small[pixel * 4 + channel]) / 255
    }
  }
  guard
    let features = try? MLDictionaryFeatureProvider(dictionary: ["input": MLFeatureValue(multiArray: input)]),
    let prediction = try? model.prediction(from: features),
    let grid = prediction.featureValue(for: "grid")?.multiArrayValue
  else {
    return image
  }
  let rows = 45
  let columns = 31
  var gridX = [Float](repeating: 0, count: rows * columns)
  var gridY = [Float](repeating: 0, count: rows * columns)
  for row in 0..<rows {
    for column in 0..<columns {
      gridX[row * columns + column] = grid[[0, 0, NSNumber(value: row), NSNumber(value: column)]].floatValue
      gridY[row * columns + column] = grid[[0, 1, NSNumber(value: row), NSNumber(value: column)]].floatValue
    }
  }

  // Resample: for each point of the flat page, where it lies in the padded picture.
  var flat = [UInt8](repeating: 255, count: width * height * 4)
  let maxX = Float(width - 1)
  let maxY = Float(height - 1)
  for y in 0..<height {
    let v = Float(y) / maxY * Float(rows - 1)
    let r0 = min(Int(v), rows - 2)
    let fv = v - Float(r0)
    for x in 0..<width {
      let u = Float(x) / maxX * Float(columns - 1)
      let c0 = min(Int(u), columns - 2)
      let fu = u - Float(c0)
      let i00 = r0 * columns + c0
      let gx =
        (gridX[i00] * (1 - fu) + gridX[i00 + 1] * fu) * (1 - fv)
        + (gridX[i00 + columns] * (1 - fu) + gridX[i00 + columns + 1] * fu) * fv
      let gy =
        (gridY[i00] * (1 - fu) + gridY[i00 + 1] * fu) * (1 - fv)
        + (gridY[i00 + columns] * (1 - fu) + gridY[i00 + columns + 1] * fu) * fv
      let sx = min(max((gx + 1) / 2 * maxX, 0), maxX)
      let sy = min(max((gy + 1) / 2 * maxY, 0), maxY)
      let x0 = min(Int(sx), width - 2)
      let y0 = min(Int(sy), height - 2)
      let fx = sx - Float(x0)
      let fy = sy - Float(y0)
      let p00 = (y0 * width + x0) * 4
      let p10 = p00 + width * 4
      let out = (y * width + x) * 4
      for channel in 0..<3 {
        let top = Float(padded[p00 + channel]) * (1 - fx) + Float(padded[p00 + 4 + channel]) * fx
        let bottom = Float(padded[p10 + channel]) * (1 - fx) + Float(padded[p10 + 4 + channel]) * fx
        flat[out + channel] = UInt8(min(max(top * (1 - fy) + bottom * fy, 0), 255))
      }
    }
  }
  guard let result = picture(of: &flat, width: width, height: height) else {
    return image
  }
  return UIImage(cgImage: result, scale: 1, orientation: .up)
}

private final class ScanDelegate: NSObject, VNDocumentCameraViewControllerDelegate {
  private let outDir: URL
  private let promise: Promise
  private let onFinish: () -> Void

  init(outDir: URL, promise: Promise, onFinish: @escaping () -> Void) {
    self.outDir = outDir
    self.promise = promise
    self.onFinish = onFinish
  }

  func documentCameraViewController(
    _ controller: VNDocumentCameraViewController,
    didFinishWith scan: VNDocumentCameraScan
  ) {
    var pages: [[String: Any]] = []
    var failure: Error?
    let stamp = Int(Date().timeIntervalSince1970 * 1000)
    do {
      try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
      for index in 0..<scan.pageCount {
        try autoreleasepool {
          let image = flattenPage(redraw(scan.imageOfPage(at: index), maxDimension: 0, quarterTurns: 0))
          guard let data = image.jpegData(compressionQuality: jpegQuality) else {
            return
          }
          let url = outDir.appendingPathComponent("scan-\(stamp)-\(index).jpg")
          try data.write(to: url, options: .atomic)
          pages.append(pageInfo(url, Int(image.size.width), Int(image.size.height)))
        }
      }
    } catch {
      failure = error
    }
    controller.dismiss(animated: true) {
      if let failure = failure {
        self.promise.reject("ERR_SCAN_SAVE", failure.localizedDescription)
      } else {
        self.promise.resolve(pages)
      }
      self.onFinish()
    }
  }

  func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
    controller.dismiss(animated: true) {
      self.promise.resolve([[String: Any]]())
      self.onFinish()
    }
  }

  func documentCameraViewController(
    _ controller: VNDocumentCameraViewController,
    didFailWithError error: Error
  ) {
    controller.dismiss(animated: true) {
      self.promise.reject("ERR_SCAN_FAILED", error.localizedDescription)
      self.onFinish()
    }
  }
}

public class EdocKitModule: Module {
  private var scanDelegate: ScanDelegate?

  public func definition() -> ModuleDefinition {
    Name("EdocKit")

    // Presents the system document scanner (the one used by Notes and Files).
    // Resolves with one entry per saved page, or an empty array when cancelled. The system scanner
    // cannot be limited to a number of pages, so maxPages is applied by the caller.
    AsyncFunction("scan") { (outDir: String, _: Int, promise: Promise) in
      guard VNDocumentCameraViewController.isSupported else {
        promise.reject("ERR_SCAN_UNSUPPORTED", "Document scanning is not available on this device")
        return
      }
      guard let presenter = self.appContext?.utilities?.currentViewController() else {
        promise.reject("ERR_SCAN_PRESENT", "Nothing to present the scanner from")
        return
      }
      let delegate = ScanDelegate(outDir: fileURL(outDir), promise: promise) { [weak self] in
        self?.scanDelegate = nil
      }
      self.scanDelegate = delegate
      let controller = VNDocumentCameraViewController()
      controller.delegate = delegate
      presenter.present(controller, animated: true)
    }.runOnQueue(.main)

    // Hardens a directory tree: files are encrypted by iOS whenever the device is locked,
    // and the tree is optionally left out of iCloud and computer backups.
    AsyncFunction("secure") { (uri: String, excludeFromBackup: Bool) in
      var root = fileURL(uri)
      let manager = FileManager.default
      let protection: [FileAttributeKey: Any] = [.protectionKey: FileProtectionType.complete]
      try manager.setAttributes(protection, ofItemAtPath: root.path)
      if let enumerator = manager.enumerator(at: root, includingPropertiesForKeys: nil) {
        for case let item as URL in enumerator {
          try? manager.setAttributes(protection, ofItemAtPath: item.path)
        }
      }
      var values = URLResourceValues()
      values.isExcludedFromBackup = excludeFromBackup
      try root.setResourceValues(values)
    }

    // On-device text recognition for one image file.
    AsyncFunction("recognizeText") { (uri: String) -> String in
      guard let image = UIImage(data: try Vault.read(fileURL(uri))), let cgImage = image.cgImage else {
        throw Exception(name: "ERR_IMAGE_READ", description: "Cannot read image")
      }
      let request = VNRecognizeTextRequest()
      request.recognitionLevel = .accurate
      request.usesLanguageCorrection = true
      if #available(iOS 16.0, *) {
        request.automaticallyDetectsLanguage = true
      }
      if let supported = try? request.supportedRecognitionLanguages() {
        let preferred = ["fr-FR", "en-US", "ar-SA"].filter { supported.contains($0) }
        if !preferred.isEmpty {
          request.recognitionLanguages = preferred
        }
      }
      let handler = VNImageRequestHandler(
        cgImage: cgImage,
        orientation: visionOrientation(image.imageOrientation),
        options: [:]
      )
      try handler.perform([request])
      let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
      return lines.joined(separator: "\n")
    }

    // Re-encodes an image as an upright JPEG, optionally resized, rotated and filtered.
    AsyncFunction("render") {
      (uri: String, outUri: String, quarterTurns: Int, filter: String, maxDimension: Double) -> [String: Any] in
      guard let source = UIImage(data: try Vault.read(fileURL(uri))) else {
        throw Exception(name: "ERR_IMAGE_READ", description: "Cannot read image")
      }
      let upright = redraw(source, maxDimension: CGFloat(maxDimension), quarterTurns: quarterTurns)
      let result = filtered(upright, filter: filter)
      guard let data = result.jpegData(compressionQuality: jpegQuality) else {
        throw Exception(name: "ERR_IMAGE_WRITE", description: "Cannot encode image")
      }
      let out = fileURL(outUri)
      try Vault.write(data, to: out)
      return pageInfo(out, Int(result.size.width), Int(result.size.height))
    }

    // Copies a file, decrypting the source and encrypting the destination as their names require.
    AsyncFunction("transcode") { (uri: String, outUri: String) in
      try Vault.write(try Vault.read(fileURL(uri)), to: fileURL(outUri))
    }

    // Returns an image as base64 JPEG without writing a decrypted copy to disk.
    // maxDimension 0 returns the stored image unchanged.
    AsyncFunction("readImage") { (uri: String, maxDimension: Double) -> String in
      let data = try Vault.read(fileURL(uri))
      if maxDimension > 0, let image = UIImage(data: data) {
        let small = redraw(image, maxDimension: CGFloat(maxDimension), quarterTurns: 0)
        if let jpeg = small.jpegData(compressionQuality: 0.7) {
          return jpeg.base64EncodedString()
        }
      }
      return data.base64EncodedString()
    }

    AsyncFunction("isSealedArchive") { (uri: String) -> Bool in
      return Vault.isSealedArchive(fileURL(uri))
    }

    // Encrypts a backup archive with a password.
    AsyncFunction("sealArchive") { (uri: String, outUri: String, password: String) in
      try Vault.sealArchive(from: fileURL(uri), to: fileURL(outUri), password: password)
    }

    // Decrypts a password-protected backup archive; fails on a wrong password.
    AsyncFunction("openArchive") { (uri: String, outUri: String, password: String) in
      try Vault.openArchive(from: fileURL(uri), to: fileURL(outUri), password: password)
    }

    // Rasterises every page of a PDF to a JPEG in outDir.
    AsyncFunction("pdfToImages") { (uri: String, outDir: String) -> [[String: Any]] in
      guard let document = PDFDocument(url: fileURL(uri)) else {
        throw Exception(name: "ERR_PDF_READ", description: "Cannot open PDF")
      }
      if document.isLocked {
        throw Exception(name: "ERR_PDF_LOCKED", description: "This PDF is password protected")
      }
      let directory = fileURL(outDir)
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      let stamp = Int(Date().timeIntervalSince1970 * 1000)
      var pages: [[String: Any]] = []
      for index in 0..<document.pageCount {
        try autoreleasepool {
          guard let page = document.page(at: index) else {
            return
          }
          let bounds = page.bounds(for: .cropBox)
          let sideways = abs(page.rotation) % 180 == 90
          let points = sideways
            ? CGSize(width: bounds.height, height: bounds.width)
            : CGSize(width: bounds.width, height: bounds.height)
          let longest = max(points.width, points.height, 1)
          let scale = min(3.0, 2400.0 / longest)
          let pixels = CGSize(
            width: max(1, (points.width * scale).rounded()),
            height: max(1, (points.height * scale).rounded())
          )
          let thumbnail = page.thumbnail(of: pixels, for: .cropBox)
          let format = UIGraphicsImageRendererFormat()
          format.scale = 1
          format.opaque = true
          let image = UIGraphicsImageRenderer(size: pixels, format: format).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: pixels))
            thumbnail.draw(in: CGRect(origin: .zero, size: pixels))
          }
          guard let data = image.jpegData(compressionQuality: jpegQuality) else {
            return
          }
          let url = directory.appendingPathComponent("pdf-\(stamp)-\(index).jpg")
          try data.write(to: url, options: .atomic)
          pages.append(pageInfo(url, Int(pixels.width), Int(pixels.height)))
        }
      }
      return pages
    }

    // Builds a PDF with one page per image, embedding the JPEG data as-is.
    // A non-empty password encrypts the PDF, which then asks for it when opened.
    AsyncFunction("makePdf") { (uris: [String], outUri: String, password: String) -> String in
      let out = fileURL(outUri)
      try FileManager.default.createDirectory(
        at: out.deletingLastPathComponent(),
        withIntermediateDirectories: true
      )
      let format = UIGraphicsPDFRendererFormat()
      if !password.isEmpty {
        format.documentInfo = [
          kCGPDFContextUserPassword as String: password,
          kCGPDFContextOwnerPassword as String: password,
          kCGPDFContextEncryptionKeyLength as String: 128
        ]
      }
      let renderer = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 595, height: 842), format: format)
      try renderer.writePDF(to: out) { context in
        for uri in uris {
          autoreleasepool {
            guard let data = try? Vault.read(fileURL(uri)),
              let provider = CGDataProvider(data: data as CFData),
              let image = CGImage(
                jpegDataProviderSource: provider,
                decode: nil,
                shouldInterpolate: true,
                intent: .defaultIntent
              ),
              image.width > 0
            else {
              return
            }
            let landscape = image.width > image.height
            let pageWidth: CGFloat = landscape ? 842 : 595
            let pageHeight = pageWidth * CGFloat(image.height) / CGFloat(image.width)
            let rect = CGRect(x: 0, y: 0, width: pageWidth, height: pageHeight)
            context.beginPage(withBounds: rect, pageInfo: [:])
            let cg = context.cgContext
            cg.saveGState()
            cg.translateBy(x: 0, y: pageHeight)
            cg.scaleBy(x: 1, y: -1)
            cg.draw(image, in: rect)
            cg.restoreGState()
          }
        }
      }
      return out.absoluteString
    }
  }
}
