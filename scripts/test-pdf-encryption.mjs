// Reference implementation of the password-protected PDF layout written by the Android module
// (modules/edoc-kit/android/.../PdfWriter.kt), kept in step with it so the format can be checked
// on a computer with any PDF tool. Usage: node scripts/test-pdf-encryption.mjs <out.pdf> <password>
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import sharp from 'sharp';

const PAD = Buffer.from(
  '28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A',
  'hex',
);
const PERMISSIONS = -4;
const KEY_LENGTH = 16;

const md5 = (...parts) => {
  const hash = createHash('md5');
  parts.forEach((part) => hash.update(part));
  return hash.digest();
};

function rc4(key, data) {
  const state = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + state[i] + key[i % key.length]) & 0xff;
    [state[i], state[j]] = [state[j], state[i]];
  }
  const out = Buffer.alloc(data.length);
  let i = 0;
  j = 0;
  for (let n = 0; n < data.length; n++) {
    i = (i + 1) & 0xff;
    j = (j + state[i]) & 0xff;
    [state[i], state[j]] = [state[j], state[i]];
    out[n] = data[n] ^ state[(state[i] + state[j]) & 0xff];
  }
  return out;
}

const xorKey = (key, value) => Buffer.from(key.map((byte) => byte ^ value));
const padded = (password) => Buffer.concat([Buffer.from(password, 'latin1'), PAD]).subarray(0, 32);

function encryption(password) {
  const id = randomBytes(16);
  const pad = padded(password);

  let ownerDigest = md5(pad);
  for (let n = 0; n < 50; n++) ownerDigest = md5(ownerDigest);
  const ownerKey = ownerDigest.subarray(0, KEY_LENGTH);
  let owner = rc4(ownerKey, pad);
  for (let round = 1; round <= 19; round++) owner = rc4(xorKey(ownerKey, round), owner);

  const permissions = Buffer.alloc(4);
  permissions.writeInt32LE(PERMISSIONS);
  let keyDigest = md5(pad, owner, permissions, id);
  for (let n = 0; n < 50; n++) keyDigest = md5(keyDigest.subarray(0, KEY_LENGTH));
  const key = keyDigest.subarray(0, KEY_LENGTH);

  let user = rc4(key, md5(PAD, id));
  for (let round = 1; round <= 19; round++) user = rc4(xorKey(key, round), user);
  user = Buffer.concat([user, Buffer.alloc(16)]);

  const seal = (data, objectNumber) => {
    const salt = Buffer.from([
      objectNumber & 0xff, (objectNumber >> 8) & 0xff, (objectNumber >> 16) & 0xff, 0, 0, 0x73, 0x41, 0x6c, 0x54,
    ]);
    const objectKey = md5(key, salt).subarray(0, KEY_LENGTH);
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-128-cbc', objectKey, iv);
    return Buffer.concat([iv, cipher.update(data), cipher.final()]);
  };
  return { owner, user, id, seal };
}

const hex = (bytes) => bytes.toString('hex').toUpperCase();

function writePdf(pages, password) {
  const chunks = [];
  let position = 0;
  const write = (value) => {
    const bytes = typeof value === 'string' ? Buffer.from(value, 'latin1') : value;
    chunks.push(bytes);
    position += bytes.length;
  };
  const protection = password ? encryption(password) : null;
  const encryptObject = 3 + pages.length * 3;
  const offsets = new Array(encryptObject + (protection ? 1 : 0)).fill(0);

  write('%PDF-1.6\n%âãÏÓ\n');
  offsets[1] = position;
  write('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  offsets[2] = position;
  const kids = pages.map((_, index) => `${3 + index * 3} 0 R`).join(' ');
  write(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`);

  pages.forEach(({ data, width, height }, index) => {
    const pageObject = 3 + index * 3;
    const imageObject = pageObject + 1;
    const contentObject = pageObject + 2;
    const pageWidth = width > height ? 842 : 595;
    const pageHeight = (pageWidth * height) / width;
    const w = pageWidth.toFixed(2);
    const h = pageHeight.toFixed(2);

    offsets[pageObject] = position;
    write(
      `${pageObject} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
        `/Resources << /XObject << /Im0 ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>\nendobj\n`,
    );

    const image = protection ? protection.seal(data, imageObject) : data;
    offsets[imageObject] = position;
    write(
      `${imageObject} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`,
    );
    write(image);
    write('\nendstream\nendobj\n');

    const drawing = Buffer.from(`q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`, 'latin1');
    const content = protection ? protection.seal(drawing, contentObject) : drawing;
    offsets[contentObject] = position;
    write(`${contentObject} 0 obj\n<< /Length ${content.length} >>\nstream\n`);
    write(content);
    write('\nendstream\nendobj\n');
  });

  if (protection) {
    offsets[encryptObject] = position;
    write(
      `${encryptObject} 0 obj\n<< /Filter /Standard /V 4 /R 4 /Length 128 ` +
        '/CF << /StdCF << /AuthEvent /DocOpen /CFM /AESV2 /Length 16 >> >> /StmF /StdCF /StrF /StdCF ' +
        `/O <${hex(protection.owner)}> /U <${hex(protection.user)}> /P ${PERMISSIONS} >>\nendobj\n`,
    );
  }

  const xref = position;
  write(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (let number = 1; number < offsets.length; number++) {
    write(`${String(offsets[number]).padStart(10, '0')} 00000 n \n`);
  }
  const extra = protection ? ` /Encrypt ${encryptObject} 0 R /ID [<${hex(protection.id)}> <${hex(protection.id)}>]` : '';
  write(`trailer\n<< /Size ${offsets.length} /Root 1 0 R${extra} >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(chunks);
}

const [out, password = ''] = process.argv.slice(2);
const page = async (color) => ({
  width: 300,
  height: 420,
  data: await sharp({ create: { width: 300, height: 420, channels: 3, background: color } }).jpeg().toBuffer(),
});
writeFileSync(out, writePdf([await page('#f6f7fa'), await page('#3d7bff')], password));
console.log(`wrote ${out}${password ? ' (encrypted)' : ''}`);
