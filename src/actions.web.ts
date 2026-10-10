// Browser stand-in used only for the design preview: device features do nothing.
import { useStore } from './store';
import type { PageFilter, Tag } from './types';

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

export async function sharePdf(_docId: string) {}

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

export async function exportBackup() {}

export async function restoreBackup(): Promise<boolean> {
  return false;
}

export function resetTemp() {}
