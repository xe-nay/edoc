import { Directory, File, Paths } from 'expo-file-system';

export const rootDir = new Directory(Paths.document, 'edoc');
export const filesDir = new Directory(rootDir, 'files');
export const tempDir = new Directory(Paths.cache, 'edoc-temp');

export function ensureDirs() {
  for (const directory of [rootDir, filesDir, tempDir]) {
    if (!directory.exists) {
      directory.create({ intermediates: true, idempotent: true });
    }
  }
}

function readFile<T>(file: File): T | null {
  if (!file.exists) {
    return null;
  }
  try {
    return JSON.parse(file.textSync()) as T;
  } catch {
    return null;
  }
}

// Falls back to the last fully written temporary copy if the main file is unreadable.
export function loadJson<T>(name: string): T | null {
  ensureDirs();
  return readFile<T>(new File(rootDir, name)) ?? readFile<T>(new File(rootDir, `${name}.tmp`));
}

export function saveJson(name: string, value: unknown) {
  ensureDirs();
  const temp = new File(rootDir, `${name}.tmp`);
  temp.create({ overwrite: true });
  temp.write(JSON.stringify(value));
  const target = new File(rootDir, name);
  if (target.exists) {
    target.delete();
  }
  temp.copySync(target);
}

export function docDir(docId: string) {
  return new Directory(filesDir, docId);
}

export type DocRef = { id: string; protected?: boolean };

// Pages of a protected document are stored under the same name plus ".enc".
export function diskName(doc: DocRef, file: string) {
  return doc.protected ? `${file}.enc` : file;
}

export function pageFile(doc: DocRef, file: string) {
  return new File(filesDir, doc.id, diskName(doc, file));
}

export function pageUri(doc: DocRef, file: string) {
  return pageFile(doc, file).uri;
}

export function clearTemp() {
  if (tempDir.exists) {
    tempDir.delete();
  }
  tempDir.create({ intermediates: true, idempotent: true });
}

export function storageBytes() {
  return rootDir.exists ? (rootDir.size ?? 0) : 0;
}
