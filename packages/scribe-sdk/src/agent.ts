/* SPDX-License-Identifier: Apache-2.0
   (c) 2025 SCRIBE AI. All rights reserved. */
export interface RunOptions { tools?: any[]; policy?: any; stream?: boolean }
export interface RunResult { taskId: string; output?: string; events?: AsyncIterable<any> }

export class ScribeAgent {
  private runtime: any
  constructor(runtimeFactory: () => any) { this.runtime = runtimeFactory() }
  async runTask(prompt: string, opts: RunOptions = {}): Promise<RunResult> {
    // enforce SCRIBE policy hooks here (audit, provenance, cost caps)
    return this.runtime.runTask(prompt, opts)
  }
}
