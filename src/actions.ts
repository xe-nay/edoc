import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, FileMode } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import * as Sharing from 'expo-sharing';

import EdocKit, { type KitPage } from '../modules/edoc-kit';
import { cancelReminders, scheduleReminders } from './reminders';
import {
  clearTemp,
  docDir,
  ensureDirs,
  filesDir,
  pageFile,
  pageUri,
  rootDir,
  tempDir,
  type DocRef,
} from './storage';
import { flushStore, makeDoc, newId, snapshotLibrary, useStore } from './store';
import type { Doc, Library, Page, PageFilter, Tag, TextIndex } from './types';
import { bytesToText, createZipWriter, readZipEntries, readZipEntry, textToBytes, type ZipSource } from './zip';

export type Target = {
  folderId: string | null;
  tag: Tag | null;
};

export const MIN_PASSWORD_LENGTH = 8;

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

// Removes a working copy as soon as it is no longer needed, so nothing confidential lingers.
function discard(item: File | Directory | string) {
  try {
    const target = typeof item === 'string' ? new File(item) : item;
    if (target.exists) {
      target.delete();
    }
  } catch {
    // Left for the clean-up at next launch.
  }
}

// Applies device-lock encryption and the backup preference to everything eDoc stores.
export async function secureStorage() {
  if (!EdocKit) {
    return;
  }
  ensureDirs();
  await EdocKit.secure(rootDir.uri, !useStore.getState().settings.deviceBackup);
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

function fileNames(pages: Page[]) {
  return pages.flatMap((page) => (page.original ? [page.file, page.original] : [page.file]));
}

// Moves freshly produced images into the document's own directory,
// encrypting them on the way when the document is protected.
async function adoptPages(doc: DocRef, items: KitPage[]): Promise<Page[]> {
  const directory = docDir(doc.id);
  if (!directory.exists) {
    directory.create({ intermediates: true, idempotent: true });
  }
  const pages: Page[] = [];
  for (const item of items) {
    const id = newId();
    const file = `${id}.jpg`;
    if (doc.protected) {
      await kit().transcode(item.uri, pageUri(doc, file));
      discard(item.uri);
    } else {
      new File(item.uri).moveSync(pageFile(doc, file));
    }
    pages.push({ id, file, width: item.width, height: item.height });
  }
  return pages;
}

function removePageFile(doc: DocRef, name: string | undefined) {
  if (name) {
    discard(pageFile(doc, name));
  }
}

async function createDoc(name: string, items: KitPage[], target: Target) {
  const docId = newId();
  const protect = useStore.getState().settings.protectNew;
  const pages = await adoptPages({ id: docId, protected: protect }, items);
  const doc = makeDoc(name, pages, target.folderId, target.tag, docId);
  useStore.getState().addDoc(protect ? { ...doc, protected: true } : doc);
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
  const scratch = scratchDir();
  try {
    const pages = await kit().scan(scratch.uri);
    if (pages.length === 0) {
      return null;
    }
    return await createDoc(defaultName('Scan'), pages, target);
  } finally {
    discard(scratch);
  }
}

export async function scanMorePages(docId: string): Promise<number> {
  if (!findDoc(docId)) {
    return 0;
  }
  ensureDirs();
  const scratch = scratchDir();
  try {
    const pages = await kit().scan(scratch.uri);
    // The scanner can stay open for a while; work from the document as it is now.
    const doc = findDoc(docId);
    if (pages.length === 0 || !doc) {
      return 0;
    }
    const added = await adoptPages(doc, pages);
    useStore.getState().updateDoc(docId, { pages: [...doc.pages, ...added] });
    queueText(docId);
    return added.length;
  } finally {
    discard(scratch);
  }
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
  const scratch = scratchDir();
  const created: string[] = [];
  const images: KitPage[] = [];
  let imagesName: string | null = null;
  try {
    for (const asset of result.assets) {
      const isPdf = asset.mimeType === 'application/pdf' || asset.name.toLowerCase().endsWith('.pdf');
      if (isPdf) {
        const pages = await kit().pdfToImages(asset.uri, new Directory(scratch, newId()).uri);
        if (pages.length > 0) {
          created.push(await createDoc(stripExtension(asset.name), pages, target));
        }
      } else {
        const out = new File(scratch, `${newId()}.jpg`);
        images.push(await kit().render(asset.uri, out.uri, 0, 'none', 3200));
        imagesName = imagesName ?? stripExtension(asset.name);
      }
    }
    if (images.length > 0) {
      created.push(await createDoc(imagesName ?? defaultName('Import'), images, target));
    }
    return created;
  } finally {
    // The picker hands over copies in the cache; they are not kept.
    for (const asset of result.assets) {
      discard(asset.uri);
    }
    discard(scratch);
  }
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
  const scratch = scratchDir();
  const images: KitPage[] = [];
  try {
    for (const asset of result.assets) {
      const out = new File(scratch, `${newId()}.jpg`);
      images.push(await kit().render(asset.uri, out.uri, 0, 'none', 3200));
    }
    return await createDoc(defaultName('Photo'), images, target);
  } finally {
    for (const asset of result.assets) {
      discard(asset.uri);
    }
    discard(scratch);
  }
}

// --- Exporting --------------------------------------------------------------

// The shared PDF is an ordinary file, also for protected documents: it is decrypted
// for the share sheet and the working copy is removed as soon as the sheet closes.
export async function sharePdf(docId: string) {
  const doc = findDoc(docId);
  if (!doc || doc.pages.length === 0) {
    return;
  }
  ensureDirs();
  const scratch = scratchDir();
  const out = new File(scratch, `${safeFileName(doc.name)}.pdf`);
  try {
    await kit().makePdf(
      doc.pages.map((page) => pageUri(doc, page.file)),
      out.uri,
    );
    await Sharing.shareAsync(out.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
  } finally {
    discard(scratch);
  }
}

// --- Protection -------------------------------------------------------------

// Page of a protected document as a data URI, decrypted in memory only.
export async function loadProtectedImage(doc: DocRef, file: string, maxDimension: number) {
  const base64 = await kit().readImage(pageUri(doc, file), maxDimension);
  return `data:image/jpeg;base64,${base64}`;
}

// Text of one page, recognised on demand and never stored (used for protected documents).
export async function recognizePage(doc: DocRef, page: Page) {
  return kit().recognizeText(pageUri(doc, page.original ?? page.file));
}

// Encrypts or decrypts every page of a document in place.
export async function setProtected(docId: string, value: boolean) {
  const doc = findDoc(docId);
  if (!doc || Boolean(doc.protected) === value) {
    return;
  }
  const from: DocRef = { id: doc.id, protected: doc.protected };
  const to: DocRef = { id: doc.id, protected: value };
  const names = fileNames(doc.pages);
  const written: string[] = [];
  try {
    for (const name of names) {
      await kit().transcode(pageUri(from, name), pageUri(to, name));
      written.push(name);
    }
  } catch (error) {
    // Nothing is switched over unless every page made it.
    for (const name of written) {
      removePageFile(to, name);
    }
    throw error;
  }
  useStore.getState().updateDoc(docId, { protected: value });
  for (const name of names) {
    removePageFile(from, name);
  }
  if (value) {
    // Recognised text would reveal the content, so it is not kept for protected documents.
    useStore.getState().dropText(doc.pages.map((page) => page.id));
  } else {
    queueText(docId);
  }
}

export function hasProtectedDocs() {
  return useStore.getState().docs.some((doc) => doc.protected);
}

// --- Page tools -------------------------------------------------------------

export async function rotatePage(docId: string, pageId: string) {
  const doc = findDoc(docId);
  const page = doc?.pages.find((item) => item.id === pageId);
  if (!doc || !page) {
    return;
  }
  const file = `${newId()}.jpg`;
  const info = await kit().render(pageUri(doc, page.file), pageUri(doc, file), 1, 'none', 0);
  let original = page.original;
  if (page.original) {
    original = `${newId()}.jpg`;
    await kit().render(pageUri(doc, page.original), pageUri(doc, original), 1, 'none', 0);
    removePageFile(doc, page.original);
  }
  removePageFile(doc, page.file);
  patchPage(docId, pageId, { file, original, width: info.width, height: info.height });
}

export async function setPageFilter(docId: string, pageId: string, filter: PageFilter) {
  const doc = findDoc(docId);
  const page = doc?.pages.find((item) => item.id === pageId);
  if (!doc || !page || (page.filter ?? 'none') === filter) {
    return;
  }
  if (filter === 'none') {
    if (page.original) {
      removePageFile(doc, page.file);
      patchPage(docId, pageId, { file: page.original, original: undefined, filter: undefined });
    }
    return;
  }
  const source = page.original ?? page.file;
  const file = `${newId()}.jpg`;
  await kit().render(pageUri(doc, source), pageUri(doc, file), 0, filter, 0);
  if (page.original) {
    removePageFile(doc, page.file);
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
  removePageFile(doc, page.file);
  removePageFile(doc, page.original);
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
  discard(docDir(docId));
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

// Rebuilds every reminder at launch, so documents dated before a change of the
// reminder schedule follow the current one. Never asks for permission.
export async function refreshReminders() {
  for (const doc of useStore.getState().docs) {
    if (doc.expiresAt === null) {
      continue;
    }
    const reminderIds = await scheduleReminders(doc, doc.expiresAt, false);
    const current = findDoc(doc.id);
    if (current && current.expiresAt === doc.expiresAt) {
      // Written straight to the store entry so the document's "last changed" date is untouched.
      useStore.setState({
        docs: useStore.getState().docs.map((item) => (item.id === doc.id ? { ...item, reminderIds } : item)),
      });
    } else {
      await cancelReminders(reminderIds);
    }
  }
}

export async function renameDoc(docId: string, name: string) {
  const doc = findDoc(docId);
  const trimmed = name.trim();
  if (!doc || !trimmed || trimmed === doc.name) {
    return;
  }
  useStore.getState().updateDoc(docId, { name: trimmed });
}

// --- Text recognition -------------------------------------------------------

let textChain: Promise<void> = Promise.resolve();
const textQueued = new Set<string>();

// Recognises text for every page that has none yet, one page at a time.
// Protected documents are skipped: their text is never written to disk.
export function queueText(onlyDocId?: string) {
  const module = EdocKit;
  if (!module) {
    return;
  }
  const { docs, text } = useStore.getState();
  for (const doc of docs) {
    if (doc.protected || (onlyDocId && doc.id !== onlyDocId)) {
      continue;
    }
    for (const page of doc.pages) {
      if (page.id in text || textQueued.has(page.id)) {
        continue;
      }
      textQueued.add(page.id);
      textChain = textChain.then(async () => {
        try {
          // The document may have been edited, protected or removed while waiting in the queue.
          const currentDoc = findDoc(doc.id);
          const current = currentDoc?.pages.find((item) => item.id === page.id);
          if (!currentDoc || !current || currentDoc.protected) {
            return;
          }
          const value = await module.recognizeText(pageUri(currentDoc, current.original ?? current.file));
          if (!findDoc(doc.id)?.protected) {
            useStore.getState().setText(page.id, value);
          }
        } catch {
          // Not recorded, so the page is tried again at the next launch
          // (files cannot be read while the iPhone is locked).
        } finally {
          textQueued.delete(page.id);
        }
      });
    }
  }
}

// --- Backup -----------------------------------------------------------------

// Writes every document into one archive and opens the share sheet. With a password the
// archive is encrypted; without one it is a plain ZIP (not offered once protected documents exist).
export async function exportBackup(password: string | null) {
  if (!password && hasProtectedDocs()) {
    throw new Error('A password is required because some documents are protected');
  }
  flushStore();
  ensureDirs();
  const { docs, text } = useStore.getState();
  const stamp = new Date().toISOString().slice(0, 10);
  const scratch = scratchDir();
  try {
    const archive = new File(scratch, `eDoc-backup-${stamp}.zip`);
    archive.create({ intermediates: true, overwrite: true });
    const handle = archive.open(FileMode.WriteOnly);
    try {
      const zip = createZipWriter({ write: (bytes) => handle.writeBytes(bytes) });
      zip.add('library.json', textToBytes(JSON.stringify(snapshotLibrary())));
      zip.add('text.json', textToBytes(JSON.stringify(text)));
      for (const doc of docs) {
        for (const name of fileNames(doc.pages)) {
          const stored = pageFile(doc, name);
          if (!stored.exists) {
            continue;
          }
          // Inside the archive every page is in plain form; the archive itself is what gets encrypted.
          if (doc.protected) {
            const plain = new File(scratch, `${newId()}.jpg`);
            await kit().transcode(stored.uri, plain.uri);
            zip.add(`files/${doc.id}/${name}`, await plain.bytes());
            discard(plain);
          } else {
            zip.add(`files/${doc.id}/${name}`, await stored.bytes());
          }
        }
      }
      zip.finish();
    } finally {
      handle.close();
    }

    let shared = archive;
    if (password) {
      shared = new File(scratch, `eDoc-backup-${stamp}.edocbackup`);
      await kit().sealArchive(archive.uri, shared.uri, password);
      discard(archive);
    }
    await Sharing.shareAsync(shared.uri, {
      mimeType: password ? 'application/octet-stream' : 'application/zip',
      UTI: password ? 'public.data' : 'public.zip-archive',
    });
  } finally {
    discard(scratch);
  }
}

export type PickedBackup = {
  uri: string;
  // Encrypted with a password.
  sealed: boolean;
};

export async function pickBackup(): Promise<PickedBackup | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  if (result.canceled) {
    return null;
  }
  const uri = result.assets[0].uri;
  return { uri, sealed: await kit().isSealedArchive(uri) };
}

export function discardBackup(picked: PickedBackup) {
  discard(picked.uri);
}

// Replaces the whole library with the content of a backup archive.
export async function restoreBackup(picked: PickedBackup, password: string | null) {
  ensureDirs();
  const scratch = scratchDir();
  const staging = new Directory(scratch, 'files');
  staging.create({ intermediates: true, idempotent: true });
  let library: Library;
  let text: TextIndex = {};

  try {
    let archive = new File(picked.uri);
    if (picked.sealed) {
      archive = new File(scratch, 'backup.zip');
      await kit().openArchive(picked.uri, archive.uri, password ?? '');
    }

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

    // Protected documents are encrypted again with this iPhone's own key.
    for (const doc of library.docs) {
      if (!doc.protected) {
        continue;
      }
      for (const name of fileNames(doc.pages)) {
        const plain = new File(staging, doc.id, name);
        if (plain.exists) {
          await kit().transcode(plain.uri, new File(staging, doc.id, `${name}.enc`).uri);
          discard(plain);
        }
      }
    }

    await Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
    if (filesDir.exists) {
      filesDir.delete();
    }
    staging.moveSync(filesDir);
  } finally {
    discard(scratch);
  }
  discard(picked.uri);

  const docs: Doc[] = [];
  for (const doc of library.docs) {
    const reminderIds = doc.expiresAt ? await scheduleReminders({ ...doc, reminderIds: [] }, doc.expiresAt) : [];
    docs.push({ ...doc, reminderIds });
  }
  // Privacy settings of this iPhone win over the ones stored in the backup.
  const settings = useStore.getState().settings;
  useStore.getState().replaceAll({ ...library, docs, settings }, text);
  flushStore();
  await secureStorage();
  queueText();
}

export function resetTemp() {
  clearTemp();
}
