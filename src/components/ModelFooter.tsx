'use client';

import { useEffect, useState, useCallback } from 'react';

type ProviderStatus = { ok: boolean; model: string };
type Health = {
  ok: boolean;
  time: string;
  providers: {
    gpt: ProviderStatus;
    claude: ProviderStatus;
    grok: ProviderStatus;
  };
};

export default function ModelFooter() {
  const [health, setHealth] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch('/api/health', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const h = (await r.json()) as Health;
      setHealth(h);
    } catch (e: any) {
      setErr(String(e?.message || e));
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // try once on mount, but don't block UI if it hangs
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      if (!cancelled && !health && !err) setErr('Health check timed out.');
    }, 5000);
    load().finally(() => clearTimeout(t));
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const badge = (ok: boolean) => (ok ? '✅' : '❌');

  return (
    <footer className="w-full border-t text-sm text-gray-600 p-2 flex items-center gap-4">
      <span className="opacity-70">Health:</span>
      {loading && <span>loading…</span>}
      {err && <span className="text-red-600">error: {err}</span>}
      {health && (
        <>
          <span title={`time: ${health.time}`}>
            {badge(health.providers.gpt.ok)} GPT
            <span className="ml-1 opacity-70">({health.providers.gpt.model || 'unset'})</span>
          </span>
          <span>
            {badge(health.providers.claude.ok)} Claude
            <span className="ml-1 opacity-70">({health.providers.claude.model || 'unset'})</span>
          </span>
          <span>
            {badge(health.providers.grok.ok)} Grok
            <span className="ml-1 opacity-70">({health.providers.grok.model || 'unset'})</span>
          </span>
        </>
      )}
      <button
        onClick={load}
        className="ml-auto px-2 py-1 border rounded"
        disabled={loading}
        aria-label="Refresh health"
        title="Refresh health"
      >
        Refresh
      </button>
    </footer>
  );
}

