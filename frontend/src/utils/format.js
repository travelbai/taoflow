export function formatAPY(v) {
  if (v == null) return '—';
  return `${Number(v).toFixed(2)}%`;
}

export function formatTVL(usd) {
  if (!usd || usd <= 0) return '—';
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(2)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(2)}M`;
  if (usd >= 1e3) return `$${Math.round(usd / 1e3)}K`;
  return `$${Math.round(usd)}`;
}

export function formatUTC(date) {
  if (!date) return '-- --- ---- --:-- UTC';
  return date.toUTCString().replace('GMT', 'UTC');
}

export function relativeTime(ts) {
  if (!ts) return '';
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)} mins ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} hours ago`;
  return `${Math.floor(secs / 86400)} days ago`;
}
