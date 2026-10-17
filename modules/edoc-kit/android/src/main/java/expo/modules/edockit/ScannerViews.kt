package expo.modules.edockit

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.MotionEvent
import android.view.View
import kotlin.math.hypot
import kotlin.math.min

internal object ScannerColors {
  const val ACCENT = 0xFF3D7BFF.toInt()
  const val ACCENT_SOFT = 0xFF6FA4FF.toInt()
  const val TEXT = 0xFFF4F7FF.toInt()
  const val DIM = 0x9ED6E2FF.toInt()
  const val PANEL = 0xE60C1730.toInt()
  const val GLASS = 0x3326365F.toInt()
}

internal fun View.dp(value: Float) = value * resources.displayMetrics.density

// Where an image with the given aspect ratio sits when fitted and centred in a view.
internal fun fittedRect(viewWidth: Float, viewHeight: Float, aspect: Float): RectF {
  if (viewWidth <= 0f || viewHeight <= 0f || aspect <= 0f) {
    return RectF()
  }
  return if (viewWidth / viewHeight > aspect) {
    val width = viewHeight * aspect
    RectF((viewWidth - width) / 2f, 0f, (viewWidth + width) / 2f, viewHeight)
  } else {
    val height = viewWidth / aspect
    RectF(0f, (viewHeight - height) / 2f, viewWidth, (viewHeight + height) / 2f)
  }
}

// The page outline drawn over the camera picture. Corners glide to their new place rather than
// jump, and the fill brightens while an automatic capture is about to happen.
internal class QuadOverlay(context: Context) : View(context) {
  private var target: FloatArray? = null
  private var shown: FloatArray? = null
  private var aspect = 0.75f
  var progress = 0f
    set(value) {
      field = value
      invalidate()
    }

  private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeWidth = dp(2.5f)
    strokeJoin = Paint.Join.ROUND
    color = ScannerColors.ACCENT_SOFT
  }
  private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val dot = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.FILL
    color = ScannerColors.TEXT
  }
  private val path = Path()

  // Corners from 0 to 1 within the camera frame, which has the given width / height ratio.
  fun show(corners: FloatArray?, frameAspect: Float) {
    aspect = frameAspect
    target = corners
    if (corners == null) {
      shown = null
    } else if (shown == null) {
      shown = corners.copyOf()
    }
    invalidate()
  }

  override fun onDraw(canvas: Canvas) {
    val goal = target ?: return
    val current = shown ?: return
    var moving = false
    for (index in current.indices) {
      val next = current[index] + (goal[index] - current[index]) * 0.35f
      if (kotlin.math.abs(next - goal[index]) > 0.0015f) {
        moving = true
      }
      current[index] = next
    }
    val frame = fittedRect(width.toFloat(), height.toFloat(), aspect)
    path.reset()
    for (corner in 0 until 4) {
      val x = frame.left + current[corner * 2] * frame.width()
      val y = frame.top + current[corner * 2 + 1] * frame.height()
      if (corner == 0) path.moveTo(x, y) else path.lineTo(x, y)
    }
    path.close()
    fill.color = Color.argb((46 + 70 * progress).toInt(), 61, 123, 255)
    canvas.drawPath(path, fill)
    canvas.drawPath(path, stroke)
    for (corner in 0 until 4) {
      canvas.drawCircle(
        frame.left + current[corner * 2] * frame.width(),
        frame.top + current[corner * 2 + 1] * frame.height(),
        dp(4f),
        dot,
      )
    }
    if (moving) {
      postInvalidateOnAnimation()
    }
  }
}

// Round shutter: a white ring around a white disc; the ring fills with blue as an automatic
// capture counts down.
internal class ShutterButton(context: Context) : View(context) {
  var progress = 0f
    set(value) {
      field = value
      invalidate()
    }
  private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeWidth = dp(3.5f)
    color = ScannerColors.TEXT
  }
  private val arc = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeWidth = dp(3.5f)
    strokeCap = Paint.Cap.ROUND
    color = ScannerColors.ACCENT
  }
  private val disc = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.FILL
    color = ScannerColors.TEXT
  }
  private val bounds = RectF()

  override fun onDraw(canvas: Canvas) {
    val radius = min(width, height) / 2f - ring.strokeWidth
    val cx = width / 2f
    val cy = height / 2f
    canvas.drawCircle(cx, cy, radius, ring)
    if (progress > 0f) {
      bounds.set(cx - radius, cy - radius, cx + radius, cy + radius)
      canvas.drawArc(bounds, -90f, 360f * progress, false, arc)
    }
    disc.alpha = if (isPressed) 170 else 255
    canvas.drawCircle(cx, cy, radius - dp(6f), disc)
  }

  override fun drawableStateChanged() {
    super.drawableStateChanged()
    invalidate()
  }
}

// The photo with its page outline; each corner can be dragged, with a magnifier above the
// finger for precise placement.
internal class CropView(context: Context) : View(context) {
  private var bitmap: Bitmap? = null
  var corners: FloatArray = DocumentDetector.fullFrame.copyOf()
    private set
  private var dragging = -1
  private var touchX = 0f
  private var touchY = 0f
  private val image = RectF()

  private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeWidth = dp(2f)
    color = ScannerColors.ACCENT_SOFT
  }
  private val shade = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.FILL
    color = Color.argb(120, 0, 0, 0)
  }
  private val handleFill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.FILL
    color = ScannerColors.TEXT
  }
  private val handleRing = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeWidth = dp(3f)
    color = ScannerColors.ACCENT
  }
  private val bitmapPaint = Paint(Paint.FILTER_BITMAP_FLAG)
  private val loupeBorder = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeWidth = dp(2f)
    color = ScannerColors.TEXT
  }
  private val cross = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeWidth = dp(1.2f)
    color = ScannerColors.ACCENT
  }
  private val path = Path()
  private val outside = Path()
  private val matrix = Matrix()

  fun show(photo: Bitmap, pageCorners: FloatArray) {
    bitmap = photo
    corners = pageCorners.copyOf()
    requestLayout()
    invalidate()
  }

  fun setCorners(pageCorners: FloatArray) {
    corners = pageCorners.copyOf()
    invalidate()
  }

  private fun layoutImage() {
    val photo = bitmap ?: return
    val inset = dp(24f)
    val area = fittedRect(width - inset * 2, height - inset * 2, photo.width.toFloat() / photo.height)
    image.set(area.left + inset, area.top + inset, area.right + inset, area.bottom + inset)
  }

  private fun cornerX(index: Int) = image.left + corners[index * 2] * image.width()
  private fun cornerY(index: Int) = image.top + corners[index * 2 + 1] * image.height()

  override fun onDraw(canvas: Canvas) {
    val photo = bitmap ?: return
    layoutImage()
    canvas.drawBitmap(photo, null, image, bitmapPaint)

    path.reset()
    for (index in 0 until 4) {
      if (index == 0) path.moveTo(cornerX(index), cornerY(index)) else path.lineTo(cornerX(index), cornerY(index))
    }
    path.close()
    outside.reset()
    outside.fillType = Path.FillType.EVEN_ODD
    outside.addRect(image, Path.Direction.CW)
    outside.addPath(path)
    canvas.drawPath(outside, shade)
    canvas.drawPath(path, stroke)

    for (index in 0 until 4) {
      val radius = dp(if (index == dragging) 13f else 11f)
      canvas.drawCircle(cornerX(index), cornerY(index), radius, handleFill)
      canvas.drawCircle(cornerX(index), cornerY(index), radius, handleRing)
    }

    if (dragging >= 0) {
      drawLoupe(canvas, photo)
    }
  }

  // A magnified circle showing the area under the dragged corner, placed away from the finger.
  private fun drawLoupe(canvas: Canvas, photo: Bitmap) {
    val radius = dp(54f)
    val margin = dp(16f)
    val left = touchX > width / 2f
    val cx = if (left) margin + radius else width - margin - radius
    val cy = margin + radius
    val px = cornerX(dragging)
    val py = cornerY(dragging)
    val zoom = 2.2f
    canvas.save()
    path.reset()
    path.addCircle(cx, cy, radius, Path.Direction.CW)
    canvas.clipPath(path)
    canvas.drawColor(Color.BLACK)
    matrix.reset()
    matrix.setRectToRect(RectF(0f, 0f, photo.width.toFloat(), photo.height.toFloat()), image, Matrix.ScaleToFit.FILL)
    matrix.postScale(zoom, zoom, px, py)
    matrix.postTranslate(cx - px, cy - py)
    canvas.drawBitmap(photo, matrix, bitmapPaint)
    canvas.restore()
    canvas.drawCircle(cx, cy, radius, loupeBorder)
    canvas.drawLine(cx - dp(10f), cy, cx + dp(10f), cy, cross)
    canvas.drawLine(cx, cy - dp(10f), cx, cy + dp(10f), cross)
  }

  @SuppressLint("ClickableViewAccessibility")
  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (bitmap == null) {
      return false
    }
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        var nearest = -1
        var best = dp(44f)
        for (index in 0 until 4) {
          val distance = hypot(event.x - cornerX(index), event.y - cornerY(index))
          if (distance < best) {
            best = distance
            nearest = index
          }
        }
        dragging = nearest
        touchX = event.x
        touchY = event.y
        parent?.requestDisallowInterceptTouchEvent(nearest >= 0)
        invalidate()
        return nearest >= 0
      }
      MotionEvent.ACTION_MOVE -> {
        if (dragging < 0) {
          return false
        }
        val dx = event.x - touchX
        val dy = event.y - touchY
        touchX = event.x
        touchY = event.y
        corners[dragging * 2] = (corners[dragging * 2] + dx / image.width()).coerceIn(0f, 1f)
        corners[dragging * 2 + 1] = (corners[dragging * 2 + 1] + dy / image.height()).coerceIn(0f, 1f)
        invalidate()
        return true
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
        dragging = -1
        invalidate()
        return true
      }
    }
    return super.onTouchEvent(event)
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    invalidate()
  }
}
