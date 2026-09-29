export function relTime(ts) {
  if (ts === null || ts === undefined || ts === '') return '—';
  const at = typeof ts === 'number' ? ts : new Date(ts).getTime();
  if (!Number.isFinite(at)) return '—';
  const s = Math.floor((Date.now() - at) / 1000);
  if (s < 0) return 'только что';
  if (s < 60) return `${s} сек назад`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  return `${d} дн назад`;
}

export function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fmtClock(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fmtDuration(seconds) {
  if (seconds == null) return '—';
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}д ${h}ч`;
  if (h > 0) return `${h}ч ${m}м`;
  if (m > 0) return `${m}м ${s % 60}с`;
  return `${s}с`;
}

export function pct(v) {
  if (v == null || Number.isNaN(v)) return '—';
  return `${Number(v).toFixed(2)}%`;
}

export function statText(level) {
  if (!level) return 'Локальное устройство';
  if (level === 'embedded') return 'Встроенное';
  if (level === 'home') return 'Домашний сервер';
  if (level === 'cloud') return 'Облако';
  if (level === 'edge') return 'Edge';
  return level;
}