/* SPDX-License-Identifier: Apache-2.0
   (c) 2025 SCRIBE AI. All rights reserved. */

import { randomUUID } from 'crypto';

type RunOptions = { tools?: any[]; policy?: any; stream?: boolean };
type RunEvent =
  | { type: 'log'; message: string }
  | { type: 'delta'; value: string }
  | { type: 'done' };

const STREAM_DELAY_MS = 15;

async function* streamText(text: string): AsyncIterable<RunEvent> {
  // split on whitespace but preserve spacing for a smoother stream
  const words = text.split(/(\s+)/);
  for (const chunk of words) {
    if (!chunk) continue;
    await new Promise((resolve) => setTimeout(resolve, STREAM_DELAY_MS));
    yield { type: 'delta', value: chunk };
  }
  yield { type: 'done' };
}

function resolvePrompt(prompt: string): { output: string; events: AsyncIterable<RunEvent> } {
  const normalized = prompt.trim();
  if (normalized.length === 0) {
    const fallback = 'No prompt supplied.';
    return { output: fallback, events: streamText(fallback) };
  }

  const sayMatch = normalized.match(/^say\s+['"](.+?)['"]$/i);
  if (sayMatch) {
    const message = sayMatch[1];
    return { output: message, events: streamText(message) };
  }

  const response = `Scribe runtime received: ${normalized}`;
  return { output: response, events: streamText(response) };
}

export function makeRuntime() {
  return {
    async runTask(prompt: string, opts: RunOptions = {}) {
      const taskId = randomUUID();
      const { output, events } = resolvePrompt(prompt);
      return {
        taskId,
        output,
        events: opts.stream ? events : undefined,
      };
    },
  };
}

