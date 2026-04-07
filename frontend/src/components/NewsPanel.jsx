import { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '';

const toBeijingTime = iso =>
  new Date(iso).toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false,
  });

const toBeijingDate = iso =>
  new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });

const toDateLabel = dateStr =>
  new Date(dateStr + 'T00:00:00Z').toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric',
  });

const S = {
  title: {
    fontWeight: 400, fontSize: 16, color: '#16a34a', lineHeight: '26px',
    letterSpacing: '-0.01em',
  },
  body: {
    fontSize: 14.5, color: '#52525b', lineHeight: '28px', marginTop: 24,
  },
  link: {
    fontSize: 13, color: '#a1a1aa', marginTop: 24, display: 'inline-block',
    transition: 'color 0.15s',
  },
  dot: {
    width: 10, height: 10, borderRadius: '50%', backgroundColor: '#22c55e',
    flexShrink: 0, marginTop: 8, boxShadow: '0 0 0 3px rgba(34,197,94,0.15)',
  },
  line: {
    width: 1, flexGrow: 1, borderLeft: '2px dashed #e4e4e7', marginLeft: 4,
  },
  time: {
    fontSize: 13, color: '#16a34a', fontFamily: 'monospace',
    whiteSpace: 'nowrap', flexShrink: 0, fontWeight: 500, opacity: 0.7,
  },
  tag: {
    fontSize: 12, color: '#16a34a', backgroundColor: 'rgba(34,197,94,0.08)',
    padding: '3px 10px', borderRadius: 20, fontFamily: 'monospace',
    letterSpacing: '0.03em', whiteSpace: 'nowrap', flexShrink: 0,
    fontWeight: 600, border: '1px solid rgba(34,197,94,0.15)',
  },
  dateSep: {
    fontSize: 12, color: '#a1a1aa', fontFamily: 'monospace',
    letterSpacing: '0.12em', textTransform: 'uppercase', whiteSpace: 'nowrap',
    fontWeight: 500,
  },
};

export default function NewsPanel({ onTabClick }) {
  const [news, setNews]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    if (!API_BASE) { setLoading(false); return; }
    fetch(`${API_BASE}/api/news?days=30`)
      .then(r => r.json())
      .then(data => { setNews(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => { setError('加载失败'); setLoading(false); });
  }, []);

  const grouped = news.reduce((acc, item) => {
    const d = toBeijingDate(item.created_at);
    (acc[d] ??= []).push(item);
    return acc;
  }, {});
  const dates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));
  const latestDate = dates[0] ?? null;

  const items = [];
  for (const date of dates) {
    if (date !== latestDate) {
      items.push({ type: 'separator', date });
    }
    for (const item of grouped[date]) {
      items.push({ type: 'news', ...item });
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Tab row */}
      <div className="border border-zinc-200 bg-white">
        <div className="px-6 py-4 flex items-center justify-between">
          <button onClick={() => onTabClick?.('home')} className="text-sm font-medium tracking-widest uppercase text-zinc-400 hover:text-zinc-600 pb-0.5">NET FLOW</button>
          <button onClick={() => onTabClick?.('staking')} className="text-sm font-medium tracking-widest uppercase text-zinc-400 hover:text-zinc-600 pb-0.5">Staking</button>
          <button className="text-sm font-medium tracking-widest uppercase text-black border-b-2 border-green-500 pb-0.5">News</button>
        </div>
      </div>

      {/* News list */}
      <div className="border border-zinc-200 bg-white rounded-sm">
        {loading ? (
          <div className="px-6 py-16 text-center text-zinc-400 font-mono text-sm">加载中...</div>
        ) : error ? (
          <div className="px-6 py-16 text-center text-red-400 font-mono text-sm">{error}</div>
        ) : !news.length ? (
          <div className="px-6 py-16 text-center text-zinc-400 font-mono text-sm">暂无快讯</div>
        ) : (
          <div style={{ overflowY: 'auto', height: 'calc(100vh - 140px)', padding: '0 24px' }}>
          <div style={{ maxWidth: 600, margin: '0 auto', width: '100%', paddingTop: 28, paddingBottom: 32 }}>
            {items.map((item, idx) => {
              if (item.type === 'separator') {
                return (
                  <div key={`sep-${item.date}`} style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '8px 0', marginLeft: 26 }}>
                    <div style={{ flex: 1, height: '1px', backgroundColor: '#e5e5e5' }} />
                    <span style={{ fontSize: '12px', color: '#aaa', letterSpacing: '0.06em', fontWeight: 400, whiteSpace: 'nowrap' }}>
                      {toDateLabel(item.date)}
                    </span>
                    <div style={{ flex: 1, height: '1px', backgroundColor: '#e5e5e5' }} />
                  </div>
                );
              }

              const isLast = idx === items.length - 1 || (idx < items.length - 1 && items[idx + 1].type === 'separator');

              return (
                <div key={item.key} className="flex" style={{ gap: 16 }}>
                  {/* Timeline: dot + dashed line */}
                  <div className="flex flex-col items-center" style={{ width: 10 }}>
                    <div style={S.dot} />
                    {!isLast && <div style={S.line} />}
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, paddingBottom: 20 }}>
                    {/* Meta + Title in one line */}
                    <div className="flex items-baseline flex-wrap" style={{ gap: '0 10px' }}>
                      <span style={S.time}>{toBeijingTime(item.created_at)}</span>
                      <span style={S.tag}>{item.subnet}</span>
                      <span style={S.title}>{item.title || item.content?.slice(0, 15)}</span>
                    </div>

                    {/* Body — split into paragraphs on Chinese period */}
                    <div style={S.body}>
                      {item.content?.split(/(?<=。)/).filter(Boolean).map((p, i) => (
                        <p key={i} style={{ margin: 0, marginTop: i > 0 ? 12 : 0 }}>{p}</p>
                      ))}
                    </div>

                    {/* Source link */}
                    {item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={S.link}
                        className="hover:text-green-600 no-underline"
                      >
                        查看原文 ↗
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          </div>
        )}
      </div>
    </div>
  );
}
