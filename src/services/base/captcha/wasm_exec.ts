// Translated from Go's lib/wasm/wasm_exec.js to TypeScript.
// This is a side-effect-only module: importing it registers `globalThis.Go`.

"use strict";

// ─── Internal helpers ──────────────────────────────────────────────────────

function enosys(): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error("not implemented");
  err.code = "ENOSYS";
  return err;
}

// Minimal typings for the subset of Node.js fs that wasm_exec uses.
interface FsLike {
  constants: Record<string, number>;
  writeSync(fd: number, buf: Uint8Array): number;
  write(fd: number, buf: Uint8Array, offset: number, length: number, position: null, callback: (err: Error | null, n?: number) => void): void;
  chmod(path: string, mode: number, callback: (err: Error) => void): void;
  chown(path: string, uid: number, gid: number, callback: (err: Error) => void): void;
  close(fd: number, callback: (err: Error) => void): void;
  fchmod(fd: number, mode: number, callback: (err: Error) => void): void;
  fchown(fd: number, uid: number, gid: number, callback: (err: Error) => void): void;
  fstat(fd: number, callback: (err: Error) => void): void;
  fsync(fd: number, callback: (err: Error | null) => void): void;
  ftruncate(fd: number, length: number, callback: (err: Error) => void): void;
  lchown(path: string, uid: number, gid: number, callback: (err: Error) => void): void;
  link(path: string, link: string, callback: (err: Error) => void): void;
  lstat(path: string, callback: (err: Error) => void): void;
  mkdir(path: string, perm: number, callback: (err: Error) => void): void;
  open(path: string, flags: number, mode: number, callback: (err: Error) => void): void;
  read(fd: number, buffer: Uint8Array, offset: number, length: number, position: number, callback: (err: Error) => void): void;
  readdir(path: string, callback: (err: Error) => void): void;
  readlink(path: string, callback: (err: Error) => void): void;
  rename(from: string, to: string, callback: (err: Error) => void): void;
  rmdir(path: string, callback: (err: Error) => void): void;
  stat(path: string, callback: (err: Error) => void): void;
  symlink(path: string, link: string, callback: (err: Error) => void): void;
  truncate(path: string, length: number, callback: (err: Error) => void): void;
  unlink(path: string, callback: (err: Error) => void): void;
  utimes(path: string, atime: number, mtime: number, callback: (err: Error) => void): void;
}

if (!globalThis.fs) {
  let outputBuf = "";
  const decoder = new TextDecoder("utf-8");

  (globalThis as Record<string, unknown>).fs = {
    constants: { O_WRONLY: -1, O_RDWR: -1, O_CREAT: -1, O_TRUNC: -1, O_APPEND: -1, O_EXCL: -1, O_DIRECTORY: -1 },
    writeSync(fd: number, buf: Uint8Array): number {
      outputBuf += decoder.decode(buf);
      const nl = outputBuf.lastIndexOf("\n");
      if (nl !== -1) {
        console.log(outputBuf.substring(0, nl));
        outputBuf = outputBuf.substring(nl + 1);
      }
      return buf.length;
    },
    write(fd: number, buf: Uint8Array, offset: number, length: number, position: null, callback: (err: Error | null, n?: number) => void): void {
      if (offset !== 0 || length !== buf.length || position !== null) {
        callback(enosys());
        return;
      }
      const n = (globalThis.fs as FsLike).writeSync(fd, buf);
      callback(null, n);
    },
    chmod(_path: string, _mode: number, callback: (err: Error) => void)              { callback(enosys()); },
    chown(_path: string, _uid: number, _gid: number, callback: (err: Error) => void) { callback(enosys()); },
    close(_fd: number, callback: (err: Error) => void)                               { callback(enosys()); },
    fchmod(_fd: number, _mode: number, callback: (err: Error) => void)               { callback(enosys()); },
    fchown(_fd: number, _uid: number, _gid: number, callback: (err: Error) => void)  { callback(enosys()); },
    fstat(_fd: number, callback: (err: Error) => void)                               { callback(enosys()); },
    fsync(_fd: number, callback: (err: Error | null) => void)                        { callback(null); },
    ftruncate(_fd: number, _length: number, callback: (err: Error) => void)          { callback(enosys()); },
    lchown(_path: string, _uid: number, _gid: number, callback: (err: Error) => void){ callback(enosys()); },
    link(_path: string, _link: string, callback: (err: Error) => void)               { callback(enosys()); },
    lstat(_path: string, callback: (err: Error) => void)                             { callback(enosys()); },
    mkdir(_path: string, _perm: number, callback: (err: Error) => void)              { callback(enosys()); },
    open(_path: string, _flags: number, _mode: number, callback: (err: Error) => void){ callback(enosys()); },
    read(_fd: number, _buffer: Uint8Array, _offset: number, _length: number, _position: number, callback: (err: Error) => void) { callback(enosys()); },
    readdir(_path: string, callback: (err: Error) => void)                           { callback(enosys()); },
    readlink(_path: string, callback: (err: Error) => void)                          { callback(enosys()); },
    rename(_from: string, _to: string, callback: (err: Error) => void)               { callback(enosys()); },
    rmdir(_path: string, callback: (err: Error) => void)                             { callback(enosys()); },
    stat(_path: string, callback: (err: Error) => void)                              { callback(enosys()); },
    symlink(_path: string, _link: string, callback: (err: Error) => void)            { callback(enosys()); },
    truncate(_path: string, _length: number, callback: (err: Error) => void)         { callback(enosys()); },
    unlink(_path: string, callback: (err: Error) => void)                            { callback(enosys()); },
    utimes(_path: string, _atime: number, _mtime: number, callback: (err: Error) => void) { callback(enosys()); },
  } satisfies FsLike;
}

if (!globalThis.process) {
  (globalThis as Record<string, unknown>).process = {
    getuid()  { return -1; },
    getgid()  { return -1; },
    geteuid() { return -1; },
    getegid() { return -1; },
    getgroups(): never { throw enosys(); },
    pid:  -1,
    ppid: -1,
    umask(): never  { throw enosys(); },
    cwd(): never    { throw enosys(); },
    chdir(): never  { throw enosys(); },
  };
}

if (!(globalThis as Record<string, unknown>).path) {
  (globalThis as Record<string, unknown>).path = {
    resolve(...pathSegments: string[]): string {
      return pathSegments.join("/");
    },
  };
}

if (!globalThis.crypto) {
  throw new Error("globalThis.crypto is not available, polyfill required (crypto.getRandomValues only)");
}
if (!globalThis.performance) {
  throw new Error("globalThis.performance is not available, polyfill required (performance.now only)");
}
if (!globalThis.TextEncoder) {
  throw new Error("globalThis.TextEncoder is not available, polyfill required");
}
if (!globalThis.TextDecoder) {
  throw new Error("globalThis.TextDecoder is not available, polyfill required");
}

// ─── Go wasm runtime class ─────────────────────────────────────────────────

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

/** Minimal view of a WebAssembly instance as used internally by the runtime. */
interface GoInst extends WebAssembly.Instance {
  exports: WebAssembly.Exports & {
    mem: WebAssembly.Memory;
    run(argc: number, argv: number): void;
    resume(): void;
    getsp(): number;
    testExport0?(): void;
    testExport?(a: number, b: number): number;
  };
}

/** Public interface exposed on `globalThis.Go`. */
export interface GoWasmRuntime {
  argv: string[];
  env: Record<string, string>;
  exit(code: number): void;
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
  exited: boolean;
}

class GoRuntime implements GoWasmRuntime {
  argv: string[] = ["js"];
  env: Record<string, string> = {};
  exit = (code: number): void => {
    if (code !== 0) console.warn("exit code:", code);
  };
  exited = false;

  // Internal state
  /** @internal */ _inst!: GoInst;
  /** @internal */ mem!: DataView;
  /** @internal */ _values!: unknown[];
  /** @internal */ _goRefCounts!: number[];
  /** @internal */ _ids!: Map<unknown, number>;
  /** @internal */ _idPool!: number[];
  /** @internal */ _pendingEvent: unknown = null;
  /** @internal */ _scheduledTimeouts = new Map<number, ReturnType<typeof setTimeout>>();
  /** @internal */ _nextCallbackTimeoutID = 1;
  /** @internal */ _exitPromise: Promise<void>;
  /** @internal */ _resolveExitPromise!: () => void;
  importObject: WebAssembly.Imports;

  constructor() {
    this._exitPromise = new Promise<void>((resolve) => {
      this._resolveExitPromise = resolve;
    });

    const setInt64 = (addr: number, v: number): void => {
      this.mem.setUint32(addr + 0, v, true);
      this.mem.setUint32(addr + 4, Math.floor(v / 4294967296), true);
    };
    const getInt64 = (addr: number): number => {
      const low  = this.mem.getUint32(addr + 0, true);
      const high = this.mem.getInt32(addr + 4, true);
      return low + high * 4294967296;
    };
    const loadValue = (addr: number): unknown => {
      const f = this.mem.getFloat64(addr, true);
      if (f === 0) return undefined;
      if (!isNaN(f)) return f;
      const id = this.mem.getUint32(addr, true);
      return this._values[id];
    };
    const storeValue = (addr: number, v: unknown): void => {
      const nanHead = 0x7FF80000;
      if (typeof v === "number" && v !== 0) {
        if (isNaN(v)) {
          this.mem.setUint32(addr + 4, nanHead, true);
          this.mem.setUint32(addr, 0, true);
          return;
        }
        this.mem.setFloat64(addr, v, true);
        return;
      }
      if (v === undefined) { this.mem.setFloat64(addr, 0, true); return; }

      let id = this._ids.get(v);
      if (id === undefined) {
        id = this._idPool.pop();
        if (id === undefined) id = this._values.length;
        this._values[id] = v;
        this._goRefCounts[id] = 0;
        this._ids.set(v, id);
      }
      this._goRefCounts[id]++;
      let typeFlag = 0;
      switch (typeof v) {
        case "object":   if (v !== null) typeFlag = 1; break;
        case "string":   typeFlag = 2; break;
        case "symbol":   typeFlag = 3; break;
        case "function": typeFlag = 4; break;
      }
      this.mem.setUint32(addr + 4, nanHead | typeFlag, true);
      this.mem.setUint32(addr, id, true);
    };
    const loadSlice = (addr: number): Uint8Array => {
      const array = getInt64(addr + 0);
      const len   = getInt64(addr + 8);
      return new Uint8Array(this._inst.exports.mem.buffer, array, len);
    };
    const loadSliceOfValues = (addr: number): unknown[] => {
      const array = getInt64(addr + 0);
      const len   = getInt64(addr + 8);
      const a: unknown[] = new Array(len);
      for (let i = 0; i < len; i++) a[i] = loadValue(array + i * 8);
      return a;
    };
    const loadString = (addr: number): string => {
      const saddr = getInt64(addr + 0);
      const len   = getInt64(addr + 8);
      return decoder.decode(new DataView(this._inst.exports.mem.buffer, saddr, len));
    };
    const testCallExport = (a: number, b: number): number | undefined => {
      this._inst.exports.testExport0?.();
      return this._inst.exports.testExport?.(a, b);
    };

    const timeOrigin = Date.now() - performance.now();

    this.importObject = {
      _gotest: {
        add: (a: number, b: number) => a + b,
        callExport: testCallExport,
      },
      gojs: {
        "runtime.wasmExit": (sp: number) => {
          sp >>>= 0;
          const code = this.mem.getInt32(sp + 8, true);
          this.exited = true;
          delete (this as Partial<GoRuntime>)._inst;
          delete (this as Partial<GoRuntime>)._values;
          delete (this as Partial<GoRuntime>)._goRefCounts;
          delete (this as Partial<GoRuntime>)._ids;
          delete (this as Partial<GoRuntime>)._idPool;
          this.exit(code);
        },
        "runtime.wasmWrite": (sp: number) => {
          sp >>>= 0;
          const fd = getInt64(sp + 8);
          const p  = getInt64(sp + 16);
          const n  = this.mem.getInt32(sp + 24, true);
          (globalThis.fs as FsLike).writeSync(fd, new Uint8Array(this._inst.exports.mem.buffer, p, n));
        },
        "runtime.resetMemoryDataView": (sp: number) => {
          sp >>>= 0;
          this.mem = new DataView(this._inst.exports.mem.buffer);
        },
        "runtime.nanotime1": (sp: number) => {
          sp >>>= 0;
          setInt64(sp + 8, (timeOrigin + performance.now()) * 1000000);
        },
        "runtime.walltime": (sp: number) => {
          sp >>>= 0;
          const msec = new Date().getTime();
          setInt64(sp + 8, msec / 1000);
          this.mem.setInt32(sp + 16, (msec % 1000) * 1000000, true);
        },
        "runtime.scheduleTimeoutEvent": (sp: number) => {
          sp >>>= 0;
          const id = this._nextCallbackTimeoutID++;
          this._scheduledTimeouts.set(id, setTimeout(() => {
            this._resume();
            while (this._scheduledTimeouts.has(id)) {
              console.warn("scheduleTimeoutEvent: missed timeout event");
              this._resume();
            }
          }, getInt64(sp + 8)));
          this.mem.setInt32(sp + 16, id, true);
        },
        "runtime.clearTimeoutEvent": (sp: number) => {
          sp >>>= 0;
          const id = this.mem.getInt32(sp + 8, true);
          clearTimeout(this._scheduledTimeouts.get(id));
          this._scheduledTimeouts.delete(id);
        },
        "runtime.getRandomData": (sp: number) => {
          sp >>>= 0;
          crypto.getRandomValues(loadSlice(sp + 8) as unknown as ArrayBufferView<ArrayBuffer>);
        },
        "syscall/js.finalizeRef": (sp: number) => {
          sp >>>= 0;
          const id = this.mem.getUint32(sp + 8, true);
          this._goRefCounts[id]--;
          if (this._goRefCounts[id] === 0) {
            const v = this._values[id];
            this._values[id] = null;
            this._ids.delete(v);
            this._idPool.push(id);
          }
        },
        "syscall/js.stringVal": (sp: number) => {
          sp >>>= 0;
          storeValue(sp + 24, loadString(sp + 8));
        },
        "syscall/js.valueGet": (sp: number) => {
          sp >>>= 0;
          const result = Reflect.get(loadValue(sp + 8) as object, loadString(sp + 16));
          sp = this._inst.exports.getsp() >>> 0;
          storeValue(sp + 32, result);
        },
        "syscall/js.valueSet": (sp: number) => {
          sp >>>= 0;
          Reflect.set(loadValue(sp + 8) as object, loadString(sp + 16), loadValue(sp + 32));
        },
        "syscall/js.valueDelete": (sp: number) => {
          sp >>>= 0;
          Reflect.deleteProperty(loadValue(sp + 8) as object, loadString(sp + 16));
        },
        "syscall/js.valueIndex": (sp: number) => {
          sp >>>= 0;
          storeValue(sp + 24, Reflect.get(loadValue(sp + 8) as object, getInt64(sp + 16)));
        },
        "syscall/js.valueSetIndex": (sp: number) => {
          sp >>>= 0;
          Reflect.set(loadValue(sp + 8) as object, getInt64(sp + 16), loadValue(sp + 24));
        },
        "syscall/js.valueCall": (sp: number) => {
          sp >>>= 0;
          try {
            const v    = loadValue(sp + 8) as object;
            const m    = Reflect.get(v, loadString(sp + 16)) as (...a: unknown[]) => unknown;
            const args = loadSliceOfValues(sp + 32);
            const result = Reflect.apply(m, v, args);
            sp = this._inst.exports.getsp() >>> 0;
            storeValue(sp + 56, result);
            this.mem.setUint8(sp + 64, 1);
          } catch (err) {
            sp = this._inst.exports.getsp() >>> 0;
            storeValue(sp + 56, err);
            this.mem.setUint8(sp + 64, 0);
          }
        },
        "syscall/js.valueInvoke": (sp: number) => {
          sp >>>= 0;
          try {
            const v    = loadValue(sp + 8) as (...a: unknown[]) => unknown;
            const args = loadSliceOfValues(sp + 16);
            const result = Reflect.apply(v, undefined, args);
            sp = this._inst.exports.getsp() >>> 0;
            storeValue(sp + 40, result);
            this.mem.setUint8(sp + 48, 1);
          } catch (err) {
            sp = this._inst.exports.getsp() >>> 0;
            storeValue(sp + 40, err);
            this.mem.setUint8(sp + 48, 0);
          }
        },
        "syscall/js.valueNew": (sp: number) => {
          sp >>>= 0;
          try {
            const v    = loadValue(sp + 8) as new (...a: unknown[]) => unknown;
            const args = loadSliceOfValues(sp + 16);
            const result = Reflect.construct(v, args);
            sp = this._inst.exports.getsp() >>> 0;
            storeValue(sp + 40, result);
            this.mem.setUint8(sp + 48, 1);
          } catch (err) {
            sp = this._inst.exports.getsp() >>> 0;
            storeValue(sp + 40, err);
            this.mem.setUint8(sp + 48, 0);
          }
        },
        "syscall/js.valueLength": (sp: number) => {
          sp >>>= 0;
          setInt64(sp + 16, parseInt(String((loadValue(sp + 8) as { length: unknown }).length)));
        },
        "syscall/js.valuePrepareString": (sp: number) => {
          sp >>>= 0;
          const str = encoder.encode(String(loadValue(sp + 8)));
          storeValue(sp + 16, str);
          setInt64(sp + 24, str.length);
        },
        "syscall/js.valueLoadString": (sp: number) => {
          sp >>>= 0;
          const str = loadValue(sp + 8) as Uint8Array;
          loadSlice(sp + 16).set(str);
        },
        "syscall/js.valueInstanceOf": (sp: number) => {
          sp >>>= 0;
          this.mem.setUint8(
            sp + 24,
            (loadValue(sp + 8) instanceof (loadValue(sp + 16) as new (...a: unknown[]) => unknown)) ? 1 : 0,
          );
        },
        "syscall/js.copyBytesToGo": (sp: number) => {
          sp >>>= 0;
          const dst = loadSlice(sp + 8);
          const src = loadValue(sp + 32);
          if (!(src instanceof Uint8Array || src instanceof Uint8ClampedArray)) {
            this.mem.setUint8(sp + 48, 0);
            return;
          }
          const toCopy = src.subarray(0, dst.length);
          dst.set(toCopy);
          setInt64(sp + 40, toCopy.length);
          this.mem.setUint8(sp + 48, 1);
        },
        "syscall/js.copyBytesToJS": (sp: number) => {
          sp >>>= 0;
          const dst = loadValue(sp + 8);
          const src = loadSlice(sp + 16);
          if (!(dst instanceof Uint8Array || dst instanceof Uint8ClampedArray)) {
            this.mem.setUint8(sp + 48, 0);
            return;
          }
          const toCopy = src.subarray(0, dst.length);
          dst.set(toCopy);
          setInt64(sp + 40, toCopy.length);
          this.mem.setUint8(sp + 48, 1);
        },
        "debug": (value: unknown) => {
          console.log(value);
        },
      },
    };
  }

  async run(instance: WebAssembly.Instance): Promise<void> {
    if (!(instance instanceof WebAssembly.Instance)) {
      throw new Error("Go.run: WebAssembly.Instance expected");
    }
    this._inst = instance as GoInst;
    this.mem = new DataView(this._inst.exports.mem.buffer);
    this._values = [NaN, 0, null, true, false, globalThis, this];
    this._goRefCounts = new Array<number>(this._values.length).fill(Infinity);
    this._ids = new Map<unknown, number>([
      [0, 1], [null, 2], [true, 3], [false, 4], [globalThis, 5], [this, 6],
    ]);
    this._idPool = [];
    this.exited = false;

    let offset = 4096;
    const strPtr = (str: string): number => {
      const ptr   = offset;
      const bytes = encoder.encode(str + "\0");
      new Uint8Array(this.mem.buffer, offset, bytes.length).set(bytes);
      offset += bytes.length;
      if (offset % 8 !== 0) offset += 8 - (offset % 8);
      return ptr;
    };

    const argc = this.argv.length;
    const argvPtrs: number[] = [];
    this.argv.forEach((arg) => argvPtrs.push(strPtr(arg)));
    argvPtrs.push(0);
    Object.keys(this.env).sort().forEach((key) => argvPtrs.push(strPtr(`${key}=${this.env[key]}`)));
    argvPtrs.push(0);

    const argv = offset;
    argvPtrs.forEach((ptr) => {
      this.mem.setUint32(offset, ptr, true);
      this.mem.setUint32(offset + 4, 0, true);
      offset += 8;
    });

    const wasmMinDataAddr = 4096 + 8192;
    if (offset >= wasmMinDataAddr) {
      throw new Error("total length of command line and environment variables exceeds limit");
    }

    this._inst.exports.run(argc, argv);
    if (this.exited) this._resolveExitPromise();
    await this._exitPromise;
  }

  _resume(): void {
    if (this.exited) throw new Error("Go program has already exited");
    this._inst.exports.resume();
    if (this.exited) this._resolveExitPromise();
  }

  _makeFuncWrapper(id: number): (...args: unknown[]) => unknown {
    const go = this;
    return function (this: unknown, ...args: unknown[]): unknown {
      const event = { id, this: this, args, result: undefined as unknown };
      go._pendingEvent = event;
      go._resume();
      return event.result;
    };
  }
}

// Register on globalThis so the rest of the runtime can find it.
globalThis.Go = GoRuntime;

export type { GoWasmRuntime as GoRuntimeType };
