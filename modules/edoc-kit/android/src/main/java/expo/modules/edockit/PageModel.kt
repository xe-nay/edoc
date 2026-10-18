package expo.modules.edockit

import android.content.Context
import org.opencv.core.CvType
import org.opencv.core.Mat
import org.opencv.core.MatOfByte
import org.opencv.core.MatOfPoint
import org.opencv.core.Point
import org.opencv.core.Scalar
import org.opencv.core.Size
import org.opencv.dnn.Dnn
import org.opencv.dnn.Net
import org.opencv.imgproc.Imgproc
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.roundToInt

// The trained page finder: DocQuadNet-256 from the MakeACopy project (Apache License 2.0),
// converted by scripts/convert-page-model.py and run with OpenCV's dnn module, on the phone.
// It sees the photo at 256 x 256 and gives a heat map per corner plus a mask of the page.
internal object PageModel {
  private const val SIDE = 256
  private const val CELLS = 64
  private var net: Net? = null
  private var failed = false

  @Synchronized
  fun load(context: Context): Boolean {
    if (net != null) return true
    if (failed) return false
    return try {
      val bytes = context.assets.open("page-corners.onnx").use { it.readBytes() }
      net = Dnn.readNetFromONNX(MatOfByte(*bytes))
      true
    } catch (error: Throwable) {
      failed = true
      false
    }
  }

  val ready: Boolean
    @Synchronized get() = net != null

  // Corners of the page (top left, top right, bottom right, bottom left) in the pixels of an RGB
  // image, or null when the model sees no page: its page mask must cover part of the picture and
  // agree with the corners it found.
  @Synchronized
  fun find(rgb: Mat): Array<Point>? {
    val model = net ?: return null
    val width = rgb.cols()
    val height = rgb.rows()
    val scale = SIDE.toDouble() / max(width, height)
    val fitWidth = max(1, (width * scale).roundToInt())
    val fitHeight = max(1, (height * scale).roundToInt())
    val left = (SIDE - fitWidth) / 2
    val top = (SIDE - fitHeight) / 2

    // The photo fitted on a black square, as the model was trained.
    val canvas = Mat.zeros(SIDE, SIDE, CvType.CV_8UC3)
    val fitted = Mat()
    Imgproc.resize(rgb, fitted, Size(fitWidth.toDouble(), fitHeight.toDouble()), 0.0, 0.0, Imgproc.INTER_AREA)
    val area = canvas.submat(top, top + fitHeight, left, left + fitWidth)
    fitted.copyTo(area)
    val blob = Dnn.blobFromImage(canvas, 1.0 / 255.0, Size(SIDE.toDouble(), SIDE.toDouble()), Scalar(0.0, 0.0, 0.0), false, false)
    listOf(canvas, fitted, area).forEach { it.release() }

    val outputs = ArrayList<Mat>()
    model.setInput(blob)
    model.forward(outputs, listOf("corner_heatmaps", "mask_logits"))
    blob.release()
    val heat = FloatArray(4 * CELLS * CELLS)
    val mask = FloatArray(CELLS * CELLS)
    outputs[0].reshape(1, 1).get(0, 0, heat)
    outputs[1].reshape(1, 1).get(0, 0, mask)
    outputs.forEach { it.release() }

    // Each corner at its heat map's peak, refined within the neighbouring cells.
    val cells = Array(4) { corner ->
      val base = corner * CELLS * CELLS
      var best = base
      for (index in base until base + CELLS * CELLS) {
        if (heat[index] > heat[best]) best = index
      }
      val peakX = (best - base) % CELLS
      val peakY = (best - base) / CELLS
      var weight = 0.0
      var sumX = 0.0
      var sumY = 0.0
      for (y in max(0, peakY - 1)..minOf(CELLS - 1, peakY + 1)) {
        for (x in max(0, peakX - 1)..minOf(CELLS - 1, peakX + 1)) {
          val w = exp((heat[base + y * CELLS + x] - heat[best]).toDouble())
          weight += w
          sumX += w * x
          sumY += w * y
        }
      }
      Point(sumX / weight + 0.5, sumY / weight + 0.5)
    }

    // Does the page mask agree with the corners?
    val outline = Mat.zeros(CELLS, CELLS, CvType.CV_8UC1)
    val polygon = MatOfPoint(*cells.map { Point(it.x.roundToInt().toDouble(), it.y.roundToInt().toDouble()) }.toTypedArray())
    Imgproc.fillPoly(outline, listOf(polygon), Scalar(1.0))
    val inside = ByteArray(CELLS * CELLS)
    outline.get(0, 0, inside)
    listOf(outline, polygon).forEach { it.release() }
    var both = 0
    var either = 0
    var covered = 0
    for (index in mask.indices) {
      val page = mask[index] > 0f
      val outlined = inside[index].toInt() != 0
      if (page) covered++
      if (page && outlined) both++
      if (page || outlined) either++
    }
    val agreement = if (either > 0) both.toDouble() / either else 0.0
    if (agreement < 0.5 || covered < 0.05 * mask.size) {
      return null
    }
    return Array(4) { corner ->
      Point((cells[corner].x * 4 - left) / scale, (cells[corner].y * 4 - top) / scale)
    }
  }
}
