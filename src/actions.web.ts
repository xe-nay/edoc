// Browser stand-in used only for the design preview: device features do nothing.
import { pageUri, type DocRef } from './storage';
import { useStore } from './store';
import type { Page, PageFilter, Tag } from './types';

export type Target = {
  folderId: string | null;
  tag: Tag | null;
};

export async function scanDocument(_target: Target): Promise<string | null> {
  return null;
}

export async function scanMorePages(_docId: string): Promise<number> {
  return 0;
}

export async function importFromFiles(_target: Target): Promise<string[]> {
  return [];
}

export async function importFromPhotos(_target: Target): Promise<string | null> {
  return null;
}

export async function reviewScan(_docId: string): Promise<boolean> {
  return true;
}

export async function rescanPage(_docId: string, _pageId: string): Promise<string | null> {
  return null;
}

export async function duplicateDoc(docId: string, name: string): Promise<string | null> {
  const doc = useStore.getState().docs.find((item) => item.id === docId);
  if (!doc) {
    return null;
  }
  const id = `copy-${Date.now()}`;
  useStore.getState().addDoc({ ...doc, id, name, createdAt: Date.now(), updatedAt: Date.now() });
  return id;
}

export async function sharePdf(_docId: string, _password: string | null = null) {}

export async function rotatePage(_docId: string, _pageId: string) {}

export async function setPageFilter(docId: string, pageId: string, filter: PageFilter) {
  const doc = useStore.getState().docs.find((item) => item.id === docId);
  if (doc) {
    useStore.getState().updateDoc(docId, {
      pages: doc.pages.map((page) => (page.id === pageId ? { ...page, filter } : page)),
    });
  }
}

export function movePage(docId: string, from: number, to: number) {
  const doc = useStore.getState().docs.find((item) => item.id === docId);
  if (!doc || to < 0 || to >= doc.pages.length) {
    return;
  }
  const pages = [...doc.pages];
  const [page] = pages.splice(from, 1);
  pages.splice(to, 0, page);
  useStore.getState().updateDoc(docId, { pages });
}

export async function deletePage(docId: string, pageId: string): Promise<boolean> {
  const doc = useStore.getState().docs.find((item) => item.id === docId);
  if (!doc) {
    return true;
  }
  if (doc.pages.length === 1) {
    useStore.getState().removeDoc(docId);
    return false;
  }
  useStore.getState().updateDoc(docId, { pages: doc.pages.filter((page) => page.id !== pageId) });
  return true;
}

export async function deleteDoc(docId: string) {
  useStore.getState().removeDoc(docId);
}

export async function setExpiry(docId: string, expiresAt: number | null) {
  useStore.getState().updateDoc(docId, { expiresAt });
}

export async function renameDoc(docId: string, name: string) {
  if (name.trim()) {
    useStore.getState().updateDoc(docId, { name: name.trim() });
  }
}

export function queueText(_onlyDocId?: string) {}

export async function secureStorage() {}

export async function refreshReminders() {}

export const MIN_PASSWORD_LENGTH = 8;

export async function loadProtectedImage(doc: DocRef, file: string, _maxDimension: number) {
  return pageUri(doc, file);
}

export async function recognizePage(_doc: DocRef, _page: Page) {
  return 'EMPLOYMENT CONTRACT\nBetween the undersigned parties\nArticle 1 - Purpose';
}

export async function setProtected(docId: string, value: boolean) {
  useStore.getState().updateDoc(docId, { protected: value });
}

export function hasProtectedDocs() {
  return useStore.getState().docs.some((doc) => doc.protected);
}

export type PickedBackup = {
  uri: string;
  sealed: boolean;
};

export async function exportBackup(_password: string | null, _onlyDocIds?: string[]) {}

export async function pickBackup(): Promise<PickedBackup | null> {
  return null;
}

export function discardBackup(_picked: PickedBackup) {}

export type RestoreMode = 'replace' | 'merge';

export async function restoreBackup(_picked: PickedBackup, _password: string | null, _mode: RestoreMode) {}

export function resetTemp() {}
