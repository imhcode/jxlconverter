import './style.css';
import { downloadZip } from 'client-zip';
import { EncoderPool } from './queue';
import { initAnalytics, track } from './analytics';
import { bytes, extOf, savedPct, toJxlName } from './format';
import type { Settings, WorkerResponse } from './types';

initAnalytics();

// ---------- State ----------
type Status = 'queued' | 'working' | 'done' | 'error';

interface Item {
  id: number;
  file: File;
  thumb: string;
  status: Status;
  version: number; // bumps on re-encode so stale results are ignored
  output?: Blob;
  url?: string;
  error?: string;
  el: HTMLLIElement;
}

const settings: Settings = { quality: 85, lossless: false, effort: 7 };
const items: Item[] = [];
let nextId = 1;
const pool = new EncoderPool();

// batch stats for analytics (one event per batch, not per file)
let batch = { count: 0, input: 0, output: 0, start: 0 };

// ---------- Elements ----------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const dropzone = $<HTMLLabelElement>('dropzone');
const fileInput = $<HTMLInputElement>('file-input');
const quality = $<HTMLInputElement>('quality');
const qualityValue = $<HTMLOutputElement>('quality-value');
const lossless = $<HTMLInputElement>('lossless');
const effort = $<HTMLDivElement>('effort');
const results = $<HTMLElement>('results');
const list = $<HTMLUListElement>('file-list');
const summaryText = $<HTMLParagraphElement>('summary-text');
const downloadAll = $<HTMLButtonElement>('download-all');
const clearBtn = $<HTMLButtonElement>('clear');

// ---------- Input ----------
fileInput.addEventListener('change', () => {
  if (fileInput.files) addFiles([...fileInput.files]);
  fileInput.value = '';
});

dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  if (++dragDepth === 1) dropzone.classList.add('dragging');
});
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    dropzone.classList.remove('dragging');
  }
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropzone.classList.remove('dragging');
  const files = [...(e.dataTransfer?.files ?? [])];
  if (files.length) addFiles(files);
});

window.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files ?? [])];
  if (files.length) addFiles(files);
});

function isImage(f: File) {
  return f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|avif|bmp|svg|ico|tiff?)$/i.test(f.name);
}

function addFiles(files: File[]) {
  const images = files.filter(isImage);
  if (!images.length) return;
  track('files_added', {
    count: images.length,
    formats: [...new Set(images.map(extOf))].sort().join(','),
  });
  for (const file of images) {
    const item: Item = {
      id: nextId++,
      file,
      thumb: URL.createObjectURL(file),
      status: 'queued',
      version: 0,
      el: document.createElement('li'),
    };
    item.el.className = 'file';
    items.push(item);
    list.prepend(item.el);
    convert(item);
  }
  render();
}

// ---------- Conversion ----------
async function convert(item: Item) {
  const version = ++item.version;
  item.status = 'working';
  item.error = undefined;
  if (!batch.count) batch.start = performance.now();
  batch.count++;
  renderItem(item);

  const s = { ...settings };
  let res: WorkerResponse;
  if (item.file.type === 'image/svg+xml') {
    // Workers can't rasterize SVG; decode on the main thread instead.
    res = await decodeOnMain(item.file).then(
      (pixels) => pool.encode({ pixels }, s),
      () => ({ id: 0, ok: false as const, decode: true, error: 'Could not read this SVG' }),
    );
  } else {
    res = await pool.encode({ file: item.file }, s);
    if (!res.ok && res.decode) {
      // Fallback: some formats (e.g. ICO) decode via <img> but not createImageBitmap in workers.
      const pixels = await decodeOnMain(item.file).catch(() => null);
      if (pixels) res = await pool.encode({ pixels }, s);
    }
  }

  if (version !== item.version || !items.includes(item)) {
    finishBatchIfIdle();
    return; // stale result
  }

  if (res.ok) {
    if (item.url) URL.revokeObjectURL(item.url);
    item.output = new Blob([res.buffer], { type: 'image/jxl' });
    item.url = URL.createObjectURL(item.output);
    item.status = 'done';
    batch.input += item.file.size;
    batch.output += item.output.size;
  } else {
    item.status = 'error';
    item.error = res.error;
    track('conversion_error', { format: extOf(item.file), reason: res.decode ? 'decode' : 'encode' });
  }
  renderItem(item);
  render();
  finishBatchIfIdle();
}

function finishBatchIfIdle() {
  if (items.some((i) => i.status === 'working' || i.status === 'queued')) return;
  if (batch.input > 0) {
    track('conversion_complete', {
      count: batch.count,
      input_bytes: batch.input,
      output_bytes: batch.output,
      saved_pct: savedPct(batch.input, batch.output),
      quality: settings.quality,
      lossless: settings.lossless,
      effort: settings.effort,
      duration_ms: Math.round(performance.now() - batch.start),
    });
  }
  batch = { count: 0, input: 0, output: 0, start: 0 };
}

function decodeOnMain(file: File): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const w = img.naturalWidth || 1024;
      const h = img.naturalHeight || 1024;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const g = canvas.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(g.getImageData(0, 0, w, h));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode'));
    };
    img.src = url;
  });
}

// Re-encode everything when settings change (debounced).
let reencodeTimer = 0;
function settingsChanged(setting: keyof Settings) {
  track('settings_changed', { setting, value: settings[setting] });
  clearTimeout(reencodeTimer);
  reencodeTimer = window.setTimeout(() => {
    items.forEach((i) => convert(i));
    render();
  }, 450);
}

// ---------- Settings ----------
quality.addEventListener('input', () => {
  qualityValue.value = quality.value;
});
quality.addEventListener('change', () => {
  settings.quality = Number(quality.value);
  settingsChanged('quality');
});

lossless.addEventListener('change', () => {
  settings.lossless = lossless.checked;
  quality.disabled = lossless.checked;
  quality.closest('.field')!.classList.toggle('disabled', lossless.checked);
  settingsChanged('lossless');
});

effort.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-effort]');
  if (!btn) return;
  effort.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b === btn)));
  settings.effort = Number(btn.dataset.effort);
  settingsChanged('effort');
});

// ---------- Download ----------
downloadAll.addEventListener('click', async () => {
  const done = items.filter((i) => i.status === 'done' && i.output);
  if (!done.length) return;
  if (done.length === 1) {
    save(done[0].url!, toJxlName(done[0].file.name));
    track('download', { type: 'single', count: 1 });
    return;
  }
  const used = new Map<string, number>();
  const files = done.map((i) => {
    let name = toJxlName(i.file.name);
    const n = used.get(name) ?? 0;
    used.set(name, n + 1);
    if (n) name = name.replace(/\.jxl$/, ` (${n}).jxl`);
    return { name, input: i.output!, lastModified: new Date() };
  });
  downloadAll.disabled = true;
  const zip = await downloadZip(files).blob();
  const url = URL.createObjectURL(zip);
  save(url, 'jxl-images.zip');
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  downloadAll.disabled = false;
  track('download', { type: 'zip', count: files.length });
});

function save(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

list.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const li = target.closest<HTMLLIElement>('li.file');
  const item = items.find((i) => i.el === li);
  if (!item) return;
  if (target.closest('[data-action="remove"]')) {
    removeItem(item);
    render();
  } else if (target.closest('[data-action="download"]')) {
    track('download', { type: 'single', count: 1 });
  }
});

clearBtn.addEventListener('click', () => {
  [...items].forEach(removeItem);
  render();
});

function removeItem(item: Item) {
  items.splice(items.indexOf(item), 1);
  item.el.remove();
  URL.revokeObjectURL(item.thumb);
  if (item.url) URL.revokeObjectURL(item.url);
  finishBatchIfIdle();
}

// ---------- Render ----------
const ICON_DOWNLOAD =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v12"/><path d="m6 10 6 6 6-6"/><path d="M4 20h16"/></svg>';
const ICON_REMOVE =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function renderItem(item: Item) {
  const name = escapeHtml(item.file.name);
  let detail = '';
  if (item.status === 'done' && item.output) {
    const pct = savedPct(item.file.size, item.output.size);
    const pill = pct > 0 ? `<span class="pill">−${pct}%</span>` : `<span class="pill worse">+${-pct}%</span>`;
    detail = `<div class="sizes"><span>${bytes(item.file.size)} → ${bytes(item.output.size)}</span>${pill}</div>`;
  } else if (item.status === 'error') {
    detail = `<div class="sizes error">${escapeHtml(item.error ?? 'Failed')}</div>`;
  } else {
    detail = `<div class="sizes"><span>${bytes(item.file.size)} · Converting…</span></div><div class="progress"><span></span></div>`;
  }
  const download =
    item.status === 'done'
      ? `<a class="icon-btn download" data-action="download" href="${item.url}" download="${escapeHtml(toJxlName(item.file.name))}" title="Download" aria-label="Download ${name}">${ICON_DOWNLOAD}</a>`
      : '';
  item.el.dataset.status = item.status;
  item.el.innerHTML = `
    <img class="thumb" src="${item.thumb}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />
    <div class="meta"><div class="name" title="${name}">${name}</div>${detail}</div>
    <div class="actions">${download}<button type="button" class="icon-btn" data-action="remove" title="Remove" aria-label="Remove ${name}">${ICON_REMOVE}</button></div>`;
}

function render() {
  results.hidden = items.length === 0;
  const done = items.filter((i) => i.status === 'done' && i.output);
  const working = items.filter((i) => i.status === 'working' || i.status === 'queued').length;
  const input = done.reduce((a, i) => a + i.file.size, 0);
  const output = done.reduce((a, i) => a + i.output!.size, 0);
  const saved = input - output;

  let text = '';
  if (done.length) {
    const fileWord = done.length === 1 ? 'file' : 'files';
    text =
      saved > 0
        ? `<strong>${done.length} ${fileWord}</strong> · saved <span class="good">${bytes(saved)} (−${savedPct(input, output)}%)</span>`
        : `<strong>${done.length} ${fileWord}</strong> · ${bytes(input)} → ${bytes(output)}`;
  }
  if (working) text += `${text ? ' · ' : ''}${working} converting…`;
  summaryText.innerHTML = text;

  downloadAll.disabled = done.length === 0;
  downloadAll.textContent = done.length > 1 ? `Download all (.zip)` : 'Download';
}
