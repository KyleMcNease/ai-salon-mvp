/* SPDX-License-Identifier: Apache-2.0 */
import { ScribeAgent } from "./agent"
export function makeAgent() {
  const runtimeFactory = process.env.SCRIBE_RUNTIME === 'scribe'
    ? require('../../scribe-core/runtime').makeRuntime
    : require('../../../agents/adapters/ii-runtime').makeRuntime
  return new ScribeAgent(runtimeFactory)
}
