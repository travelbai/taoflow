import { useState, useMemo } from 'react';
import { Clock, TrendingUp } from 'lucide-react';
import { useSortable } from '../hooks';
import { formatTVL, relativeTime } from '../utils/format';

export default function NetFlowTable({ subnets, timeline, onNavigate }) {
  const [selectedId, setSelectedId] = useState(null);
  const { sortConfig, handleSort, SortIcon } = useSortable('id', 'asc');

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

  return (
    <div className="flex flex-col gap-8">
      {/* ── Subnet Table ── */}
      <div className="border border-zinc-200 bg-white">
        <div className="p-6 border-b border-zinc-200 flex items-center justify-between">
          <button onClick={() => onNavigate('home')} className="text-sm font-medium tracking-widest uppercase pb-0.5 text-black border-b-2 border-green-500">NET FLOW</button>
          <button onClick={() => onNavigate('staking')} className="text-sm font-medium tracking-widest uppercase text-zinc-400 hover:text-zinc-600 pb-0.5">Staking</button>
          <button onClick={() => onNavigate('news')} className="text-sm font-medium tracking-widest uppercase text-zinc-400 hover:text-zinc-600 pb-0.5">News</button>
        </div>
        <div className="overflow-x-auto max-h-[720px] overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
          <table className="w-full text-sm text-left table-fixed">
            <colgroup>
              <col className="w-[150px]" />
              <col className="w-[95px]" />
              <col className="w-[80px] hidden md:table-column" />
              <col className="w-[70px]" />
              <col className="w-[85px]" />
              <col className="w-[85px]" />
              <col className="w-[85px] hidden md:table-column" />
              <col className="w-[85px] hidden md:table-column" />
              <col className="w-[100px] hidden md:table-column" />
              <col className="w-[80px]" />
            </colgroup>
            <thead className="text-xs text-zinc-600 tracking-widest sticky top-0 z-10">
              <tr className="bg-white border-b border-zinc-200">
                <th className="px-3 py-4 font-normal cursor-pointer" onClick={() => handleSort('id')}>
                  <span className="relative inline-flex">Subnet <SortIcon col="id" /></span>
                </th>
                <th className="px-2 py-4 font-normal text-center cursor-pointer" onClick={() => handleSort('price')}>
                  <span className="relative inline-flex">Price <SortIcon col="price" /></span>
                </th>
                <th className="px-2 py-4 font-normal text-center cursor-pointer hidden md:table-cell" onClick={() => handleSort('emission')}>
                  <span className="relative inline-flex">Emission <SortIcon col="emission" /></span>
                </th>
                <th className="px-2 py-4 font-normal text-center cursor-pointer" onClick={() => handleSort('priceChange')}>
                  <span className="relative inline-flex">24H% <SortIcon col="priceChange" /></span>
                </th>
                <th className="px-2 py-4 font-normal text-center cursor-pointer" onClick={() => handleSort('netFlow4H')}>
                  <span className="relative inline-flex">Flow 4H <SortIcon col="netFlow4H" /></span>
                </th>
                <th className="px-2 py-4 font-normal text-center cursor-pointer" onClick={() => handleSort('netFlow24H')}>
                  <span className="relative inline-flex">Flow 24H <SortIcon col="netFlow24H" /></span>
                </th>
                <th className="px-2 py-4 font-normal text-center cursor-pointer hidden md:table-cell" onClick={() => handleSort('netFlow7D')}>
                  <span className="relative inline-flex">Flow 7D <SortIcon col="netFlow7D" /></span>
                </th>
                <th className="px-2 py-4 font-normal text-center cursor-pointer hidden md:table-cell" onClick={() => handleSort('netFlow1M')}>
                  <span className="relative inline-flex">Flow 1M <SortIcon col="netFlow1M" /></span>
                </th>
                <th className="px-2 py-4 font-normal text-center cursor-pointer hidden md:table-cell" onClick={() => handleSort('tvlUsd')}>
                  <span className="relative inline-flex">TVL <SortIcon col="tvlUsd" /></span>
                </th>
                <th className="px-2 py-4 font-normal text-center">Signals</th>
              </tr>
              <tr className="bg-white border-b border-zinc-200">
                <th className="px-3 py-3.5 font-semibold text-zinc-800 text-xs tracking-widest uppercase">Total</th>
                <th className="px-2 py-3.5"></th>
                <th className="px-2 py-3.5 hidden md:table-cell"></th>
                <th className="px-2 py-3.5"></th>
                {['netFlow4H', 'netFlow24H', 'netFlow7D', 'netFlow1M'].map((key, i) => {
                  const val = totals[key];
                  return (
                    <th key={key} className={`px-2 py-3.5 text-center font-mono text-xs font-semibold ${i >= 2 ? 'hidden md:table-cell' : ''} ${val > 0 ? 'text-green-600' : val < 0 ? 'text-red-500' : 'text-zinc-400'}`}>
                      {val > 0 ? '+' : val < 0 ? '-' : ''}τ{Math.abs(val).toLocaleString()}
                    </th>
                  );
                })}
                <th className="px-2 py-3.5 text-center font-mono text-xs font-semibold text-zinc-800 hidden md:table-cell">
                  {formatTVL(totals.tvlUsd)}
                </th>
                <th className="px-2 py-3.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {sortedSubnets.map((subnet) => {
                const isSelected = selectedSubnet?.id === subnet.id;
                return (
                  <tr
                    key={subnet.id}
                    onClick={() => setSelectedId(subnet.id)}
                    className={`cursor-pointer h-[52px] ${subnet.signal === 'in' ? 'bg-green-50 hover:bg-green-100' : isSelected ? 'bg-zinc-100' : 'hover:bg-zinc-50'}`}
                  >
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-mono text-xs shrink-0 ${isSelected ? 'text-green-600' : 'text-zinc-400'}`}>
                          SN{subnet.id.toString().padStart(2, '0')}
                        </span>
                        <span className={`font-medium truncate ${subnet.name ? 'text-zinc-700' : 'text-zinc-400'}`}>{subnet.name || 'Unknown'}</span>
                        {subnet.isNew && (
                          <span className="text-[9px] leading-none border border-blue-200 text-blue-600 bg-blue-50 px-1 py-0.5 uppercase tracking-widest shrink-0">
                            New
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-3 text-center font-mono text-zinc-900 font-medium">
                      τ{subnet.price.toFixed(5)}
                    </td>
                    <td className="px-2 py-3 text-center font-mono text-zinc-900 hidden md:table-cell">
                      {subnet.emission.toFixed(2)}%
                    </td>
                    <td className={`px-2 py-3 text-center font-mono text-xs ${subnet.priceChange > 0 ? 'text-green-600' : subnet.priceChange < 0 ? 'text-red-500' : 'text-zinc-400'}`}>
                      {subnet.priceChange > 0 ? '+' : ''}{subnet.priceChange}%
                    </td>
                    {['netFlow4H', 'netFlow24H', 'netFlow7D', 'netFlow1M'].map((key, i) => {
                      const val = subnet[key] ?? 0;
                      return (
                        <td key={key} className={`px-2 py-3 text-center font-mono text-xs ${i >= 2 ? 'hidden md:table-cell' : ''} ${val > 0 ? 'text-green-600 font-medium' : val < 0 ? 'text-red-500' : 'text-zinc-400'}`}>
                          {val > 0 ? '+' : val < 0 ? '-' : ''}τ{Math.abs(val).toLocaleString()}
                        </td>
                      );
                    })}
                    <td className="px-2 py-2 text-center font-mono text-xs text-zinc-700 hidden md:table-cell">
                      <div className="flex flex-col items-center gap-0.5 leading-tight">
                        <span>{formatTVL(subnet.tvlUsd)}</span>
                        {subnet.tvlUsd > 0 && subnet.tvlUsd < 500000 && (
                          <span className="text-[8px] leading-none border border-red-200 text-red-500 bg-red-50 px-1 py-[1px] uppercase tracking-widest">Low</span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-3 text-center">
                      {subnet.signal === 'in' ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-green-50 text-green-600 text-[10px] leading-none font-mono tracking-wider border border-green-200 uppercase">
                          <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                          Whale
                        </span>
                      ) : subnet.signal === 'out' ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-red-50 text-red-600 text-[10px] leading-none font-mono tracking-wider border border-red-100 uppercase">
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
  );
}
