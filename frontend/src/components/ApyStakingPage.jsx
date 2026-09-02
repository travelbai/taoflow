import { useEffect, useMemo, useState } from 'react';
import { useSortable } from '../hooks';
import { formatAPY } from '../utils/format';

const APY_COLUMNS = [
  ['apy_1h', '1H APY'],
  ['apy_1d', '1D APY'],
  ['apy_7d', '7D APY'],
  ['apy_30d', '30D APY'],
];
const LOW_STAKE_THRESHOLD = 1000; // Matches the default STAKING table filter.

function apyValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildSubnetApy(validators) {
  const highest7d = validators.reduce((best, validator) => {
    const apy = apyValue(validator.apy_7d);
    if (apy == null || Number(validator.stake ?? 0) < LOW_STAKE_THRESHOLD) return best;
    return !best || apy > apyValue(best.apy_7d) ? validator : best;
  }, null);
  return {
    hotkey: highest7d?.hotkey ?? null,
    ...Object.fromEntries(APY_COLUMNS.map(([key]) => [key, apyValue(highest7d?.[key])])),
  };
}

export default function ApyStakingPage({ subnets, apiUrl, onNavigate, onSelectSubnet }) {
  const { sortConfig, handleSort, SortIcon } = useSortable('id', 'asc');
  const [apyByNetuid, setApyByNetuid] = useState({});

  useEffect(() => {
    if (!apiUrl || !subnets.length) return;

    let cancelled = false;
    let nextIndex = 0;
    const loadOne = async () => {
      while (!cancelled) {
        const subnet = subnets[nextIndex++];
        if (!subnet) return;
        try {
          const response = await fetch(`${apiUrl}/staking?netuid=${subnet.id}`);
          const payload = await response.json();
          if (!response.ok || !Array.isArray(payload.data) || cancelled) continue;
          setApyByNetuid(current => ({
            ...current,
            [subnet.id]: buildSubnetApy(payload.data),
          }));
        } catch {
          // Leave this subnet blank; a later visit retries through the existing API cache.
        }
      }
    };

    // Limit concurrent requests so opening the ranking does not flood the existing API.
    Promise.all(Array.from({ length: Math.min(4, subnets.length) }, loadOne));
    return () => { cancelled = true; };
  }, [apiUrl, subnets]);

  const rankedSubnets = useMemo(() => subnets
    .map(subnet => {
      const apy = apyByNetuid[subnet.id];
      return {
        ...subnet,
        apy_1h: apy?.apy_1h ?? null,
        apy_1d: apy?.apy_1d ?? null,
        apy_7d: apy?.apy_7d ?? null,
        apy_30d: apy?.apy_30d ?? null,
        hotkey: apy?.hotkey ?? null,
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
