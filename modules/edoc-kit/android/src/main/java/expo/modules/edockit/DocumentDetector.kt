package expo.modules.edockit

import android.graphics.Bitmap
import org.opencv.android.OpenCVLoader
import org.opencv.android.Utils
import org.opencv.core.Core
import org.opencv.core.CvType
import org.opencv.core.Mat
import org.opencv.core.MatOfInt
import org.opencv.core.MatOfPoint
import org.opencv.core.MatOfPoint2f
import org.opencv.core.Point
import org.opencv.core.Scalar
import org.opencv.core.Size
import org.opencv.imgproc.Imgproc
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

// Finds a page in a photo, straightens it and cleans it up, with OpenCV, on the phone.
//
// Finding: the page outline is looked for in several edge maps and in the bright-area mask.
// Every four-cornered outline found is scored by its size and by how much of its four sides
// follows a real edge in the photo, which rules out outlines that cut across a patterned table.
internal object DocumentDetector {
  @Volatile
  private var loaded: Boolean? = null

  fun load(): Boolean {
    loaded?.let { return it }
    val result = try {
      OpenCVLoader.initLocal()
    } catch (error: Throwable) {
      false
    }
    loaded = result
    return result
  }

  // The whole image, as corner positions from 0 to 1.
  val fullFrame = floatArrayOf(0f, 0f, 1f, 0f, 1f, 1f, 0f, 1f)

  // Corners of the page in a greyscale image, in its pixels: top left, top right, bottom right,
  // bottom left. Null when no page outline stands out.
  fun find(gray: Mat): Array<Point>? {
    val area = gray.rows().toDouble() * gray.cols()
    val minArea = 0.1 * area
    val maxArea = 0.97 * area
    val blurred = Mat()
    Imgproc.GaussianBlur(gray, blurred, Size(5.0, 5.0), 0.0)
    val found = ArrayList<Array<Point>>()
    val edges = Mat()
    val small = Imgproc.getStructuringElement(Imgproc.MORPH_RECT, Size(3.0, 3.0))
    for ((low, high) in listOf(20.0 to 60.0, 40.0 to 120.0, 75.0 to 200.0)) {
      Imgproc.Canny(blurred, edges, low, high)
      Imgproc.dilate(edges, edges, small)
      collect(edges, minArea, maxArea, found)
    }
    val bright = Mat()
    Imgproc.threshold(blurred, bright, 0.0, 255.0, Imgproc.THRESH_BINARY or Imgproc.THRESH_OTSU)
    val closing = Imgproc.getStructuringElement(Imgproc.MORPH_RECT, Size(9.0, 9.0))
    Imgproc.morphologyEx(bright, bright, Imgproc.MORPH_CLOSE, closing)
    collect(bright, minArea, maxArea, found)

    var best: Array<Point>? = null
    if (found.isNotEmpty()) {
      val reference = Mat()
      Imgproc.Canny(blurred, reference, 20.0, 60.0)
      val wide = Imgproc.getStructuringElement(Imgproc.MORPH_RECT, Size(5.0, 5.0))
      Imgproc.dilate(reference, reference, wide)
      val width = reference.cols()
      val pixels = ByteArray(width * reference.rows())
      reference.get(0, 0, pixels)
      var bestScore = 0.0
      for (corners in found) {
        val share = support(pixels, width, reference.rows(), corners)
        val score = quadArea(corners) * share * share * share
        if (score > bestScore) {
          bestScore = score
          best = corners
        }
      }
      reference.release()
      wide.release()
    }
    listOf(blurred, edges, small, bright, closing).forEach { it.release() }
    return best
  }

  // Page corners in a bitmap, from 0 to 1 (x, y for each corner), found on a copy whose longest
  // side is about maxSide pixels.
  fun find(bitmap: Bitmap, maxSide: Int): FloatArray? {
    val scale = maxSide.toFloat() / max(bitmap.width, bitmap.height)
    val sample = if (scale < 1f) {
      Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).roundToInt(), (bitmap.height * scale).roundToInt(), true)
    } else {
      bitmap
    }
    val rgba = Mat()
    Utils.bitmapToMat(sample, rgba)
    val gray = Mat()
    Imgproc.cvtColor(rgba, gray, Imgproc.COLOR_RGBA2GRAY)
    val corners = find(gray)
    val width = gray.cols().toFloat()
    val height = gray.rows().toFloat()
    rgba.release()
    gray.release()
    if (sample !== bitmap) {
      sample.recycle()
    }
    return corners?.let { normalized(it, width, height) }
  }

  fun normalized(corners: Array<Point>, width: Float, height: Float): FloatArray =
    FloatArray(8) { index ->
      val point = corners[index / 2]
      if (index % 2 == 0) (point.x / width).toFloat().coerceIn(0f, 1f) else (point.y / height).toFloat().coerceIn(0f, 1f)
    }

  private fun collect(binary: Mat, minArea: Double, maxArea: Double, found: MutableList<Array<Point>>) {
    val contours = ArrayList<MatOfPoint>()
    val hierarchy = Mat()
    Imgproc.findContours(binary, contours, hierarchy, Imgproc.RETR_LIST, Imgproc.CHAIN_APPROX_SIMPLE)
    hierarchy.release()
    val hulls = ArrayList<Pair<Double, MatOfPoint2f>>()
    for (contour in contours) {
      val box = Imgproc.boundingRect(contour)
      if (box.width.toDouble() * box.height >= minArea) {
        val hull = hullOf(contour)
        val area = Imgproc.contourArea(hull)
        if (area in minArea..maxArea) {
          hulls.add(area to hull)
        } else {
          hull.release()
        }
      }
      contour.release()
    }
    hulls.sortByDescending { it.first }
    for ((index, entry) in hulls.withIndex()) {
      val hull = entry.second
      if (index < 10) {
        val perimeter = Imgproc.arcLength(hull, true)
        val approx = MatOfPoint2f()
        for (epsilon in doubleArrayOf(0.02, 0.035, 0.05)) {
          Imgproc.approxPolyDP(hull, approx, epsilon * perimeter, true)
          if (approx.rows() == 4) {
            val corners = order(approx.toArray())
            if (convex(corners) && squareEnough(corners)) {
              found.add(corners)
            }
            break
          }
        }
        approx.release()
      }
      hull.release()
    }
  }

  private fun hullOf(contour: MatOfPoint): MatOfPoint2f {
    val indices = MatOfInt()
    Imgproc.convexHull(contour, indices)
    val points = contour.toArray()
    val hull = indices.toArray().map { points[it] }
    indices.release()
    return MatOfPoint2f(*hull.toTypedArray())
  }

  // Top left, top right, bottom right, bottom left.
  private fun order(points: Array<Point>): Array<Point> {
    val topLeft = points.minByOrNull { it.x + it.y }!!
    val bottomRight = points.maxByOrNull { it.x + it.y }!!
    val topRight = points.minByOrNull { it.y - it.x }!!
    val bottomLeft = points.maxByOrNull { it.y - it.x }!!
    return arrayOf(topLeft, topRight, bottomRight, bottomLeft)
  }

  private fun convex(corners: Array<Point>): Boolean {
    var sign = 0
    for (index in 0 until 4) {
      val a = corners[index]
      val b = corners[(index + 1) % 4]
      val c = corners[(index + 2) % 4]
      val cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
      val current = if (cross > 0) 1 else if (cross < 0) -1 else 0
      if (current == 0 || (sign != 0 && current != sign)) {
        return false
      }
      sign = current
    }
    return true
  }

  // Every corner between 60 and 120 degrees.
  private fun squareEnough(corners: Array<Point>): Boolean {
    for (index in 0 until 4) {
      val a = corners[(index + 3) % 4]
      val b = corners[index]
      val c = corners[(index + 1) % 4]
      val x1 = a.x - b.x
      val y1 = a.y - b.y
      val x2 = c.x - b.x
      val y2 = c.y - b.y
      val cos = abs(x1 * x2 + y1 * y2) / (sqrt(x1 * x1 + y1 * y1) * sqrt(x2 * x2 + y2 * y2) + 1e-6)
      if (cos > 0.5) {
        return false
      }
    }
    return true
  }

  private fun quadArea(corners: Array<Point>): Double {
    var sum = 0.0
    for (index in 0 until 4) {
      val a = corners[index]
      val b = corners[(index + 1) % 4]
      sum += a.x * b.y - b.x * a.y
    }
    return abs(sum) / 2
  }

  // Share of points along the four sides that sit on an edge.
  private fun support(edges: ByteArray, width: Int, height: Int, corners: Array<Point>): Double {
    var hits = 0
    var total = 0
    for (side in 0 until 4) {
      val a = corners[side]
      val b = corners[(side + 1) % 4]
      for (step in 0 until 40) {
        val t = 0.05 + 0.9 * step / 39.0
        val x = (a.x + (b.x - a.x) * t).roundToInt()
        val y = (a.y + (b.y - a.y) * t).roundToInt()
        if (x in 0 until width && y in 0 until height) {
          total++
          if (edges[y * width + x].toInt() != 0) {
            hits++
          }
        }
      }
    }
    return if (total > 0) hits.toDouble() / total else 0.0
  }

  // Cuts the page out of the photo and flattens it. Corners go from 0 to 1.
  fun straighten(source: Bitmap, corners: FloatArray): Bitmap {
    val width = source.width.toDouble()
    val height = source.height.toDouble()
    val points = Array(4) { Point(corners[it * 2] * width, corners[it * 2 + 1] * height) }
    val top = distance(points[0], points[1])
    val bottom = distance(points[3], points[2])
    val left = distance(points[0], points[3])
    val right = distance(points[1], points[2])
    val outWidth = max(1.0, max(top, bottom)).roundToInt()
    val outHeight = max(1.0, max(left, right)).roundToInt()

    val from = MatOfPoint2f(*points)
    val to = MatOfPoint2f(
      Point(0.0, 0.0),
      Point(outWidth.toDouble(), 0.0),
      Point(outWidth.toDouble(), outHeight.toDouble()),
      Point(0.0, outHeight.toDouble()),
    )
    val transform = Imgproc.getPerspectiveTransform(from, to)
    val input = Mat()
    Utils.bitmapToMat(source, input)
    val output = Mat()
    Imgproc.warpPerspective(
      input, output, transform, Size(outWidth.toDouble(), outHeight.toDouble()),
      Imgproc.INTER_LINEAR, Core.BORDER_REPLICATE,
    )
    val result = Bitmap.createBitmap(outWidth, outHeight, Bitmap.Config.ARGB_8888)
    Utils.matToBitmap(output, result)
    listOf(from, to, transform, input, output).forEach { it.release() }
    return result
  }

  private fun distance(a: Point, b: Point) = hypot(a.x - b.x, a.y - b.y)

  // Clean-up styles: "original" keeps the photo; "enhance" removes shadows and evens out the
  // paper to white while keeping colour; "gray" does the same in greyscale; "bw" is crisp black
  // on white.
  fun cleanUp(source: Bitmap, style: String): Bitmap {
    if (style == "original") {
      return source.copy(Bitmap.Config.ARGB_8888, false)
    }
    val rgba = Mat()
    Utils.bitmapToMat(source, rgba)
    val rgb = Mat()
    Imgproc.cvtColor(rgba, rgb, Imgproc.COLOR_RGBA2RGB)
    rgba.release()
    val result = Mat()
    if (style == "enhance") {
      val channels = ArrayList<Mat>()
      Core.split(rgb, channels)
      val flattened = channels.map { channel -> flatten(channel).also { channel.release() } }
      Core.merge(flattened, result)
      flattened.forEach { it.release() }
    } else {
      val gray = Mat()
      Imgproc.cvtColor(rgb, gray, Imgproc.COLOR_RGB2GRAY)
      val flat = flatten(gray)
      gray.release()
      if (style == "bw") {
        val block = odd(max(15, max(flat.cols(), flat.rows()) / 40))
        Imgproc.adaptiveThreshold(flat, flat, 255.0, Imgproc.ADAPTIVE_THRESH_GAUSSIAN_C, Imgproc.THRESH_BINARY, block, 14.0)
        // Clears isolated specks left by the camera's grain.
        Imgproc.medianBlur(flat, flat, 3)
      }
      Imgproc.cvtColor(flat, result, Imgproc.COLOR_GRAY2RGB)
      flat.release()
    }
    rgb.release()
    val output = Bitmap.createBitmap(source.width, source.height, Bitmap.Config.ARGB_8888)
    Utils.matToBitmap(result, output)
    result.release()
    return output
  }

  // Evens out the light: the paper's brightness is estimated on a coarse grid (with text taken
  // out) and divided away, so shadows and colour casts disappear and the paper turns white. The
  // estimate never drops below about half the paper's white, so large dark areas such as an ID
  // photo or a stamp are kept rather than washed out. Then ink is darkened to a clean black.
  private fun flatten(channel: Mat): Mat {
    val longest = max(channel.cols(), channel.rows())
    val scale = 256.0 / longest
    val small = Mat()
    Imgproc.resize(channel, small, Size(), scale, scale, Imgproc.INTER_AREA)
    val kernel = Imgproc.getStructuringElement(Imgproc.MORPH_RECT, Size(5.0, 5.0))
    Imgproc.dilate(small, small, kernel)
    kernel.release()
    val grid = Mat()
    Imgproc.resize(
      small, grid,
      Size(max(1.0, Math.round(small.cols() / 4.0).toDouble()), max(1.0, Math.round(small.rows() / 4.0).toDouble())),
      0.0, 0.0, Imgproc.INTER_AREA,
    )
    small.release()
    val cells = ByteArray(grid.total().toInt())
    grid.get(0, 0, cells)
    val white = percentile(cells.map { (it.toInt() and 0xFF).toFloat() }, 0.95)
    val light = Mat()
    grid.convertTo(light, CvType.CV_32F)
    grid.release()
    Core.max(light, Scalar(0.55 * white), light)
    Imgproc.GaussianBlur(light, light, Size(0.0, 0.0), 0.8)
    val envelope = Mat()
    Imgproc.resize(light, envelope, channel.size(), 0.0, 0.0, Imgproc.INTER_LINEAR)
    light.release()

    val values = Mat()
    channel.convertTo(values, CvType.CV_32F)
    val even = Mat()
    Core.divide(values, envelope, even, 250.0)
    values.release()
    envelope.release()

    val preview = Mat()
    Imgproc.resize(even, preview, Size(), scale, scale, Imgproc.INTER_AREA)
    val sample = FloatArray(preview.total().toInt())
    preview.get(0, 0, sample)
    preview.release()
    val low = min(percentile(sample.asList(), 0.01), 80f) * 0.8f
    val result = Mat()
    val gain = 255.0 / (250.0 - low)
    even.convertTo(result, CvType.CV_8U, gain, -low * gain)
    even.release()
    return result
  }

  private fun percentile(values: List<Float>, share: Double): Float {
    if (values.isEmpty()) {
      return 255f
    }
    val sorted = values.sorted()
    return sorted[((sorted.size - 1) * share).toInt()]
  }

  private fun odd(value: Int) = if (value % 2 == 0) value + 1 else value
}
