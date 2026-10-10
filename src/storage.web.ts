// Browser stand-in used only for the design preview: no real files, demo content.
import type { Doc, Folder, Library, TextIndex } from './types';

const paper = (title: string, accent: string, lines: number) => {
  const rows = Array.from({ length: lines }, (_, index) => {
    const width = 420 - ((index * 53) % 170);
    return `<rect x="70" y="${230 + index * 34}" width="${width}" height="9" rx="4" fill="#C9CEDA"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="620" height="877" viewBox="0 0 620 877">
    <rect width="620" height="877" fill="#F6F7FA"/>
    <rect x="70" y="80" width="150" height="16" rx="8" fill="${accent}"/>
    <text x="70" y="160" font-family="Helvetica, Arial" font-size="34" font-weight="700" fill="#1B2233">${title}</text>
    <rect x="70" y="186" width="260" height="8" rx="4" fill="#A9B0C0"/>
    ${rows}
    <rect x="390" y="760" width="160" height="44" rx="8" fill="none" stroke="#A9B0C0" stroke-width="3"/>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const pages: Record<string, string> = {};

function demoDoc(
  id: string,
  name: string,
  accent: string,
  count: number,
  patch: Partial<Doc> = {},
): Doc {
  const now = Date.now();
  return {
    id,
    name,
    folderId: null,
    tag: null,
    favorite: false,
    createdAt: now - 86400000 * 3,
    updatedAt: now - 3600000,
    expiresAt: null,
    reminderIds: [],
    pages: Array.from({ length: count }, (_, index) => {
      const file = `p${index}.jpg`;
      pages[`${id}/${file}`] = paper(index === 0 ? name : `Page ${index + 1}`, accent, 12 + ((index * 3) % 5));
      return { id: `${id}-p${index}`, file, width: 620, height: 877 };
    }),
    ...patch,
  };
}

const day = 86400000;
const midnight = new Date().setHours(0, 0, 0, 0);

const folders: Folder[] = [
  { id: 'f1', name: 'Identity', color: '#3D7BFF', createdAt: 1 },
  { id: 'f2', name: 'Contracts', color: '#6E5BFF', createdAt: 2 },
  { id: 'f3', name: 'Home', color: '#2DD4BF', createdAt: 3 },
  { id: 'f4', name: 'Invoices', color: '#FFB547', createdAt: 4 },
];

const demo: Library = {
  version: 1,
  folders,
  settings: { faceId: false, deviceBackup: false, protectNew: false },
  docs: [
    demoDoc('d1', 'Passport', '#3D7BFF', 2, { folderId: 'f1', tag: 'personal', expiresAt: midnight + day * 21, favorite: true }),
    demoDoc('d2', 'Employment contract', '#6E5BFF', 6, { folderId: 'f2', tag: 'professional', protected: true }),
    demoDoc('d3', 'Lease agreement', '#2DD4BF', 9, { folderId: 'f3', tag: 'personal', expiresAt: midnight + day * 64 }),
    demoDoc('d4', 'Invoice 2026-041', '#FFB547', 1, { folderId: 'f4', tag: 'professional' }),
    demoDoc('d5', 'Driving licence', '#3D7BFF', 2, { folderId: 'f1', tag: 'personal', expiresAt: midnight + day * 5 }),
    demoDoc('d6', 'Insurance', '#4CC9FF', 4, { tag: 'personal' }),
  ],
};

const demoText: TextIndex = {
  'd1-p0': 'PASSPORT\nSurname\nGiven names\nDate of expiry',
  'd2-p0': 'EMPLOYMENT CONTRACT\nBetween the undersigned parties\nArticle 1 - Purpose',
};

export function ensureDirs() {}

export function loadJson<T>(name: string): T | null {
  return (name === 'library.json' ? demo : demoText) as T;
}

export function saveJson(_name: string, _value: unknown) {}

export type DocRef = { id: string; protected?: boolean };

export function pageUri(doc: DocRef, file: string) {
  return pages[`${doc.id}/${file}`] ?? '';
}

export function clearTemp() {}

export function storageBytes() {
  return 48_300_000;
}
