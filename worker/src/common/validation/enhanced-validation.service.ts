import { Injectable, Logger } from '@nestjs/common';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  sanitized?: string;
}

export interface SecurityConfig {
  allowInternalTargets?: boolean;
  maxStringLength?: number;
  allowedProtocols?: string[];
  requiredTlsVersion?: string;
}

@Injectable()
export class EnhancedValidationService {
  private readonly logger = new Logger(EnhancedValidationService.name);

  // 🔴 CRITICAL: Comprehensive input validation and sanitization

  /**
   * Validates and sanitizes URLs with comprehensive security checks
   */
  validateAndSanitizeUrl(
    url: string,
    config: SecurityConfig = {},
  ): ValidationResult {
    try {
      if (!url || typeof url !== 'string') {
        return { valid: false, error: 'URL must be a non-empty string' };
      }

      // Sanitize: Remove leading/trailing whitespace and normalize
      const sanitized = url.trim().toLowerCase();

      if (sanitized.length > (config.maxStringLength || 2048)) {
        return { valid: false, error: 'URL exceeds maximum allowed length' };
      }

      // Validate URL format
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(sanitized);
      } catch {
        return { valid: false, error: 'Invalid URL format' };
      }

      // Protocol validation
      const allowedProtocols = config.allowedProtocols || ['http:', 'https:'];
      if (!allowedProtocols.includes(parsedUrl.protocol)) {
        return {
          valid: false,
          error: `Only ${allowedProtocols.join(', ')} protocols are allowed`,
        };
      }

      // SSRF Protection: Check for internal/private addresses
      if (!config.allowInternalTargets) {
        const hostname = parsedUrl.hostname;

        // Check for localhost and internal network variations
        // SECURITY: Block all private IP ranges and cloud metadata endpoints
        const localhostPatterns = [
          'localhost',
          '127.0.0.1',
          '::1',
          '0.0.0.0',
          // Private networks (RFC 1918)
          '10.',
          '172.16.',
          '172.17.',
          '172.18.',
          '172.19.',
          '172.20.',
          '172.21.',
          '172.22.',
          '172.23.',
          '172.24.',
          '172.25.',
          '172.26.',
          '172.27.',
          '172.28.',
          '172.29.',
          '172.30.',
          '172.31.',
          '192.168.',
          // Link-local addresses (including AWS/GCP/Azure metadata service)
          '169.254.',
          // Carrier-grade NAT (RFC 6598) - can be used to access metadata
          '100.64.',
          '100.65.',
          '100.66.',
          '100.67.',
          '100.68.',
          '100.69.',
          '100.70.',
          '100.71.',
          '100.72.',
          '100.73.',
          '100.74.',
          '100.75.',
          '100.76.',
          '100.77.',
          '100.78.',
          '100.79.',
          '100.80.',
          '100.81.',
          '100.82.',
          '100.83.',
          '100.84.',
          '100.85.',
          '100.86.',
          '100.87.',
          '100.88.',
          '100.89.',
          '100.90.',
          '100.91.',
          '100.92.',
          '100.93.',
          '100.94.',
          '100.95.',
          '100.96.',
          '100.97.',
          '100.98.',
          '100.99.',
          '100.100.',
          '100.101.',
          '100.102.',
          '100.103.',
          '100.104.',
          '100.105.',
          '100.106.',
          '100.107.',
          '100.108.',
          '100.109.',
          '100.110.',
          '100.111.',
          '100.112.',
          '100.113.',
          '100.114.',
          '100.115.',
          '100.116.',
          '100.117.',
          '100.118.',
          '100.119.',
          '100.120.',
          '100.121.',
          '100.122.',
          '100.123.',
          '100.124.',
          '100.125.',
          '100.126.',
          '100.127.',
        ];

        if (localhostPatterns.some((pattern) => hostname.startsWith(pattern))) {
          return {
            valid: false,
            error: 'Access to internal/private addresses is not allowed',
          };
        }

        // Check for IP address ranges (more comprehensive)
        if (this.isPrivateIP(hostname)) {
          return {
            valid: false,
            error: 'Access to private IP ranges is not allowed',
          };
        }
      }

      // Additional security checks for suspicious patterns
      const suspiciousPatterns = [
        /javascript:/i,
        /data:/i,
        /file:/i,
        /ftp:/i,
        /gopher:/i,
        /@.*@/, // Multiple @ symbols
        /\.\./, // Path traversal attempts
      ];

      if (suspiciousPatterns.some((pattern) => pattern.test(sanitized))) {
        return {
          valid: false,
          error: 'URL contains potentially dangerous patterns',
        };
      }

      return { valid: true, sanitized };
    } catch (error) {
      this.logger.error('URL validation error:', error);
      return { valid: false, error: 'URL validation failed' };
    }
  }

  /**
   * Validates and sanitizes hostnames/IPs with enhanced security
   */
  validateAndSanitizeHostname(
    hostname: string,
    config: SecurityConfig = {},
  ): ValidationResult {
    try {
      if (!hostname || typeof hostname !== 'string') {
        return { valid: false, error: 'Hostname must be a non-empty string' };
      }

      // Sanitize: Remove leading/trailing whitespace
      const sanitized = hostname.trim();

      if (sanitized.length === 0 || sanitized.length > 253) {
        return {
          valid: false,
          error: 'Hostname must be between 1 and 253 characters',
        };
      }

      // Enhanced command injection prevention
      const dangerousPatterns = [
        /[;&|`$(){}[\]<>'"\\]/, // Command injection characters
        /\s/, // No whitespace allowed
        // eslint-disable-next-line no-control-regex
        /[\u0000-\u001f]/, // Control characters
        /[\u007f-\u009f]/, // Extended control characters
        /^-/, // Leading dash (can be dangerous in commands)
        /\.\./, // Path traversal
        /[%#]/, // URL encoding attempts
      ];

      if (dangerousPatterns.some((pattern) => pattern.test(sanitized))) {
        return {
          valid: false,
          error: 'Hostname contains invalid or dangerous characters',
        };
      }

      // Validate IPv4
      const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
      if (ipv4Regex.test(sanitized)) {
        const result = this.validateIPv4(sanitized, config);
        if (!result.valid) return result;
      }
      // Validate IPv6
      else if (sanitized.includes(':')) {
        const result = this.validateIPv6(sanitized, config);
        if (!result.valid) return result;
      }
      // Validate hostname
      else {
        const hostnameRegex =
          /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
        if (!hostnameRegex.test(sanitized)) {
          return { valid: false, error: 'Invalid hostname format' };
        }

        // Check for suspicious TLDs or patterns
        const suspiciousTlds = ['.local', '.localhost', '.test', '.invalid'];
        if (suspiciousTlds.some((tld) => sanitized.endsWith(tld))) {
          if (!config.allowInternalTargets) {
            return {
              valid: false,
              error: 'Access to local/test domains is not allowed',
            };
          }
        }
      }

      return { valid: true, sanitized };
    } catch (error) {
      this.logger.error('Hostname validation error:', error);
      return { valid: false, error: 'Hostname validation failed' };
    }
  }

  /**
   * Validates IPv4 addresses with private range checks
   */
  private validateIPv4(ip: string, config: SecurityConfig): ValidationResult {
    const octets = ip.split('.');

    for (const octet of octets) {
      const num = parseInt(octet, 10);
      if (num < 0 || num > 255 || octet !== num.toString()) {
        return { valid: false, error: 'Invalid IPv4 address format' };
      }
    }

    // Check for private/internal ranges
    if (!config.allowInternalTargets && this.isPrivateIP(ip)) {
      return {
        valid: false,
        error: 'Access to private IP ranges is not allowed',
      };
    }

    return { valid: true, sanitized: ip };
  }

  /**
   * Validates IPv6 addresses
   */
  private validateIPv6(ip: string, config: SecurityConfig): ValidationResult {
    // Basic IPv6 validation
    const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$|^::$/;
    const ipv6CompressedRegex =
      /^([0-9a-fA-F]{1,4}:)*::([0-9a-fA-F]{1,4}:)*[0-9a-fA-F]{1,4}$/;

    if (!ipv6Regex.test(ip) && !ipv6CompressedRegex.test(ip)) {
      return { valid: false, error: 'Invalid IPv6 address format' };
    }

    // Check for localhost and private ranges
    if (!config.allowInternalTargets) {
      if (
        ip === '::1' ||
        ip.startsWith('fe80:') ||
        ip.startsWith('fc00:') ||
        ip.startsWith('fd00:')
      ) {
        return {
          valid: false,
          error: 'Access to private IPv6 ranges is not allowed',
        };
      }
    }

    return { valid: true, sanitized: ip };
  }

  /**
   * Check if IP address is in private/internal ranges
   * SECURITY: Includes all ranges that could be used for SSRF attacks
   */
  private isPrivateIP(ip: string): boolean {
    // First, validate that the input is actually a valid IPv4 address
    // This prevents hostnames like 'docs.bullmq.io' from being incorrectly matched
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = ip.match(ipv4Regex);
    if (!match) {
      return false; // Not an IPv4 address, skip range check
    }

    // Validate each octet is in valid range (0-255)
    const octets = [
      parseInt(match[1], 10),
      parseInt(match[2], 10),
      parseInt(match[3], 10),
      parseInt(match[4], 10),
    ];
    if (octets.some((o) => o < 0 || o > 255)) {
      return false; // Invalid IP address
    }

    // IPv4 private and special-use ranges that should be blocked for SSRF
    const privateRanges = [
      // RFC 1918 - Private networks
      { start: '10.0.0.0', end: '10.255.255.255' },
      { start: '172.16.0.0', end: '172.31.255.255' },
      { start: '192.168.0.0', end: '192.168.255.255' },
      // Loopback (RFC 1122)
      { start: '127.0.0.0', end: '127.255.255.255' },
      // Link-local / APIPA (RFC 3927) - includes cloud metadata (169.254.169.254)
      { start: '169.254.0.0', end: '169.254.255.255' },
      // Carrier-grade NAT (RFC 6598) - can sometimes access cloud metadata
      { start: '100.64.0.0', end: '100.127.255.255' },
      // Documentation ranges (RFC 5737) - should not be routable
      { start: '192.0.2.0', end: '192.0.2.255' },
      { start: '198.51.100.0', end: '198.51.100.255' },
      { start: '203.0.113.0', end: '203.0.113.255' },
      // Current network (RFC 1122) - can be used for SSRF
      { start: '0.0.0.0', end: '0.255.255.255' },
    ];

    for (const range of privateRanges) {
      if (this.isIPInRange(ip, range.start, range.end)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if IP is in a specific range
   */
  private isIPInRange(ip: string, startIP: string, endIP: string): boolean {
    const ipNum = this.ipToNumber(ip);
    const startNum = this.ipToNumber(startIP);
    const endNum = this.ipToNumber(endIP);

    return ipNum >= startNum && ipNum <= endNum;
  }

  /**
   * Convert IP to number for range comparison
   */
  private ipToNumber(ip: string): number {
    const parts = ip.split('.');
    return (
      ((parseInt(parts[0]) << 24) +
        (parseInt(parts[1]) << 16) +
        (parseInt(parts[2]) << 8) +
        parseInt(parts[3])) >>>
      0
    ); // Unsigned right shift to handle large numbers
  }

  /**
   * Validates port numbers with comprehensive checks
   */
  validatePort(port: number | string): ValidationResult {
    try {
      const portNum = typeof port === 'string' ? parseInt(port, 10) : port;

      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        return {
          valid: false,
          error: 'Port must be a number between 1 and 65535',
        };
      }

      // Check for well-known dangerous ports
      const restrictedPorts = [
        22, // SSH
        23, // Telnet
        135, // RPC
        139, // NetBIOS
        445, // SMB
        1433, // SQL Server
        3306, // MySQL
        3389, // RDP
        5432, // PostgreSQL
        5984, // CouchDB
        6379, // Redis
        11211, // Memcached
        27017, // MongoDB
      ];

      // Warn about potentially dangerous ports (but don't block)
      if (restrictedPorts.includes(portNum)) {
        this.logger.warn(`Monitoring potentially sensitive port: ${portNum}`);
      }

      return { valid: true, sanitized: portNum.toString() };
    } catch {
      return { valid: false, error: 'Invalid port format' };
    }
  }

  /**
   * Validates and sanitizes configuration values
   */
  validateConfiguration(config: Record<string, unknown>): ValidationResult {
    try {
      if (!config || typeof config !== 'object') {
        return { valid: false, error: 'Configuration must be an object' };
      }

      // Validate timeout values
      if (config.timeoutSeconds !== undefined) {
        const rawTimeout = config.timeoutSeconds;
        const timeout = parseInt(
          typeof rawTimeout === 'number'
            ? rawTimeout.toString()
            : typeof rawTimeout === 'string'
              ? rawTimeout
              : '',
          10,
        );
        if (isNaN(timeout) || timeout < 1 || timeout > 300) {
          return {
            valid: false,
            error: 'Timeout must be between 1 and 300 seconds',
          };
        }
      }

      // Validate status codes
      if (config.expectedStatusCodes !== undefined) {
        const rawCodes = config.expectedStatusCodes;
        const result = this.validateStatusCodes(
          typeof rawCodes === 'string' ? rawCodes : '',
        );
        if (!result.valid) return result;
      }

      // Validate headers (if present)
      if (config.headers !== undefined) {
        const result = this.validateHeaders(
          config.headers as Record<string, unknown>,
        );
        if (!result.valid) return result;
      }

      // Validate method
      if (config.method !== undefined) {
        const allowedMethods = [
          'GET',
          'POST',
          'PUT',
          'DELETE',
          'PATCH',
          'HEAD',
          'OPTIONS',
        ];
        const method = typeof config.method === 'string' ? config.method : '';
        if (!allowedMethods.includes(method)) {
          return {
            valid: false,
            error: `HTTP method must be one of: ${allowedMethods.join(', ')}`,
          };
        }
      }

      return { valid: true };
    } catch (error) {
      this.logger.error('Configuration validation error:', error);
      return { valid: false, error: 'Configuration validation failed' };
    }
  }

  /**
   * Validates status codes format
   */
  private validateStatusCodes(codes: string): ValidationResult {
    try {
      if (typeof codes !== 'string' || codes.trim().length === 0) {
        return {
          valid: false,
          error: 'Status codes must be a non-empty string',
        };
      }

      const parts = codes.split(',').map((part) => part.trim());

      for (const part of parts) {
        // Range format (e.g., "200-299")
        if (part.includes('-')) {
          const [min, max] = part.split('-').map(Number);
          if (isNaN(min) || isNaN(max) || min < 100 || max > 599 || min > max) {
            return {
              valid: false,
              error: `Invalid status code range: ${part}`,
            };
          }
        }
        // Wildcard format (e.g., "2xx")
        else if (part.endsWith('xx')) {
          const prefix = parseInt(part.charAt(0));
          if (isNaN(prefix) || prefix < 1 || prefix > 5) {
            return {
              valid: false,
              error: `Invalid status code wildcard: ${part}`,
            };
          }
        }
        // Specific code (e.g., "200")
        else {
          const code = parseInt(part);
          if (isNaN(code) || code < 100 || code > 599) {
            return {
              valid: false,
              error: `Invalid status code: ${part}`,
            };
          }
        }
      }

      return { valid: true };
    } catch {
      return { valid: false, error: 'Status code validation failed' };
    }
  }

  /**
   * Validates HTTP headers
   */
  private validateHeaders(headers: Record<string, unknown>): ValidationResult {
    try {
      if (typeof headers !== 'object' || headers === null) {
        return { valid: false, error: 'Headers must be an object' };
      }

      // Check for dangerous headers
      const dangerousHeaders = [
        'host',
        'authorization',
        'cookie',
        'set-cookie',
        'x-forwarded-for',
        'x-real-ip',
        'x-forwarded-host',
      ];

      for (const [key, value] of Object.entries(headers)) {
        if (typeof key !== 'string' || typeof value !== 'string') {
          return {
            valid: false,
            error: 'Header keys and values must be strings',
          };
        }

        // Check for suspicious header names
        if (dangerousHeaders.includes(key.toLowerCase())) {
          this.logger.warn(`Potentially dangerous header detected: ${key}`);
        }

        // Validate header value length
        if (value.length > 8192) {
          return {
            valid: false,
            error: `Header value too long: ${key}`,
          };
        }

        // Check for control characters
        // eslint-disable-next-line no-control-regex
        if (/[\u0000-\u001f\u007f]/.test(value)) {
          return {
            valid: false,
            error: `Header contains control characters: ${key}`,
          };
        }
      }

      return { valid: true };
    } catch {
      return { valid: false, error: 'Header validation failed' };
    }
  }
}
