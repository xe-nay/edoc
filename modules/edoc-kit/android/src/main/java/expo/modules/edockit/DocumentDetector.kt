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
import org.opencv.core.Size
import org.opencv.imgproc.Imgproc
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
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

  // A mask of the main object in a picture, from Google's subject segmentation: one value from
  // 0 to 1 per pixel of a width x height copy of the picture.
  class Mask(val values: FloatArray, val width: Int, val height: Int)

  // Corners of the page (top left, top right, bottom right, bottom left) in the pixels of an RGB
  // image and its greyscale copy, or null when there is no page.
  //
  // The trained model reads the picture: its corner peaks and its page mask. Google's subject
  // mask, when given, is a second opinion on where the page lies. From each mask come rough
  // outlines: the corner peaks, the mask's outline, a mix of the two (weak corners taken from
  // the mask) and the rectangle around the mask. Every side of each rough outline is then moved
  // onto the nearest real straight edge running the same way, unless that mask sees page beyond
  // the edge (a rule or table border inside the page). The outline that best matches its mask and
  // the photo's edges wins. Without the model, edges alone decide.
  fun find(rgb: Mat, gray: Mat, subject: Mask? = null): Array<Point>? {
    val model = if (PageModel.ready) PageModel.run(rgb) else null
    if (model == null) {
      return if (PageModel.ready) null else find(gray)
    }
    val readings = listOfNotNull(model, subject?.let { model.withMask(it.values, it.width, it.height, rgb.cols()) })
      .filter { it.coverage >= 0.05 }
    if (readings.isEmpty()) {
      return null
    }
    val width = gray.cols()
    val height = gray.rows()
    val diagonal = hypot(width.toDouble(), height.toDouble())
    val longest = max(width, height).toDouble()

    val map = edgeMap(gray)
    val blurred = Mat()
    Imgproc.GaussianBlur(gray, blurred, Size(5.0, 5.0), 0.0)
    val edges = Mat()
    Imgproc.Canny(blurred, edges, 30.0, 90.0)
    val lines = straightEdges(edges, 0.08 * min(width, height))
    listOf(blurred, edges).forEach { it.release() }

    var best: Array<Point>? = null
    var bestScore = -1.0
    for (reading in readings) {
      val (peaks, strength) = reading.peaks()
      val rough = ArrayList<Pair<Boolean, Array<Point>>>()
      rough.add(false to order(peaks))
      reading.maskOutline()?.let { outline ->
        val maskCorners = order(outline)
        rough.add(true to maskCorners)
        val mixed = Array(4) { corner ->
          if (strength[corner] >= 0.6) peaks[corner] else maskCorners.minByOrNull { distance(it, peaks[corner]) }!!
        }
        rough.add(false to order(mixed))
      }
      reading.maskBox()?.let { rough.add(true to order(it)) }

      for ((fromMask, cells) in rough) {
        val outline = cells.map { reading.toImage(it) }.toTypedArray()
        if (!convex(outline) || quadArea(outline) < 0.05 * width * height) {
          continue
        }
        // Rough outlines from a mask may be far off; corner peaks are close already.
        val reach = (if (fromMask) 0.12 else 0.04) * diagonal
        var corners = snapSides(outline, lines, map, reading, reach, 6.0 * longest / 480)
        if (!convex(corners) || !squareEnough(corners)) {
          if (!squareEnough(outline)) continue
          corners = outline
        }
        val agreement = reading.agreement(corners.map { reading.toCells(it) }.toTypedArray())
        if (agreement < 0.5) {
          continue
        }
        val score = agreement + map.support(corners)
        if (score > bestScore) {
          bestScore = score
          best = corners
        }
      }
    }
    return best
  }
  private fun edgeMap(gray: Mat): EdgeMap {
    val blurred = Mat()
    Imgproc.GaussianBlur(gray, blurred, Size(5.0, 5.0), 0.0)
    val reference = Mat()
    Imgproc.Canny(blurred, reference, 20.0, 60.0)
    val dx = Mat()
    val dy = Mat()
    Imgproc.Sobel(blurred, dx, CvType.CV_32F, 1, 0, 3)
    Imgproc.Sobel(blurred, dy, CvType.CV_32F, 0, 1, 3)
    val map = EdgeMap(gray.cols(), gray.rows())
    reference.get(0, 0, map.edges)
    dx.get(0, 0, map.dx)
    dy.get(0, 0, map.dy)
    listOf(blurred, reference, dx, dy).forEach { it.release() }
    return map
  }

  // Moves each side of an outline onto the best straight edge near it.
  private fun snapSides(outline: Array<Point>, lines: List<Line>, map: EdgeMap, model: PageModel.Output, reach: Double, offset: Double): Array<Point> {
    val centre = Point(outline.sumOf { it.x } / 4, outline.sumOf { it.y } / 4)
    val chosen = Array(4) { side ->
      val a = outline[side]
      val b = outline[(side + 1) % 4]
      val length = hypot(b.x - a.x, b.y - a.y)
      var angle = atan2(b.y - a.y, b.x - a.x)
      if (angle < 0) angle += Math.PI
      val middle = Point((a.x + b.x) / 2, (a.y + b.y) / 2)
      val nx = -(b.y - a.y) / max(length, 1e-6)
      val ny = (b.x - a.x) / max(length, 1e-6)
      var best = Line(angle, 0.0, length, a.x, a.y, b.x, b.y)
      var bestScore = map.sideSupport(a, b)
      for (line in lines) {
        val turn = abs(line.angle - angle)
        if (min(turn, Math.PI - turn) > Math.toRadians(15.0)) continue
        val gap = abs((middle.x - line.x1) * nx + (middle.y - line.y1) * ny)
        if (gap > reach) continue
        // The side's own stretch, moved onto this line.
        val dirX = cos(line.angle)
        val dirY = sin(line.angle)
        val t1 = (a.x - line.x1) * dirX + (a.y - line.y1) * dirY
        val t2 = (b.x - line.x1) * dirX + (b.y - line.y1) * dirY
        val na = Point(line.x1 + dirX * t1, line.y1 + dirY * t1)
        val nb = Point(line.x1 + dirX * t2, line.y1 + dirY * t2)
        if (pageBeyond(model, na, nb, centre, offset)) continue
        val score = map.sideSupport(na, nb) - 0.4 * gap / reach
        if (score > bestScore + 0.05) {
          bestScore = score
          best = Line(line.angle, 0.0, length, na.x, na.y, nb.x, nb.y)
        }
      }
      best
    }
    val corners = Array(4) { corner -> crossing(chosen[(corner + 3) % 4], chosen[corner]) ?: outline[corner] }
    return order(corners)
  }

  // True when the model sees page just beyond a side, which makes it a line inside the page.
  private fun pageBeyond(model: PageModel.Output, a: Point, b: Point, centre: Point, offset: Double): Boolean {
    val length = max(hypot(b.x - a.x, b.y - a.y), 1e-6)
    var nx = -(b.y - a.y) / length
    var ny = (b.x - a.x) / length
    if (((a.x + b.x) / 2 - centre.x) * nx + ((a.y + b.y) / 2 - centre.y) * ny < 0) {
      nx = -nx
      ny = -ny
    }
    var sum = 0.0
    for (step in 0 until 8) {
      val t = 0.15 + 0.7 * step / 7.0
      sum += model.pageAt(Point(a.x + (b.x - a.x) * t + nx * offset, a.y + (b.y - a.y) * t + ny * offset))
    }
    return sum / 8 >= 0.5
  }
  // Corners of the page in a greyscale image from its edges alone: the best scoring outline.
  fun find(gray: Mat): Array<Point>? {
    val (found, map) = outlines(gray)
    return found.maxByOrNull { corners ->
      val share = map.support(corners)
      quadArea(corners) * share * share
    }
  }

  // Every four-cornered outline in a greyscale image, and its edge map for scoring them.
  private fun outlines(gray: Mat): Pair<List<Array<Point>>, EdgeMap> {
    val width = gray.cols()
    val height = gray.rows()
    val area = height.toDouble() * width
    val minArea = 0.1 * area
    val maxArea = 0.97 * area
    val blurred = Mat()
    Imgproc.GaussianBlur(gray, blurred, Size(5.0, 5.0), 0.0)
    val found = ArrayList<Array<Point>>()
    val edges = Mat()
    val small = Imgproc.getStructuringElement(Imgproc.MORPH_RECT, Size(3.0, 3.0))
    for ((low, high) in listOf(20.0 to 60.0, 40.0 to 120.0, 75.0 to 200.0)) {
      Imgproc.Canny(blurred, edges, low, high)
      if (low == 40.0) {
        // Outlines made of four straight edges still work when a chair or a table edge touches
        // the page, which joins their outlines into one shape.
        collectFromLines(edges, width, height, minArea, maxArea, found)
      }
      Imgproc.dilate(edges, edges, small)
      collect(edges, minArea, maxArea, found)
    }
    val bright = Mat()
    Imgproc.threshold(blurred, bright, 0.0, 255.0, Imgproc.THRESH_BINARY or Imgproc.THRESH_OTSU)
    val closing = Imgproc.getStructuringElement(Imgproc.MORPH_RECT, Size(9.0, 9.0))
    Imgproc.morphologyEx(bright, bright, Imgproc.MORPH_CLOSE, closing)
    collect(bright, minArea, maxArea, found)

    val reference = Mat()
    Imgproc.Canny(blurred, reference, 20.0, 60.0)
    val dx = Mat()
    val dy = Mat()
    Imgproc.Sobel(blurred, dx, CvType.CV_32F, 1, 0, 3)
    Imgproc.Sobel(blurred, dy, CvType.CV_32F, 0, 1, 3)
    val map = EdgeMap(width, height)
    reference.get(0, 0, map.edges)
    dx.get(0, 0, map.dx)
    dy.get(0, 0, map.dy)
    listOf(blurred, edges, small, bright, closing, reference, dx, dy).forEach { it.release() }
    return found to map
  }
  // Edges and their direction, for checking how well an outline follows the photo's edges.
  private class EdgeMap(val width: Int, val height: Int) {
    val edges = ByteArray(width * height)
    val dx = FloatArray(width * height)
    val dy = FloatArray(width * height)

    // Support of one side on its own.
    fun sideSupport(a: Point, b: Point) = support(arrayOf(a, b, b, a))

    // Share of points along the four sides that sit on an edge running the same way as the side
    // (an edge crossing it, such as a chair arm, does not count).
    fun support(corners: Array<Point>): Double {
      var hits = 0
      var total = 0
      for (side in 0 until 4) {
        val a = corners[side]
        val b = corners[(side + 1) % 4]
        val length = hypot(b.x - a.x, b.y - a.y)
        if (length < 1) {
          continue
        }
        val nx = -(b.y - a.y) / length
        val ny = (b.x - a.x) / length
        for (step in 0 until 40) {
          val t = 0.05 + 0.9 * step / 39.0
          val x = a.x + (b.x - a.x) * t
          val y = a.y + (b.y - a.y) * t
          total++
          for (offset in intArrayOf(0, -1, 1, -2, 2)) {
            val px = (x + nx * offset).roundToInt()
            val py = (y + ny * offset).roundToInt()
            if (px !in 0 until width || py !in 0 until height) {
              continue
            }
            val index = py * width + px
            if (edges[index].toInt() == 0) {
              continue
            }
            val gx = dx[index].toDouble()
            val gy = dy[index].toDouble()
            val magnitude = hypot(gx, gy)
            if (magnitude > 0 && abs(gx * nx + gy * ny) / magnitude > 0.85) {
              hits++
              break
            }
          }
        }
      }
      return if (total > 0) hits.toDouble() / total else 0.0
    }
  }

  // A straight edge: direction (0 to pi), distance from the origin along its normal, total
  // length, and two points on it.
  private class Line(val angle: Double, val offset: Double, var length: Double, val x1: Double, val y1: Double, val x2: Double, val y2: Double)

  private fun straightEdges(edges: Mat, minLength: Double): List<Line> {
    val segments = Mat()
    Imgproc.HoughLinesP(edges, segments, 1.0, Math.PI / 180, 40, minLength, 12.0)
    val lines = ArrayList<Line>()
    val values = IntArray(4)
    for (row in 0 until segments.rows()) {
      segments.get(row, 0, values)
      val x1 = values[0].toDouble()
      val y1 = values[1].toDouble()
      val x2 = values[2].toDouble()
      val y2 = values[3].toDouble()
      var angle = atan2(y2 - y1, x2 - x1)
      if (angle < 0) angle += Math.PI
      if (angle >= Math.PI) angle -= Math.PI
      val offset = -sin(angle) * x1 + cos(angle) * y1
      lines.add(Line(angle, offset, hypot(x2 - x1, y2 - y1), x1, y1, x2, y2))
    }
    segments.release()
    lines.sortByDescending { it.length }
    // Pieces of the same edge are merged into one.
    val kept = ArrayList<Line>()
    for (line in lines) {
      val same = kept.firstOrNull { other ->
        val difference = abs(line.angle - other.angle)
        min(difference, Math.PI - difference) < Math.toRadians(4.0) && abs(line.offset - other.offset) < 8
      }
      if (same != null) same.length += line.length else kept.add(line)
    }
    return kept
  }

  private fun crossing(a: Line, b: Line): Point? {
    val d = (a.x1 - a.x2) * (b.y1 - b.y2) - (a.y1 - a.y2) * (b.x1 - b.x2)
    if (abs(d) < 1e-6) {
      return null
    }
    val t = ((a.x1 - b.x1) * (b.y1 - b.y2) - (a.y1 - b.y1) * (b.x1 - b.x2)) / d
    return Point(a.x1 + t * (a.x2 - a.x1), a.y1 + t * (a.y2 - a.y1))
  }

  private fun collectFromLines(edges: Mat, width: Int, height: Int, minArea: Double, maxArea: Double, found: MutableList<Array<Point>>) {
    val lines = straightEdges(edges, 0.12 * min(width, height))
    val across = lines.filter { it.angle < Math.toRadians(40.0) || it.angle > Math.toRadians(140.0) }.take(8)
    val upright = lines.filter { it.angle > Math.toRadians(50.0) && it.angle < Math.toRadians(130.0) }.take(8)
    val margin = 0.04 * max(width, height)
    for (i in across.indices) for (j in i + 1 until across.size) for (k in upright.indices) for (m in k + 1 until upright.size) {
      val points = arrayOf(
        crossing(across[i], upright[k]), crossing(across[i], upright[m]),
        crossing(across[j], upright[k]), crossing(across[j], upright[m]),
      )
      if (points.any { it == null || it.x < -margin || it.x > width + margin || it.y < -margin || it.y > height + margin }) {
        continue
      }
      val clamped = points.map { Point(it!!.x.coerceIn(0.0, width - 1.0), it.y.coerceIn(0.0, height - 1.0)) }.toTypedArray()
      val corners = order(clamped)
      val size = quadArea(corners)
      if (size in minArea..maxArea && convex(corners) && squareEnough(corners)) {
        found.add(corners)
      }
    }
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
    val rgb = Mat()
    Imgproc.cvtColor(rgba, rgb, Imgproc.COLOR_RGBA2RGB)
    val gray = Mat()
    Imgproc.cvtColor(rgba, gray, Imgproc.COLOR_RGBA2GRAY)
    val subject = Foreground.mask(sample)?.let { Mask(it, sample.width, sample.height) }
    val corners = find(rgb, gray, subject)
    val width = gray.cols().toFloat()
    val height = gray.rows().toFloat()
    listOf(rgba, rgb, gray).forEach { it.release() }
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

  // Clean-up styles, like CamScanner's: "original" keeps the photo; "enhance" turns the paper pure
  // white (no shadows, no wrinkle shading, no colour cast), deepens the ink and keeps coloured ink
  // such as stamps vivid; "gray" is the same in greyscale; "bw" is black on white.
  //
  // The paper's light is measured on a small copy: a local maximum over a few stroke widths
  // leaves only paper, then a blur at about a sixtieth of the page smooths it while still
  // following wrinkles. Each pixel is divided by that light, then a tone curve sends the paper to
  // white and the ink towards black. Large dark areas (a photo) are not mistaken for shadow.
  // Work happens pixel by pixel on bytes, so a 12 megapixel page needs little memory.
  fun cleanUp(source: Bitmap, style: String): Bitmap {
    if (style == "original") {
      return source.copy(Bitmap.Config.ARGB_8888, false)
    }
    val width = source.width
    val height = source.height
    val rgba = Mat()
    Utils.bitmapToMat(source, rgba)
    val rgb = Mat()
    Imgproc.cvtColor(rgba, rgb, Imgproc.COLOR_RGBA2RGB)
    rgba.release()

    // The paper's light, per colour channel, on a copy about 512 pixels on its short side.
    val scale = min(1.0, 512.0 / min(width, height))
    val smallWidth = max(1, (width * scale).roundToInt())
    val smallHeight = max(1, (height * scale).roundToInt())
    val small = Mat()
    Imgproc.resize(rgb, small, Size(smallWidth.toDouble(), smallHeight.toDouble()), 0.0, 0.0, Imgproc.INTER_AREA)
    val side = min(smallWidth, smallHeight).toDouble()
    val reach = odd(max(3, (side / 45).roundToInt()))
    val kernel = Imgproc.getStructuringElement(Imgproc.MORPH_RECT, Size(reach.toDouble(), reach.toDouble()))
    Imgproc.dilate(small, small, kernel)
    kernel.release()
    val floats = Mat()
    small.convertTo(floats, CvType.CV_32FC3, 1.0 / 255)
    small.release()
    Imgproc.GaussianBlur(floats, floats, Size(0.0, 0.0), side / 60)
    val light = FloatArray(smallWidth * smallHeight * 3)
    floats.get(0, 0, light)
    floats.release()
    for (channel in 0 until 3) {
      val values = FloatArray(smallWidth * smallHeight) { light[it * 3 + channel] }
      values.sort()
      val floor = 0.5f * values[((values.size - 1) * 0.9).toInt()]
      for (index in channel until light.size step 3) {
        if (light[index] < floor) light[index] = floor
      }
    }

    // Tone curves as tables: paper to white, ink deeper; coloured ink deepened gently.
    val steps = 1024
    val paperCurve = FloatArray(steps + 1) { (it.toDouble() / steps).pow(1.8).toFloat() }
    val inkCurve = FloatArray(steps + 1) { (it.toDouble() / steps).pow(2.2).toFloat() }

    val pixels = ByteArray(width * height * 3)
    rgb.get(0, 0, pixels)
    val even = FloatArray(3)
    val out = FloatArray(3)
    for (y in 0 until height) {
      val sy = ((y + 0.5) * scale - 0.5).coerceIn(0.0, smallHeight - 1.0)
      val y0 = sy.toInt()
      val y1 = min(y0 + 1, smallHeight - 1)
      val fy = (sy - y0).toFloat()
      for (x in 0 until width) {
        val sx = ((x + 0.5) * scale - 0.5).coerceIn(0.0, smallWidth - 1.0)
        val x0 = sx.toInt()
        val x1 = min(x0 + 1, smallWidth - 1)
        val fx = (sx - x0).toFloat()
        val base = (y * width + x) * 3
        for (channel in 0 until 3) {
          val a = light[(y0 * smallWidth + x0) * 3 + channel]
          val b = light[(y0 * smallWidth + x1) * 3 + channel]
          val c = light[(y1 * smallWidth + x0) * 3 + channel]
          val d = light[(y1 * smallWidth + x1) * 3 + channel]
          val paper = (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy
          even[channel] = ((pixels[base + channel].toInt() and 0xFF) / 255f) / paper
        }
        val luma = (even[0] + even[1] + even[2]) / 3
        val t = ((luma - 0.35f) / 0.51f).coerceIn(0f, 1f)
        val gain = paperCurve[(t * steps).toInt()] / max(luma, 1e-3f)
        val r = even[0].coerceIn(0f, 1f)
        val g = even[1].coerceIn(0f, 1f)
        val bl = even[2].coerceIn(0f, 1f)
        val colour = (((max(r, max(g, bl)) - min(r, min(g, bl))) - 0.06f) / 0.12f).coerceIn(0f, 1f)
        for (channel in 0 until 3) {
          val inked = inkCurve[(even[channel].coerceIn(0f, 1f) * steps).toInt()]
          out[channel] = even[channel] * gain * (1 - colour) + inked * colour
        }
        // Colour a little more vivid, coloured ink much more.
        val mean = (out[0] + out[1] + out[2]) / 3
        val vivid = 1.25f + 0.6f * colour
        for (channel in 0 until 3) {
          val value = mean + (out[channel] - mean) * vivid
          pixels[base + channel] = (value.coerceIn(0f, 1f) * 255 + 0.5f).toInt().toByte()
        }
      }
    }
    rgb.put(0, 0, pixels)

    // Light sharpening for crisp text.
    val soft = Mat()
    val blurKernel = Mat(3, 3, CvType.CV_32F)
    blurKernel.put(0, 0, floatArrayOf(1f, 2f, 1f, 2f, 4f, 2f, 1f, 2f, 1f).map { it / 16f }.toFloatArray())
    Imgproc.filter2D(rgb, soft, -1, blurKernel)
    Core.addWeighted(rgb, 1.6, soft, -0.6, 0.0, rgb)
    listOf(soft, blurKernel).forEach { it.release() }

    if (style == "gray" || style == "bw") {
      val gray = Mat()
      Imgproc.cvtColor(rgb, gray, Imgproc.COLOR_RGB2GRAY)
      if (style == "bw") {
        Imgproc.threshold(gray, gray, 152.0, 255.0, Imgproc.THRESH_BINARY)
      }
      Imgproc.cvtColor(gray, rgb, Imgproc.COLOR_GRAY2RGB)
      gray.release()
    }
    val output = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    Utils.matToBitmap(rgb, output)
    rgb.release()
    return output
  }
  private fun odd(value: Int) = if (value % 2 == 0) value + 1 else value
}
