/**
 * Shared HTTP client with TLS configuration for Windows compatibility.
 *
 * Node's built-in fetch() (undici) uses its own TLS stack and ignores the
 * Windows certificate store. Corporate proxies/firewalls with custom CAs
 * cause TLS handshake failures. This module creates a configured undici
 * Agent that respects NODE_EXTRA_CA_CERTS and handles custom trust stores.
 */

import { Agent } from 'undici';
import undiciFetch from 'undici';
import fs from 'fs';

let sharedAgent: Agent | undefined;

function getTlsAgent(): Agent {
  if (sharedAgent) return sharedAgent;

  const connectOpts: Record<string, unknown> = {};

  const extraCa = process.env.NODE_EXTRA_CA_CERTS;
  if (extraCa) {
    try {
      connectOpts.ca = fs.readFileSync(extraCa, 'utf-8');
    } catch { /* file not found */ }
  }

  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    connectOpts.rejectUnauthorized = false;
  }

  sharedAgent = new Agent({ connect: connectOpts });
  return sharedAgent;
}

type FetchFn = (url: any, init?: any) => Promise<any>;

const _realFetch: FetchFn = (url, init) => {
  return (undiciFetch as any).fetch(url, { ...init, dispatcher: getTlsAgent() });
};

let _testFetch: FetchFn | null = null;

/** Replace the fetch implementation (for tests only). */
export function setTestFetch(fn: FetchFn | null): void {
  _testFetch = fn;
}

/** Fetch with proper TLS handling. Drop-in replacement for global fetch(). */
export function safeFetch(url: string | URL, init?: RequestInit): Promise<any> {
  if (_testFetch) return _testFetch(url, init);
  return _realFetch(url, init);
}
