export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function savedPct(input: number, output: number): number {
  return input ? Math.round((1 - output / input) * 100) : 0;
}

export function extOf(file: File): string {
  const fromType = file.type.split('/')[1]?.replace('svg+xml', 'svg').replace('jpeg', 'jpg');
  return (fromType || file.name.split('.').pop() || 'unknown').toLowerCase();
}

export function toJxlName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '') || 'image';
  return `${base}.jxl`;
}
