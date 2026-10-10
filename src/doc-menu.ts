import { deleteDoc, renameDoc, sharePdf } from './actions';
import { chooseOption, confirmDelete, promptText, showError } from './native-ui';
import { useStore } from './store';
import type { Doc } from './types';

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

// Long-press menu for a document in any list.
export function openDocMenu(doc: Doc) {
  const { updateDoc } = useStore.getState();
  chooseOption(
    [
      { label: 'Share PDF', onPress: () => later(() => sharePdf(doc.id).catch(showError)) },
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
