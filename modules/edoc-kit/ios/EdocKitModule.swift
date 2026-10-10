import CoreImage
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

private let sharedCIContext = CIContext(options: nil)

private func filtered(_ image: UIImage, filter: String) -> UIImage {
  var saturation = 1.0
  var contrast = 1.0
  var brightness = 0.0
  switch filter {
  case "enhance":
    saturation = 1.15
    contrast = 1.25
    brightness = 0.02
  case "gray":
    saturation = 0.0
    contrast = 1.08
  case "bw":
    saturation = 0.0
    contrast = 1.9
    brightness = 0.08
  default:
    return image
  }
  guard let input = CIImage(image: image), let colorControls = CIFilter(name: "CIColorControls") else {
    return image
  }
  colorControls.setValue(input, forKey: kCIInputImageKey)
  colorControls.setValue(saturation, forKey: kCIInputSaturationKey)
  colorControls.setValue(contrast, forKey: kCIInputContrastKey)
  colorControls.setValue(brightness, forKey: kCIInputBrightnessKey)
  guard let output = colorControls.outputImage,
    let cgImage = sharedCIContext.createCGImage(output, from: input.extent)
  else {
    return image
  }
  return UIImage(cgImage: cgImage, scale: 1, orientation: .up)
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
          let image = redraw(scan.imageOfPage(at: index), maxDimension: 0, quarterTurns: 0)
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
    // Resolves with one entry per saved page, or an empty array when cancelled.
    AsyncFunction("scan") { (outDir: String, promise: Promise) in
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
      guard let image = UIImage(contentsOfFile: fileURL(uri).path), let cgImage = image.cgImage else {
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
      guard let source = UIImage(contentsOfFile: fileURL(uri).path) else {
        throw Exception(name: "ERR_IMAGE_READ", description: "Cannot read image")
      }
      let upright = redraw(source, maxDimension: CGFloat(maxDimension), quarterTurns: quarterTurns)
      let result = filtered(upright, filter: filter)
      guard let data = result.jpegData(compressionQuality: jpegQuality) else {
        throw Exception(name: "ERR_IMAGE_WRITE", description: "Cannot encode image")
      }
      let out = fileURL(outUri)
      try FileManager.default.createDirectory(
        at: out.deletingLastPathComponent(),
        withIntermediateDirectories: true
      )
      try data.write(to: out, options: .atomic)
      return pageInfo(out, Int(result.size.width), Int(result.size.height))
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
    AsyncFunction("makePdf") { (uris: [String], outUri: String) -> String in
      let out = fileURL(outUri)
      try FileManager.default.createDirectory(
        at: out.deletingLastPathComponent(),
        withIntermediateDirectories: true
      )
      let renderer = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 595, height: 842))
      try renderer.writePDF(to: out) { context in
        for uri in uris {
          autoreleasepool {
            let url = fileURL(uri)
            guard let provider = CGDataProvider(url: url as CFURL),
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
