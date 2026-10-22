import { Resolver } from 'node:dns/promises';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import { isPrivateOrReservedAddress } from '../utils/url-validator';

export function normalizeTargetHostname(value: string): string {
  const hasControlOrSpace = Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x20 || code === 0x7f;
  });
  if (hasControlOrSpace || /[/:?#@*\\]/u.test(value))
    throw new Error('An exact public DNS hostname is required');
  const hostname = domainToASCII(value.toLowerCase().replace(/\.$/, ''));
  if (
    !hostname ||
    hostname.length > 253 ||
    isIP(hostname) ||
    !hostname.includes('.') ||
    !hostname
      .split('.')
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    /\.(?:localhost|local|internal|lan|home)$/.test(hostname) ||
    /\.(?:\d+|0x[0-9a-f]*)$/.test(hostname)
  ) {
    throw new Error('An exact public DNS hostname is required');
  }
  return hostname;
}

type TargetResolver = Pick<Resolver, 'resolveTxt' | 'resolve4' | 'resolve6'>;

export async function verifyTargetDns(
  value: string,
  token: string,
  resolver: TargetResolver = new Resolver({ timeout: 3000, tries: 1 }),
): Promise<string[]> {
  const hostname = normalizeTargetHostname(value);
  const proof = await resolver.resolveTxt(`_supercheck-load-test.${hostname}`);
  if (
    !proof.some((parts) => parts.join('') === `supercheck-load-test=${token}`)
  ) {
    throw new Error('DNS ownership proof does not match this organization');
  }
  const answers = await Promise.allSettled([
    resolver.resolve4(hostname),
    resolver.resolve6(hostname),
  ]);
  const addresses = [
    ...new Set(
      answers.flatMap((result) =>
        result.status === 'fulfilled' ? result.value : [],
      ),
    ),
  ];
  if (
    !addresses.length ||
    addresses.some(
      (address) => !isIP(address) || isPrivateOrReservedAddress(address),
    )
  ) {
    throw new Error('Execution targets must resolve only to public addresses');
  }
  return addresses;
}
