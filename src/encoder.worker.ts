/// <reference lib="webworker" />
// Everything here runs on the user's device. No network calls are made.
import encode from '@jsquash/jxl/encode';
import { fitWithin } from './limits';
import type { FailCode, WorkerRequest, WorkerResponse } from './types';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

interface Decoded {
  image: ImageData;
  resizedFrom?: { width: number; height: number };
}

async function toImageData(source: Blob | ImageData): Promise<Decoded> {
  let bitmap = await createImageBitmap(source);
  const { width: w, height: h } = bitmap;
  const fit = fitWithin(w, h);
  if (fit.scaled) {
    // Let the browser resample while decoding, so we never allocate a huge canvas.
    const small = await createImageBitmap(bitmap, {
      resizeWidth: fit.width,
      resizeHeight: fit.height,
      resizeQuality: 'high',
    });
    bitmap.close();
    bitmap = small;
  }
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('Canvas not available');
  g.drawImage(bitmap, 0, 0);
  bitmap.close();
  return {
    image: g.getImageData(0, 0, canvas.width, canvas.height),
    resizedFrom: fit.scaled ? { width: w, height: h } : undefined,
  };
}

/** WebAssembly traps and aborts read differently per browser:
 *  Firefox "index out of bounds", Chrome "memory access out of bounds",
 *  Safari "Out of bounds memory access", Emscripten "Aborted()". */
function failCode(err: unknown): FailCode {
  const msg = String((err as Error)?.message ?? err);
  return /out of bounds|abort|out of memory|memory|unreachable|RuntimeError/i.test(msg) ? 'memory' : 'encode';
}

function fail(id: number, code: FailCode, error: string) {
  const res: WorkerResponse = { id, ok: false, code, error };
  ctx.postMessage(res);
}

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, file, pixels, settings } = e.data;
  let decoded: Decoded;
  try {
    decoded = await toImageData(pixels ?? file!);
  } catch {
    fail(id, 'decode', 'Format not supported by this browser');
    return;
  }
  try {
    const buffer = await encode(decoded.image, {
      quality: settings.lossless ? 100 : settings.quality,
      lossless: settings.lossless,
      effort: settings.effort,
    });
    const res: WorkerResponse = {
      id,
      ok: true,
      buffer,
      width: decoded.image.width,
      height: decoded.image.height,
      resizedFrom: decoded.resizedFrom,
    };
    ctx.postMessage(res, [buffer]);
  } catch (err) {
    // After a WASM abort the module is unusable; the pool replaces this worker.
    fail(id, failCode(err), (err as Error)?.message || 'Encoding failed');
  }
};
