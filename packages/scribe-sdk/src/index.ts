/* SPDX-License-Identifier: Apache-2.0 */
import { ScribeAgent } from './agent';
import { makeRuntime as makeScribeRuntime } from './runtime';

type RuntimeFactory = () => any;

function resolveRuntimeFactory(): RuntimeFactory {
  const override = process.env.SCRIBE_RUNTIME?.trim();
  if (!override || override === 'local' || override === 'scribe') {
    return makeScribeRuntime;
  }

  // Allow advanced users to point at a custom runtime module.
  // The module must export a makeRuntime() factory.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(override);
  const factory: RuntimeFactory | undefined = mod?.makeRuntime;

  if (typeof factory !== 'function') {
    throw new Error(`Runtime module "${override}" does not export makeRuntime()`);
  }

  return factory;
}

export function makeAgent() {
  const runtimeFactory = resolveRuntimeFactory();
  return new ScribeAgent(runtimeFactory);
}
