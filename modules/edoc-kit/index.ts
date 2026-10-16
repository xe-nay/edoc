import { requireOptionalNativeModule } from 'expo';

export type KitPage = {
  uri: string;
  width: number;
  height: number;
};

export type KitFilter = 'none' | 'enhance' | 'gray' | 'bw';

type EdocKitModule = {
  // Opens the system document scanner; resolves with [] when cancelled.
  // maxPages 0 means no limit; iOS cannot limit its scanner, so callers keep only what they need.
  scan(outDir: string, maxPages: number): Promise<KitPage[]>;
  // Android only: has Google Play services fetch the text recognition model ahead of use.
  prepareTextRecognition?(): Promise<void>;
  // Encrypts the tree while the device is locked and sets whether backups include it.
  secure(uri: string, excludeFromBackup: boolean): Promise<void>;
  // Android only: keeps the app out of screenshots and the recent-apps preview.
  setScreenSecure?(enabled: boolean): Promise<void>;
  recognizeText(uri: string): Promise<string>;
  // quarterTurns rotates clockwise in 90 degree steps; maxDimension 0 keeps the size.
  render(uri: string, outUri: string, quarterTurns: number, filter: KitFilter, maxDimension: number): Promise<KitPage>;
  // Files whose name ends in ".enc" are encrypted with a key kept in this iPhone's keychain.
  // Every function below reads and writes such files transparently.
  transcode(uri: string, outUri: string): Promise<void>;
  // Base64 JPEG, decrypted in memory only. maxDimension 0 keeps the stored size.
  readImage(uri: string, maxDimension: number): Promise<string>;
  isSealedArchive(uri: string): Promise<boolean>;
  sealArchive(uri: string, outUri: string, password: string): Promise<void>;
  openArchive(uri: string, outUri: string, password: string): Promise<void>;
  pdfToImages(uri: string, outDir: string): Promise<KitPage[]>;
  // A non-empty password produces an encrypted PDF that asks for it when opened.
  makePdf(uris: string[], outUri: string, password: string): Promise<string>;
};

// Null outside iOS (for example in the web preview).
export default requireOptionalNativeModule<EdocKitModule>('EdocKit');
