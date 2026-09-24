import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Outbound request policy for API datasources.
 *
 * A low-code platform lets tenants point an API datasource at any URL they type,
 * which by default includes the cloud metadata endpoint and everything else on the
 * private network the server sits in. Every outbound host is resolved and checked
 * against the denied ranges before a request is made.
 */

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

/** Always denied, regardless of tenant configuration. */
const HARD_BLOCKED_HOSTS = new Set([
  '169.254.169.254', // AWS / GCP / Azure instance metadata
  'metadata.google.internal',
  'metadata.goog',
]);

interface CidrRange {
  base: bigint;
  bits: number;
  version: 4 | 6;
}

const PRIVATE_RANGES: CidrRange[] = [
  cidr('0.0.0.0/8'),
  cidr('10.0.0.0/8'),
  cidr('100.64.0.0/10'), // carrier-grade NAT
  cidr('127.0.0.0/8'),
  cidr('169.254.0.0/16'), // link-local
  cidr('172.16.0.0/12'),
  cidr('192.0.0.0/24'),
  cidr('192.168.0.0/16'),
  cidr('198.18.0.0/15'),
  cidr('224.0.0.0/4'), // multicast
  cidr('240.0.0.0/4'),
  cidr('::1/128'),
  cidr('fc00::/7'), // unique local
  cidr('fe80::/10'), // link-local
];

export interface SsrfPolicy {
  /**
   * Hosts or CIDRs a tenant is explicitly permitted to reach despite being private.
   * Set by an administrator, for on-premise APIs that legitimately live inside the
   * network — never inferred from the URL itself.
   */
  allowedPrivateHosts?: string[];
  /** When set, only these hosts are reachable at all. */
  allowlistOnly?: string[];
}

export async function assertUrlAllowed(rawUrl: string, policy: SsrfPolicy = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(`Invalid URL: ${rawUrl}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfBlockedError(`Protocol ${url.protocol} is not allowed`);
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (HARD_BLOCKED_HOSTS.has(hostname)) {
    throw new SsrfBlockedError(`Host ${hostname} is blocked`);
  }

  if (policy.allowlistOnly && policy.allowlistOnly.length > 0) {
    if (!policy.allowlistOnly.some((allowed) => matchesHost(hostname, allowed))) {
      throw new SsrfBlockedError(
        `Host ${hostname} is not in this organization's API allowlist`,
      );
    }
    return url;
  }

  const explicitlyAllowed = (policy.allowedPrivateHosts ?? []).some((allowed) =>
    matchesHost(hostname, allowed),
  );
  if (explicitlyAllowed) return url;

  // Resolve every address the host maps to. Checking only the first would let a
  // multi-record DNS response smuggle a private address past the check.
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true }).catch(() => {
        throw new SsrfBlockedError(`Could not resolve host ${hostname}`);
      });

  for (const { address } of addresses) {
    if (HARD_BLOCKED_HOSTS.has(address)) {
      throw new SsrfBlockedError(`Host ${hostname} resolves to a blocked address`);
    }
    if (isPrivateAddress(address)) {
      throw new SsrfBlockedError(
        `Host ${hostname} resolves to the private address ${address}. ` +
          'An administrator must allowlist it explicitly to reach internal services.',
      );
    }
  }

  return url;
}

export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 0) return false;

  const value = toBigInt(address, version as 4 | 6);
  if (value === null) return false;

  return PRIVATE_RANGES.some((range) => {
    if (range.version !== version) return false;
    const width = range.version === 4 ? 32 : 128;
    const mask = range.bits === 0 ? 0n : (~0n << BigInt(width - range.bits)) & maxFor(width);
    return (value & mask) === (range.base & mask);
  });
}

function matchesHost(hostname: string, pattern: string): boolean {
  const normalised = pattern.toLowerCase().trim();
  if (normalised.startsWith('*.')) {
    return hostname === normalised.slice(2) || hostname.endsWith(normalised.slice(1));
  }
  return hostname === normalised;
}

function cidr(notation: string): CidrRange {
  const [address, bitsText] = notation.split('/');
  const version = (isIP(address!) === 6 ? 6 : 4) as 4 | 6;
  return {
    base: toBigInt(address!, version) ?? 0n,
    bits: Number(bitsText),
    version,
  };
}

function maxFor(width: number): bigint {
  return (1n << BigInt(width)) - 1n;
}

function toBigInt(address: string, version: 4 | 6): bigint | null {
  if (version === 4) {
    const parts = address.split('.');
    if (parts.length !== 4) return null;
    return parts.reduce((acc, part) => (acc << 8n) + BigInt(Number(part)), 0n);
  }

  // Expand :: then parse the eight groups.
  const [head, tail] = address.split('::');
  const headGroups = head ? head.split(':').filter(Boolean) : [];
  const tailGroups = tail ? tail.split(':').filter(Boolean) : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  if (missing < 0) return null;
  const groups = [
    ...headGroups,
    ...Array<string>(address.includes('::') ? missing : 0).fill('0'),
    ...tailGroups,
  ];
  if (groups.length !== 8) return null;
  return groups.reduce((acc, group) => (acc << 16n) + BigInt(parseInt(group, 16) || 0), 0n);
}
