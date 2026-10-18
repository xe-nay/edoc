package expo.modules.edockit

import android.content.Context
import org.opencv.core.CvType
import org.opencv.core.Mat
import org.opencv.core.MatOfByte
import org.opencv.core.MatOfInt
import org.opencv.core.MatOfPoint
import org.opencv.core.MatOfPoint2f
import org.opencv.core.Point
import org.opencv.core.Scalar
import org.opencv.core.Size
import org.opencv.dnn.Dnn
import org.opencv.dnn.Net
import org.opencv.imgproc.Imgproc
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

// The trained page finder: DocQuadNet-256 from the MakeACopy project (Apache License 2.0),
// converted by scripts/convert-page-model.py and run with OpenCV's dnn module, on the phone.
// It sees the photo at 256 x 256 and gives a heat map per corner plus a mask of the page, both
// on a 64 x 64 grid of cells.
internal object PageModel {
  private const val SIDE = 256
  const val CELLS = 64
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

  // What the model saw in one picture, and how its grid of cells maps onto the picture.
  class Output(private val heat: FloatArray, private val mask: FloatArray, private val scale: Double, private val left: Int, private val top: Int) {
    fun toImage(cell: Point) = Point((cell.x * 4 - left) / scale, (cell.y * 4 - top) / scale)

    fun toCells(point: Point) = Point((point.x * scale + left) / 4, (point.y * scale + top) / 4)

    // The same reading with another page mask: a mask of the picture (one value from 0 to 1 per
    // pixel of a maskWidth x maskHeight copy of a picture imageWidth pixels wide) laid on the grid.
    fun withMask(values: FloatArray, maskWidth: Int, maskHeight: Int, imageWidth: Int): Output {
      val ratio = maskWidth.toDouble() / imageWidth
      val grid = FloatArray(CELLS * CELLS) { index ->
        val point = toImage(Point(index % CELLS + 0.5, index / CELLS + 0.5))
        val x = (point.x * ratio).roundToInt()
        val y = (point.y * ratio).roundToInt()
        if (x !in 0 until maskWidth || y !in 0 until maskHeight) {
          -10f
        } else {
          val p = values[y * maskWidth + x].coerceIn(0.001f, 0.999f)
          kotlin.math.ln(p / (1 - p))
        }
      }
      return Output(heat, grid, scale, left, top)
    }

    // Share of the grid the page mask covers.
    val coverage: Double
      get() = mask.count { it > 0f }.toDouble() / mask.size

    // How sure the model is that the picture point is on the page (0 to 1).
    fun pageAt(point: Point): Double {
      val cell = toCells(point)
      val x = (cell.x - 0.5).coerceIn(0.0, CELLS - 1.0)
      val y = (cell.y - 0.5).coerceIn(0.0, CELLS - 1.0)
      val x0 = floor(x).toInt()
      val y0 = floor(y).toInt()
      val x1 = min(x0 + 1, CELLS - 1)
      val y1 = min(y0 + 1, CELLS - 1)
      val fx = x - x0
      val fy = y - y0
      fun at(cx: Int, cy: Int) = 1.0 / (1.0 + exp(-mask[cy * CELLS + cx].toDouble()))
      return (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy
    }

    // The four corner peaks in cells (in the model's order: top left, top right, bottom right,
    // bottom left), each refined within its neighbouring cells, with how strong each peak is.
    fun peaks(): Pair<Array<Point>, DoubleArray> {
      val strength = DoubleArray(4)
      val points = Array(4) { corner ->
        val base = corner * CELLS * CELLS
        var best = base
        for (index in base until base + CELLS * CELLS) {
          if (heat[index] > heat[best]) best = index
        }
        strength[corner] = 1.0 / (1.0 + exp(-heat[best].toDouble()))
        val peakX = (best - base) % CELLS
        val peakY = (best - base) / CELLS
        var weight = 0.0
        var sumX = 0.0
        var sumY = 0.0
        for (y in max(0, peakY - 1)..min(CELLS - 1, peakY + 1)) {
          for (x in max(0, peakX - 1)..min(CELLS - 1, peakX + 1)) {
            val w = exp((heat[base + y * CELLS + x] - heat[best]).toDouble())
            weight += w
            sumX += w * x
            sumY += w * y
          }
        }
        Point(sumX / weight + 0.5, sumY / weight + 0.5)
      }
      return points to strength
    }

    // How well an outline (in cells) matches the page mask: shared over combined area.
    fun agreement(cells: Array<Point>): Double {
      val outline = Mat.zeros(CELLS, CELLS, CvType.CV_8UC1)
      val polygon = MatOfPoint(*cells.map { Point(it.x.roundToInt().toDouble(), it.y.roundToInt().toDouble()) }.toTypedArray())
      Imgproc.fillPoly(outline, listOf(polygon), Scalar(1.0))
      val inside = ByteArray(CELLS * CELLS)
      outline.get(0, 0, inside)
      outline.release()
      polygon.release()
      var both = 0
      var either = 0
      for (index in mask.indices) {
        val page = mask[index] > 0f
        val outlined = inside[index].toInt() != 0
        if (page && outlined) both++
        if (page || outlined) either++
      }
      return if (either > 0) both.toDouble() / either else 0.0
    }

    // The largest region of the page mask, at four times the grid's detail.
    private fun maskRegion(): MatOfPoint? {
      val grid = Mat(CELLS, CELLS, CvType.CV_32FC1)
      grid.put(0, 0, mask)
      val large = Mat()
      Imgproc.resize(grid, large, Size(SIDE.toDouble(), SIDE.toDouble()), 0.0, 0.0, Imgproc.INTER_LINEAR)
      val binary = Mat()
      Imgproc.threshold(large, binary, 0.0, 255.0, Imgproc.THRESH_BINARY)
      binary.convertTo(binary, CvType.CV_8UC1)
      val contours = ArrayList<MatOfPoint>()
      val hierarchy = Mat()
      Imgproc.findContours(binary, contours, hierarchy, Imgproc.RETR_EXTERNAL, Imgproc.CHAIN_APPROX_SIMPLE)
      listOf(grid, large, binary, hierarchy).forEach { it.release() }
      val largest = contours.maxByOrNull { Imgproc.contourArea(it) }
      contours.filter { it !== largest }.forEach { it.release() }
      return largest
    }

    // The page mask's outline reduced to four corners, in cells.
    fun maskOutline(): Array<Point>? {
      val region = maskRegion() ?: return null
      val indices = MatOfInt()
      Imgproc.convexHull(region, indices)
      val points = region.toArray()
      val hull = MatOfPoint2f(*indices.toArray().map { points[it] }.toTypedArray())
      indices.release()
      region.release()
      val perimeter = Imgproc.arcLength(hull, true)
      val approx = MatOfPoint2f()
      var result: Array<Point>? = null
      for (epsilon in doubleArrayOf(0.02, 0.03, 0.045, 0.06, 0.08)) {
        Imgproc.approxPolyDP(hull, approx, epsilon * perimeter, true)
        if (approx.rows() == 4) {
          result = approx.toArray().map { Point(it.x / 4, it.y / 4) }.toTypedArray()
          break
        }
      }
      if (result == null) {
        val box = Mat()
        Imgproc.boxPoints(Imgproc.minAreaRect(hull), box)
        result = Array(4) { Point(box.get(it, 0)[0] / 4, box.get(it, 1)[0] / 4) }
        box.release()
      }
      hull.release()
      approx.release()
      return result
    }

    // The smallest rotated rectangle around the page mask, in cells: square corners even where
    // the mask is ragged.
    fun maskBox(): Array<Point>? {
      val region = maskRegion() ?: return null
      val points = MatOfPoint2f(*region.toArray())
      region.release()
      val box = Mat()
      Imgproc.boxPoints(Imgproc.minAreaRect(points), box)
      val result = Array(4) { Point(box.get(it, 0)[0] / 4, box.get(it, 1)[0] / 4) }
      points.release()
      box.release()
      return result
    }
  }

  // Runs the model on an RGB picture of any size.
  @Synchronized
  fun run(rgb: Mat): Output? {
    val model = net ?: return null
    val width = rgb.cols()
    val height = rgb.rows()
    val scale = SIDE.toDouble() / max(width, height)
    val fitWidth = max(1, (width * scale).roundToInt())
    val fitHeight = max(1, (height * scale).roundToInt())
    val left = (SIDE - fitWidth) / 2
    val top = (SIDE - fitHeight) / 2

    // The picture fitted on a black square, as the model was trained.
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
    return Output(heat, mask, scale, left, top)
  }
}
