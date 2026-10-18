import { renameDoc, reviewScan, setExpiry } from './actions';
import { pickDate, promptName, showError, suggestedExpiry } from './native-ui';
import { useStore } from './store';

// Every newly added document goes through a naming step before it opens: Save, or Set Expiry to
// save the name and pick the expiry date. For a scan, Cancel goes back to the scan's pages; the
// scan itself is only thrown away from the scanner. The short delay lets the scanner or picker
// finish closing first.
export function nameThenOpen(docId: string, open: (docId: string) => void, scanned = false) {
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
      scanned
        ? () =>
            reviewScan(docId)
              .then((kept) => {
                if (kept) {
                  nameThenOpen(docId, open, true);
                }
              })
              .catch(showError)
        : undefined,
    );
  }, 450);
}
