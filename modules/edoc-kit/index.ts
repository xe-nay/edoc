import { requireOptionalNativeModule } from 'expo';

export type KitPage = {
  uri: string;
  width: number;
  height: number;
};

export type KitFilter = 'none' | 'enhance' | 'gray' | 'bw';

type EdocKitModule = {
  // Opens the system document scanner; resolves with [] when cancelled.
  scan(outDir: string): Promise<KitPage[]>;
  recognizeText(uri: string): Promise<string>;
  // quarterTurns rotates clockwise in 90 degree steps; maxDimension 0 keeps the size.
  render(uri: string, outUri: string, quarterTurns: number, filter: KitFilter, maxDimension: number): Promise<KitPage>;
  pdfToImages(uri: string, outDir: string): Promise<KitPage[]>;
  makePdf(uris: string[], outUri: string): Promise<string>;
};

// Null outside iOS (for example in the web preview).
export default requireOptionalNativeModule<EdocKitModule>('EdocKit');
