import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Network, TrendingUp, Clock, AlertCircle, Copy, Check,
} from 'lucide-react';

// Change this to your deployed Worker URL
const API_URL = import.meta.env.VITE_API_URL || '';

import seedData from './seed.json';
import NewsPanel from './components/NewsPanel';

function useData(url) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);

  const fetchData = useCallback(async () => {
    // 没有配置 API URL 时直接用本地 seed 数据
    if (!url) {
      setData(seedData);
      setUpdatedAt(seedData.meta?.updatedAt ? new Date(seedData.meta.updatedAt) : new Date());
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setUpdatedAt(json.meta?.updatedAt ? new Date(json.meta.updatedAt) : new Date());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    fetchData();
    if (url) {
      const id = setInterval(fetchData, 30_000);
      return () => clearInterval(id);
    }
  }, [fetchData, url]);

  return { data, loading, error, updatedAt, refetch: fetchData };
}

function formatAPY(v) {
  if (v == null) return '—';
  return `${Number(v).toFixed(2)}%`;
}

function useSortable(defaultKey, defaultDir = 'desc') {
  const [sortConfig, setSortConfig] = useState({ key: defaultKey, direction: defaultDir });
  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc',
    }));
  };
  const SortIcon = ({ col }) => {
    const icon = sortConfig.key !== col
      ? <span className="text-zinc-300">↕</span>
      : <span className="text-green-500">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>;
    return <span className="absolute right-0 translate-x-full pl-0.5">{icon}</span>;
  };
  return { sortConfig, handleSort, SortIcon };
}

const LOW_STAKE_THRESHOLD = 1000; // TAO

function StakingPage({ subnets, apiUrl, onNavigate }) {
  const [netuid, setNetuid] = useState(0);
  const [validators, setValidators] = useState([]);
  const [loading, setLoading] = useState(false);
  const { sortConfig, handleSort, SortIcon } = useSortable('apy_1d');
  const [stakeInput, setStakeInput] = useState('');
  const [showLowStake, setShowLowStake] = useState(false);
  const [selectedHotkey, setSelectedHotkey] = useState(null);
  const [copiedHotkey, setCopiedHotkey] = useState(null);

  const copyAddress = useCallback((e, hotkey) => {
    e.stopPropagation();
    navigator.clipboard.writeText(hotkey).then(() => {
      setCopiedHotkey(hotkey);
      setTimeout(() => setCopiedHotkey(null), 1000);
    });
  }, []);

  useEffect(() => {
    if (!apiUrl) return;
    setLoading(true);
    setSelectedHotkey(null);
    fetch(`${apiUrl}/staking?netuid=${netuid}`)
      .then(r => r.json())
      .then(j => setValidators(j.data ?? []))
      .catch(() => setValidators([]))
      .finally(() => setLoading(false));
  }, [netuid, apiUrl]);

  // Filter low-stake validators unless toggled on
  const filtered = useMemo(() =>
    showLowStake ? validators : validators.filter(v => (v.stake ?? 0) >= LOW_STAKE_THRESHOLD),
    [validators, showLowStake]
  );

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    const av = a[sortConfig.key] ?? 0;
    const bv = b[sortConfig.key] ?? 0;
    return sortConfig.direction === 'desc' ? bv - av : av - bv;
  }), [filtered, sortConfig]);

  // Default to highest-stake validator when none selected
  const topValidator = useMemo(() =>
    [...filtered].sort((a, b) => (b.stake ?? 0) - (a.stake ?? 0))[0] ?? null,
    [filtered]
  );
  const selectedValidator = useMemo(() =>
    (selectedHotkey && filtered.find(v => v.hotkey === selectedHotkey)) || topValidator,
    [selectedHotkey, filtered, topValidator]
  );
  const calcApy = selectedValidator?.apy_1d ?? 0;

  const stake = parseFloat(stakeInput) || 0;
  const dailyRate = calcApy / 100 / 365;

  const lowStakeCount = useMemo(() =>
    validators.filter(v => (v.stake ?? 0) < LOW_STAKE_THRESHOLD).length,
    [validators]
  );

  const subnetOptions = [{ id: 0, name: 'Root' }, ...subnets];

  return (
    <div className="flex flex-col gap-8">
      {/* ── Title row ── */}
      <div className="border border-zinc-200 bg-white">
        <div className="px-6 py-4 flex items-center justify-between">
          <button onClick={() => onNavigate('home')} className="text-sm font-medium tracking-widest uppercase text-zinc-400 hover:text-zinc-600 pb-0.5">NET FLOW</button>
          <button className="text-sm font-medium tracking-widest uppercase text-black border-b-2 border-green-500 pb-0.5">Staking</button>
          <button onClick={() => onNavigate('news')} className="text-sm font-medium tracking-widest uppercase text-zinc-400 hover:text-zinc-600 pb-0.5">News</button>
        </div>
      </div>
      {/* Subnet + Calculator row */}
      <div className="border border-zinc-200 bg-white px-6 py-4 flex items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-400 tracking-widest uppercase shrink-0">Subnet</span>
          <select
            value={netuid}
            onChange={e => setNetuid(Number(e.target.value))}
            className="border border-zinc-200 px-3 py-1.5 text-sm font-mono text-zinc-700 bg-white focus:outline-none focus:border-zinc-400"
          >
            {subnetOptions.map(s => (
              <option key={s.id} value={s.id}>
                SN{String(s.id).padStart(2, '0')} {s.name || ''}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-400 uppercase tracking-widest shrink-0">Stake</span>
            <input
              type="number"
              value={stakeInput}
              onChange={e => setStakeInput(e.target.value)}
              placeholder="0"
              className="border border-zinc-200 px-3 py-1.5 font-mono text-sm w-28 focus:outline-none focus:border-zinc-400"
            />
            <span className="text-xs text-zinc-500 shrink-0">TAO</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[9px] text-zinc-400 tracking-widest uppercase mb-1">
              {selectedValidator ? (selectedValidator.name || selectedValidator.hotkey?.slice(0, 8) + '…') : '—'}
            </span>
            <span className="text-[10px] text-zinc-400 font-mono">1D APY: {calcApy > 0 ? calcApy.toFixed(2) + '%' : '—'}</span>
          </div>
          {[['每天', 1], ['每周', 7], ['每月', 30]].map(([label, mul]) => (
            <div key={label} className="flex flex-col items-center">
              <span className="text-[9px] text-zinc-400 tracking-widest uppercase mb-1">{label}</span>
              <span className="font-mono text-sm text-zinc-900">
                {stake > 0 && calcApy > 0 ? `τ${(stake * dailyRate * mul).toFixed(4)}` : '—'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Validator table */}
      <div className="border border-zinc-200 bg-white">
        <div className="overflow-x-auto max-h-[620px] overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
          <table className="w-full text-sm text-left table-fixed">
            <colgroup>
              <col className="w-[260px]" />
              <col className="w-[110px]" />
              <col className="w-[90px]" />
              <col className="w-[90px]" />
              <col className="w-[90px]" />
              <col className="w-[90px]" />
              <col className="w-[100px]" />
            </colgroup>
            <thead className="text-xs text-zinc-600 tracking-widest sticky top-0 z-10">
              <tr className="bg-white border-b border-zinc-200">
                <th className="px-4 py-4 font-normal">
                  <span className="inline-flex items-center gap-3">
                    Validator
                    {lowStakeCount > 0 && (
                      <button
                        onClick={() => setShowLowStake(v => !v)}
                        className="text-[10px] text-zinc-400 hover:text-zinc-600 font-mono normal-case tracking-normal"
                      >
                        {showLowStake ? `隐藏低质押` : `显示低质押 +${lowStakeCount}`}
                      </button>
                    )}
                  </span>
                </th>
                <th className="px-4 py-4 font-normal text-center cursor-pointer" onClick={() => handleSort('stake')}>
                  <span className="relative inline-flex">Stake <SortIcon col="stake" /></span>
                </th>
                <th className="px-4 py-4 font-normal text-center cursor-pointer" onClick={() => handleSort('apy_1h')}>
                  <span className="relative inline-flex">1H APY <SortIcon col="apy_1h" /></span>
                </th>
                <th className="px-4 py-4 font-normal text-center cursor-pointer" onClick={() => handleSort('apy_1d')}>
                  <span className="relative inline-flex">1D APY <SortIcon col="apy_1d" /></span>
                </th>
                <th className="px-4 py-4 font-normal text-center cursor-pointer" onClick={() => handleSort('apy_7d')}>
                  <span className="relative inline-flex">7D APY <SortIcon col="apy_7d" /></span>
                </th>
                <th className="px-4 py-4 font-normal text-center cursor-pointer" onClick={() => handleSort('apy_30d')}>
                  <span className="relative inline-flex">30D APY <SortIcon col="apy_30d" /></span>
                </th>
                <th className="px-4 py-4 font-normal text-center cursor-pointer" onClick={() => handleSort('commission')}>
                  <span className="relative inline-flex">Commission <SortIcon col="commission" /></span>
                </th>
              </tr>
            </thead>
              <tbody className="divide-y divide-zinc-100">
                {sorted.map((v, i) => {
                  const isSelected = selectedValidator?.hotkey === v.hotkey;
                  return (
                  <tr
                    key={v.hotkey ?? i}
                    onClick={() => setSelectedHotkey(v.hotkey)}
                    className={`cursor-pointer ${isSelected ? 'bg-green-50' : 'hover:bg-zinc-50'}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <div className={`font-medium truncate max-w-[180px] ${isSelected ? 'text-green-700' : 'text-zinc-700'}`}>
                          {v.name || '—'}
                        </div>
                        {v.hotkey && (
                          <button
                            onClick={e => copyAddress(e, v.hotkey)}
                            className="shrink-0 text-zinc-300 hover:text-zinc-500 transition-colors"
                            title={v.hotkey}
                          >
                            {copiedHotkey === v.hotkey
                              ? <Check className="w-3 h-3 text-green-500" strokeWidth={2.5} />
                              : <Copy className="w-3 h-3" strokeWidth={1.5} />}
                          </button>
                        )}
                      </div>
                      <div className="text-[10px] text-zinc-400 font-mono truncate max-w-[200px]">
                        {copiedHotkey === v.hotkey
                          ? <span className="text-green-500">已复制</span>
                          : v.hotkey}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center font-mono text-xs text-zinc-700">
                      α {(v.stake ?? 0).toLocaleString()}
                    </td>
                    {['apy_1h', 'apy_1d', 'apy_7d', 'apy_30d'].map(k => (
                      <td key={k} className="px-4 py-3 text-center font-mono text-xs">
                        <span className={(v[k] ?? 0) > 0 ? 'text-green-600' : 'text-zinc-400'}>
                          {formatAPY(v[k])}
                        </span>
                      </td>
                    ))}
                    <td className="px-4 py-3 text-center font-mono text-xs text-zinc-700">
                      {(v.commission ?? 0).toFixed(0)}%
                    </td>
                  </tr>
                );
                })}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-zinc-400 font-mono text-xs">No data</td>
                  </tr>
                )}
              </tbody>
            </table>
        </div>
      </div>
    </div>
  );
}

function formatTVL(usd) {
  if (!usd || usd <= 0) return '—';
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(2)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(2)}M`;
  if (usd >= 1e3) return `$${Math.round(usd / 1e3)}K`;
  return `$${Math.round(usd)}`;
}

function formatUTC(date) {
  if (!date) return '-- --- ---- --:-- UTC';
  return date.toUTCString().replace('GMT', 'UTC');
}

function relativeTime(ts) {
  if (!ts) return '';
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)} mins ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} hours ago`;
  return `${Math.floor(secs / 86400)} days ago`;
}

export default function App() {
  const { data, loading, error, updatedAt } = useData(API_URL);

  const subnets = data?.subnets ?? [];
  const timeline = data?.timeline ?? [];
  const meta = data?.meta ?? {};

  const [page, setPage] = useState('home');
  const [selectedId, setSelectedId] = useState(null);
  const { sortConfig, handleSort, SortIcon } = useSortable('id', 'asc');

  // Default select first subnet once data loads
  const selectedSubnet = useMemo(() => {
    if (!subnets.length) return null;
    return subnets.find((s) => s.id === selectedId) ?? subnets[0];
  }, [subnets, selectedId]);

  const sortedSubnets = useMemo(() => {
    return [...subnets].sort((a, b) => {
      const k = sortConfig.key;
      if (a[k] < b[k]) return sortConfig.direction === 'asc' ? -1 : 1;
      if (a[k] > b[k]) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [subnets, sortConfig]);

  const totals = useMemo(() => {
    return subnets.reduce((acc, s) => ({
      netFlow4H: acc.netFlow4H + (s.netFlow4H ?? 0),
      netFlow24H: acc.netFlow24H + (s.netFlow24H ?? 0),
      netFlow7D: acc.netFlow7D + (s.netFlow7D ?? 0),
      netFlow1M: acc.netFlow1M + (s.netFlow1M ?? 0),
      tvlUsd: acc.tvlUsd + (s.tvlUsd ?? 0),
    }), { netFlow4H: 0, netFlow24H: 0, netFlow7D: 0, netFlow1M: 0, tvlUsd: 0 });
  }, [subnets]);

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
      <div className="flex flex-col gap-8">
        {/* ── Subnet Table ── */}
        <div className="border border-zinc-200 bg-white">
          <div className="p-6 border-b border-zinc-200 flex items-center justify-between">
            <button onClick={() => setPage('home')} className={`text-sm font-medium tracking-widest uppercase pb-0.5 ${page === 'home' ? 'text-black border-b-2 border-green-500' : 'text-zinc-400'}`}>NET FLOW</button>
            <button onClick={() => setPage('staking')} className="text-sm font-medium tracking-widest uppercase text-zinc-400 hover:text-zinc-600 pb-0.5">Staking</button>
            <button onClick={() => setPage('news')} className="text-sm font-medium tracking-widest uppercase text-zinc-400 hover:text-zinc-600 pb-0.5">News</button>
          </div>
          <div className="overflow-x-auto max-h-[720px] overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
            <table className="w-full text-sm text-left table-fixed">
              <colgroup>
                <col className="w-[180px]" />
                <col className="w-[120px]" />
                <col className="w-[100px] hidden md:table-column" />
                <col className="w-[100px]" />
                <col className="w-[100px]" />
                <col className="w-[100px] hidden md:table-column" />
                <col className="w-[100px] hidden md:table-column" />
                <col className="w-[100px] hidden md:table-column" />
                <col className="w-[100px]" />
              </colgroup>
              <thead className="text-xs text-zinc-600 tracking-widest sticky top-0 z-10">
                <tr className="bg-white border-b border-zinc-200">
                  <th className="px-4 py-4 font-normal cursor-pointer" onClick={() => handleSort('id')}>
                    <span className="relative inline-flex">Subnet <SortIcon col="id" /></span>
                  </th>
                  <th className="px-6 py-4 font-normal text-center cursor-pointer" onClick={() => handleSort('price')}>
                    <span className="relative inline-flex">Price <SortIcon col="price" /></span>
                  </th>
                  <th className="px-6 py-4 font-normal text-center cursor-pointer hidden md:table-cell" onClick={() => handleSort('emission')}>
                    <span className="relative inline-flex">Emission <SortIcon col="emission" /></span>
                  </th>
                  <th className="px-4 py-4 font-normal text-center cursor-pointer" onClick={() => handleSort('netFlow4H')}>
                    <span className="relative inline-flex">Flow 4H <SortIcon col="netFlow4H" /></span>
                  </th>
                  <th className="px-4 py-4 font-normal text-center cursor-pointer" onClick={() => handleSort('netFlow24H')}>
                    <span className="relative inline-flex">Flow 24H <SortIcon col="netFlow24H" /></span>
                  </th>
                  <th className="px-4 py-4 font-normal text-center cursor-pointer hidden md:table-cell" onClick={() => handleSort('netFlow7D')}>
                    <span className="relative inline-flex">Flow 7D <SortIcon col="netFlow7D" /></span>
                  </th>
                  <th className="px-4 py-4 font-normal text-center cursor-pointer hidden md:table-cell" onClick={() => handleSort('netFlow1M')}>
                    <span className="relative inline-flex">Flow 1M <SortIcon col="netFlow1M" /></span>
                  </th>
                  <th className="px-4 py-4 font-normal text-center cursor-pointer hidden md:table-cell" onClick={() => handleSort('tvlUsd')}>
                    <span className="relative inline-flex">TVL <SortIcon col="tvlUsd" /></span>
                  </th>
                  <th className="px-6 py-4 font-normal text-center">Signals</th>
                </tr>
                <tr className="bg-white border-b border-zinc-200">
                  <th className="px-4 py-3.5 font-semibold text-zinc-800 text-xs tracking-widest uppercase">Total</th>
                  <th className="px-6 py-3.5"></th>
                  <th className="px-6 py-3.5 hidden md:table-cell"></th>
                  {['netFlow4H', 'netFlow24H', 'netFlow7D', 'netFlow1M'].map((key, i) => {
                    const val = totals[key];
                    return (
                      <th key={key} className={`px-4 py-3.5 text-center font-mono text-xs font-semibold ${i >= 2 ? 'hidden md:table-cell' : ''} ${val > 0 ? 'text-green-600' : val < 0 ? 'text-red-500' : 'text-zinc-400'}`}>
                        {val > 0 ? '+' : val < 0 ? '-' : ''}τ{Math.abs(val).toLocaleString()}
                      </th>
                    );
                  })}
                  <th className="px-4 py-3.5 text-center font-mono text-xs font-semibold text-zinc-800 hidden md:table-cell">
                    {formatTVL(totals.tvlUsd)}
                  </th>
                  <th className="px-6 py-3.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {sortedSubnets.map((subnet) => {
                  const isSelected = selectedSubnet?.id === subnet.id;
                  return (
                    <tr
                      key={subnet.id}
                      onClick={() => setSelectedId(subnet.id)}
                      className={`cursor-pointer ${subnet.signal === 'in' ? 'bg-green-50 hover:bg-green-100' : isSelected ? 'bg-zinc-100' : 'hover:bg-zinc-50'}`}
                    >
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span className={`font-mono text-xs shrink-0 ${isSelected ? 'text-green-600' : 'text-zinc-400'}`}>
                            SN{subnet.id.toString().padStart(2, '0')}
                          </span>
                          <span className={`font-medium truncate ${subnet.name ? 'text-zinc-700' : 'text-zinc-400'}`}>{subnet.name || 'Unknown'}</span>
                          {subnet.isNew && (
                            <span className="text-[9px] border border-blue-200 text-blue-600 bg-blue-50 px-1.5 py-0.5 uppercase tracking-widest shrink-0">
                              New
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-2 text-center font-mono">
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="text-zinc-900 font-medium">τ{subnet.price.toFixed(5)}</span>
                          <span className={`text-[10px] ${subnet.priceChange > 0 ? 'text-green-600' : 'text-red-500'}`}>
                            {subnet.priceChange > 0 ? '+' : ''}{subnet.priceChange}%
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-2 text-center font-mono text-zinc-900 hidden md:table-cell">
                        {subnet.emission.toFixed(2)}%
                      </td>
                      {['netFlow4H', 'netFlow24H', 'netFlow7D', 'netFlow1M'].map((key, i) => {
                        const val = subnet[key] ?? 0;
                        return (
                          <td key={key} className={`px-4 py-2 text-center font-mono text-xs ${i >= 2 ? 'hidden md:table-cell' : ''} ${val > 0 ? 'text-green-600 font-medium' : val < 0 ? 'text-red-500' : 'text-zinc-400'}`}>
                            {val > 0 ? '+' : val < 0 ? '-' : ''}τ{Math.abs(val).toLocaleString()}
                          </td>
                        );
                      })}
                      <td className="px-4 py-2 text-center font-mono text-xs text-zinc-700 hidden md:table-cell">
                        <div className="flex flex-col items-center gap-0.5">
                          {formatTVL(subnet.tvlUsd)}
                          {subnet.tvlUsd > 0 && subnet.tvlUsd < 500000 && (
                            <span className="text-[9px] border border-red-200 text-red-500 bg-red-50 px-1.5 py-0.5 uppercase tracking-widest">Low</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-2 text-center">
                        {subnet.signal === 'in' ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-green-50 text-green-600 text-[10px] font-mono tracking-wider border border-green-200 uppercase">
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                            Whale
                          </span>
                        ) : subnet.signal === 'out' ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-red-50 text-red-600 text-[10px] font-mono tracking-wider border border-red-100 uppercase">
                            <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                            撤出
                          </span>
                        ) : (
                          <span className="text-zinc-700 text-xs font-medium">正常</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>


        {/* ── Timeline ── */}
        <div className="border border-zinc-200 bg-white p-6">
          <h2 className="text-sm font-medium text-black tracking-widest uppercase mb-6 flex items-center gap-2">
            <Clock className="w-4 h-4 text-zinc-400" strokeWidth={1.5} />
            Subnet Registration
          </h2>
          <div className="relative pl-3 border-l border-zinc-200 space-y-8">
            {timeline.map((item, idx) => (
              <div key={idx} className="relative">
                <div className="absolute -left-[17px] top-1.5 w-2 h-2 bg-zinc-300 rounded-full ring-4 ring-white" />
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="text-sm font-medium text-black">{item.title}</h4>
                  {item.feeTrend === 'up' && (
                    <span className="text-[9px] bg-red-50 text-red-600 px-1 py-0.5 border border-red-100 uppercase tracking-wider">
                      HOT
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-zinc-400 font-mono mb-3">{relativeTime(item.timestamp)}</p>
                <div className="grid grid-cols-3 gap-px bg-zinc-200 border border-zinc-200">
                  <div className="col-span-2 bg-zinc-50 p-2">
                    <span className="block text-[9px] tracking-widest uppercase text-zinc-400 mb-1">Creator</span>
                    <span className="font-mono text-zinc-700 text-xs break-all block">{item.creator}</span>
                  </div>
                  <div className="bg-zinc-50 p-2">
                    <span className="block text-[9px] tracking-widest uppercase text-zinc-400 mb-1">Fee (TAO)</span>
                    <span className={`font-mono text-xs flex items-center gap-1 font-medium ${item.feeTrend === 'up' ? 'text-red-600' : 'text-zinc-700'}`}>
                      {item.fee}
                      {item.feeTrend === 'up' && <TrendingUp className="w-3 h-3" strokeWidth={2} />}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      )}
    </div>
    </div>
  );
}
