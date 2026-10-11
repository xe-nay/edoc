// Renders the app icon, splash glyph and screen background from SVG.
// Run with: node scripts/make-assets.mjs
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';

const lock = `
  <path d="M372 470 V380 a140 140 0 0 1 280 0 V470" fill="none" stroke="url(#shackle)" stroke-width="56" stroke-linecap="round"/>
  <rect x="292" y="452" width="440" height="340" rx="84" fill="url(#body)"/>
  <rect x="292" y="452" width="440" height="340" rx="84" fill="url(#sheen)"/>
  <circle cx="512" cy="596" r="44" fill="#041033"/>
  <rect x="490" y="610" width="44" height="92" rx="22" fill="#041033"/>`;

const lockDefs = `
  <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#86BCFF"/>
    <stop offset="1" stop-color="#2757FF"/>
  </linearGradient>
  <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.26"/>
    <stop offset="0.5" stop-color="#FFFFFF" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="shackle" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#E4EFFF"/>
    <stop offset="1" stop-color="#7DAEFF"/>
  </linearGradient>`;

const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <radialGradient id="bg" cx="50%" cy="82%" r="90%">
      <stop offset="0" stop-color="#11317F"/>
      <stop offset="0.42" stop-color="#061333"/>
      <stop offset="1" stop-color="#01030A"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="60%" r="40%">
      <stop offset="0" stop-color="#3D7BFF" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#3D7BFF" stop-opacity="0"/>
    </radialGradient>
    ${lockDefs}
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <rect width="1024" height="1024" fill="url(#glow)"/>
  ${lock}
</svg>`;

const splash = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>${lockDefs}</defs>
  ${lock}
</svg>`;

// Transparent overlay: a deep blue glow rising from the bottom edge of the screen.
const glow = `<svg xmlns="http://www.w3.org/2000/svg" width="860" height="760" viewBox="0 0 860 760">
  <defs>
    <radialGradient id="rise" gradientUnits="userSpaceOnUse" cx="430" cy="900" r="760">
      <stop offset="0" stop-color="#2A66FF" stop-opacity="0.78"/>
      <stop offset="0.4" stop-color="#1640C8" stop-opacity="0.36"/>
      <stop offset="0.75" stop-color="#0B2580" stop-opacity="0.1"/>
      <stop offset="1" stop-color="#0A1F66" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="left" gradientUnits="userSpaceOnUse" cx="-40" cy="800" r="520">
      <stop offset="0" stop-color="#34C6FF" stop-opacity="0.42"/>
      <stop offset="1" stop-color="#34C6FF" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="860" height="760" fill="url(#rise)"/>
  <rect width="860" height="760" fill="url(#left)"/>
</svg>`;

// Android draws its own shape around the icon, so the lock sits smaller on a transparent canvas.
const adaptive = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>${lockDefs}</defs>
  <g transform="translate(512 512) scale(0.58) translate(-512 -516)">${lock}</g>
</svg>`;

await mkdir('assets', { recursive: true });
await sharp(Buffer.from(adaptive)).png().toFile('assets/adaptive-icon.png');
await sharp(Buffer.from(icon)).png().toFile('assets/icon.png');
await sharp(Buffer.from(splash)).resize(512, 512).png().toFile('assets/splash.png');
await sharp(Buffer.from(glow)).png().toFile('assets/glow.png');
console.log('assets written');
