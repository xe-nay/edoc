export type Tag = 'personal' | 'professional';

export type PageFilter = 'none' | 'flex' | 'enhance' | 'gray' | 'bw';

export type Page = {
  id: string;
  // File name inside the document's directory.
  file: string;
  // Untouched copy kept once a filter has been applied, so filters stay reversible.
  original?: string;
  filter?: PageFilter;
  width: number;
  height: number;
};

export type Doc = {
  id: string;
  name: string;
  folderId: string | null;
  tag: Tag | null;
  favorite: boolean;
  pages: Page[];
  createdAt: number;
  updatedAt: number;
  // Local midnight of the expiry day.
  expiresAt: number | null;
  reminderIds: string[];
  // Pages are stored encrypted with a key that only exists in this iPhone's keychain.
  protected?: boolean;
};

export type Folder = {
  id: string;
  name: string;
  color: string;
  createdAt: number;
};

export type Settings = {
  faceId: boolean;
  // When false, documents are left out of iCloud and computer backups of the iPhone.
  deviceBackup: boolean;
  // Newly scanned and imported documents are protected straight away.
  protectNew: boolean;
};

export type Library = {
  version: 1;
  folders: Folder[];
  docs: Doc[];
  settings: Settings;
};

// Recognised text per page id.
export type TextIndex = Record<string, string>;

export type ScannedPage = {
  uri: string;
  width: number;
  height: number;
};
