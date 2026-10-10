// Minimal ZIP reader/writer for backups. Entries are stored uncompressed (page
// images are already JPEG) with sizes written up front, so archives are read by
// offset instead of being scanned. Deflated entries are still accepted on read,
// in case the backup was repacked on a computer.
import { inflateSync } from 'fflate';

export type ZipSink = {
  write: (bytes: Uint8Array) => void;
};

export type ZipSource = {
  size: number;
  read: (offset: number, length: number) => Uint8Array;
};

export type ZipEntry = {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  headerOffset: number;
};

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const UTF8_FLAG = 0x0800;
const MAX_UINT32 = 0xffffffff;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function encodeUtf8(value: string) {
  const out: number[] = [];
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return Uint8Array.from(out);
}

function decodeUtf8(bytes: Uint8Array) {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i++];
    let code = b;
    if (b >= 0xf0) {
      code = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    } else if (b >= 0xe0) {
      code = ((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    } else if (b >= 0xc0) {
      code = ((b & 0x1f) << 6) | (bytes[i++] & 0x3f);
    }
    out += String.fromCodePoint(code);
  }
  return out;
}

export function textToBytes(value: string) {
  return encodeUtf8(value);
}

export function bytesToText(bytes: Uint8Array) {
  return decodeUtf8(bytes);
}

function dosDateTime(date: Date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

export function createZipWriter(sink: ZipSink) {
  const central: Uint8Array[] = [];
  let offset = 0;
  let count = 0;
  const { time, day } = dosDateTime(new Date());

  const emit = (bytes: Uint8Array) => {
    sink.write(bytes);
    offset += bytes.length;
  };

  return {
    add(name: string, data: Uint8Array) {
      const nameBytes = encodeUtf8(name);
      const crc = crc32(data);
      const headerOffset = offset;

      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, LOCAL_SIGNATURE, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, UTF8_FLAG, true);
      lv.setUint16(8, 0, true);
      lv.setUint16(10, time, true);
      lv.setUint16(12, day, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      emit(local);
      emit(data);

      const record = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(record.buffer);
      cv.setUint32(0, CENTRAL_SIGNATURE, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, UTF8_FLAG, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, time, true);
      cv.setUint16(14, day, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, headerOffset, true);
      record.set(nameBytes, 46);
      central.push(record);
      count += 1;

      if (offset > MAX_UINT32 || count > 0xffff) {
        throw new Error('Backup is too large for a single archive');
      }
    },

    finish() {
      const start = offset;
      let size = 0;
      for (const record of central) {
        emit(record);
        size += record.length;
      }
      const end = new Uint8Array(22);
      const ev = new DataView(end.buffer);
      ev.setUint32(0, END_SIGNATURE, true);
      ev.setUint16(8, count, true);
      ev.setUint16(10, count, true);
      ev.setUint32(12, size, true);
      ev.setUint32(16, start, true);
      emit(end);
    },
  };
}

export function readZipEntries(source: ZipSource): ZipEntry[] {
  // The end record sits in the last 22 bytes, plus an optional comment of up to 65535 bytes.
  const tailLength = Math.min(source.size, 22 + 0xffff);
  const tailStart = source.size - tailLength;
  const tail = source.read(tailStart, tailLength);
  const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let endAt = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === END_SIGNATURE) {
      endAt = i;
      break;
    }
  }
  if (endAt < 0) {
    throw new Error('Not a valid backup archive');
  }
  const count = tv.getUint16(endAt + 10, true);
  const centralSize = tv.getUint32(endAt + 12, true);
  const centralOffset = tv.getUint32(endAt + 16, true);
  if (centralOffset === MAX_UINT32 || centralOffset + centralSize > source.size) {
    throw new Error('Unsupported backup archive');
  }

  const central = source.read(centralOffset, centralSize);
  const cv = new DataView(central.buffer, central.byteOffset, central.byteLength);
  const entries: ZipEntry[] = [];
  let at = 0;
  for (let index = 0; index < count; index++) {
    if (at + 46 > central.length || cv.getUint32(at, true) !== CENTRAL_SIGNATURE) {
      throw new Error('Backup archive is damaged');
    }
    const nameLength = cv.getUint16(at + 28, true);
    const extraLength = cv.getUint16(at + 30, true);
    const commentLength = cv.getUint16(at + 32, true);
    entries.push({
      name: decodeUtf8(central.subarray(at + 46, at + 46 + nameLength)),
      method: cv.getUint16(at + 10, true),
      crc: cv.getUint32(at + 16, true),
      compressedSize: cv.getUint32(at + 20, true),
      size: cv.getUint32(at + 24, true),
      headerOffset: cv.getUint32(at + 42, true),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function readZipEntry(source: ZipSource, entry: ZipEntry): Uint8Array {
  const header = source.read(entry.headerOffset, 30);
  const hv = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (hv.getUint32(0, true) !== LOCAL_SIGNATURE) {
    throw new Error('Backup archive is damaged');
  }
  const dataOffset = entry.headerOffset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
  const raw = entry.compressedSize > 0 ? source.read(dataOffset, entry.compressedSize) : new Uint8Array(0);
  let data: Uint8Array;
  if (entry.method === 0) {
    data = raw;
  } else if (entry.method === 8) {
    data = inflateSync(raw, { out: new Uint8Array(entry.size) });
  } else {
    throw new Error('Unsupported compression in backup archive');
  }
  if (crc32(data) !== entry.crc) {
    throw new Error(`Backup archive is damaged (${entry.name})`);
  }
  return data;
}
