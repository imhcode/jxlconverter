// Google Analytics 4. Only loaded when VITE_GA_ID is set.
// Never sends file names, file contents or pixels — only anonymous counters.

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const GA_ID = (import.meta.env.VITE_GA_ID as string | undefined)?.trim();

export function initAnalytics() {
  if (!GA_ID) return;
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
  document.head.appendChild(s);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', GA_ID, { anonymize_ip: true });
}

type Events = {
  files_added: { count: number; formats: string };
  conversion_complete: {
    count: number;
    input_bytes: number;
    output_bytes: number;
    saved_pct: number;
    quality: number;
    lossless: boolean;
    effort: number;
    duration_ms: number;
  };
  conversion_error: { format: string; reason: string };
  download: { type: 'single' | 'zip'; count: number };
  settings_changed: { setting: string; value: string | number | boolean };
};

export function track<K extends keyof Events>(name: K, params: Events[K]) {
  window.gtag?.('event', name, params);
}
