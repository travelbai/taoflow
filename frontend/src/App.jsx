import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart,
} from 'recharts';
import {
  Network, TrendingUp, Clock, AlertCircle,
} from 'lucide-react';

// Change this to your deployed Worker URL
const API_URL = import.meta.env.VITE_API_URL || '';

import seedData from '../../worker/seed.json';

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

function formatUTC(date) {
  if (!date) return '-- --- ---- --:-- UTC';
  return date.toUTCString().replace('GMT', 'UTC');
}

export default function App() {
  const { data, loading, error, updatedAt } = useData(API_URL);

  const subnets = data?.subnets ?? [];
  const timeline = data?.timeline ?? [];
  const meta = data?.meta ?? {};

  const [selectedId, setSelectedId] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: 'id', direction: 'asc' });
  const [timeRange, setTimeRange] = useState('24H');

  // Default select first subnet once data loads
  const selectedSubnet = useMemo(() => {
    if (!subnets.length) return null;
    return subnets.find((s) => s.id === selectedId) ?? subnets[0];
  }, [subnets, selectedId]);

  const sortedSubnets = useMemo(() => {
    return [...subnets].sort((a, b) => {
      const k = sortConfig.key === 'netFlow' ? `netFlow${timeRange}` : sortConfig.key;
      if (a[k] < b[k]) return sortConfig.direction === 'asc' ? -1 : 1;
      if (a[k] > b[k]) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [subnets, sortConfig, timeRange]);

  const chartData = useMemo(() => {
    if (!selectedSubnet) return [];
    let points = 24;
    let volatility = 200;
    if (timeRange === '4H') { points = 24; volatility = 50; }
    if (timeRange === '7D') { points = 28; volatility = 800; }
    if (timeRange === '1M') { points = 30; volatility = 2500; }
    let baseCumulative = 1000 * selectedSubnet.id;
    let currentCumulative = baseCumulative;
    return Array.from({ length: points }, (_, i) => {
      let timeLabel = '';
      if (timeRange === '4H') { timeLabel = `${Math.floor(i / 6).toString().padStart(2, '0')}:${((i % 6) * 10).toString().padStart(2, '0')}`; }
      else if (timeRange === '24H') { timeLabel = `${i.toString().padStart(2, '0')}:00`; }
      else if (timeRange === '7D') { const d = Math.floor(i / 4) + 1; const h = (i % 4) * 6; timeLabel = `D${d} ${h.toString().padStart(2, '0')}:00`; }
      else { timeLabel = `Day ${i + 1}`; }
      const trendBias = (selectedSubnet[`netFlow${timeRange}`] ?? 0) > 0 ? volatility * 0.2 : -volatility * 0.2;
      const intervalFlow = Math.floor(Math.random() * volatility * 2) - volatility + trendBias;
      currentCumulative += intervalFlow;
      return { time: timeLabel, intervalFlow, cumulativeFlow: currentCumulative };
    });
  }, [timeRange, selectedSubnet]);

  const handleSort = (key) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const SortIcon = ({ col }) => {
    if (sortConfig.key !== col) return <span className="text-zinc-300 ml-1">↕</span>;
    return <span className="text-green-500 ml-1">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>;
  };

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
      {/* ── Header ── */}
      <header className="flex flex-col items-center mb-10 pb-6 border-b border-zinc-200">
        <div className="flex items-center gap-4 mb-4">
          <Network className="text-black w-9 h-9 shrink-0" strokeWidth={1.5} />
          <div className="flex flex-col items-center gap-1.5">
            <h1 className="text-2xl font-medium text-black tracking-wider">TAOFLOW</h1>
            <p className="text-[10px] text-zinc-500 uppercase tracking-[0.2em]">Bittensor Observer</p>
          </div>
        </div>
        <div className="flex gap-8 text-sm mb-2">
          <div className="flex flex-col items-end">
            <span className="text-zinc-400 text-xs tracking-widest uppercase mb-1">Net Flow Active</span>
            <span className="font-mono text-green-500 text-base font-medium">
              {meta.activeSubnets ?? '--'}{' '}
              <span className="text-zinc-400 font-normal">/ {meta.totalSubnets ?? '--'}</span>
            </span>
          </div>
          <div className="flex flex-col items-end">
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

      <div className="max-w-5xl mx-auto flex flex-col gap-8">
        {/* ── Subnet Table ── */}
        <div className="border border-zinc-200 bg-white">
          <div className="p-6 border-b border-zinc-200 flex justify-between items-center">
            <h2 className="text-sm font-medium text-black tracking-widest uppercase">NET FLOW</h2>
            <div className="flex gap-6 text-xs font-mono">
              {['4H', '24H', '7D', '1M'].map((range) => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range)}
                  className={
                    timeRange === range
                      ? 'text-green-600 font-medium border-b border-green-500 pb-0.5'
                      : 'text-zinc-400 hover:text-black'
                  }
                >
                  {range}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-zinc-600 tracking-widest bg-white border-b border-zinc-200">
                <tr>
                  <th className="px-6 py-4 font-normal cursor-pointer" onClick={() => handleSort('id')}>
                    Subnet <SortIcon col="id" />
                  </th>
                  <th className="px-6 py-4 font-normal text-center cursor-pointer" onClick={() => handleSort('price')}>
                    Price <SortIcon col="price" />
                  </th>
                  <th className="px-6 py-4 font-normal text-center cursor-pointer hidden md:table-cell" onClick={() => handleSort('emission')}>
                    Emission <SortIcon col="emission" />
                  </th>
                  <th className="px-6 py-4 font-normal text-center cursor-pointer" onClick={() => handleSort('netFlow')}>
                    Net Flow <SortIcon col="netFlow" />
                  </th>
                  <th className="px-6 py-4 font-normal text-center">Signals</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {sortedSubnets.map((subnet) => {
                  const currentNetFlow = subnet[`netFlow${timeRange}`] ?? 0;
                  const isSelected = selectedSubnet?.id === subnet.id;
                  return (
                    <tr
                      key={subnet.id}
                      onClick={() => setSelectedId(subnet.id)}
                      className={`cursor-pointer ${isSelected ? 'bg-zinc-100' : 'hover:bg-zinc-50'}`}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <span className={`font-mono text-xs ${isSelected ? 'text-green-600' : 'text-zinc-400'}`}>
                            SN{subnet.id.toString().padStart(2, '0')}
                          </span>
                          <span className="font-medium text-zinc-700">{subnet.name}</span>
                          {subnet.isNew && (
                            <span className="text-[9px] border border-blue-200 text-blue-600 bg-blue-50 px-1.5 py-0.5 uppercase tracking-widest">
                              New
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center font-mono">
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-zinc-900 font-medium">τ{subnet.price.toFixed(4)}</span>
                          <span className={`text-[10px] ${subnet.priceChange > 0 ? 'text-green-600' : 'text-red-500'}`}>
                            {subnet.priceChange > 0 ? '+' : ''}{subnet.priceChange}%
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center font-mono text-zinc-500 hidden md:table-cell">
                        {subnet.emission.toFixed(2)}%
                      </td>
                      <td className={`px-6 py-4 text-center font-mono ${currentNetFlow > 0 ? 'text-green-600 font-medium' : 'text-zinc-500'}`}>
                        {currentNetFlow > 0 ? '+' : '-'}τ{Math.abs(currentNetFlow).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-center">
                        {subnet.smartMoney ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-red-50 text-red-600 text-[10px] font-mono tracking-wider border border-red-100 uppercase">
                            <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                            Whale
                          </span>
                        ) : (
                          <span className="text-zinc-300">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Chart ── */}
        {selectedSubnet && (
          <div className="border border-zinc-200 bg-white p-6">
            <div className="flex justify-between items-end mb-8 flex-wrap gap-4">
              <h3 className="text-xl font-medium text-black">
                SN{selectedSubnet.id} {selectedSubnet.name}
              </h3>
              <div className="flex gap-6 items-center">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-500/30 border border-green-500" />
                  <span className="text-[10px] tracking-widest uppercase text-zinc-500">每小时净流入</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-[2px] bg-black" />
                  <span className="text-[10px] tracking-widest uppercase text-zinc-500">累计资金流向</span>
                </div>
              </div>
            </div>
            <div className="h-[200px] md:h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                  <XAxis dataKey="time" stroke="#a1a1aa" fontSize={9} tickLine={false} axisLine={false} dy={10} fontFamily="monospace" minTickGap={15} />
                  <YAxis yAxisId="left" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} domain={['auto', 'auto']} tickFormatter={(v) => v.toLocaleString()} fontFamily="monospace" />
                  <YAxis yAxisId="right" orientation="right" stroke="#22c55e" fontSize={10} tickLine={false} axisLine={false} fontFamily="monospace" />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e4e4e7', borderRadius: '0', fontSize: '12px', fontFamily: 'monospace' }}
                    cursor={{ stroke: '#d4d4d8', strokeWidth: 1, strokeDasharray: '3 3' }}
                  />
                  <Bar yAxisId="right" dataKey="intervalFlow" fill="#22c55e" opacity={0.25} />
                  <Line yAxisId="left" type="monotone" dataKey="cumulativeFlow" stroke="#000000" strokeWidth={2} dot={false} activeDot={{ r: 5, fill: '#000000', stroke: '#ffffff', strokeWidth: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

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
                <p className="text-[10px] text-zinc-400 font-mono mb-3">{item.time}</p>
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
    </div>
  );
}
