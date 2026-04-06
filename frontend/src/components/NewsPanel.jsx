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
    (acc[item.date] ??= []).push(item);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-8">
      {/* ── Title row ── */}
      <div className="border border-zinc-200 bg-white">
        <div className="px-6 py-4 flex items-center justify-between">
          <button onClick={() => onTabClick?.('home')} className="text-sm font-medium tracking-widest uppercase text-zinc-400 hover:text-zinc-600 pb-0.5">NET FLOW</button>
          <button onClick={() => onTabClick?.('staking')} className="text-sm font-medium tracking-widest uppercase text-zinc-400 hover:text-zinc-600 pb-0.5">Staking</button>
          <button className="text-sm font-medium tracking-widest uppercase text-black border-b-2 border-green-500 pb-0.5">News</button>
        </div>
      </div>

      <div className="border border-zinc-200 bg-white">
        {loading ? (
          <div className="px-6 py-10 text-center text-zinc-400 font-mono text-xs">加载中...</div>
        ) : error ? (
          <div className="px-6 py-10 text-center text-red-400 font-mono text-xs">{error}</div>
        ) : !news.length ? (
          <div className="px-6 py-10 text-center text-zinc-400 font-mono text-xs">暂无快讯</div>
        ) : (
          <div className="max-h-[780px] overflow-y-auto px-6 py-2" style={{ scrollbarGutter: 'stable' }}>
            {Object.keys(grouped).sort((a, b) => b.localeCompare(a)).map(date => (
              <div key={date}>
                <div className="flex items-center gap-3 py-5">
                  <div className="flex-1 h-px bg-zinc-200" />
                  <span className="text-[10px] text-zinc-400 font-mono tracking-widest uppercase whitespace-nowrap">
                    {toDateLabel(date)}
                  </span>
                  <div className="flex-1 h-px bg-zinc-200" />
                </div>
                {grouped[date].map(item => (
                  <div key={item.key} className="flex items-start gap-3 py-3 border-b border-zinc-100 last:border-b-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-2 shrink-0" />
                    <span className="text-xs text-zinc-400 font-mono tabular-nums whitespace-nowrap mt-0.5 shrink-0">
                      {toBeijingTime(item.created_at)}
                    </span>
                    <span className="text-[10px] text-zinc-700 bg-zinc-100 px-1.5 py-0.5 whitespace-nowrap shrink-0 mt-0.5 font-mono tracking-wider">
                      {item.subnet}
                    </span>
                    <div className="flex-1 text-sm text-zinc-700 leading-relaxed">
                      {item.content}
                      {item.url && (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-2 text-xs text-zinc-400 hover:text-green-600 no-underline"
                        >
                          原文 ↗
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
