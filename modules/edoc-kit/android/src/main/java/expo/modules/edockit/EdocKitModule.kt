package expo.modules.edockit

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.util.Base64
import android.view.WindowManager
import androidx.exifinterface.media.ExifInterface
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import com.google.android.gms.common.moduleinstall.ModuleInstall
import com.google.android.gms.common.moduleinstall.ModuleInstallRequest
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private const val SCAN_REQUEST = 4471
private const val OWN_SCAN_REQUEST = 4472
private const val JPEG_QUALITY = 82

class EdocKitModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private var pendingScan: Promise? = null
  private var pendingScanDir: File? = null
  private var pendingMaxPages = 0

  // Google's document scanner, for a device where eDoc's own cannot start. Settles pendingScan.
  private fun startGoogleScanner(activity: Activity, maxPages: Int) {
    val promise = pendingScan ?: return
    val builder = GmsDocumentScannerOptions.Builder()
      .setGalleryImportAllowed(false)
      .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
      .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
    if (maxPages > 0) {
      builder.setPageLimit(maxPages)
    }
    GmsDocumentScanning.getClient(builder.build()).getStartScanIntent(activity)
      .addOnSuccessListener { sender ->
        try {
          activity.startIntentSenderForResult(sender, SCAN_REQUEST, null, 0, 0, 0)
        } catch (error: Exception) {
          pendingScan = null
          promise.reject("ERR_SCAN_FAILED", error.message ?: "The scanner could not be opened", error)
        }
      }
      .addOnFailureListener { error ->
        pendingScan = null
        promise.reject("ERR_SCAN_UNAVAILABLE", error.message ?: "The scanner is not available on this phone", error)
      }
  }

  private fun toFile(value: String): File {
    if (value.startsWith("file:")) {
      return File(Uri.parse(value).path ?: value.removePrefix("file://"))
    }
    return File(value)
  }

  private fun pageInfo(file: File, width: Int, height: Int): Map<String, Any> =
    mapOf("uri" to Uri.fromFile(file).toString(), "width" to width, "height" to height)

  private fun imageSize(file: File): Pair<Int, Int> {
    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, options)
    return options.outWidth to options.outHeight
  }

  // Decodes an image upright (camera photos carry their rotation as metadata), sampling large
  // files down while decoding so a 50-megapixel photo never has to fit in memory at full size.
  private fun decodeUpright(data: ByteArray, maxDimension: Int): Bitmap {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(data, 0, data.size, bounds)
    var sample = 1
    if (maxDimension > 0) {
      while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxDimension) {
        sample *= 2
      }
    }
    val options = BitmapFactory.Options().apply { inSampleSize = sample }
    val decoded = BitmapFactory.decodeByteArray(data, 0, data.size, options)
      ?: throw CodedException("ERR_IMAGE_READ", "Cannot read image", null)

    val orientation = try {
      ExifInterface(ByteArrayInputStream(data))
        .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
    } catch (error: Exception) {
      ExifInterface.ORIENTATION_NORMAL
    }
    val matrix = Matrix()
    when (orientation) {
      ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
      ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
      ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
      ExifInterface.ORIENTATION_TRANSPOSE -> {
        matrix.postRotate(90f)
        matrix.postScale(-1f, 1f)
      }
      ExifInterface.ORIENTATION_TRANSVERSE -> {
        matrix.postRotate(270f)
        matrix.postScale(-1f, 1f)
      }
    }
    val longest = max(decoded.width, decoded.height)
    if (maxDimension > 0 && longest > maxDimension) {
      val ratio = maxDimension.toFloat() / longest
      matrix.postScale(ratio, ratio)
    }
    if (matrix.isIdentity) {
      return decoded
    }
    return Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
  }

  // Draws the bitmap on white with an optional clockwise rotation and colour filter.
  private fun redraw(source: Bitmap, quarterTurns: Int, filter: String): Bitmap {
    val turns = ((quarterTurns % 4) + 4) % 4
    val swapped = turns % 2 == 1
    val width = if (swapped) source.height else source.width
    val height = if (swapped) source.width else source.height
    val result = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(result)
    canvas.drawColor(Color.WHITE)

    val paint = Paint(Paint.FILTER_BITMAP_FLAG)
    val settings = when (filter) {
      "enhance" -> Triple(1.15f, 1.25f, 0.02f)
      "gray" -> Triple(0f, 1.08f, 0f)
      "bw" -> Triple(0f, 1.9f, 0.08f)
      else -> null
    }
    if (settings != null) {
      val (saturation, contrast, brightness) = settings
      val colors = ColorMatrix().apply { setSaturation(saturation) }
      val offset = (1f - contrast) * 127.5f + brightness * 255f
      colors.postConcat(
        ColorMatrix(
          floatArrayOf(
            contrast, 0f, 0f, 0f, offset,
            0f, contrast, 0f, 0f, offset,
            0f, 0f, contrast, 0f, offset,
            0f, 0f, 0f, 1f, 0f
          )
        )
      )
      paint.colorFilter = ColorMatrixColorFilter(colors)
    }

    canvas.translate(width / 2f, height / 2f)
    canvas.rotate(90f * turns)
    canvas.drawBitmap(source, -source.width / 2f, -source.height / 2f, paint)
    return result
  }

  private fun jpeg(bitmap: Bitmap, quality: Int): ByteArray {
    val out = ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)
    return out.toByteArray()
  }

  // Google's scanner turns pages by itself from the text it detects. It gets Arabic pages (and
  // pages shot with the phone lying flat) wrong, upside down or sideways, and offers no way to
  // switch that off. Every page is therefore checked again here: the shape of its printed lines
  // tells sideways from upright in any script, and which way is up. When the page has plenty of
  // Latin text, the text recognizer has the final word on which way is up. When nothing is
  // conclusive, the page is kept as the scanner returned it.
  private fun legibleCharacters(bitmap: Bitmap, quarterTurns: Int, recognizer: TextRecognizer): Int {
    val turned = if (quarterTurns % 4 == 0) bitmap else redraw(bitmap, quarterTurns, "none")
    try {
      val text = Tasks.await(recognizer.process(InputImage.fromBitmap(turned, 0)))
      return text.textBlocks.sumOf { block ->
        block.lines.sumOf { line ->
          val letters = line.text.count { it.isLetterOrDigit() }
          if (letters >= 3) letters else 0
        }
      }
    } finally {
      if (turned !== bitmap) {
        turned.recycle()
      }
    }
  }

  // Clockwise quarter turns that bring a scanned page upright.
  private fun uprightTurns(bitmap: Bitmap): Int {
    val layout = try {
      PageOrientation.read(bitmap)
    } catch (error: Exception) {
      null
    }
    val first = if (layout?.sideways == true) 1 else 0
    val second = first + 2

    val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    val latin = try {
      val longest = max(bitmap.width, bitmap.height)
      val sample = if (longest > 1600) {
        val ratio = 1600f / longest
        Bitmap.createScaledBitmap(bitmap, (bitmap.width * ratio).roundToInt(), (bitmap.height * ratio).roundToInt(), true)
      } else {
        bitmap
      }
      val one = legibleCharacters(sample, first, recognizer)
      val two = legibleCharacters(sample, second, recognizer)
      if (sample !== bitmap) {
        sample.recycle()
      }
      when {
        one >= 40 && one > two * 2 -> first
        two >= 40 && two > one * 2 -> second
        else -> null
      }
    } catch (error: Exception) {
      // The recognition model may not be available yet; the line shape decides alone.
      null
    } finally {
      recognizer.close()
    }
    if (latin != null) {
      return latin % 4
    }
    val upright = layout?.upright ?: return 0
    return (if (upright) first else second) % 4
  }

  // Writes a scanned page upright and returns its size.
  private fun saveUpright(data: ByteArray, file: File): Pair<Int, Int> {
    val upright = decodeUpright(data, 0)
    val turns = uprightTurns(upright)
    val result = if (turns != 0) redraw(upright, turns, "none") else upright
    file.writeBytes(if (result === upright && !hasRotationTag(data)) data else jpeg(result, 90))
    val size = result.width to result.height
    if (result !== upright) {
      result.recycle()
    }
    upright.recycle()
    return size
  }

  private fun hasRotationTag(data: ByteArray): Boolean = try {
    ExifInterface(ByteArrayInputStream(data))
      .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) != ExifInterface.ORIENTATION_NORMAL
  } catch (error: Exception) {
    false
  }

  override fun definition() = ModuleDefinition {
    Name("EdocKit")


    // Presents eDoc's own scanner (live page outline, automatic capture, crop, clean-up). Google's
    // document scanner takes over only if eDoc's cannot start on a device. maxPages 0 means no
    // limit. Resolves with one entry per saved page, or an empty list when cancelled.
    AsyncFunction("scan") { outDir: String, maxPages: Int, promise: Promise ->
      if (pendingScan != null) {
        promise.reject("ERR_SCAN_BUSY", "A scan is already in progress", null)
        return@AsyncFunction
      }
      val activity = appContext.throwingActivity
      pendingScan = promise
      pendingScanDir = toFile(outDir)
      pendingMaxPages = maxPages
      if (!DocumentDetector.load()) {
        startGoogleScanner(activity, maxPages)
        return@AsyncFunction
      }
      val secure = activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0
      val intent = Intent(activity, ScannerActivity::class.java)
        .putExtra(ScannerActivity.EXTRA_OUT_DIR, toFile(outDir).path)
        .putExtra(ScannerActivity.EXTRA_MAX_PAGES, maxPages)
        .putExtra(ScannerActivity.EXTRA_SECURE, secure)
      try {
        activity.startActivityForResult(intent, OWN_SCAN_REQUEST)
      } catch (error: Exception) {
        startGoogleScanner(activity, maxPages)
      }
    }

    OnActivityResult { activity, (requestCode, resultCode, intent) ->
      if (requestCode == OWN_SCAN_REQUEST) {
        val promise = pendingScan ?: return@OnActivityResult
        when (resultCode) {
          Activity.RESULT_OK -> {
            pendingScan = null
            val uris = intent?.getStringArrayListExtra(ScannerActivity.RESULT_URIS).orEmpty()
            val widths = intent?.getIntArrayExtra(ScannerActivity.RESULT_WIDTHS) ?: IntArray(0)
            val heights = intent?.getIntArrayExtra(ScannerActivity.RESULT_HEIGHTS) ?: IntArray(0)
            promise.resolve(uris.mapIndexed { index, uri ->
              mapOf("uri" to uri, "width" to widths.getOrElse(index) { 0 }, "height" to heights.getOrElse(index) { 0 })
            })
          }
          ScannerActivity.RESULT_NO_PERMISSION -> {
            pendingScan = null
            promise.reject("ERR_CAMERA_PERMISSION", "Camera access is off for eDoc. Turn it on in Settings.", null)
          }
          ScannerActivity.RESULT_NO_CAMERA -> startGoogleScanner(activity, pendingMaxPages)
          else -> {
            pendingScan = null
            promise.resolve(emptyList<Map<String, Any>>())
          }
        }
        return@OnActivityResult
      }
      if (requestCode != SCAN_REQUEST) {
        return@OnActivityResult
      }
      val promise = pendingScan ?: return@OnActivityResult
      pendingScan = null
      if (resultCode != Activity.RESULT_OK) {
        promise.resolve(emptyList<Map<String, Any>>())
        return@OnActivityResult
      }
      val directory = pendingScanDir
      val result = GmsDocumentScanningResult.fromActivityResultIntent(intent)
      // Saving and straightening run off the main thread: text recognition must not block it.
      Thread {
        try {
          directory ?: throw CodedException("ERR_SCAN_SAVE", "Nowhere to save the scan", null)
          directory.mkdirs()
          val stamp = System.currentTimeMillis()
          val pages = result?.pages.orEmpty().mapIndexed { index, page ->
            val input = context.contentResolver.openInputStream(page.imageUri)
              ?: throw CodedException("ERR_SCAN_SAVE", "The scanned page cannot be read", null)
            val data = input.use { it.readBytes() }
            val file = File(directory, "scan-$stamp-$index.jpg")
            val (width, height) = saveUpright(data, file)
            pageInfo(file, width, height)
          }
          promise.resolve(pages)
        } catch (error: Exception) {
          promise.reject("ERR_SCAN_SAVE", error.message ?: "The scan could not be saved", error)
        }
      }.start()
    }

    // Asks Google Play services to fetch the text recognition model now, so that the first
    // recognition does not have to wait for it. Does nothing when it is already there.
    AsyncFunction("prepareTextRecognition") {
      val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
      val request = ModuleInstallRequest.newBuilder().addApi(recognizer).build()
      ModuleInstall.getClient(context).installModules(request)
        .addOnCompleteListener { recognizer.close() }
      Unit
    }
    // App storage on Android is already private to the app and left out of backups by the manifest.
    AsyncFunction("secure") { _: String, _: Boolean -> }

    // Keeps the app out of screenshots, screen recordings and the recent-apps preview.
    AsyncFunction("setScreenSecure") { enabled: Boolean ->
      val activity = appContext.currentActivity ?: return@AsyncFunction
      activity.runOnUiThread {
        if (enabled) {
          activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        } else {
          activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
      }
    }

    // On-device text recognition for one image file.
    AsyncFunction("recognizeText") { uri: String ->
      val bitmap = decodeUpright(Vault.read(context, toFile(uri)), 0)
      val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
      try {
        Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, 0))).text
      } finally {
        recognizer.close()
        bitmap.recycle()
      }
    }

    // Re-encodes an image as an upright JPEG, optionally resized, rotated and filtered.
    AsyncFunction("render") { uri: String, outUri: String, quarterTurns: Int, filter: String, maxDimension: Double ->
      val source = decodeUpright(Vault.read(context, toFile(uri)), maxDimension.roundToInt())
      val result = redraw(source, quarterTurns, filter)
      val out = toFile(outUri)
      Vault.write(context, jpeg(result, JPEG_QUALITY), out)
      val info = pageInfo(out, result.width, result.height)
      source.recycle()
      result.recycle()
      info
    }

    // Copies a file, decrypting the source and encrypting the destination as their names require.
    AsyncFunction("transcode") { uri: String, outUri: String ->
      Vault.write(context, Vault.read(context, toFile(uri)), toFile(outUri))
    }

    // Returns an image as base64 JPEG without writing a decrypted copy to disk.
    // maxDimension 0 returns the stored image unchanged.
    AsyncFunction("readImage") { uri: String, maxDimension: Double ->
      val data = Vault.read(context, toFile(uri))
      if (maxDimension > 0) {
        val small = decodeUpright(data, maxDimension.roundToInt())
        val encoded = Base64.encodeToString(jpeg(small, 70), Base64.NO_WRAP)
        small.recycle()
        encoded
      } else {
        Base64.encodeToString(data, Base64.NO_WRAP)
      }
    }

    AsyncFunction("isSealedArchive") { uri: String ->
      Vault.isSealedArchive(toFile(uri))
    }

    // Encrypts a backup archive with a password.
    AsyncFunction("sealArchive") { uri: String, outUri: String, password: String ->
      Vault.sealArchive(toFile(uri), toFile(outUri), password)
    }

    // Decrypts a password-protected backup archive; fails on a wrong password.
    AsyncFunction("openArchive") { uri: String, outUri: String, password: String ->
      Vault.openArchive(toFile(uri), toFile(outUri), password)
    }

    // Rasterises every page of a PDF to a JPEG in outDir.
    AsyncFunction("pdfToImages") { uri: String, outDir: String ->
      val directory = toFile(outDir)
      directory.mkdirs()
      val stamp = System.currentTimeMillis()
      val pages = mutableListOf<Map<String, Any>>()
      val descriptor = ParcelFileDescriptor.open(toFile(uri), ParcelFileDescriptor.MODE_READ_ONLY)
      val renderer = try {
        PdfRenderer(descriptor)
      } catch (error: SecurityException) {
        descriptor.close()
        throw CodedException("ERR_PDF_LOCKED", "This PDF is password protected", error)
      } catch (error: Exception) {
        descriptor.close()
        throw CodedException("ERR_PDF_READ", "Cannot open PDF", error)
      }
      renderer.use {
        for (index in 0 until renderer.pageCount) {
          renderer.openPage(index).use { page ->
            val longest = max(page.width, page.height).coerceAtLeast(1)
            val scale = min(3.0, 2400.0 / longest)
            val width = max(1, (page.width * scale).roundToInt())
            val height = max(1, (page.height * scale).roundToInt())
            val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            bitmap.eraseColor(Color.WHITE)
            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
            val file = File(directory, "pdf-$stamp-$index.jpg")
            file.writeBytes(jpeg(bitmap, JPEG_QUALITY))
            bitmap.recycle()
            pages.add(pageInfo(file, width, height))
          }
        }
      }
      pages
    }

    // Builds a PDF with one page per image, embedding the JPEG data as-is.
    // A non-empty password encrypts the PDF.
    AsyncFunction("makePdf") { uris: List<String>, outUri: String, password: String ->
      val out = toFile(outUri)
      PdfWriter.write(uris.map { Vault.read(context, toFile(it)) }, out, password)
      Uri.fromFile(out).toString()
    }
  }
}
