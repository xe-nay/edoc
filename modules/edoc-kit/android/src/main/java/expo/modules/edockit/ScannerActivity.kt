package expo.modules.edockit

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.view.Gravity
import android.view.GestureDetector
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.OrientationEventListener
import android.view.ScaleGestureDetector
import android.view.Surface
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import org.opencv.android.Utils
import org.opencv.core.Core
import org.opencv.core.CvType
import org.opencv.core.Mat
import org.opencv.core.Size
import org.opencv.imgproc.Imgproc
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

// eDoc's own document scanner: a live camera that outlines the page and takes it by itself once
// the phone is steady, then a review of the pages (crop, rotate, clean-up style, delete).
// Pages are kept the way the phone is held, as on the iPhone; nothing guesses from the text.
class ScannerActivity : ComponentActivity() {
  companion object {
    const val EXTRA_OUT_DIR = "edoc.outDir"
    const val EXTRA_MAX_PAGES = "edoc.maxPages"
    const val EXTRA_SECURE = "edoc.secure"
    // Pages of a scan to show again for review (file URIs), instead of starting at the camera.
    const val EXTRA_PAGES = "edoc.pages"
    const val RESULT_URIS = "edoc.uris"
    const val RESULT_WIDTHS = "edoc.widths"
    const val RESULT_HEIGHTS = "edoc.heights"
    const val RESULT_NO_PERMISSION = Activity.RESULT_FIRST_USER + 1
    const val RESULT_NO_CAMERA = Activity.RESULT_FIRST_USER + 2

    private const val ANALYSIS_SIDE = 480
    private const val PHOTO_SIDE = 4096
    private const val AUTO_HOLD_MS = 1100L
    private const val ORIENTATION_HOLD_MS = 400L
    private val STYLES = listOf("original" to "Original", "enhance" to "Enhance", "gray" to "Gray", "bw" to "B&W")
  }

  private class Page(val photo: File, val detected: FloatArray, var corners: FloatArray) {
    var turns = 0
    var style = "enhance"
    var output: File? = null
    var thumb: Bitmap? = null
  }

  private val pages = ArrayList<Page>()
  private lateinit var workDir: File
  private lateinit var outDir: File
  private var maxPages = 0

  // Captures, page rendering and saving run one after another on this thread.
  private val worker = Executors.newSingleThreadExecutor()
  private val analyzer = Executors.newSingleThreadExecutor()

  private lateinit var root: FrameLayout
  private lateinit var cameraLayer: FrameLayout
  private lateinit var previewView: PreviewView
  private lateinit var overlay: QuadOverlay
  private lateinit var shutter: ShutterButton
  private lateinit var flashView: View
  private lateinit var thumb: ImageView
  private lateinit var badge: TextView
  private lateinit var doneButton: View
  private lateinit var modeLabel: TextView
  private lateinit var torchButton: ImageButton
  private lateinit var zoomLabel: TextView
  private lateinit var reviewLayer: FrameLayout
  private lateinit var pageImage: ZoomImageView
  private lateinit var counter: TextView
  private lateinit var addButton: View
  private val styleChips = LinkedHashMap<String, TextView>()
  private lateinit var cropLayer: FrameLayout
  private lateinit var cropView: CropView
  private lateinit var busy: View

  private var camera: Camera? = null
  private var preview: Preview? = null
  private var analysis: ImageAnalysis? = null
  private var imageCapture: ImageCapture? = null
  private var torch = false
  private var auto = true
  private var capturing = false

  @Volatile
  private var analysing = true
  private var lastAnalysis = 0L
  private var tracked: FloatArray? = null
  private var challenger: FloatArray? = null
  private var challengerFrames = 0
  private var misses = 0
  private var frameAspect = 0.75f
  private var corners: FloatArray? = null
  private var lastSeen = 0L
  private var stableSince = 0L
  private var armed = true
  private var capturedCorners: FloatArray? = null
  private var analysisRotation = 0

  private var deviceOrientation = 0
  private var candidateOrientation = 0
  private var candidateSince = 0L

  private var current = 0
  private var cropping: Page? = null
  private var cropPhoto: Bitmap? = null

  private val askCamera = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    if (granted) startCamera() else finishWith(RESULT_NO_PERMISSION)
  }

  // Which way the phone is held, settled for a moment before it counts, so that tipping the
  // phone down over a page does not turn it. Upside down only counts on a tablet whose screen
  // has turned too.
  private val orientationListener by lazy {
    object : OrientationEventListener(this) {
      override fun onOrientationChanged(angle: Int) {
        if (angle == ORIENTATION_UNKNOWN) {
          return
        }
        val next = when {
          angle <= 30 || angle >= 330 -> 0
          angle in 60..120 -> 90
          angle in 150..210 -> 180
          angle in 240..300 -> 270
          else -> return
        }
        val now = SystemClock.uptimeMillis()
        if (next != candidateOrientation) {
          candidateOrientation = next
          candidateSince = now
        } else if (now - candidateSince >= ORIENTATION_HOLD_MS) {
          deviceOrientation = next
        }
      }
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (resources.configuration.smallestScreenWidthDp < 600) {
      requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
    }
    if (intent.getBooleanExtra(EXTRA_SECURE, false)) {
      window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    WindowCompat.setDecorFitsSystemWindows(window, false)

    outDir = File(intent.getStringExtra(EXTRA_OUT_DIR) ?: cacheDir.path)
    maxPages = intent.getIntExtra(EXTRA_MAX_PAGES, 0)
    // Photos left behind by a scan that was cut short (the app closed by the system) go first.
    cacheDir.listFiles { file -> file.isDirectory && file.name.startsWith("edoc-scan-") }
      ?.forEach { stale -> worker.execute { stale.deleteRecursively() } }
    workDir = File(cacheDir, "edoc-scan-${System.currentTimeMillis()}").apply { mkdirs() }

    buildViews()
    setContentView(root)
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() = goBack()
    })

    if (!DocumentDetector.load()) {
      finishWith(RESULT_NO_CAMERA)
      return
    }
    analyzer.execute { PageModel.load(applicationContext) }
    intent.getStringArrayListExtra(EXTRA_PAGES)?.takeIf { it.isNotEmpty() }?.let { uris ->
      work({ uris.forEach { uri -> pages.add(existingPage(uri)) } }) {
        updateCameraBar()
        showReview(0)
      }
    }
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
      startCamera()
    } else {
      askCamera.launch(Manifest.permission.CAMERA)
    }
  }

  override fun onResume() {
    super.onResume()
    if (orientationListener.canDetectOrientation()) {
      orientationListener.enable()
    }
  }

  override fun onPause() {
    orientationListener.disable()
    super.onPause()
  }

  override fun onDestroy() {
    super.onDestroy()
    analysing = false
    analyzer.shutdown()
    worker.execute { workDir.deleteRecursively() }
    worker.shutdown()
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    // A tablet turned on its side: the preview and the page outline follow the screen.
    previewView.post {
      val rotation = previewView.display?.rotation ?: return@post
      preview?.targetRotation = rotation
      analysis?.targetRotation = rotation
    }
  }

  // ---- Layout ----

  private fun dp(value: Float) = value * resources.displayMetrics.density
  private fun px(value: Float) = dp(value).roundToInt()

  private fun rounded(color: Int, radius: Float) = GradientDrawable().apply {
    setColor(color)
    cornerRadius = radius
  }

  private fun frame(width: Int, height: Int, gravity: Int, margins: IntArray = intArrayOf(0, 0, 0, 0)) =
    FrameLayout.LayoutParams(width, height, gravity).apply { setMargins(margins[0], margins[1], margins[2], margins[3]) }

  private fun iconButton(icon: Int, description: String, size: Float = 48f, background: Int = ScannerColors.GLASS, onClick: () -> Unit) =
    ImageButton(this).apply {
      setImageResource(icon)
      scaleType = ImageView.ScaleType.CENTER
      this.background = rounded(background, dp(size) / 2)
      contentDescription = description
      setOnClickListener { onClick() }
    }

  private fun label(text: String, size: Float, color: Int = ScannerColors.TEXT, bold: Boolean = false) = TextView(this).apply {
    this.text = text
    textSize = size
    setTextColor(color)
    if (bold) typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    gravity = Gravity.CENTER
  }

  private fun row(gravity: Int = Gravity.CENTER_VERTICAL) = LinearLayout(this).apply {
    orientation = LinearLayout.HORIZONTAL
    this.gravity = gravity
  }

  private fun spacer() = View(this).apply { layoutParams = LinearLayout.LayoutParams(0, 1, 1f) }

  private fun LinearLayout.addSized(view: View, size: Float) {
    addView(view, LinearLayout.LayoutParams(px(size), px(size)))
  }

  private fun buildViews() {
    root = FrameLayout(this).apply { setBackgroundColor(android.graphics.Color.BLACK) }
    ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
    buildCamera()
    buildReview()
    buildCrop()
    busy = FrameLayout(this).apply {
      setBackgroundColor(0x99000000.toInt())
      isClickable = true
      visibility = View.GONE
      addView(ProgressBar(this@ScannerActivity), frame(px(44f), px(44f), Gravity.CENTER))
    }
    root.addView(busy, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
  }

  private fun buildCamera() {
    cameraLayer = FrameLayout(this)
    previewView = PreviewView(this).apply { scaleType = PreviewView.ScaleType.FIT_CENTER }
    overlay = QuadOverlay(this)
    flashView = View(this).apply {
      setBackgroundColor(android.graphics.Color.WHITE)
      alpha = 0f
    }
    val fill = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    val previewArea = frame(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.TOP, intArrayOf(0, px(64f), 0, px(128f)))
    cameraLayer.addView(previewView, previewArea)
    cameraLayer.addView(overlay, frame(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.TOP, intArrayOf(0, px(64f), 0, px(128f))))
    cameraLayer.addView(flashView, fill)

    // Tap to focus.
    val focus = GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
      override fun onDown(event: MotionEvent) = true
      override fun onSingleTapUp(event: MotionEvent): Boolean {
        val point = previewView.meteringPointFactory.createPoint(event.x, event.y)
        camera?.cameraControl?.startFocusAndMetering(FocusMeteringAction.Builder(point).build())
        return true
      }
    })
    // Pinch to zoom, from the main lens's widest view up to 8 times.
    val pinch = ScaleGestureDetector(this, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
      override fun onScale(detector: ScaleGestureDetector): Boolean {
        val state = camera?.cameraInfo?.zoomState?.value ?: return false
        val lowest = max(state.minZoomRatio, 1f)
        val highest = kotlin.math.min(state.maxZoomRatio, 8f)
        val ratio = (state.zoomRatio * detector.scaleFactor).coerceIn(lowest, max(lowest, highest))
        camera?.cameraControl?.setZoomRatio(ratio)
        showZoom(ratio)
        return true
      }
    })
    overlay.setOnTouchListener { view, event ->
      if (event.actionMasked == MotionEvent.ACTION_UP) view.performClick()
      pinch.onTouchEvent(event)
      if (!pinch.isInProgress && event.pointerCount == 1) {
        focus.onTouchEvent(event)
      }
      true
    }
    zoomLabel = label("", 13f, ScannerColors.TEXT, bold = true).apply {
      background = rounded(ScannerColors.PANEL, dp(14f))
      setPadding(px(12f), 0, px(12f), 0)
      alpha = 0f
    }

    val top = row().apply { setPadding(px(16f), 0, px(16f), 0) }
    top.addSized(iconButton(R.drawable.edoc_close, "Close") { goBack() }, 44f)
    top.addView(spacer())
    modeLabel = label("Auto", 14f, ScannerColors.TEXT, bold = true).apply {
      background = rounded(ScannerColors.GLASS, dp(16f))
      setPadding(px(16f), 0, px(16f), 0)
      setOnClickListener { setAuto(!auto) }
    }
    top.addView(modeLabel, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, px(32f)))
    top.addView(spacer())
    torchButton = iconButton(R.drawable.edoc_flash_off, "Light") { setTorch(!torch) }
    top.addSized(torchButton, 44f)
    cameraLayer.addView(top, frame(ViewGroup.LayoutParams.MATCH_PARENT, px(64f), Gravity.TOP))

    val bottom = FrameLayout(this)
    val thumbFrame = FrameLayout(this).apply {
      background = rounded(ScannerColors.GLASS, dp(10f))
      visibility = View.INVISIBLE
      setOnClickListener { if (pages.isNotEmpty()) showReview(pages.size - 1) }
    }
    thumb = ImageView(this).apply {
      scaleType = ImageView.ScaleType.CENTER_CROP
      clipToOutline = true
      background = rounded(ScannerColors.GLASS, dp(10f))
    }
    thumbFrame.addView(thumb, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    badge = label("0", 11f, ScannerColors.TEXT, bold = true).apply {
      background = rounded(ScannerColors.ACCENT, dp(10f))
    }
    thumbFrame.addView(badge, frame(px(20f), px(20f), Gravity.TOP or Gravity.END, intArrayOf(0, -px(6f), -px(6f), 0)))
    thumbFrame.clipChildren = false
    bottom.clipChildren = false
    bottom.addView(thumbFrame, frame(px(52f), px(66f), Gravity.START or Gravity.CENTER_VERTICAL, intArrayOf(px(28f), 0, 0, 0)))
    shutter = ShutterButton(this).apply {
      contentDescription = "Take photo"
      isClickable = true
      setOnClickListener { takePhoto() }
    }
    bottom.addView(shutter, frame(px(76f), px(76f), Gravity.CENTER))
    doneButton = iconButton(R.drawable.edoc_check, "Done", 52f, ScannerColors.ACCENT) {
      if (pages.isNotEmpty()) showReview(pages.size - 1)
    }.apply { visibility = View.INVISIBLE }
    bottom.addView(doneButton, frame(px(52f), px(52f), Gravity.END or Gravity.CENTER_VERTICAL, intArrayOf(0, 0, px(28f), 0)))
    cameraLayer.addView(bottom, frame(ViewGroup.LayoutParams.MATCH_PARENT, px(128f), Gravity.BOTTOM))
    cameraLayer.addView(zoomLabel, frame(ViewGroup.LayoutParams.WRAP_CONTENT, px(28f), Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL, intArrayOf(0, 0, 0, px(140f))))

    root.addView(cameraLayer, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
  }

  private fun buildReview() {
    reviewLayer = FrameLayout(this).apply { visibility = View.GONE }
    pageImage = ZoomImageView(this).apply { onSwipe = { step -> showPage(current + step) } }
    reviewLayer.addView(pageImage, frame(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.TOP, intArrayOf(px(16f), px(68f), px(16f), px(150f))))

    val top = row().apply { setPadding(px(16f), 0, px(16f), 0) }
    top.addSized(iconButton(R.drawable.edoc_back, "Back") { goBack() }, 44f)
    top.addView(spacer())
    counter = label("", 15f, ScannerColors.DIM, bold = true)
    top.addView(counter)
    top.addView(spacer())
    val save = label("Save", 15f, ScannerColors.TEXT, bold = true).apply {
      background = rounded(ScannerColors.ACCENT, dp(18f))
      setPadding(px(20f), 0, px(20f), 0)
      setOnClickListener { save() }
    }
    top.addView(save, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, px(36f)))
    reviewLayer.addView(top, frame(ViewGroup.LayoutParams.MATCH_PARENT, px(64f), Gravity.TOP))

    val chips = row(Gravity.CENTER)
    for ((style, name) in STYLES) {
      val chip = label(name, 13f, ScannerColors.TEXT, bold = true).apply {
        setPadding(px(14f), 0, px(14f), 0)
        setOnClickListener { setStyle(style) }
      }
      styleChips[style] = chip
      chips.addView(chip, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, px(32f)).apply { setMargins(px(4f), 0, px(4f), 0) })
    }
    reviewLayer.addView(chips, frame(ViewGroup.LayoutParams.MATCH_PARENT, px(40f), Gravity.BOTTOM, intArrayOf(0, 0, 0, px(92f))))

    val tools = row(Gravity.CENTER)
    tools.addSized(iconButton(R.drawable.edoc_crop, "Crop") { startCrop() }, 52f)
    tools.addView(View(this), LinearLayout.LayoutParams(px(22f), 1))
    tools.addSized(iconButton(R.drawable.edoc_rotate, "Rotate") { rotatePage() }, 52f)
    tools.addView(View(this), LinearLayout.LayoutParams(px(22f), 1))
    tools.addSized(iconButton(R.drawable.edoc_delete, "Delete") { deletePage() }, 52f)
    addButton = iconButton(R.drawable.edoc_add, "Add pages") { showCamera() }
    tools.addView(View(this), LinearLayout.LayoutParams(px(22f), 1))
    tools.addSized(addButton, 52f)
    reviewLayer.addView(tools, frame(ViewGroup.LayoutParams.MATCH_PARENT, px(76f), Gravity.BOTTOM, intArrayOf(0, 0, 0, px(12f))))

    root.addView(reviewLayer, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
  }

  private fun buildCrop() {
    cropLayer = FrameLayout(this).apply { visibility = View.GONE }
    cropView = CropView(this)
    cropLayer.addView(cropView, frame(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.TOP, intArrayOf(0, px(8f), 0, px(96f))))
    val bar = row().apply { setPadding(px(28f), 0, px(28f), 0) }
    bar.addSized(iconButton(R.drawable.edoc_close, "Cancel") { endCrop(apply = false) }, 52f)
    bar.addView(spacer())
    bar.addSized(iconButton(R.drawable.edoc_full, "Whole photo") { toggleWholePhoto() }, 52f)
    bar.addView(spacer())
    bar.addSized(iconButton(R.drawable.edoc_check, "Apply", 52f, ScannerColors.ACCENT) { endCrop(apply = true) }, 52f)
    cropLayer.addView(bar, frame(ViewGroup.LayoutParams.MATCH_PARENT, px(84f), Gravity.BOTTOM))
    root.addView(cropLayer, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
  }

  // ---- Camera ----

  private fun startCamera() {
    val future = ProcessCameraProvider.getInstance(this)
    future.addListener({
      val provider = try {
        future.get()
      } catch (error: Exception) {
        finishWith(RESULT_NO_CAMERA)
        return@addListener
      }
      val fourThree = AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY
      val rotation = previewView.display?.rotation ?: Surface.ROTATION_0
      val preview = Preview.Builder()
        .setResolutionSelector(ResolutionSelector.Builder().setAspectRatioStrategy(fourThree).build())
        .setTargetRotation(rotation)
        .build()
      preview.setSurfaceProvider(previewView.surfaceProvider)
      val analysis = ImageAnalysis.Builder()
        .setResolutionSelector(
          ResolutionSelector.Builder()
            .setAspectRatioStrategy(fourThree)
            .setResolutionStrategy(ResolutionStrategy(android.util.Size(640, 480), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
            .build(),
        )
        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
        .setTargetRotation(rotation)
        .build()
      analysis.setAnalyzer(analyzer) { image -> analyze(image) }
      // Twelve megapixels at most: plenty for a page, and safe for memory.
      val capture = ImageCapture.Builder()
        .setResolutionSelector(
          ResolutionSelector.Builder()
            .setAspectRatioStrategy(fourThree)
            .setResolutionStrategy(ResolutionStrategy(android.util.Size(4032, 3024), ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER))
            .build(),
        )
        .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
        .setJpegQuality(95)
        .build()
      try {
        provider.unbindAll()
        camera = provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis, capture)
      } catch (error: Exception) {
        finishWith(RESULT_NO_CAMERA)
        return@addListener
      }
      this.preview = preview
      this.analysis = analysis
      this.imageCapture = capture
      torchButton.visibility = if (camera?.cameraInfo?.hasFlashUnit() == true) View.VISIBLE else View.INVISIBLE
    }, ContextCompat.getMainExecutor(this))
  }

  // Shows the zoom level for a moment while pinching.
  private fun showZoom(ratio: Float) {
    zoomLabel.text = String.format(java.util.Locale.US, "%.1f×", ratio)
    zoomLabel.animate().cancel()
    zoomLabel.alpha = 1f
    zoomLabel.animate().alpha(0f).setStartDelay(900).setDuration(300).start()
  }

  private fun setTorch(on: Boolean) {
    torch = on
    camera?.cameraControl?.enableTorch(on)
    torchButton.setImageResource(if (on) R.drawable.edoc_flash_on else R.drawable.edoc_flash_off)
  }

  private fun setAuto(on: Boolean) {
    auto = on
    modeLabel.text = if (on) "Auto" else "Manual"
    stableSince = SystemClock.uptimeMillis()
  }

  private fun analyze(image: ImageProxy) {
    try {
      val now = SystemClock.uptimeMillis()
      if (!analysing || now - lastAnalysis < 80) {
        return
      }
      lastAnalysis = now
      val full = colour(image)
      // Google's subject mask from the whole frame (it wants 512 pixels or more), the rest from
      // a smaller copy.
      val picture = Bitmap.createBitmap(full.cols(), full.rows(), Bitmap.Config.ARGB_8888)
      Utils.matToBitmap(full, picture)
      val subject = Foreground.mask(picture)?.let { DocumentDetector.Mask(it, picture.width, picture.height) }
      picture.recycle()
      val scale = ANALYSIS_SIDE.toDouble() / max(full.cols(), full.rows())
      val rgb = Mat()
      Imgproc.resize(full, rgb, Size(), scale, scale, Imgproc.INTER_AREA)
      full.release()
      val gray = Mat()
      Imgproc.cvtColor(rgb, gray, Imgproc.COLOR_RGB2GRAY)
      val found = DocumentDetector.find(rgb, gray, subject)
      val width = gray.cols().toFloat()
      val height = gray.rows().toFloat()
      rgb.release()
      gray.release()
      val normalized = found?.let { DocumentDetector.normalized(it, width, height) }
      val rotation = image.imageInfo.rotationDegrees
      runOnUiThread { onFrame(normalized, width / height, rotation) }
    } catch (error: Exception) {
      // A frame that cannot be read is skipped.
    } finally {
      image.close()
    }
  }

  // A camera frame in colour, turned upright for the screen.
  private fun colour(image: ImageProxy): Mat {
    val width = image.width
    val height = image.height
    // The frame's planes rearranged as NV21 (brightness, then interleaved colour), which OpenCV
    // converts to RGB in one step.
    val nv21 = ByteArray(width * height * 3 / 2)
    val luma = image.planes[0]
    val lumaBuffer = luma.buffer
    for (line in 0 until height) {
      lumaBuffer.position(line * luma.rowStride)
      lumaBuffer.get(nv21, line * width, width)
    }
    val u = image.planes[1]
    val v = image.planes[2]
    val uBuffer = u.buffer
    val vBuffer = v.buffer
    var position = width * height
    for (line in 0 until height / 2) {
      for (column in 0 until width / 2) {
        nv21[position++] = vBuffer.get(line * v.rowStride + column * v.pixelStride)
        nv21[position++] = uBuffer.get(line * u.rowStride + column * u.pixelStride)
      }
    }
    val yuv = Mat(height * 3 / 2, width, CvType.CV_8UC1)
    yuv.put(0, 0, nv21)
    val full = Mat()
    Imgproc.cvtColor(yuv, full, Imgproc.COLOR_YUV2RGB_NV21)
    yuv.release()
    val code = when (image.imageInfo.rotationDegrees) {
      90 -> Core.ROTATE_90_CLOCKWISE
      180 -> Core.ROTATE_180
      270 -> Core.ROTATE_90_COUNTERCLOCKWISE
      else -> return full
    }
    val upright = Mat()
    Core.rotate(full, upright, code)
    full.release()
    return upright
  }
  private fun spread(a: FloatArray, b: FloatArray): Float {
    var largest = 0f
    for (index in a.indices) {
      largest = max(largest, abs(a[index] - b[index]))
    }
    return largest
  }

  // The outline follows the page smoothly. A different outline replaces it only after it has
  // shown up in several frames in a row, and a page missing for a frame or two keeps its outline,
  // so the outline no longer jumps between the page and things around it.
  private fun onFrame(found: FloatArray?, aspect: Float, rotation: Int) {
    if (!analysing || cameraLayer.visibility != View.VISIBLE) {
      return
    }
    analysisRotation = rotation
    frameAspect = aspect
    val now = SystemClock.uptimeMillis()
    val current = tracked
    if (found != null) {
      misses = 0
      val difference = current?.let { spread(it, found) }
      if (current != null && difference != null && difference < 0.06f) {
        if (difference > 0.015f) {
          stableSince = now
        }
        for (index in current.indices) {
          current[index] += (found[index] - current[index]) * 0.35f
        }
        challenger = null
      } else {
        val rival = challenger
        if (rival != null && spread(rival, found) < 0.05f) {
          challengerFrames++
        } else {
          challenger = found
          challengerFrames = 1
        }
        if (challengerFrames >= (if (current == null) 2 else 3)) {
          tracked = found.copyOf()
          challenger = null
          stableSince = now
        }
      }
    } else if (++misses > 8) {
      tracked = null
      challenger = null
      stableSince = now
    }
    corners = tracked
    overlay.show(tracked, aspect)
    // After a capture, the next one waits for the page to be taken away or clearly moved.
    capturedCorners?.let { captured ->
      val shown = tracked
      if ((shown == null && misses > 8) || (shown != null && spread(captured, shown) > 0.25f)) {
        armed = true
        capturedCorners = null
      }
    }
    val progress = if (auto && armed && !capturing && tracked != null) {
      ((now - stableSince).toFloat() / AUTO_HOLD_MS).coerceIn(0f, 1f)
    } else {
      0f
    }
    if (!capturing) {
      shutter.progress = progress
      overlay.progress = progress
    }
    if (progress >= 1f) {
      takePhoto()
    }
  }
  private fun captureRotation(): Int {
    val screen = previewView.display?.rotation ?: Surface.ROTATION_0
    return when (deviceOrientation) {
      90 -> Surface.ROTATION_270
      270 -> Surface.ROTATION_90
      180 -> if (screen == Surface.ROTATION_180) Surface.ROTATION_180 else Surface.ROTATION_0
      else -> Surface.ROTATION_0
    }
  }

  // Focuses and sets the exposure on the page first (for at most a little over a second), then
  // takes the photo, so pages come out sharp.
  private fun takePhoto() {
    val capture = imageCapture ?: return
    if (capturing || (maxPages > 0 && pages.size >= maxPages)) {
      return
    }
    capturing = true
    armed = false
    val previewCorners = corners?.copyOf()
    capturedCorners = previewCorners ?: capturedCorners
    val previewRotation = analysisRotation
    shutter.progress = 1f
    var started = false
    val shoot = {
      if (!started) {
        started = true
        shoot(capture, previewCorners, previewRotation)
      }
    }
    val control = camera?.cameraControl
    if (control == null) {
      shoot()
      return
    }
    val frame = fittedRect(previewView.width.toFloat(), previewView.height.toFloat(), frameAspect)
    val centre = previewCorners?.let { points ->
      floatArrayOf((points[0] + points[2] + points[4] + points[6]) / 4f, (points[1] + points[3] + points[5] + points[7]) / 4f)
    } ?: floatArrayOf(0.5f, 0.5f)
    val point = previewView.meteringPointFactory.createPoint(
      frame.left + centre[0] * frame.width(),
      frame.top + centre[1] * frame.height(),
    )
    val action = FocusMeteringAction.Builder(point, FocusMeteringAction.FLAG_AF or FocusMeteringAction.FLAG_AE)
      .setAutoCancelDuration(3, TimeUnit.SECONDS)
      .build()
    control.startFocusAndMetering(action).addListener({ shoot() }, ContextCompat.getMainExecutor(this))
    root.postDelayed({ shoot() }, 1300)
  }

  private fun shoot(capture: ImageCapture, previewCorners: FloatArray?, previewRotation: Int) {
    shutter.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
    flashView.alpha = 0.8f
    flashView.animate().alpha(0f).setDuration(220).start()
    capture.targetRotation = captureRotation()
    capture.takePicture(worker, object : ImageCapture.OnImageCapturedCallback() {
      override fun onCaptureSuccess(image: ImageProxy) {
        val rotation = image.imageInfo.rotationDegrees
        val data = try {
          val buffer = image.planes[0].buffer
          ByteArray(buffer.remaining()).also { buffer.get(it) }
        } finally {
          image.close()
        }
        val page = try {
          preparePage(data, rotation, previewCorners, previewRotation)
        } catch (error: Throwable) {
          null
        }
        runOnUiThread {
          capturing = false
          shutter.progress = 0f
          if (page != null) {
            added(page)
          }
        }
      }

      override fun onError(exception: ImageCaptureException) {
        runOnUiThread {
          capturing = false
          shutter.progress = 0f
        }
      }
    })
  }
  // ---- Pages ----

  private fun decode(file: File, maxSide: Int): Bitmap {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) {
      sample *= 2
    }
    return BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })
      ?: throw IllegalStateException("Cannot read the page")
  }

  private fun turned(source: Bitmap, quarterTurns: Int): Bitmap {
    val turns = ((quarterTurns % 4) + 4) % 4
    if (turns == 0) {
      return source
    }
    val matrix = Matrix().apply { postRotate(90f * turns) }
    return Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrix, true)
  }

  // Corners from the preview, which is upright for the screen, carried over to the photo,
  // which is upright for the way the phone is held.
  private fun carried(points: FloatArray, quarterTurns: Int): FloatArray {
    var result = points.copyOf()
    repeat(((quarterTurns % 4) + 4) % 4) {
      val next = FloatArray(8)
      for (corner in 0 until 4) {
        next[corner * 2] = 1f - result[corner * 2 + 1]
        next[corner * 2 + 1] = result[corner * 2]
      }
      // The corner that was bottom left is now top left.
      result = FloatArray(8) { index -> next[((index / 2 + 3) % 4) * 2 + index % 2] }
    }
    return result
  }

  private fun preparePage(data: ByteArray, rotation: Int, previewCorners: FloatArray?, previewRotation: Int): Page {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(data, 0, data.size, bounds)
    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= PHOTO_SIDE) {
      sample *= 2
    }
    val decoded = BitmapFactory.decodeByteArray(data, 0, data.size, BitmapFactory.Options().apply { inSampleSize = sample })
      ?: throw IllegalStateException("Cannot read the photo")
    val photo = turned(decoded, rotation / 90)
    if (photo !== decoded) {
      decoded.recycle()
    }
    val file = File(workDir, "photo-${System.nanoTime()}.jpg")
    file.outputStream().use { photo.compress(Bitmap.CompressFormat.JPEG, 92, it) }

    val detected = DocumentDetector.find(photo, 900)
      ?: previewCorners?.let { carried(it, (rotation - previewRotation + 360) % 360 / 90) }
      ?: DocumentDetector.fullFrame.copyOf()
    val page = Page(file, detected.copyOf(), detected.copyOf())
    render(page, photo)
    photo.recycle()
    return page
  }

  // Straightens, turns and cleans up a page, and saves the result.
  private fun render(page: Page, photo: Bitmap? = null) {
    val source = photo ?: decode(page.photo, PHOTO_SIDE)
    val straight = DocumentDetector.straighten(source, page.corners)
    if (source !== photo) {
      source.recycle()
    }
    val upright = turned(straight, page.turns)
    if (upright !== straight) {
      straight.recycle()
    }
    val clean = DocumentDetector.cleanUp(upright, page.style)
    upright.recycle()
    val file = File(workDir, "page-${System.nanoTime()}.jpg")
    file.outputStream().use { clean.compress(Bitmap.CompressFormat.JPEG, 90, it) }
    page.output?.delete()
    page.output = file
    val ratio = 220f / max(clean.width, clean.height)
    page.thumb = Bitmap.createScaledBitmap(clean, max(1, (clean.width * ratio).roundToInt()), max(1, (clean.height * ratio).roundToInt()), true)
    clean.recycle()
  }

  // A page brought back from an earlier scan: already straightened and cleaned up, so it is
  // kept as it is unless cropped, turned or restyled.
  private fun existingPage(uri: String): Page {
    val source = File(Uri.parse(uri).path ?: uri)
    val photo = File(workDir, "photo-${System.nanoTime()}.jpg")
    source.copyTo(photo, overwrite = true)
    val page = Page(photo, DocumentDetector.fullFrame.copyOf(), DocumentDetector.fullFrame.copyOf())
    page.style = "original"
    val output = File(workDir, "page-${System.nanoTime()}.jpg")
    source.copyTo(output, overwrite = true)
    page.output = output
    val shown = decode(output, 220)
    val ratio = 220f / max(shown.width, shown.height)
    page.thumb = if (ratio < 1f) {
      Bitmap.createScaledBitmap(shown, max(1, (shown.width * ratio).roundToInt()), max(1, (shown.height * ratio).roundToInt()), true).also { shown.recycle() }
    } else {
      shown
    }
    return page
  }

  private fun added(page: Page) {
    pages.add(page)
    updateCameraBar()
    if (maxPages > 0 && pages.size >= maxPages) {
      showReview(pages.size - 1)
    }
  }

  private fun updateCameraBar() {
    val last = pages.lastOrNull()
    (thumb.parent as View).visibility = if (last == null) View.INVISIBLE else View.VISIBLE
    doneButton.visibility = if (last == null) View.INVISIBLE else View.VISIBLE
    thumb.setImageBitmap(last?.thumb)
    badge.text = pages.size.toString()
  }

  // Runs a task on the worker thread behind a spinner, then continues on the screen.
  private fun work(task: () -> Unit, then: () -> Unit) {
    busy.visibility = View.VISIBLE
    worker.execute {
      try {
        task()
      } catch (error: Throwable) {
        // The page keeps its previous version.
      }
      runOnUiThread {
        busy.visibility = View.GONE
        then()
      }
    }
  }

  // ---- Screens ----

  private fun showCamera() {
    reviewLayer.visibility = View.GONE
    cropLayer.visibility = View.GONE
    cameraLayer.visibility = View.VISIBLE
    analysing = true
    armed = capturedCorners == null
    stableSince = SystemClock.uptimeMillis()
    updateCameraBar()
  }

  private fun showReview(index: Int) {
    analysing = false
    overlay.show(null, 0.75f)
    shutter.progress = 0f
    if (torch) setTorch(false)
    cameraLayer.visibility = View.GONE
    cropLayer.visibility = View.GONE
    reviewLayer.visibility = View.VISIBLE
    showPage(index)
  }

  private fun showPage(index: Int) {
    if (pages.isEmpty()) {
      showCamera()
      return
    }
    current = index.coerceIn(0, pages.size - 1)
    val page = pages[current]
    counter.text = "${current + 1} / ${pages.size}"
    val shown = page.output?.let { decode(it, 1600) }
    pageImage.setImageBitmap(shown)
    for ((style, chip) in styleChips) {
      val on = style == page.style
      chip.background = rounded(if (on) ScannerColors.ACCENT else ScannerColors.GLASS, dp(16f))
      chip.setTextColor(if (on) ScannerColors.TEXT else ScannerColors.DIM)
    }
    addButton.visibility = if (maxPages > 0 && pages.size >= maxPages) View.GONE else View.VISIBLE
  }

  private fun setStyle(style: String) {
    val page = pages.getOrNull(current) ?: return
    if (page.style == style) {
      return
    }
    page.style = style
    work({ render(page) }) { showPage(current) }
  }

  private fun rotatePage() {
    val page = pages.getOrNull(current) ?: return
    page.turns = (page.turns + 1) % 4
    work({ render(page) }) { showPage(current) }
  }

  private fun deletePage() {
    val page = pages.getOrNull(current) ?: return
    pages.removeAt(current)
    worker.execute {
      page.photo.delete()
      page.output?.delete()
    }
    if (pages.isEmpty()) showCamera() else showPage(current)
  }

  private fun startCrop() {
    val page = pages.getOrNull(current) ?: return
    cropping = page
    work({ cropPhoto = decode(page.photo, 2000) }) {
      val photo = cropPhoto ?: return@work
      cropView.show(photo, page.corners)
      reviewLayer.visibility = View.GONE
      cropLayer.visibility = View.VISIBLE
    }
  }

  private fun toggleWholePhoto() {
    val page = cropping ?: return
    val whole = DocumentDetector.fullFrame
    cropView.setCorners(if (cropView.corners.contentEquals(whole)) page.detected else whole)
  }

  private fun endCrop(apply: Boolean) {
    val page = cropping ?: return
    cropping = null
    cropLayer.visibility = View.GONE
    reviewLayer.visibility = View.VISIBLE
    val photo = cropPhoto
    cropPhoto = null
    if (apply) {
      page.corners = cropView.corners.copyOf()
      work({ render(page) }) {
        showPage(current)
        photo?.recycle()
      }
    } else {
      photo?.recycle()
    }
  }

  private fun goBack() {
    when {
      cropLayer.visibility == View.VISIBLE -> endCrop(apply = false)
      reviewLayer.visibility == View.VISIBLE -> {
        // With a single page asked for (rescanning a page), going back means taking it again.
        if (maxPages > 0 && pages.size >= maxPages) {
          pages.toList().forEach { page ->
            worker.execute {
              page.photo.delete()
              page.output?.delete()
            }
          }
          pages.clear()
          capturedCorners = null
        }
        showCamera()
      }
      pages.isEmpty() -> finishWith(Activity.RESULT_CANCELED)
      else -> AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
        .setTitle("Discard scans?")
        .setPositiveButton("Discard") { _, _ -> finishWith(Activity.RESULT_CANCELED) }
        .setNegativeButton("Keep", null)
        .show()
    }
  }

  private fun save() {
    if (pages.isEmpty()) {
      return
    }
    val list = pages.toList()
    val uris = ArrayList<String>()
    val widths = IntArray(list.size)
    val heights = IntArray(list.size)
    work({
      outDir.mkdirs()
      val stamp = System.currentTimeMillis()
      list.forEachIndexed { index, page ->
        val output = page.output ?: return@forEachIndexed
        val target = File(outDir, "scan-$stamp-$index.jpg")
        output.copyTo(target, overwrite = true)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(target.path, bounds)
        widths[uris.size] = bounds.outWidth
        heights[uris.size] = bounds.outHeight
        uris.add(Uri.fromFile(target).toString())
      }
    }) {
      val result = Intent()
        .putStringArrayListExtra(RESULT_URIS, uris)
        .putExtra(RESULT_WIDTHS, widths.copyOf(uris.size))
        .putExtra(RESULT_HEIGHTS, heights.copyOf(uris.size))
      setResult(Activity.RESULT_OK, result)
      finish()
    }
  }

  private fun finishWith(code: Int) {
    setResult(code)
    finish()
  }
}
