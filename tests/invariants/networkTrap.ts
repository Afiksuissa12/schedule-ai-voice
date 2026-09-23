/**
 * INVARIANT 10, the runtime half: prove the sweep touched no network.
 *
 * WHY A RUNTIME TRAP AS WELL AS THE STATIC GUARD
 * ---------------------------------------------------------------------------
 * `tests/scheduling/providerBoundary.test.ts` reads the source and fails the
 * build if a guarded directory imports a vendor SDK. That is a strong check and
 * it catches the realistic case. What it cannot catch is a transitive
 * dependency dialling out, or a `globalThis.fetch` call assembled from a
 * string. So this module installs a trap over every outbound primitive Node
 * offers and RECORDS what tried to use it.
 *
 * IT RECORDS, IT DOES NOT THROW
 * ---------------------------------------------------------------------------
 * Throwing inside a patched `http.request` would surface as some unrelated
 * error hundreds of frames away, and the sweep would report a confusing failure
 * instead of a clear one. Recording lets the assertion happen where it reads
 * properly: "the sweep made 0 outbound attempts", with the offending target and
 * a stack if it ever stops being 0.
 *
 * WHAT IS DELIBERATELY NOT TRAPPED
 * ---------------------------------------------------------------------------
 * Unix-domain sockets and local file I/O. Prisma's SQLite engine runs in
 * process against a file, and `dns`/`net` traffic to a local socket is not what
 * "no network I/O" means here. `net.connect` IS trapped, but only TCP/IP
 * targets are recorded - see `isNetworkTarget`.
 */
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

export interface NetworkAttempt {
  /** `fetch` | `http.request` | `https.request` | `net.connect` */
  readonly via: string;
  readonly target: string;
  readonly stack: string;
}

/** Does this look like an attempt to reach another machine? */
function isNetworkTarget(options: unknown): boolean {
  if (typeof options === 'string') {
    return /^https?:\/\//i.test(options);
  }
  if (typeof options !== 'object' || options === null) return false;
  const candidate = options as { path?: unknown; host?: unknown; hostname?: unknown; port?: unknown };
  // A unix-socket connection names `path` and no host/port. Not network.
  if (typeof candidate.path === 'string' && candidate.host === undefined && candidate.port === undefined) {
    return false;
  }
  return candidate.host !== undefined || candidate.hostname !== undefined || candidate.port !== undefined;
}

function describe(options: unknown): string {
  if (typeof options === 'string') return options;
  if (options instanceof URL) return options.toString();
  if (typeof options === 'object' && options !== null) {
    const candidate = options as { host?: unknown; hostname?: unknown; port?: unknown; path?: unknown };
    return `${String(candidate.hostname ?? candidate.host ?? '?')}:${String(candidate.port ?? '?')}${String(
      candidate.path ?? '',
    )}`;
  }
  return String(options);
}

/**
 * Run `body` with every outbound primitive trapped, and report what it tried.
 *
 * Restores the originals in a `finally`, so a thrown body cannot leave the
 * process with patched globals and poison every test that follows.
 */
export async function withNetworkTrap<T>(
  body: () => Promise<T>,
): Promise<{ result: T; attempts: NetworkAttempt[] }> {
  const attempts: NetworkAttempt[] = [];
  const record = (via: string, target: unknown): void => {
    attempts.push({
      via,
      target: describe(target),
      stack: new Error('network attempt').stack ?? '(no stack)',
    });
  };

  const originalFetch = globalThis.fetch;
  const originalHttpRequest = http.request;
  const originalHttpGet = http.get;
  const originalHttpsRequest = https.request;
  const originalHttpsGet = https.get;
  const originalNetConnect = net.connect;

  globalThis.fetch = ((input: unknown, init?: unknown) => {
    record('fetch', input);
    return (originalFetch as (a: unknown, b?: unknown) => Promise<Response>)(input, init);
  }) as typeof fetch;

  const wrap = <F extends (...args: never[]) => unknown>(via: string, original: F): F =>
    ((...args: never[]) => {
      if (isNetworkTarget(args[0])) record(via, args[0]);
      return original(...args);
    }) as F;

  http.request = wrap('http.request', originalHttpRequest);
  http.get = wrap('http.get', originalHttpGet);
  https.request = wrap('https.request', originalHttpsRequest);
  https.get = wrap('https.get', originalHttpsGet);
  net.connect = wrap('net.connect', originalNetConnect);

  try {
    const result = await body();
    return { result, attempts };
  } finally {
    globalThis.fetch = originalFetch;
    http.request = originalHttpRequest;
    http.get = originalHttpGet;
    https.request = originalHttpsRequest;
    https.get = originalHttpsGet;
    net.connect = originalNetConnect;
  }
}
