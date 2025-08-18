'use client';

import { useEffect, useState } from 'react';

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

  useEffect(() => {
    let alive = true;
    fetch('/api/health', { cache: 'no-store' })
      .then(r => r.json())
      .then((h: Health) => { if (alive) setHealth(h); })
      .catch(e => setErr(String(e)));
    return () => { alive = false; };
  }, []);

  const badge = (ok: boolean) => ok ? '✅' : '❌';

  return (
    <footer className="w-full border-t text-sm text-gray-600 p-2 flex items-center gap-4">
      <span className="opacity-70">Health:</span>
      {err && <span className="text-red-600">error: {err}</span>}
      {!health && !err && <span>loading…</span>}
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
    </footer>
  );
}

