// Writes a small password-protected eDoc backup with an independent implementation of the
// archive format, to check that the phone apps can restore a backup they did not make.
// Usage: node scripts/make-test-backup.mjs <out.edocbackup> <password>
import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import sharp from 'sharp';

import { createZipWriter, textToBytes } from '../src/zip.ts';

const [out, password] = process.argv.slice(2);
const CHUNK = 1 << 20;
const ITERATIONS = 600_000;

const page = async (label, color) =>
  sharp({ create: { width: 600, height: 840, channels: 3, background: color } })
    .composite([
      {
        input: Buffer.from(
          `<svg width="600" height="840"><text x="50" y="140" font-family="Arial" font-size="54" font-weight="700" fill="#1b2233">${label}</text></svg>`,
        ),
      },
    ])
    .jpeg()
    .toBuffer();

const now = Date.now();
const doc = (id, name, extra) => ({
  id,
  name,
  folderId: 'tfolder1',
  tag: 'professional',
  favorite: false,
  createdAt: now,
  updatedAt: now,
  expiresAt: null,
  reminderIds: [],
  pages: [
    { id: `${id}p1`, file: `${id}p1.jpg`, width: 600, height: 840 },
    { id: `${id}p2`, file: `${id}p2.jpg`, width: 600, height: 840 },
  ],
  ...extra,
});
const library = {
  version: 1,
  folders: [{ id: 'tfolder1', name: 'Imported', color: '#2DD4BF', createdAt: now }],
  docs: [doc('tdoc1', 'Imported plain', {}), doc('tdoc2', 'Imported protected', { protected: true })],
  settings: { faceId: false, deviceBackup: false, protectNew: false },
};

const chunks = [];
const zip = createZipWriter({ write: (bytes) => chunks.push(Buffer.from(bytes)) });
zip.add('library.json', textToBytes(JSON.stringify(library)));
zip.add('text.json', textToBytes(JSON.stringify({ tdoc1p1: 'INVOICE 2026 Total 1250' })));
for (const item of library.docs) {
  zip.add(`files/${item.id}/${item.pages[0].file}`, await page(`${item.name} 1`, '#f6f7fa'));
  zip.add(`files/${item.id}/${item.pages[1].file}`, await page(`${item.name} 2`, '#dfe9ff'));
}
zip.finish();
const plain = Buffer.concat(chunks);

// Sealed archive: magic, salt, iteration count, then length-prefixed AES-256-GCM chunks whose
// additional data is the chunk index and a last-chunk flag.
const salt = randomBytes(16);
const key = pbkdf2Sync(Buffer.from(password, 'utf8'), salt, ITERATIONS, 32, 'sha256');
const parts = [Buffer.from('EDOCBK01', 'ascii'), salt];
const iterations = Buffer.alloc(4);
iterations.writeUInt32BE(ITERATIONS);
parts.push(iterations);
let offset = 0;
let index = 0n;
do {
  const chunk = plain.subarray(offset, offset + CHUNK);
  offset += chunk.length;
  const tag = Buffer.alloc(9);
  tag.writeBigUInt64BE(index);
  tag[8] = offset >= plain.length ? 1 : 0;
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(tag);
  const sealed = Buffer.concat([nonce, cipher.update(chunk), cipher.final(), cipher.getAuthTag()]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(sealed.length);
  parts.push(length, sealed);
  index += 1n;
} while (offset < plain.length);

writeFileSync(out, Buffer.concat(parts));
console.log(`wrote ${out}: ${library.docs.length} documents, ${plain.length} bytes before encryption`);
