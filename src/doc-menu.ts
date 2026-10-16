import { Alert } from 'react-native';

import { deleteDoc, duplicateDoc, renameDoc, sharePdf } from './actions';
import { confirmIdentity } from './auth';
import { chooseOption, confirmDelete, promptSecret, promptText, showError } from './native-ui';
import { useStore } from './store';
import type { Doc } from './types';

const MIN_PDF_PASSWORD = 4;

// Lets the current sheet finish dismissing before the next native dialog appears.
function later(action: () => void) {
  setTimeout(action, 350);
}

export function askRename(doc: Doc) {
  promptText('Rename', doc.name, (name) => {
    renameDoc(doc.id, name).catch(showError);
  });
}

export function askMove(doc: Doc) {
  const { folders, updateDoc } = useStore.getState();
  chooseOption(
    [
      { label: 'No Folder', onPress: () => updateDoc(doc.id, { folderId: null }) },
      ...folders.map((folder) => ({
        label: folder.name,
        onPress: () => updateDoc(doc.id, { folderId: folder.id }),
      })),
    ],
    'Move to',
  );
}

export function askDelete(doc: Doc, onDeleted?: () => void) {
  confirmDelete(`Delete “${doc.name}”?`, 'This cannot be undone.', () => {
    deleteDoc(doc.id)
      .then(() => onDeleted?.())
      .catch(showError);
  });
}

// Shares the document as a PDF. A protected document leaves the app only after
// Face ID, fingerprint or the passcode, wherever the export was started from.
export async function shareDoc(doc: Doc, password: string | null = null) {
  try {
    if (doc.protected && !(await confirmIdentity('Export protected document'))) {
      return;
    }
    await sharePdf(doc.id, password);
  } catch (error) {
    showError(error);
  }
}

// Asks for a password, then shares a PDF that cannot be opened without it.
export function askSharePassword(doc: Doc, share: (password: string) => void = (password) => shareDoc(doc, password)) {
  promptSecret('PDF Password', 'Anyone opening the PDF will need this password.', (password) => {
    if (password.length < MIN_PDF_PASSWORD) {
      later(() => Alert.alert('Password too short', `Use at least ${MIN_PDF_PASSWORD} characters.`));
      return;
    }
    later(() => share(password));
  });
}

// Asks for the copy's name, makes the copy and hands its id to onDone (to open it).
export function askDuplicate(doc: Doc, onDone?: (copyId: string) => void) {
  promptText('Duplicate', `${doc.name} copy`, (name) => {
    duplicateDoc(doc.id, name)
      .then((copyId) => {
        if (copyId) {
          onDone?.(copyId);
        }
      })
      .catch(showError);
  });
}

// Long-press menu for a document in any list. onOpen opens a document, used for a new copy.
export function openDocMenu(doc: Doc, onOpen?: (docId: string) => void) {
  const { updateDoc } = useStore.getState();
  chooseOption(
    [
      { label: 'Share PDF', onPress: () => later(() => shareDoc(doc)) },
      { label: 'Share with Password', onPress: () => later(() => askSharePassword(doc)) },
      { label: 'Duplicate', onPress: () => later(() => askDuplicate(doc, onOpen)) },
      { label: 'Rename', onPress: () => later(() => askRename(doc)) },
      { label: 'Move', onPress: () => later(() => askMove(doc)) },
      {
        label: doc.favorite ? 'Remove from Favorites' : 'Add to Favorites',
        onPress: () => updateDoc(doc.id, { favorite: !doc.favorite }),
      },
      { label: 'Delete', destructive: true, onPress: () => later(() => askDelete(doc)) },
    ],
    doc.name,
  );
}
