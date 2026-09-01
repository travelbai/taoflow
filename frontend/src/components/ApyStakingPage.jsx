import { useEffect, useMemo, useState } from 'react';
import { useSortable } from '../hooks';
import { formatAPY } from '../utils/format';

const APY_COLUMNS = [
  ['apy_1h', '1H APY'],
  ['apy_1d', '1D APY'],
  ['apy_7d', '7D APY'],
  ['apy_30d', '30D APY'],
];
export default function ApyStakingPage({ subnets, apiUrl, onNavigate, onSelectSubnet }) {
  const { sortConfig, handleSort, SortIcon } = useSortable('id', 'asc');
  const [apyByNetuid, setApyByNetuid] = useState({});
  const [loading, setLoading] = useState(false);

  // This primitive remains equal across the 30-second core-data poll when the
  // active IDs are unchanged, so the ranking makes only one batch request.
  const netuidList = useMemo(
    () => [...subnets].map(subnet => subnet.id).filter(Number.isInteger).sort((a, b) => a - b).join(','),
    [subnets]
  );

  useEffect(() => {
    if (!apiUrl || !netuidList) {
      setApyByNetuid({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`${apiUrl}/staking/apy?netuids=${encodeURIComponent(netuidList)}`)
      .then(response => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then(response => {
        if (!cancelled) setApyByNetuid(response.data ?? {});
      })
      .catch(() => {
        if (!cancelled) setApyByNetuid({});
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [apiUrl, netuidList]);

  const rankedSubnets = useMemo(() => subnets
    .map(subnet => {
      const summary = apyByNetuid[subnet.id];
      const validator = summary?.validator;
      return {
        ...subnet,
        apy_1h: validator?.apy_1h ?? null,
        apy_1d: validator?.apy_1d ?? null,
        apy_7d: validator?.apy_7d ?? null,
        apy_30d: validator?.apy_30d ?? null,
        hotkey: validator?.hotkey ?? null,
      };
    })
    .sort((a, b) => {
      const av = a[sortConfig.key];
      const bv = b[sortConfig.key];
      if (av == null) return bv == null ? 0 : 1;
      if (bv == null) return -1;
      return sortConfig.direction === 'desc' ? bv - av : av - bv;
    }), [subnets, apyByNetuid, sortConfig]);

  return (
    <div className="flex flex-col gap-8">
      <div className="border border-zinc-200 bg-white">
        <div className="px-6 py-4 flex items-center justify-between">
          <button onClick={() => onNavigate('home')} className="text-sm font-medium tracking-widest uppercase text-zinc-400 hover:text-zinc-600 pb-0.5">NET FLOW</button>
          <button className="text-sm font-medium tracking-widest uppercase text-black border-b-2 border-green-500 pb-0.5">APY STAKING</button>
          <button onClick={() => onNavigate('staking')} className="text-sm font-medium tracking-widest uppercase text-zinc-400 hover:text-zinc-600 pb-0.5">Staking</button>
          <button onClick={() => onNavigate('news')} className="text-sm font-medium tracking-widest uppercase text-zinc-400 hover:text-zinc-600 pb-0.5">News</button>
        </div>
      </div>

      <div className="border border-zinc-200 bg-white">
        {loading && <div className="px-4 py-2 border-b border-zinc-200 text-right text-[10px] text-zinc-400 font-mono">Loading snapshots…</div>}
        <div className="overflow-x-auto max-h-[620px] overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
          <table className="w-full text-sm text-left table-fixed">
            <colgroup>
              <col className="w-[260px]" />
              <col className="w-[120px]" />
              <col className="w-[120px]" />
              <col className="w-[120px]" />
              <col className="w-[120px]" />
            </colgroup>
            <thead className="text-xs text-zinc-600 tracking-widest sticky top-0 z-10">
              <tr className="bg-white border-b border-zinc-200">
                <th className="px-4 py-4 font-normal cursor-pointer" onClick={() => handleSort('id')}>
                  <span className="relative inline-flex">Subnet <SortIcon col="id" /></span>
                </th>
                {APY_COLUMNS.map(([key, label]) => (
                  <th key={key} className="px-4 py-4 font-normal text-center cursor-pointer" onClick={() => handleSort(key)}>
                    <span className="relative inline-flex">{label} <SortIcon col={key} /></span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rankedSubnets.map(subnet => (
                <tr key={subnet.id} onClick={() => onSelectSubnet(subnet)} className="cursor-pointer hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-zinc-400 shrink-0">SN{String(subnet.id).padStart(2, '0')}</span>
                      <span className="font-medium text-zinc-700 truncate">{subnet.name || 'Unknown'}</span>
                    </div>
                  </td>
                  {APY_COLUMNS.map(([key]) => (
                    <td key={key} className="px-4 py-3 text-center font-mono text-xs">
                      <span className={subnet[key] == null ? 'text-zinc-400' : subnet[key] > 0 ? 'text-green-600' : 'text-zinc-600'}>
                        {formatAPY(subnet[key])}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
              {rankedSubnets.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-zinc-400 font-mono text-xs">No data</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
