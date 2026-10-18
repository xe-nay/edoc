import { renameDoc, setExpiry } from './actions';
import { pickDate, promptName, showError, suggestedExpiry } from './native-ui';
import { useStore } from './store';

// Every newly added document goes through a naming step before it opens.
// The short delay lets the scanner or picker finish closing first.
export function nameThenOpen(docId: string, open: (docId: string) => void) {
  const doc = useStore.getState().docs.find((item) => item.id === docId);
  if (!doc) {
    return;
  }
  setTimeout(() => {
    promptName(
      doc.name,
      (name) => {
        renameDoc(docId, name).catch(showError);
        open(docId);
      },
      // The name is saved first; picking a day saves the expiry date too, and then it opens.
      (name) => {
        renameDoc(docId, name).catch(showError);
        setTimeout(() => {
          pickDate(
            'Expiry Date',
            suggestedExpiry(),
            (day) => {
              setExpiry(docId, day.getTime()).catch(showError);
              open(docId);
            },
            () => open(docId),
          );
        }, 60);
      },
    );
  }, 450);
}
