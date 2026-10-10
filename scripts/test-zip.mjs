import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { zipSync } from 'fflate';
import { createZipWriter, readZipEntries, readZipEntry, textToBytes, bytesToText, crc32 } from '../src/zip.ts';

const out = process.argv[2];
mkdirSync(out, { recursive: true });
const chunks = [];
const zip = createZipWriter({ write: (b) => chunks.push(Buffer.from(b)) });
const json = JSON.stringify({ name: 'Passeport é à ü – “quoted” 文書', n: 1 });
const big = new Uint8Array(3_000_000).map((_, i) => (i * 31 + 7) & 255);
zip.add('library.json', textToBytes(json));
zip.add('files/abc123/page-1.jpg', big);
zip.add('files/abc123/empty.jpg', new Uint8Array(0));
zip.finish();
const archive = Buffer.concat(chunks);
writeFileSync(out + '/test.zip', archive);

const source = (buf) => ({ size: buf.length, read: (o, l) => new Uint8Array(buf.subarray(o, o + l)) });
const entries = readZipEntries(source(archive));
console.log('entries', entries.map((e) => `${e.name}:${e.size}`).join(' | '));
console.log('json roundtrip', bytesToText(readZipEntry(source(archive), entries[0])) === json);
const back = readZipEntry(source(archive), entries[1]);
console.log('binary roundtrip', back.length === big.length && crc32(back) === crc32(big));
console.log('empty roundtrip', readZipEntry(source(archive), entries[2]).length === 0);

// A deflated archive produced by another tool must also be readable.
const other = Buffer.from(zipSync({ 'library.json': textToBytes(json), 'files/x/p.jpg': big }, { level: 6 }));
const otherEntries = readZipEntries(source(other));
console.log('deflate methods', otherEntries.map((e) => e.method).join(','));
console.log('deflate roundtrip', bytesToText(readZipEntry(source(other), otherEntries[0])) === json && crc32(readZipEntry(source(other), otherEntries[1])) === crc32(big));

// Corruption must be detected.
const bad = Buffer.from(archive); bad[200] ^= 0xff;
try { readZipEntry(source(bad), readZipEntries(source(bad))[1]); console.log('corruption detected', false); } catch (e) { console.log('corruption detected', true, '-', e.message); }

