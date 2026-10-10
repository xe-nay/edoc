import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, FileMode } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import * as Sharing from 'expo-sharing';

import EdocKit, { type KitPage } from '../modules/edoc-kit';
import { cancelReminders, scheduleReminders } from './reminders';
import { clearTemp, docDir, ensureDirs, filesDir, pageUri, tempDir } from './storage';
import { flushStore, makeDoc, newId, snapshotLibrary, useStore } from './store';
import type { Doc, Library, Page, PageFilter, Tag, TextIndex } from './types';
import { bytesToText, createZipWriter, readZipEntries, readZipEntry, textToBytes, type ZipSource } from './zip';

export type Target = {
  folderId: string | null;
  tag: Tag | null;
};

function kit() {
  if (!EdocKit) {
    throw new Error('This feature needs the iPhone app');
  }
  return EdocKit;
}

function findDoc(docId: string) {
  return useStore.getState().docs.find((doc) => doc.id === docId);
}

function scratchDir() {
  return new Directory(tempDir, newId());
}

function stripExtension(name: string) {
  return name.replace(/\.[A-Za-z0-9]{1,5}$/, '');
}

function safeFileName(name: string) {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 80);
  return cleaned || 'Document';
}

function defaultName(prefix: string) {
  const date = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `${prefix} ${date}`;
}

// Moves freshly produced images into the document's own directory.
function adoptPages(docId: string, items: KitPage[]): Page[] {
  const directory = docDir(docId);
  if (!directory.exists) {
    directory.create({ intermediates: true, idempotent: true });
  }
  return items.map((item) => {
    const id = newId();
    const file = `${id}.jpg`;
    new File(item.uri).moveSync(new File(directory, file));
    return { id, file, width: item.width, height: item.height };
  });
}

function removePageFile(docId: string, name: string | undefined) {
  if (!name) {
    return;
  }
  const file = new File(filesDir, docId, name);
  if (file.exists) {
    file.delete();
  }
}

function createDoc(name: string, items: KitPage[], target: Target) {
  const docId = newId();
  const doc = makeDoc(name, adoptPages(docId, items), target.folderId, target.tag, docId);
  useStore.getState().addDoc(doc);
  queueText(docId);
  return docId;
}

function patchPage(docId: string, pageId: string, patch: Partial<Page>) {
  const doc = findDoc(docId);
  if (!doc) {
    return;
  }
  useStore.getState().updateDoc(docId, {
    pages: doc.pages.map((page) => (page.id === pageId ? { ...page, ...patch } : page)),
  });
}

// --- Scanning and importing -------------------------------------------------

export async function scanDocument(target: Target): Promise<string | null> {
  ensureDirs();
  const pages = await kit().scan(scratchDir().uri);
  if (pages.length === 0) {
    return null;
  }
  return createDoc(defaultName('Scan'), pages, target);
}

export async function scanMorePages(docId: string): Promise<number> {
  const doc = findDoc(docId);
  if (!doc) {
    return 0;
  }
  ensureDirs();
  const pages = await kit().scan(scratchDir().uri);
  if (pages.length === 0) {
    return 0;
  }
  const added = adoptPages(docId, pages);
  useStore.getState().updateDoc(docId, { pages: [...doc.pages, ...added] });
  queueText(docId);
  return added.length;
}

// PDFs become one document each; images picked together become one document.
export async function importFromFiles(target: Target): Promise<string[]> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf', 'image/*'],
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (result.canceled) {
    return [];
  }
  ensureDirs();
  const created: string[] = [];
  const images: KitPage[] = [];
  let imagesName: string | null = null;
  for (const asset of result.assets) {
    const isPdf = asset.mimeType === 'application/pdf' || asset.name.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      const pages = await kit().pdfToImages(asset.uri, scratchDir().uri);
      if (pages.length > 0) {
        created.push(createDoc(stripExtension(asset.name), pages, target));
      }
    } else {
      const out = new File(scratchDir(), 'image.jpg');
      images.push(await kit().render(asset.uri, out.uri, 0, 'none', 3200));
      imagesName = imagesName ?? stripExtension(asset.name);
    }
  }
  if (images.length > 0) {
    created.push(createDoc(imagesName ?? defaultName('Import'), images, target));
  }
  return created;
}

export async function importFromPhotos(target: Target): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    orderedSelection: true,
    quality: 1,
  });
  if (result.canceled || result.assets.length === 0) {
    return null;
  }
  ensureDirs();
  const images: KitPage[] = [];
  for (const asset of result.assets) {
    const out = new File(scratchDir(), 'image.jpg');
    images.push(await kit().render(asset.uri, out.uri, 0, 'none', 3200));
  }
  return createDoc(defaultName('Photo'), images, target);
}

// --- Exporting --------------------------------------------------------------

export async function sharePdf(docId: string) {
  const doc = findDoc(docId);
  if (!doc || doc.pages.length === 0) {
    return;
  }
  ensureDirs();
  const out = new File(scratchDir(), `${safeFileName(doc.name)}.pdf`);
  await kit().makePdf(
    doc.pages.map((page) => pageUri(doc.id, page.file)),
    out.uri,
  );
  await Sharing.shareAsync(out.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
}

// --- Page tools -------------------------------------------------------------

export async function rotatePage(docId: string, pageId: string) {
  const page = findDoc(docId)?.pages.find((item) => item.id === pageId);
  if (!page) {
    return;
  }
  const directory = docDir(docId);
  const file = `${newId()}.jpg`;
  const info = await kit().render(pageUri(docId, page.file), new File(directory, file).uri, 1, 'none', 0);
  let original = page.original;
  if (page.original) {
    original = `${newId()}.jpg`;
    await kit().render(pageUri(docId, page.original), new File(directory, original).uri, 1, 'none', 0);
    removePageFile(docId, page.original);
  }
  removePageFile(docId, page.file);
  patchPage(docId, pageId, { file, original, width: info.width, height: info.height });
}

export async function setPageFilter(docId: string, pageId: string, filter: PageFilter) {
  const page = findDoc(docId)?.pages.find((item) => item.id === pageId);
  if (!page || (page.filter ?? 'none') === filter) {
    return;
  }
  if (filter === 'none') {
    if (page.original) {
      removePageFile(docId, page.file);
      patchPage(docId, pageId, { file: page.original, original: undefined, filter: undefined });
    }
    return;
  }
  const source = page.original ?? page.file;
  const file = `${newId()}.jpg`;
  await kit().render(pageUri(docId, source), new File(docDir(docId), file).uri, 0, filter, 0);
  if (page.original) {
    removePageFile(docId, page.file);
  }
  patchPage(docId, pageId, { file, original: source, filter });
}

export function movePage(docId: string, from: number, to: number) {
  const doc = findDoc(docId);
  if (!doc || to < 0 || to >= doc.pages.length || from === to) {
    return;
  }
  const pages = [...doc.pages];
  const [page] = pages.splice(from, 1);
  pages.splice(to, 0, page);
  useStore.getState().updateDoc(docId, { pages });
}

// Returns false when the last page was removed and the document was deleted with it.
export async function deletePage(docId: string, pageId: string): Promise<boolean> {
  const doc = findDoc(docId);
  const page = doc?.pages.find((item) => item.id === pageId);
  if (!doc || !page) {
    return true;
  }
  if (doc.pages.length === 1) {
    await deleteDoc(docId);
    return false;
  }
  removePageFile(docId, page.file);
  removePageFile(docId, page.original);
  useStore.getState().updateDoc(docId, { pages: doc.pages.filter((item) => item.id !== pageId) });
  useStore.getState().dropText([pageId]);
  return true;
}

export async function deleteDoc(docId: string) {
  const doc = findDoc(docId);
  if (!doc) {
    return;
  }
  await cancelReminders(doc.reminderIds);
  const directory = docDir(docId);
  if (directory.exists) {
    directory.delete();
  }
  useStore.getState().removeDoc(docId);
}

export async function setExpiry(docId: string, expiresAt: number | null) {
  const doc = findDoc(docId);
  if (!doc) {
    return;
  }
  const reminderIds = await scheduleReminders(doc, expiresAt);
  useStore.getState().updateDoc(docId, { expiresAt, reminderIds });
}

export async function renameDoc(docId: string, name: string) {
  const doc = findDoc(docId);
  const trimmed = name.trim();
  if (!doc || !trimmed || trimmed === doc.name) {
    return;
  }
  useStore.getState().updateDoc(docId, { name: trimmed });
  if (doc.expiresAt !== null) {
    // Reminders carry the document name, so they are rebuilt.
    const reminderIds = await scheduleReminders({ ...doc, name: trimmed }, doc.expiresAt);
    useStore.getState().updateDoc(docId, { reminderIds });
  }
}

// --- Text recognition -------------------------------------------------------

let textChain: Promise<void> = Promise.resolve();
const textQueued = new Set<string>();

// Recognises text for every page that has none yet, one page at a time.
export function queueText(onlyDocId?: string) {
  const module = EdocKit;
  if (!module) {
    return;
  }
  const { docs, text } = useStore.getState();
  for (const doc of docs) {
    if (onlyDocId && doc.id !== onlyDocId) {
      continue;
    }
    for (const page of doc.pages) {
      if (page.id in text || textQueued.has(page.id)) {
        continue;
      }
      textQueued.add(page.id);
      textChain = textChain.then(async () => {
        try {
          // The page may have been edited or removed while waiting in the queue.
          const current = findDoc(doc.id)?.pages.find((item) => item.id === page.id);
          if (!current) {
            return;
          }
          const value = await module.recognizeText(pageUri(doc.id, current.original ?? current.file));
          useStore.getState().setText(page.id, value);
        } catch {
          useStore.getState().setText(page.id, '');
        } finally {
          textQueued.delete(page.id);
        }
      });
    }
  }
}

// --- Backup -----------------------------------------------------------------

export async function exportBackup() {
  flushStore();
  ensureDirs();
  const { docs, text } = useStore.getState();
  const stamp = new Date().toISOString().slice(0, 10);
  const out = new File(scratchDir(), `eDoc-backup-${stamp}.zip`);
  out.create({ intermediates: true, overwrite: true });
  const handle = out.open(FileMode.WriteOnly);
  try {
    const zip = createZipWriter({ write: (bytes) => handle.writeBytes(bytes) });
    zip.add('library.json', textToBytes(JSON.stringify(snapshotLibrary())));
    zip.add('text.json', textToBytes(JSON.stringify(text)));
    for (const doc of docs) {
      for (const page of doc.pages) {
        for (const name of [page.file, page.original]) {
          const file = name ? new File(filesDir, doc.id, name) : null;
          if (name && file?.exists) {
            zip.add(`files/${doc.id}/${name}`, await file.bytes());
          }
        }
      }
    }
    zip.finish();
  } finally {
    handle.close();
  }
  await Sharing.shareAsync(out.uri, { mimeType: 'application/zip', UTI: 'public.zip-archive' });
}

// Replaces the whole library with the content of a backup archive.
export async function restoreBackup(): Promise<boolean> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/zip', 'public.zip-archive'],
    copyToCacheDirectory: true,
  });
  if (result.canceled) {
    return false;
  }
  ensureDirs();
  const archive = new File(result.assets[0].uri);
  const staging = scratchDir();
  staging.create({ intermediates: true, idempotent: true });
  let library: Library;
  let text: TextIndex = {};

  const handle = archive.open(FileMode.ReadOnly);
  try {
    const source: ZipSource = {
      size: handle.size ?? archive.size,
      read: (offset, length) => {
        handle.offset = offset;
        return handle.readBytes(length);
      },
    };
    const entries = readZipEntries(source);
    const libraryEntry = entries.find((entry) => entry.name === 'library.json');
    if (!libraryEntry) {
      throw new Error('This file is not an eDoc backup');
    }
    library = JSON.parse(bytesToText(readZipEntry(source, libraryEntry))) as Library;
    if (!Array.isArray(library.docs) || !Array.isArray(library.folders)) {
      throw new Error('This file is not an eDoc backup');
    }
    const textEntry = entries.find((entry) => entry.name === 'text.json');
    if (textEntry) {
      text = JSON.parse(bytesToText(readZipEntry(source, textEntry))) as TextIndex;
    }
    for (const entry of entries) {
      const match = /^files\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_.-]+)$/.exec(entry.name);
      if (!match) {
        continue;
      }
      const directory = new Directory(staging, match[1]);
      if (!directory.exists) {
        directory.create({ intermediates: true, idempotent: true });
      }
      const file = new File(directory, match[2]);
      file.create({ overwrite: true });
      file.write(readZipEntry(source, entry));
    }
  } finally {
    handle.close();
  }

  await Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
  if (filesDir.exists) {
    filesDir.delete();
  }
  staging.moveSync(filesDir);

  const docs: Doc[] = [];
  for (const doc of library.docs) {
    const reminderIds = doc.expiresAt ? await scheduleReminders({ ...doc, reminderIds: [] }, doc.expiresAt) : [];
    docs.push({ ...doc, reminderIds });
  }
  useStore.getState().replaceAll({ ...library, docs }, text);
  flushStore();
  queueText();
  return true;
}

export function resetTemp() {
  clearTemp();
}
