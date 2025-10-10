/* SPDX-License-Identifier: Apache-2.0
   (c) 2025 SCRIBE AI. All rights reserved. */
type RunOptions = { tools?: any[]; policy?: any; stream?: boolean };
export function makeRuntime() {
  // local bridge into vendored II-Agent server/SDK; replace when scribe-core lands
  const ii = require('../scribe-agent/src/index.js'); // adjust to their entrypoint
  return {
    async runTask(prompt: string, opts: RunOptions) {
      return ii.runTask({ prompt, ...opts })  // shape-match their API
    }
  }
}
