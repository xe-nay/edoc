import { renameDoc } from './actions';
import { promptName, showError } from './native-ui';
import { useStore } from './store';

// Every newly added document goes through a naming step before it opens.
// The short delay lets the scanner or picker finish closing first.
export function nameThenOpen(docId: string, open: (docId: string) => void) {
  const doc = useStore.getState().docs.find((item) => item.id === docId);
  if (!doc) {
    return;
  }
  setTimeout(() => {
    promptName(doc.name, (name) => {
      renameDoc(docId, name).catch(showError);
      open(docId);
    });
  }, 450);
}
