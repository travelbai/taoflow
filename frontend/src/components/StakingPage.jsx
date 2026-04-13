import { useState, useEffect, useMemo, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { useSortable } from '../hooks';
import { formatAPY } from '../utils/format';

const LOW_STAKE_THRESHOLD = 1000; // TAO

export default function StakingPage({ subnets, apiUrl, onNavigate }) {
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

  const filtered = useMemo(() =>
    showLowStake ? validators : validators.filter(v => (v.stake ?? 0) >= LOW_STAKE_THRESHOLD),
    [validators, showLowStake]
  );

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    const av = a[sortConfig.key] ?? 0;
    const bv = b[sortConfig.key] ?? 0;
    return sortConfig.direction === 'desc' ? bv - av : av - bv;
  }), [filtered, sortConfig]);

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
