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
import android.view.GestureDetector
import android.view.ScaleGestureDetector
import android.widget.ImageView
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

// A page picture that can be pinched to zoom (around the fingers), dragged while zoomed and
// double-tapped to zoom in or back out. A sideways swipe while not zoomed turns the page.
@SuppressLint("ClickableViewAccessibility")
internal class ZoomImageView(context: Context) : ImageView(context) {
  private val fit = Matrix()
  private val zoom = Matrix()
  private val shown = Matrix()
  private val bounds = RectF()
  private var scale = 1f
  val zoomed: Boolean
    get() = scale > 1.01f

  // -1 for the previous page, +1 for the next one.
  var onSwipe: ((Int) -> Unit)? = null

  init {
    scaleType = ScaleType.MATRIX
  }

  override fun setImageBitmap(bitmap: Bitmap?) {
    super.setImageBitmap(bitmap)
    reset()
  }

  fun reset() {
    scale = 1f
    zoom.reset()
    layoutPicture()
  }

  private fun layoutPicture() {
    val picture = drawable ?: return
    if (width == 0 || height == 0) return
    fit.setRectToRect(
      RectF(0f, 0f, picture.intrinsicWidth.toFloat(), picture.intrinsicHeight.toFloat()),
      RectF(0f, 0f, width.toFloat(), height.toFloat()),
      Matrix.ScaleToFit.CENTER,
    )
    update()
  }

  // Keeps the zoomed picture covering the view (or centred where it is smaller).
  private fun update() {
    val picture = drawable ?: return
    shown.set(fit)
    shown.postConcat(zoom)
    bounds.set(0f, 0f, picture.intrinsicWidth.toFloat(), picture.intrinsicHeight.toFloat())
    shown.mapRect(bounds)
    val dx = when {
      bounds.width() <= width -> width / 2f - bounds.centerX()
      bounds.left > 0 -> -bounds.left
      bounds.right < width -> width - bounds.right
      else -> 0f
    }
    val dy = when {
      bounds.height() <= height -> height / 2f - bounds.centerY()
      bounds.top > 0 -> -bounds.top
      bounds.bottom < height -> height - bounds.bottom
      else -> 0f
    }
    zoom.postTranslate(dx, dy)
    shown.postTranslate(dx, dy)
    imageMatrix = shown
  }

  private fun zoomBy(factor: Float, x: Float, y: Float) {
    val next = (scale * factor).coerceIn(1f, 6f)
    val applied = next / scale
    scale = next
    zoom.postScale(applied, applied, x, y)
    update()
  }

  private val pinch = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
    override fun onScale(detector: ScaleGestureDetector): Boolean {
      zoomBy(detector.scaleFactor, detector.focusX, detector.focusY)
      return true
    }
  })

  private val gestures = GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
    override fun onDown(event: MotionEvent) = true

    override fun onScroll(first: MotionEvent?, event: MotionEvent, distanceX: Float, distanceY: Float): Boolean {
      if (!zoomed) return false
      zoom.postTranslate(-distanceX, -distanceY)
      update()
      return true
    }

    override fun onDoubleTap(event: MotionEvent): Boolean {
      if (zoomed) reset() else zoomBy(2.5f, event.x, event.y)
      return true
    }

    override fun onFling(first: MotionEvent?, event: MotionEvent, velocityX: Float, velocityY: Float): Boolean {
      if (zoomed || kotlin.math.abs(velocityX) < kotlin.math.abs(velocityY) || kotlin.math.abs(velocityX) < 600) {
        return false
      }
      onSwipe?.invoke(if (velocityX < 0) 1 else -1)
      return true
    }
  })

  override fun onTouchEvent(event: MotionEvent): Boolean {
    pinch.onTouchEvent(event)
    if (!pinch.isInProgress) {
      gestures.onTouchEvent(event)
    }
    parent?.requestDisallowInterceptTouchEvent(zoomed || event.pointerCount > 1)
    if (event.actionMasked == MotionEvent.ACTION_UP) {
      performClick()
    }
    return true
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    layoutPicture()
  }
}
