// go-captcha — TypeScript source distribution.
//
// Copy this whole folder into your Node.js + TypeScript project, then import:
//
//     import { createCaptcha } from './go-captcha/index.js';
//
// The folder must keep all files together at runtime:
//   - index.ts          (this file; or its compiled .js)
//   - wasm_exec.ts      (Go wasm runtime — pure TS, no .cjs needed)
//   - globals.d.ts      (ambient global types)
//
// captcha.wasm is loaded from <project-root>/assets/captcha.wasm at runtime
// (resolved via process.cwd()).
//
// Requirements:
//   * Node.js >= 18
//   * TypeScript with module / moduleResolution set to one of:
//       NodeNext | Node16 | Bundler | ESNext
//   * @types/node installed.

import './wasm_exec'; // side-effect: registers globalThis.Go

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** captcha.wasm 默认路径：项目根目录下的 assets/ 目录 */
const DEFAULT_WASM_PATH = resolve(process.cwd(), 'assets', 'captcha.wasm');

export type CaptchaMode = 'easy' | 'normal' | 'hard';
export type CaptchaFormat = 'png' | 'jpeg' | 'jpg' | 'webp';

export interface CaptchaOptions {
  /** Image width in pixels. Default 240. */
  width?: number;
  /** Image height in pixels. Default 80. */
  height?: number;
  /** Number of characters in the answer. Default 4. */
  length?: number;
  /** Disallow repeated characters in the answer. Default true. */
  noRepeat?: boolean;
  /** Character pool to sample from. */
  source?: string;
  /** Difficulty level. */
  mode?: CaptchaMode;
  /** Horizontal gap between glyphs in pixels. Default 5. */
  spacing?: number;
  /** Output image format. Default 'png'. */
  format?: CaptchaFormat;
}

export interface CaptchaResult {
  /** Encoded image bytes (PNG/JPEG). */
  buffer: Uint8Array;
  /** Ground-truth answer text. */
  text: string;
  /** MIME type matching the format. */
  mime: string;
  width: number;
  height: number;
}

export interface CaptchaBridge {
  createCaptcha(options?: CaptchaOptions): CaptchaResult | { error: string };
}

export type WasmSource = string | URL | Uint8Array | ArrayBuffer;

let bridgePromise: Promise<CaptchaBridge> | null = null;

function isNode(): boolean {
  return typeof process !== 'undefined' && !!process.versions && !!process.versions.node;
}

async function loadWasmBytes(source?: WasmSource): Promise<Uint8Array> {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);

  if (typeof source === 'string' || source instanceof URL) {
    if (isNode()) {
      const path =
        source instanceof URL && source.protocol === 'file:'
          ? fileURLToPath(source)
          : (typeof source === 'string' ? source : source.toString());
      const buf = await readFile(path);
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    const res = await fetch(source as RequestInfo | URL);
    if (!res.ok) throw new Error(`failed to fetch wasm: ${res.status} ${res.statusText}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  if (!isNode()) {
    throw new Error('In browser environments you must pass a wasm URL to loadCaptcha()');
  }
  const buf = await readFile(DEFAULT_WASM_PATH);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

async function instantiate(source?: WasmSource): Promise<CaptchaBridge> {
  // globalThis.Go is guaranteed to exist: wasm_exec.ts runs at import time.
  const bytes = await loadWasmBytes(source);
  const GoCtor = globalThis.Go;
  if (!GoCtor) throw new Error('globalThis.Go was not registered by wasm_exec');
  const go = new GoCtor();
  // The `BufferSource` overload of `WebAssembly.instantiate` returns
  // `WebAssemblyInstantiatedSource`. TypeScript's generic Uint8Array typing
  // can confuse overload resolution, so we widen explicitly.
  const result = (await WebAssembly.instantiate(
    bytes as BufferSource,
    go.importObject,
  )) as WebAssembly.WebAssemblyInstantiatedSource;
  void go.run(result.instance);
  const bridge = globalThis.goCaptcha;
  if (!bridge || typeof bridge.createCaptcha !== 'function') {
    throw new Error('go-captcha wasm bridge did not initialize');
  }
  return bridge;
}

/**
 * Load (and cache) the wasm module, returning the low-level bridge.
 * Subsequent calls reuse the same instance.
 *
 * 在 Node.js 中，`captcha.wasm` 默认从项目根目录的 `assets/captcha.wasm` 加载（通过 `process.cwd()` 解析）。
 * 也可传入显式路径/URL/字节数组覆盖默认行为。
 * 在浏览器中必须传入显式 URL（并提前加载 `wasm_exec.js` 使 `globalThis.Go` 可用）。
 */
export function loadCaptcha(wasmSource?: WasmSource): Promise<CaptchaBridge> {
  if (!bridgePromise) {
    bridgePromise = instantiate(wasmSource).catch((err: unknown) => {
      bridgePromise = null;
      throw err;
    });
  }
  return bridgePromise;
}

/**
 * Generate a single captcha image. The wasm module is lazily initialized
 * on the first call and cached for the lifetime of the process / worker.
 */
export async function createCaptcha(options: CaptchaOptions = {}): Promise<CaptchaResult> {
  const bridge = await loadCaptcha();
  const result = bridge.createCaptcha(options);
  if ('error' in result && result.error) {
    throw new Error(result.error);
  }
  return result as CaptchaResult;
}

export default { createCaptcha, loadCaptcha };
