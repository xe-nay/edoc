package expo.modules.edockit

import android.graphics.Bitmap
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

// Tells which way up a scanned page is from the shape of its printed lines, in any script.
// Lines have a dense core band (the Arabic baseline, the Latin x-height) with clearly more ink
// rising above it (alif and lam, dots, ascenders, capitals) than hanging below it. The direction
// the lines run separates upright from sideways pages; the side with the extra ink is the top.
internal object PageOrientation {
  private const val LONGEST = 1000
  private const val STRIPS = 6
  private const val RADIUS = 12
  private const val MARGIN = 0.03

  // How a page reads along one axis: share of its ink inside text lines, and how strongly the
  // lines point up (positive) or down (negative).
  private class Reading(val share: Double, val evidence: Double, val lines: Int)

  // The answer: lines run along rows when sideways is false; upright tells which way up, or is
  // null when the line shape is not conclusive.
  class Layout(val sideways: Boolean, val upright: Boolean?)

  // Returns null when the page has no clear text lines (a photo, a drawing, a near-empty page).
  fun read(bitmap: Bitmap): Layout? {
    val scale = LONGEST.toFloat() / max(bitmap.width, bitmap.height)
    val small = if (scale < 1f) {
      Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).roundToInt(), (bitmap.height * scale).roundToInt(), true)
    } else {
      bitmap
    }
    try {
      return layout(small)
    } finally {
      if (small !== bitmap) {
        small.recycle()
      }
    }
  }

  private fun layout(bitmap: Bitmap): Layout? {
    val width = bitmap.width
    val height = bitmap.height
    val pixels = IntArray(width * height)
    bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
    val gray = IntArray(pixels.size) { index ->
      val color = pixels[index]
      (((color shr 16) and 0xFF) * 299 + ((color shr 8) and 0xFF) * 587 + (color and 0xFF) * 114) / 1000
    }

    // Running sums for the local mean, so shadows and uneven light do not read as ink.
    val stride = width + 1
    val sums = LongArray(stride * (height + 1))
    for (y in 0 until height) {
      var row = 0L
      for (x in 0 until width) {
        row += gray[y * width + x]
        sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + row
      }
    }

    val left = (width * MARGIN).toInt()
    val right = width - left
    val top = (height * MARGIN).toInt()
    val bottom = height - top
    val innerWidth = right - left
    val innerHeight = bottom - top
    if (innerWidth < 50 || innerHeight < 50) {
      return null
    }

    // Ink counts per line of pixels, split into vertical strips so that a slightly tilted page
    // does not blur neighbouring lines together. "Rows" reads the page as it is; "columns" reads
    // it turned a quarter clockwise, as needed for a page lying on its left side.
    val rows = Array(STRIPS) { IntArray(innerHeight) }
    val columns = Array(STRIPS) { IntArray(innerWidth) }
    var ink = 0L
    for (y in top until bottom) {
      val y0 = max(0, y - RADIUS)
      val y1 = minOf(height, y + RADIUS + 1)
      val rowStrip = (bottom - 1 - y) * STRIPS / innerHeight
      for (x in left until right) {
        val x0 = max(0, x - RADIUS)
        val x1 = minOf(width, x + RADIUS + 1)
        val area = (y1 - y0) * (x1 - x0)
        val total = sums[y1 * stride + x1] - sums[y0 * stride + x1] - sums[y1 * stride + x0] + sums[y0 * stride + x0]
        val value = gray[y * width + x]
        if (value < 200 && value.toLong() * area * 100 < total * 82) {
          ink++
          rows[(x - left) * STRIPS / innerWidth][y - top]++
          columns[rowStrip][x - left]++
        }
      }
    }
    if (ink == 0L) {
      return null
    }

    val asIs = measure(rows, ink)
    val turned = measure(columns, ink)
    val sideways = turned.share > asIs.share
    val chosen = if (sideways) turned else asIs
    val other = if (sideways) asIs else turned
    if (chosen.lines < 4 || chosen.share < 0.6 || chosen.share - other.share < 0.08) {
      return null
    }
    val upright = if (abs(chosen.evidence) < 0.08) null else chosen.evidence > 0
    return Layout(sideways, upright)
  }

  private fun measure(profiles: Array<IntArray>, ink: Long): Reading {
    var upper = 0.0
    var lower = 0.0
    var inLines = 0.0
    var lines = 0
    for (profile in profiles) {
      val inked = profile.filter { it > 0 }.sorted()
      if (inked.isEmpty()) {
        continue
      }
      val threshold = max(1.0, 0.03 * inked[((inked.size - 1) * 0.9).toInt()])
      var start = 0
      while (start < profile.size) {
        if (profile[start] <= threshold) {
          start++
          continue
        }
        var end = start
        while (end < profile.size && profile[end] > threshold) {
          end++
        }
        if (end - start in 6..80) {
          var peak = 0
          for (index in start until end) {
            peak = max(peak, profile[index])
          }
          var first = -1
          var last = -1
          for (index in start until end) {
            if (profile[index] * 2 >= peak) {
              if (first < 0) first = index
              last = index
            }
          }
          for (index in start until end) {
            when {
              index < first -> upper += profile[index]
              index > last -> lower += profile[index]
            }
            inLines += profile[index]
          }
          lines++
        }
        start = end
      }
    }
    val evidence = if (upper + lower > 0) (upper - lower) / (upper + lower) else 0.0
    return Reading(inLines / ink, evidence, lines)
  }
}
