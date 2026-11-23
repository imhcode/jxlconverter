export interface Settings {
  quality: number;
  lossless: boolean;
  effort: number;
}

export type WorkerRequest = {
  id: number;
  /** Either the original file (decoded inside the worker) or pre-decoded pixels. */
  file?: Blob;
  pixels?: ImageData;
  settings: Settings;
};

export type FailCode = 'decode' | 'memory' | 'encode';

export type WorkerResponse =
  | {
      id: number;
      ok: true;
      buffer: ArrayBuffer;
      width: number;
      height: number;
      /** Set when the image was scaled down to fit browser memory. */
      resizedFrom?: { width: number; height: number };
    }
  | { id: number; ok: false; code: FailCode; error: string };
