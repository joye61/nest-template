// Ambient global declarations — Go runtime + captcha bridge.
// `wasm_exec.ts` registers `globalThis.Go` as a side effect when imported.

import type { GoWasmRuntime } from './wasm_exec.js';
import type { CaptchaBridge } from './index.js';

declare global {
  // eslint-disable-next-line no-var
  var Go: (new () => GoWasmRuntime) | undefined;
  // eslint-disable-next-line no-var
  var goCaptcha: CaptchaBridge | undefined;
  // wasm_exec.ts also conditionally installs minimal stubs for these:
  // eslint-disable-next-line no-var
  var fs: unknown;
}

export {};
