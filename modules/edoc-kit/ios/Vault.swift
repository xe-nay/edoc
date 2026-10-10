import CommonCrypto
import CryptoKit
import ExpoModulesCore
import Foundation
import Security

// Encryption for protected documents and password-protected backups.
//
// Pages: a file whose name ends in ".enc" holds AES-256-GCM ciphertext made with a key
// that exists only in this iPhone's keychain. Every other file is read and written as-is.
//
// Backups: the whole archive is encrypted in 1 MB chunks with a key derived from the
// user's password (PBKDF2-SHA256). Each chunk authenticates its position and whether it
// is the last one, so reordered or truncated archives are rejected.
enum Vault {
  static let encryptedSuffix = ".enc"

  private static let keyService = "app.edoc.vault"
  private static let keyAccount = "page-key-v1"
  private static let keyLock = NSLock()
  private static var cachedKey: SymmetricKey?

  private static let archiveMagic = Data("EDOCBK01".utf8)
  private static let saltLength = 16
  private static let chunkSize = 1 << 20
  // Nonce (12) and tag (16) added to every chunk by AES-GCM.
  private static let chunkOverhead = 28
  private static let passwordIterations: UInt32 = 600_000

  private static func failure(_ name: String, _ description: String) -> Exception {
    return Exception(name: name, description: description)
  }

  static func isEncrypted(_ url: URL) -> Bool {
    return url.lastPathComponent.hasSuffix(encryptedSuffix)
  }

  // MARK: - Device key

  private static func deviceKey() throws -> SymmetricKey {
    keyLock.lock()
    defer { keyLock.unlock() }
    if let cachedKey = cachedKey {
      return cachedKey
    }

    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keyService,
      kSecAttrAccount as String: keyAccount,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne
    ]
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecSuccess, let data = item as? Data, data.count == 32 {
      let key = SymmetricKey(data: data)
      cachedKey = key
      return key
    }
    // Only a missing key may be replaced; any other failure must not create a second key.
    guard status == errSecItemNotFound else {
      throw failure("ERR_KEYCHAIN", "The encryption key cannot be read (\(status))")
    }

    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
      throw failure("ERR_KEYCHAIN", "The encryption key cannot be created")
    }
    let data = Data(bytes)
    let attributes: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keyService,
      kSecAttrAccount as String: keyAccount,
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
      kSecValueData as String: data
    ]
    let addStatus = SecItemAdd(attributes as CFDictionary, nil)
    guard addStatus == errSecSuccess else {
      throw failure("ERR_KEYCHAIN", "The encryption key cannot be saved (\(addStatus))")
    }
    let key = SymmetricKey(data: data)
    cachedKey = key
    return key
  }

  // MARK: - Page files

  // Returns the plain content of a file, decrypting it when its name ends in ".enc".
  static func read(_ url: URL) throws -> Data {
    let raw = try Data(contentsOf: url)
    guard isEncrypted(url) else {
      return raw
    }
    let key = try deviceKey()
    do {
      return try AES.GCM.open(try AES.GCM.SealedBox(combined: raw), using: key)
    } catch {
      throw failure("ERR_DECRYPT", "This document cannot be decrypted on this iPhone")
    }
  }

  // Writes content to a file, encrypting it when the name ends in ".enc".
  static func write(_ data: Data, to url: URL) throws {
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    var payload = data
    if isEncrypted(url) {
      let sealed = try AES.GCM.seal(data, using: try deviceKey())
      guard let combined = sealed.combined else {
        throw failure("ERR_ENCRYPT", "This document cannot be encrypted")
      }
      payload = combined
    }
    try payload.write(to: url, options: [.atomic, .completeFileProtection])
  }

  // MARK: - Password-protected archives

  private static func bigEndian(_ value: UInt32) -> Data {
    return Data([
      UInt8((value >> 24) & 0xff),
      UInt8((value >> 16) & 0xff),
      UInt8((value >> 8) & 0xff),
      UInt8(value & 0xff)
    ])
  }

  private static func readUInt32(_ data: Data) -> UInt32 {
    return data.reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
  }

  private static func chunkTag(_ index: UInt64, isFinal: Bool) -> Data {
    var data = Data()
    for shift in stride(from: 56, through: 0, by: -8) {
      data.append(UInt8((index >> UInt64(shift)) & 0xff))
    }
    data.append(isFinal ? 1 : 0)
    return data
  }

  private static func fileSize(_ url: URL) throws -> UInt64 {
    let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
    return (attributes[.size] as? NSNumber)?.uint64Value ?? 0
  }

  private static func passwordKey(_ password: String, salt: Data, iterations: UInt32) throws -> SymmetricKey {
    let saltBytes = [UInt8](salt)
    var derived = [UInt8](repeating: 0, count: 32)
    let status = CCKeyDerivationPBKDF(
      CCPBKDFAlgorithm(kCCPBKDF2),
      password,
      password.utf8.count,
      saltBytes,
      saltBytes.count,
      CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
      iterations,
      &derived,
      derived.count
    )
    guard status == Int32(kCCSuccess) else {
      throw failure("ERR_PASSWORD", "The password cannot be used")
    }
    return SymmetricKey(data: Data(derived))
  }

  private static func prepareOutput(_ url: URL) throws -> FileHandle {
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    FileManager.default.createFile(
      atPath: url.path,
      contents: nil,
      attributes: [.protectionKey: FileProtectionType.complete]
    )
    return try FileHandle(forWritingTo: url)
  }

  static func isSealedArchive(_ url: URL) -> Bool {
    guard let handle = try? FileHandle(forReadingFrom: url) else {
      return false
    }
    defer { try? handle.close() }
    guard let head = try? handle.read(upToCount: archiveMagic.count) else {
      return false
    }
    return head == archiveMagic
  }

  static func sealArchive(from source: URL, to destination: URL, password: String) throws {
    var saltBytes = [UInt8](repeating: 0, count: saltLength)
    guard SecRandomCopyBytes(kSecRandomDefault, saltBytes.count, &saltBytes) == errSecSuccess else {
      throw failure("ERR_ENCRYPT", "The backup cannot be encrypted")
    }
    let salt = Data(saltBytes)
    let key = try passwordKey(password, salt: salt, iterations: passwordIterations)

    var remaining = try fileSize(source)
    let input = try FileHandle(forReadingFrom: source)
    defer { try? input.close() }
    let output = try prepareOutput(destination)
    defer { try? output.close() }

    var header = Data()
    header.append(archiveMagic)
    header.append(salt)
    header.append(bigEndian(passwordIterations))
    try output.write(contentsOf: header)

    var index: UInt64 = 0
    repeat {
      try autoreleasepool {
        let count = Int(min(UInt64(chunkSize), remaining))
        var chunk = Data()
        if count > 0 {
          chunk = try input.read(upToCount: count) ?? Data()
        }
        guard chunk.count == count else {
          throw failure("ERR_ENCRYPT", "The backup cannot be read")
        }
        remaining -= UInt64(count)
        let sealed = try AES.GCM.seal(
          chunk,
          using: key,
          authenticating: chunkTag(index, isFinal: remaining == 0)
        )
        guard let combined = sealed.combined else {
          throw failure("ERR_ENCRYPT", "The backup cannot be encrypted")
        }
        try output.write(contentsOf: bigEndian(UInt32(combined.count)))
        try output.write(contentsOf: combined)
        index += 1
      }
    } while remaining > 0
  }

  static func openArchive(from source: URL, to destination: URL, password: String) throws {
    let damaged = failure("ERR_ARCHIVE", "This backup is damaged")
    let size = try fileSize(source)
    let headerLength = archiveMagic.count + saltLength + 4
    let input = try FileHandle(forReadingFrom: source)
    defer { try? input.close() }

    guard let header = try input.read(upToCount: headerLength),
      header.count == headerLength,
      Data(header.prefix(archiveMagic.count)) == archiveMagic
    else {
      throw failure("ERR_ARCHIVE", "This file is not an encrypted eDoc backup")
    }
    let bytes = [UInt8](header)
    let salt = Data(bytes[archiveMagic.count..<(archiveMagic.count + saltLength)])
    let iterations = readUInt32(Data(bytes[(archiveMagic.count + saltLength)..<headerLength]))
    guard iterations >= 10_000, iterations <= 20_000_000 else {
      throw damaged
    }
    let key = try passwordKey(password, salt: salt, iterations: iterations)

    let output = try prepareOutput(destination)
    defer { try? output.close() }

    var offset = UInt64(headerLength)
    var index: UInt64 = 0
    var finished = false
    while !finished {
      try autoreleasepool {
        guard let lengthData = try input.read(upToCount: 4), lengthData.count == 4 else {
          throw damaged
        }
        let length = Int(readUInt32(lengthData))
        guard length >= chunkOverhead, length <= chunkSize + chunkOverhead,
          let combined = try input.read(upToCount: length),
          combined.count == length
        else {
          throw damaged
        }
        offset += UInt64(4 + length)
        let isFinal = offset == size
        let plain: Data
        do {
          plain = try AES.GCM.open(
            try AES.GCM.SealedBox(combined: combined),
            using: key,
            authenticating: chunkTag(index, isFinal: isFinal)
          )
        } catch {
          // The first chunk failing means the key is wrong; later ones mean corruption.
          throw index == 0 ? failure("ERR_PASSWORD", "Wrong password") : damaged
        }
        try output.write(contentsOf: plain)
        index += 1
        finished = isFinal
      }
    }
  }
}
