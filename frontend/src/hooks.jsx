import { useState, useEffect, useCallback } from 'react';
import seedData from './seed.json';

export function useData(url) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);

  const fetchData = useCallback(async () => {
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

  return { data, loading, error, updatedAt };
}

export function useSortable(defaultKey, defaultDir = 'desc') {
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
