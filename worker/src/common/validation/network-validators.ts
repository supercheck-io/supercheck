/**
 * Network validation utilities
 * Provides secure validation for URLs, hostnames, IPs, and ports
 * Includes SSRF protection and command injection prevention
 */

import { SECURITY, isInternalHost, INTERNAL_IP_PATTERNS } from '../constants';

export interface ValidationResult {
  valid: boolean;
  error?: string;
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
    if (!SECURITY.ALLOWED_PROTOCOLS.includes(url.protocol as any)) {
      return {
        valid: false,
        error: 'Only HTTP and HTTPS protocols are allowed',
      };
    }

    // Check for localhost/internal IPs (SSRF protection)
    const hostname = url.hostname.toLowerCase();
    if (isInternalHost(hostname)) {
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
  } catch (error) {
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
    if (isInternalHost(target) && !process.env.ALLOW_INTERNAL_TARGETS) {
      return {
        valid: false,
        error:
          'Internal/localhost targets are not allowed for security reasons',
      };
    }

    return { valid: true };
  }

  // Check for IPv6 address format (basic)
  const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$|^::/;
  if (ipv6Regex.test(target)) {
    return { valid: true };
  }

  // Check for hostname format
  const hostnameRegex =
    /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/;
  if (!hostnameRegex.test(target)) {
    return { valid: false, error: 'Invalid hostname format' };
  }

  // Additional security check for localhost/internal IPs
  const lowerTarget = target.toLowerCase();
  if (isInternalHost(lowerTarget) && !process.env.ALLOW_INTERNAL_TARGETS) {
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
