/// <reference lib="webworker" />
// Everything here runs on the user's device. No network calls are made.
import encode from '@jsquash/jxl/encode';
import type { WorkerRequest, WorkerResponse } from './types';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

async function decode(file: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(file);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('Canvas not available');
  g.drawImage(bitmap, 0, 0);
  bitmap.close();
  return g.getImageData(0, 0, canvas.width, canvas.height);
}

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, file, pixels, settings } = e.data;
  let image: ImageData;
  try {
    image = pixels ?? (await decode(file!));
  } catch {
    const res: WorkerResponse = { id, ok: false, decode: true, error: 'Format not supported by this browser' };
    ctx.postMessage(res);
    return;
  }
  try {
    const buffer = await encode(image, {
      quality: settings.lossless ? 100 : settings.quality,
      lossless: settings.lossless,
      effort: settings.effort,
    });
    const res: WorkerResponse = { id, ok: true, buffer, width: image.width, height: image.height };
    ctx.postMessage(res, [buffer]);
  } catch (err) {
    const res: WorkerResponse = { id, ok: false, decode: false, error: (err as Error).message || 'Encoding failed' };
    ctx.postMessage(res);
  }
};
