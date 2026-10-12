/**
 * Network validation utilities
 * Provides secure validation for URLs, hostnames, IPs, and ports
 * Includes SSRF protection and command injection prevention
 */

import { isIP } from 'node:net';

import { SECURITY } from '../constants';
import { isPrivateHost } from '../utils/url-validator';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Returns true for a private, loopback, link-local,
 * reserved, or cloud-metadata destination.
 *
 * Uses the shared outbound-policy classifier (`isPrivateHost`) so URL, ping,
 * and port checks share the webhook address classification, including IPv6
 * (`::1`, `::ffff:10.0.0.1`, `fc00::/7`, `fe80::/10`) and bracketed literals.
 * This synchronous check does not resolve DNS.
 */
function isBlockedInternalTarget(hostnameOrAddress: string): boolean {
  const normalized = hostnameOrAddress.toLowerCase().replace(/^\[|\]$/g, '');
  return isPrivateHost(normalized);
}

/**
 * Validates a target URL with SSRF protection
 * Checks protocol, hostname, and prevents access to internal resources
 */
export function validateTargetUrl(
  target: string,
  options?: { allowInternalTargets?: boolean },
): ValidationResult {
  try {
    const url = new URL(target);

    // Check protocol
    if (
      !SECURITY.ALLOWED_PROTOCOLS.includes(url.protocol as 'http:' | 'https:')
    ) {
      return {
        valid: false,
        error: 'Only HTTP and HTTPS protocols are allowed',
      };
    }

    // Check for localhost/internal IPs (SSRF protection)
    if (isBlockedInternalTarget(url.hostname)) {
      // Allow if explicitly configured
      if (
        !options?.allowInternalTargets &&
        !process.env.ALLOW_INTERNAL_TARGETS
      ) {
        return {
          valid: false,
          error:
            'Internal/localhost targets are not allowed for security reasons',
        };
      }
    }

    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

/**
 * Validates a ping target to prevent command injection
 * Supports IPv4, IPv6, and hostname formats
 */
export function validatePingTarget(target: string): ValidationResult {
  // Basic validation
  if (!target || typeof target !== 'string') {
    return { valid: false, error: 'Target must be a non-empty string' };
  }

  // Remove leading/trailing whitespace
  target = target.trim();

  // Check length
  if (
    target.length < SECURITY.MIN_HOSTNAME_LENGTH ||
    target.length > SECURITY.MAX_HOSTNAME_LENGTH
  ) {
    return {
      valid: false,
      error: `Target must be between ${SECURITY.MIN_HOSTNAME_LENGTH} and ${SECURITY.MAX_HOSTNAME_LENGTH} characters`,
    };
  }

  // Check for command injection attempts
  const dangerousChars = /[;&|`$(){}[\]<>'"\\]/;
  if (dangerousChars.test(target)) {
    return { valid: false, error: 'Target contains invalid characters' };
  }

  // Check for IPv4 address format
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Regex.test(target)) {
    // Validate IPv4 octets
    const octets = target.split('.');
    for (const octet of octets) {
      const num = parseInt(octet, 10);
      if (num < 0 || num > 255) {
        return { valid: false, error: 'Invalid IPv4 address' };
      }
    }

    // Check if it's internal
    if (
      isBlockedInternalTarget(target) &&
      !process.env.ALLOW_INTERNAL_TARGETS
    ) {
      return {
        valid: false,
        error:
          'Internal/localhost targets are not allowed for security reasons',
      };
    }

    return { valid: true };
  }

  // Check for IPv6 address format (covers compressed forms like 2606::1)
  if (isIP(target) === 6) {
    // IPv6 literals are subject to the same SSRF policy as IPv4/hostnames:
    // loopback (::1), unspecified (::), IPv4-mapped (::ffff:10.0.0.1),
    // link-local (fe80::/10) and ULA (fc00::/7) addresses are internal.
    if (
      isBlockedInternalTarget(target) &&
      !process.env.ALLOW_INTERNAL_TARGETS
    ) {
      return {
        valid: false,
        error:
          'Internal/localhost targets are not allowed for security reasons',
      };
    }

    return { valid: true };
  }

  // Check for hostname format
  const hostnameRegex =
    /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  if (!hostnameRegex.test(target)) {
    return { valid: false, error: 'Invalid hostname format' };
  }

  // Additional security check for localhost/internal IPs
  if (isBlockedInternalTarget(target) && !process.env.ALLOW_INTERNAL_TARGETS) {
    return {
      valid: false,
      error: 'Internal/localhost targets are not allowed for security reasons',
    };
  }

  return { valid: true };
}

/**
 * Validates port number
 * Ensures port is within valid range (1-65535)
 */
export function validatePort(port: number): ValidationResult {
  if (
    !Number.isInteger(port) ||
    port < SECURITY.MIN_PORT ||
    port > SECURITY.MAX_PORT
  ) {
    return {
      valid: false,
      error: `Port must be an integer between ${SECURITY.MIN_PORT} and ${SECURITY.MAX_PORT}`,
    };
  }

  return { valid: true };
}

/**
 * Validates protocol for port checks
 * Supports TCP and UDP
 */
export function validateProtocol(protocol: string): ValidationResult {
  if (!['tcp', 'udp'].includes(protocol.toLowerCase())) {
    return { valid: false, error: 'Protocol must be either "tcp" or "udp"' };
  }

  return { valid: true };
}

/**
 * Validates port check target (combination of host, port, and protocol)
 * Performs all necessary validations for secure port checking
 */
export function validatePortCheckTarget(
  target: string,
  port: number,
  protocol: string,
): ValidationResult {
  // Validate target (hostname or IP)
  const targetValidation = validatePingTarget(target);
  if (!targetValidation.valid) {
    return targetValidation;
  }

  // Validate port range
  const portValidation = validatePort(port);
  if (!portValidation.valid) {
    return portValidation;
  }

  // Validate protocol
  const protocolValidation = validateProtocol(protocol);
  if (!protocolValidation.valid) {
    return protocolValidation;
  }

  return { valid: true };
}

/**
 * Check if a port is in the reserved ports list
 * Returns true if the port is commonly reserved (informational only)
 */
export function isReservedPort(port: number): boolean {
  return (SECURITY.RESERVED_PORTS as readonly number[]).includes(port);
}
