'use client';

import Image from 'next/image';

import type { AgentId } from '@/config/agents';
import { getAgentDisplay } from '@/config/agents';

type Props = {
  agentId: AgentId | string;
};

export default function AgentIdentityCard({ agentId }: Props) {
  const display = getAgentDisplay(agentId);

  return (
    <section
      className="flex items-center gap-4 p-4 border-b bg-white/60 backdrop-blur"
      style={{ borderColor: display.color }}
      aria-label={`${display.displayName} identity`}
    >
      {display.avatarUrl ? (
        <Image
          src={display.avatarUrl}
          alt={`${display.displayName} avatar`}
          width={64}
          height={64}
          className="h-16 w-16 rounded-full object-cover border"
          style={{ borderColor: display.color }}
          unoptimized
        />
      ) : (
        <div
          className="h-16 w-16 rounded-full flex items-center justify-center text-white text-lg font-semibold"
          style={{ backgroundColor: display.color }}
        >
          {display.displayName.slice(0, 2).toUpperCase()}
        </div>
      )}
      <div className="space-y-1 max-w-3xl">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold" style={{ color: display.color }}>
            {display.displayName}
          </h2>
          <span className="text-xs uppercase tracking-wide text-neutral-500">
            {display.providerName}
          </span>
        </div>
        <p className="text-sm text-neutral-700">{display.tagline}</p>
        <div className="text-xs text-neutral-500 flex flex-col sm:flex-row sm:items-center sm:gap-4">
          <span>
            <strong className="text-neutral-600">Voice:</strong> {display.voiceStyle}
          </span>
          <span>
            <strong className="text-neutral-600">Avatar:</strong> {display.avatarStyle}
          </span>
        </div>
      </div>
    </section>
  );
}
