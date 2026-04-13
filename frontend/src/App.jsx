import { useState } from 'react';
import { Network, TrendingUp, AlertCircle } from 'lucide-react';

import { API_URL } from './config';
import { useData } from './hooks';
import { formatUTC } from './utils/format';
import NetFlowTable from './components/NetFlowTable';
import StakingPage from './components/StakingPage';
import NewsPanel from './components/NewsPanel';

export default function App() {
  const { data, loading, error, updatedAt } = useData(API_URL);
  const [page, setPage] = useState('home');

  const subnets = data?.subnets ?? [];
  const timeline = data?.timeline ?? [];
  const meta = data?.meta ?? {};

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center text-zinc-400 font-mono text-sm">
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center gap-3 text-red-500 font-mono text-sm">
        <AlertCircle className="w-5 h-5" strokeWidth={1.5} />
        {error}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-zinc-600 font-sans p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        {/* ── Header ── */}
        <header className="flex flex-col items-center mb-6 pb-6 border-b border-zinc-200">
          <div className="flex items-center gap-4 mb-4">
            <Network className="text-black w-9 h-9 shrink-0" strokeWidth={1.5} />
            <div className="flex flex-col items-center gap-1.5">
              <h1 className="text-2xl font-medium text-black tracking-wider">TAOFLOW</h1>
              <p className="text-[10px] text-zinc-500 uppercase tracking-[0.2em]">Bittensor Observer</p>
            </div>
          </div>
          <div className="flex gap-8 text-sm mb-2">
            <div className="flex flex-col items-center">
              <span className="text-zinc-400 text-xs tracking-widest uppercase mb-1">Net Flow Active</span>
              <span className="font-mono text-green-500 text-base font-medium">
                {meta.activeSubnets ?? '--'}{' '}
                <span className="text-zinc-400 font-normal">/ {meta.totalSubnets ?? '--'}</span>
              </span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-zinc-400 text-xs tracking-widest uppercase mb-1">Recycle Fee</span>
              <span className="font-mono text-black text-base font-medium flex items-center gap-2">
                {meta.recycleFee ?? '--'}{' '}
                <span className="text-zinc-500 text-xs font-normal">TAO</span>
                {meta.recycleFeeUp && <TrendingUp className="w-4 h-4 text-red-500" strokeWidth={1.5} />}
              </span>
            </div>
          </div>
          <div className="text-[10px] text-zinc-400 font-mono">
            Last updated: {formatUTC(updatedAt)}
          </div>
        </header>

        {page === 'staking' ? (
          <StakingPage subnets={subnets} apiUrl={API_URL} onNavigate={setPage} />
        ) : page === 'news' ? (
          <NewsPanel onTabClick={setPage} />
        ) : (
          <NetFlowTable subnets={subnets} timeline={timeline} onNavigate={setPage} />
        )}
      </div>
    </div>
  );
}
