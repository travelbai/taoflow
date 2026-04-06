import { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '';

const toBeijingTime = iso =>
  new Date(iso).toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false,
  });

const toDateLabel = dateStr =>
  new Date(dateStr + 'T00:00:00Z').toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric',
  });

const S = {
  title: { fontWeight: 500, fontSize: 14, color: '#18181b', lineHeight: '22px' },
  body: { fontSize: 13, color: '#71717a', lineHeight: '20px', marginTop: 2 },
  link: { fontSize: 12, color: '#a1a1aa', marginTop: 4, display: 'block' },
  dot: { width: 8, height: 8, borderRadius: '50%', backgroundColor: '#22c55e', flexShrink: 0, marginTop: 6 },
  line: { width: 1, flexGrow: 1, borderLeft: '1.5px dashed #d4d4d8', marginLeft: 3.5 },
  time: { fontSize: 11, color: '#a1a1aa', fontFamily: 'monospace', whiteSpace: 'nowrap', flexShrink: 0 },
  tag: { fontSize: 10, color: '#52525b', backgroundColor: '#f4f4f5', padding: '2px 6px', fontFamily: 'monospace', letterSpacing: '0.05em', whiteSpace: 'nowrap', flexShrink: 0 },
  dateSep: { fontSize: 10, color: '#a1a1aa', fontFamily: 'monospace', letterSpacing: '0.15em', textTransform: 'uppercase', whiteSpace: 'nowrap' },
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

  // Group by date, sorted newest first
  const grouped = news.reduce((acc, item) => {
    (acc[item.date] ??= []).push(item);
    return acc;
  }, {});
  const dates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));
  const latestDate = dates[0] ?? null;

  // Flatten all items with date separators for non-latest dates
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
      <div className="border border-zinc-200 bg-white">
        {loading ? (
          <div className="px-6 py-10 text-center text-zinc-400 font-mono text-xs">加载中...</div>
        ) : error ? (
          <div className="px-6 py-10 text-center text-red-400 font-mono text-xs">{error}</div>
        ) : !news.length ? (
          <div className="px-6 py-10 text-center text-zinc-400 font-mono text-xs">暂无快讯</div>
        ) : (
          <div className="max-h-[780px] overflow-y-auto px-6 py-4" style={{ scrollbarGutter: 'stable' }}>
            {items.map((item, idx) => {
              if (item.type === 'separator') {
                return (
                  <div key={`sep-${item.date}`} className="flex items-center gap-3 py-4">
                    <div className="flex-1 h-px bg-zinc-200" />
                    <span style={S.dateSep}>{toDateLabel(item.date)}</span>
                    <div className="flex-1 h-px bg-zinc-200" />
                  </div>
                );
              }

              const isLast = idx === items.length - 1 || (idx < items.length - 1 && items[idx + 1].type === 'separator');

              return (
                <div key={item.key} className="flex gap-3" style={{ minHeight: 60 }}>
                  {/* Timeline: dot + dashed line */}
                  <div className="flex flex-col items-center" style={{ width: 8 }}>
                    <div style={S.dot} />
                    {!isLast && <div style={S.line} />}
                  </div>

                  {/* Content */}
                  <div className="flex-1 pb-5">
                    {/* Meta row: time + subnet tag */}
                    <div className="flex items-center gap-2 mb-1">
                      <span style={S.time}>{toBeijingTime(item.created_at)}</span>
                      <span style={S.tag}>{item.subnet}</span>
                    </div>

                    {/* Title */}
                    <div style={S.title}>{item.title || item.content?.slice(0, 15)}</div>

                    {/* Body */}
                    <div style={S.body}>{item.content}</div>

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
        )}
      </div>
    </div>
  );
}
