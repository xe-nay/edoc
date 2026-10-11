import { create } from 'zustand';

import { loadJson, saveJson } from './storage';
import type { Doc, Folder, Library, Page, Settings, Tag, TextIndex } from './types';

const LIBRARY_FILE = 'library.json';
const TEXT_FILE = 'text.json';

type State = {
  ready: boolean;
  folders: Folder[];
  docs: Doc[];
  settings: Settings;
  text: TextIndex;

  hydrate: () => void;
  replaceAll: (library: Library, text: TextIndex) => void;
  // Adds the content of a backup to what is already here; entries with the same id are replaced.
  mergeIn: (folders: Folder[], docs: Doc[], text: TextIndex) => void;

  addFolder: (name: string, color: string) => Folder;
  updateFolder: (id: string, patch: Partial<Pick<Folder, 'name' | 'color'>>) => void;
  removeFolder: (id: string) => void;
  // Moves a folder to a new position in the list.
  moveFolder: (id: string, toIndex: number) => void;

  addDoc: (doc: Doc) => void;
  updateDoc: (id: string, patch: Partial<Omit<Doc, 'id'>>) => void;
  removeDoc: (id: string) => void;

  setText: (pageId: string, value: string) => void;
  dropText: (pageIds: string[]) => void;
  updateSettings: (patch: Partial<Settings>) => void;
};

const emptyLibrary: Library = {
  version: 1,
  folders: [],
  docs: [],
  settings: { faceId: false, deviceBackup: false, protectNew: false },
};

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  folders: [],
  docs: [],
  settings: emptyLibrary.settings,
  text: {},

  hydrate: () => {
    const library = loadJson<Library>(LIBRARY_FILE) ?? emptyLibrary;
    const text = loadJson<TextIndex>(TEXT_FILE) ?? {};
    set({
      ready: true,
      folders: library.folders ?? [],
      docs: library.docs ?? [],
      settings: { ...emptyLibrary.settings, ...library.settings },
      text,
    });
  },

  replaceAll: (library, text) => {
    set({
      folders: library.folders ?? [],
      docs: library.docs ?? [],
      settings: { ...emptyLibrary.settings, ...library.settings },
      text,
    });
  },

  mergeIn: (folders, docs, text) => {
    const folderIds = new Set(folders.map((folder) => folder.id));
    const docIds = new Set(docs.map((doc) => doc.id));
    set({
      folders: [...get().folders.filter((folder) => !folderIds.has(folder.id)), ...folders],
      docs: [...docs, ...get().docs.filter((doc) => !docIds.has(doc.id))],
      text: { ...get().text, ...text },
    });
  },

  addFolder: (name, color) => {
    const folder: Folder = { id: newId(), name, color, createdAt: Date.now() };
    set({ folders: [...get().folders, folder] });
    return folder;
  },

  updateFolder: (id, patch) => {
    set({ folders: get().folders.map((folder) => (folder.id === id ? { ...folder, ...patch } : folder)) });
  },

  // Documents inside a removed folder are kept and moved back to the library root.
  removeFolder: (id) => {
    set({
      folders: get().folders.filter((folder) => folder.id !== id),
      docs: get().docs.map((doc) => (doc.folderId === id ? { ...doc, folderId: null } : doc)),
    });
  },

  moveFolder: (id, toIndex) => {
    const folders = [...get().folders];
    const from = folders.findIndex((folder) => folder.id === id);
    if (from < 0) {
      return;
    }
    const [folder] = folders.splice(from, 1);
    folders.splice(Math.max(0, Math.min(folders.length, toIndex)), 0, folder);
    set({ folders });
  },

  addDoc: (doc) => {
    set({ docs: [doc, ...get().docs] });
  },

  updateDoc: (id, patch) => {
    set({
      docs: get().docs.map((doc) => (doc.id === id ? { ...doc, ...patch, updatedAt: Date.now() } : doc)),
    });
  },

  removeDoc: (id) => {
    const doc = get().docs.find((item) => item.id === id);
    if (!doc) {
      return;
    }
    const text = { ...get().text };
    for (const page of doc.pages) {
      delete text[page.id];
    }
    set({ docs: get().docs.filter((item) => item.id !== id), text });
  },

  setText: (pageId, value) => {
    set({ text: { ...get().text, [pageId]: value } });
  },

  dropText: (pageIds) => {
    const text = { ...get().text };
    for (const pageId of pageIds) {
      delete text[pageId];
    }
    set({ text });
  },

  updateSettings: (patch) => {
    set({ settings: { ...get().settings, ...patch } });
  },
}));

export function snapshotLibrary(): Library {
  const { folders, docs, settings } = useStore.getState();
  return { version: 1, folders, docs, settings };
}

// Persist to disk shortly after any change. Library and recognised text live in
// separate files so a text update does not rewrite the whole library.
let libraryTimer: ReturnType<typeof setTimeout> | null = null;
let textTimer: ReturnType<typeof setTimeout> | null = null;

useStore.subscribe((state, previous) => {
  if (!state.ready) {
    return;
  }
  if (state.folders !== previous.folders || state.docs !== previous.docs || state.settings !== previous.settings) {
    if (libraryTimer) {
      clearTimeout(libraryTimer);
    }
    libraryTimer = setTimeout(() => saveJson(LIBRARY_FILE, snapshotLibrary()), 120);
  }
  if (state.text !== previous.text) {
    if (textTimer) {
      clearTimeout(textTimer);
    }
    textTimer = setTimeout(() => saveJson(TEXT_FILE, useStore.getState().text), 400);
  }
});

export function flushStore() {
  if (libraryTimer) {
    clearTimeout(libraryTimer);
    libraryTimer = null;
  }
  if (textTimer) {
    clearTimeout(textTimer);
    textTimer = null;
  }
  saveJson(LIBRARY_FILE, snapshotLibrary());
  saveJson(TEXT_FILE, useStore.getState().text);
}

export function makeDoc(name: string, pages: Page[], folderId: string | null, tag: Tag | null, id = newId()): Doc {
  const now = Date.now();
  return {
    id,
    name,
    folderId,
    tag,
    favorite: false,
    pages,
    createdAt: now,
    updatedAt: now,
    expiresAt: null,
    reminderIds: [],
  };
}

const DAY = 24 * 60 * 60 * 1000;

export function daysUntil(timestamp: number) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((timestamp - today.getTime()) / DAY);
}

export function searchDocs(docs: Doc[], text: TextIndex, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }
  return docs.filter((doc) => {
    if (doc.name.toLowerCase().includes(needle)) {
      return true;
    }
    return doc.pages.some((page) => (text[page.id] ?? '').toLowerCase().includes(needle));
  });
}
