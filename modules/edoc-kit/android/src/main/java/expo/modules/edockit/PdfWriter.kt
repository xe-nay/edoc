package expo.modules.edockit

import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

// Minimal PDF writer: one page per JPEG, with the JPEG data embedded as-is (no re-encoding).
// With a password, the file is encrypted with the standard PDF security handler
// (version 4, revision 4, AES-128), which every common PDF reader can open.
internal object PdfWriter {
  private class JpegInfo(val width: Int, val height: Int, val components: Int)

  private class Counting(private val out: OutputStream) {
    var position = 0L
      private set

    fun write(bytes: ByteArray) {
      out.write(bytes)
      position += bytes.size
    }

    fun write(text: String) = write(text.toByteArray(Charsets.ISO_8859_1))
  }

  // --- Standard security handler ------------------------------------------------

  // Padding string defined by the PDF specification.
  private val PAD = intArrayOf(
    0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41, 0x64, 0x00, 0x4E, 0x56, 0xFF, 0xFA, 0x01, 0x08,
    0x2E, 0x2E, 0x00, 0xB6, 0xD0, 0x68, 0x3E, 0x80, 0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A
  ).map { it.toByte() }.toByteArray()

  // All permissions granted; the two lowest bits must be zero.
  private const val PERMISSIONS = -4
  private const val KEY_LENGTH = 16

  private class Encryption(val key: ByteArray, val owner: ByteArray, val user: ByteArray, val id: ByteArray) {
    private val random = SecureRandom()

    // Each object is encrypted with its own key derived from the file key and its number.
    fun seal(data: ByteArray, objectNumber: Int): ByteArray {
      val digest = MessageDigest.getInstance("MD5")
      digest.update(key)
      digest.update(
        byteArrayOf(
          objectNumber.toByte(), (objectNumber shr 8).toByte(), (objectNumber shr 16).toByte(),
          0, 0,
          0x73, 0x41, 0x6C, 0x54
        )
      )
      val objectKey = digest.digest().copyOf(KEY_LENGTH)
      val iv = ByteArray(16).also { random.nextBytes(it) }
      val cipher = Cipher.getInstance("AES/CBC/PKCS5Padding")
      cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(objectKey, "AES"), IvParameterSpec(iv))
      return iv + cipher.doFinal(data)
    }
  }

  private fun md5(vararg parts: ByteArray): ByteArray {
    val digest = MessageDigest.getInstance("MD5")
    parts.forEach { digest.update(it) }
    return digest.digest()
  }

  private fun rc4(key: ByteArray, data: ByteArray): ByteArray {
    val state = IntArray(256) { it }
    var j = 0
    for (i in 0 until 256) {
      j = (j + state[i] + (key[i % key.size].toInt() and 0xFF)) and 0xFF
      val swap = state[i]
      state[i] = state[j]
      state[j] = swap
    }
    val out = ByteArray(data.size)
    var i = 0
    j = 0
    for (n in data.indices) {
      i = (i + 1) and 0xFF
      j = (j + state[i]) and 0xFF
      val swap = state[i]
      state[i] = state[j]
      state[j] = swap
      out[n] = (data[n].toInt() xor state[(state[i] + state[j]) and 0xFF]).toByte()
    }
    return out
  }

  private fun xorKey(key: ByteArray, value: Int) = ByteArray(key.size) { (key[it].toInt() xor value).toByte() }

  private fun padded(password: String): ByteArray {
    val bytes = password.toByteArray(Charsets.ISO_8859_1)
    return (bytes + PAD).copyOf(32)
  }

  // The same password is used as the user and the owner password.
  private fun encryption(password: String): Encryption {
    val id = ByteArray(16).also { SecureRandom().nextBytes(it) }
    val pad = padded(password)

    // Owner entry (algorithm 3 of the specification).
    var ownerDigest = md5(pad)
    repeat(50) { ownerDigest = md5(ownerDigest) }
    val ownerKey = ownerDigest.copyOf(KEY_LENGTH)
    var owner = rc4(ownerKey, pad)
    for (round in 1..19) {
      owner = rc4(xorKey(ownerKey, round), owner)
    }

    // File encryption key (algorithm 2).
    val permissions = byteArrayOf(
      PERMISSIONS.toByte(), (PERMISSIONS shr 8).toByte(), (PERMISSIONS shr 16).toByte(), (PERMISSIONS shr 24).toByte()
    )
    var keyDigest = md5(pad, owner, permissions, id)
    repeat(50) { keyDigest = md5(keyDigest.copyOf(KEY_LENGTH)) }
    val key = keyDigest.copyOf(KEY_LENGTH)

    // User entry (algorithm 5).
    var user = rc4(key, md5(PAD, id))
    for (round in 1..19) {
      user = rc4(xorKey(key, round), user)
    }
    return Encryption(key, owner, user.copyOf(32), id)
  }

  private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02X".format(it) }

  // --- JPEG and document ----------------------------------------------------------

  // Reads the size and channel count from the JPEG's start-of-frame segment.
  private fun inspect(data: ByteArray): JpegInfo? {
    if (data.size < 4 || data[0] != 0xFF.toByte() || data[1] != 0xD8.toByte()) {
      return null
    }
    var at = 2
    while (at + 9 < data.size) {
      if (data[at] != 0xFF.toByte()) {
        return null
      }
      val marker = data[at + 1].toInt() and 0xFF
      if (marker == 0xFF) {
        at += 1
        continue
      }
      if (marker == 0xD8 || (marker in 0xD0..0xD7) || marker == 0x01) {
        at += 2
        continue
      }
      val length = ((data[at + 2].toInt() and 0xFF) shl 8) or (data[at + 3].toInt() and 0xFF)
      val isFrame = marker in 0xC0..0xCF && marker != 0xC4 && marker != 0xC8 && marker != 0xCC
      if (isFrame) {
        val height = ((data[at + 5].toInt() and 0xFF) shl 8) or (data[at + 6].toInt() and 0xFF)
        val width = ((data[at + 7].toInt() and 0xFF) shl 8) or (data[at + 8].toInt() and 0xFF)
        return JpegInfo(width, height, data[at + 9].toInt() and 0xFF)
      }
      at += 2 + length
    }
    return null
  }

  fun write(pages: List<ByteArray>, destination: File, password: String) {
    destination.parentFile?.mkdirs()
    val usable = pages.mapNotNull { data -> inspect(data)?.takeIf { it.width > 0 && it.height > 0 }?.let { data to it } }
    val encryption = if (password.isEmpty()) null else encryption(password)

    FileOutputStream(destination).buffered().use { stream ->
      val out = Counting(stream)
      // Object numbers: 1 catalog, 2 page tree, three per page (page, image, content),
      // then the encryption dictionary when there is a password.
      val encryptObject = 3 + usable.size * 3
      val offsets = LongArray(encryptObject + if (encryption != null) 1 else 0)

      out.write("%PDF-1.6\n%âãÏÓ\n")
      offsets[1] = out.position
      out.write("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")

      offsets[2] = out.position
      val kids = usable.indices.joinToString(" ") { "${3 + it * 3} 0 R" }
      out.write("2 0 obj\n<< /Type /Pages /Kids [$kids] /Count ${usable.size} >>\nendobj\n")

      usable.forEachIndexed { index, (data, info) ->
        val pageObject = 3 + index * 3
        val imageObject = pageObject + 1
        val contentObject = pageObject + 2
        // A4 width (portrait) or A4 height (landscape); the other side follows the image's proportions.
        val pageWidth = if (info.width > info.height) 842.0 else 595.0
        val pageHeight = pageWidth * info.height / info.width
        val widthText = "%.2f".format(java.util.Locale.US, pageWidth)
        val heightText = "%.2f".format(java.util.Locale.US, pageHeight)

        offsets[pageObject] = out.position
        out.write(
          "$pageObject 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 $widthText $heightText] " +
            "/Resources << /XObject << /Im0 $imageObject 0 R >> >> /Contents $contentObject 0 R >>\nendobj\n"
        )

        val colorSpace = when (info.components) {
          1 -> "/DeviceGray"
          4 -> "/DeviceCMYK /Decode [1 0 1 0 1 0 1 0]"
          else -> "/DeviceRGB"
        }
        val image = encryption?.seal(data, imageObject) ?: data
        offsets[imageObject] = out.position
        out.write(
          "$imageObject 0 obj\n<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} " +
            "/ColorSpace $colorSpace /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.size} >>\nstream\n"
        )
        out.write(image)
        out.write("\nendstream\nendobj\n")

        // Scales the unit image square to the full page.
        val drawing = "q\n$widthText 0 0 $heightText 0 0 cm\n/Im0 Do\nQ\n".toByteArray(Charsets.ISO_8859_1)
        val content = encryption?.seal(drawing, contentObject) ?: drawing
        offsets[contentObject] = out.position
        out.write("$contentObject 0 obj\n<< /Length ${content.size} >>\nstream\n")
        out.write(content)
        out.write("\nendstream\nendobj\n")
      }

      if (encryption != null) {
        offsets[encryptObject] = out.position
        out.write(
          "$encryptObject 0 obj\n<< /Filter /Standard /V 4 /R 4 /Length 128 " +
            "/CF << /StdCF << /AuthEvent /DocOpen /CFM /AESV2 /Length 16 >> >> /StmF /StdCF /StrF /StdCF " +
            "/O <${hex(encryption.owner)}> /U <${hex(encryption.user)}> /P $PERMISSIONS >>\nendobj\n"
        )
      }

      val xref = out.position
      out.write("xref\n0 ${offsets.size}\n")
      out.write("0000000000 65535 f \n")
      for (number in 1 until offsets.size) {
        out.write("%010d 00000 n \n".format(java.util.Locale.US, offsets[number]))
      }
      val protection = if (encryption != null) {
        " /Encrypt $encryptObject 0 R /ID [<${hex(encryption.id)}> <${hex(encryption.id)}>]"
      } else {
        ""
      }
      out.write("trailer\n<< /Size ${offsets.size} /Root 1 0 R$protection >>\nstartxref\n$xref\n%%EOF\n")
    }
  }
}
