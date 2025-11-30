import {
  sanitizeString,
  sanitizeUrl,
  sanitizeHostname,
  sanitizeJson,
  sanitizeCredential,
  sanitizeMonitorName,
  sanitizeInteger,
  sanitizeStatusCodes,
  sanitizeHttpMethod,
  sanitizeMonitorFormData,
} from './input-sanitizer';

describe('InputSanitizer', () => {
  describe('sanitizeString', () => {
    // Core string sanitization - critical for XSS prevention

    describe('basic sanitization', () => {
      it('should return empty string for null input', () => {
        expect(sanitizeString(null)).toBe('');
      });

      it('should return empty string for undefined input', () => {
        expect(sanitizeString(undefined)).toBe('');
      });

      it('should return empty string for empty string', () => {
        expect(sanitizeString('')).toBe('');
      });

      it('should preserve normal text', () => {
        expect(sanitizeString('Hello World')).toBe('Hello World');
      });

      it('should trim whitespace', () => {
        expect(sanitizeString('  hello  ')).toBe('hello');
      });
    });

    describe('XSS prevention - script tags', () => {
      it('should remove script tags with content', () => {
        // Script tags are the most common XSS vector
        const input = '<script>alert("xss")</script>';
        expect(sanitizeString(input)).not.toContain('<script');
        expect(sanitizeString(input)).not.toContain('alert');
      });

      it('should remove script tags with attributes', () => {
        const input = '<script type="text/javascript">malicious()</script>';
        expect(sanitizeString(input)).not.toContain('<script');
      });

      it('should remove self-closing script tags', () => {
        const input = '<script src="evil.js"/>';
        expect(sanitizeString(input)).not.toContain('<script');
      });

      it('should remove inline scripts between text', () => {
        const input = 'Hello <script>evil()</script> World';
        expect(sanitizeString(input)).toBe('Hello  World');
      });
    });

    describe('XSS prevention - iframe tags', () => {
      it('should remove iframe tags', () => {
        const input = '<iframe src="evil.com"></iframe>';
        expect(sanitizeString(input)).not.toContain('<iframe');
      });

      it('should remove nested iframe content', () => {
        const input = '<iframe><script>evil()</script></iframe>';
        expect(sanitizeString(input)).not.toContain('<iframe');
        expect(sanitizeString(input)).not.toContain('<script');
      });
    });

    describe('XSS prevention - object/embed tags', () => {
      it('should remove object tags', () => {
        const input = '<object data="malware.swf"></object>';
        expect(sanitizeString(input)).not.toContain('<object');
      });

      it('should remove embed tags', () => {
        const input = '<embed src="malware.swf">';
        expect(sanitizeString(input)).not.toContain('<embed');
      });
    });

    describe('XSS prevention - SVG tags', () => {
      it('should remove svg tags', () => {
        // SVG can contain scripts
        const input = '<svg onload="evil()"><circle /></svg>';
        expect(sanitizeString(input)).not.toContain('<svg');
      });

      it('should remove svg with embedded script', () => {
        const input = '<svg><script>alert(1)</script></svg>';
        expect(sanitizeString(input)).not.toContain('<svg');
      });
    });

    describe('XSS prevention - form/input tags', () => {
      it('should remove form tags', () => {
        const input = '<form action="evil.com"><input type="text"></form>';
        expect(sanitizeString(input)).not.toContain('<form');
      });

      it('should remove input tags', () => {
        const input = '<input onfocus="evil()" autofocus>';
        expect(sanitizeString(input)).not.toContain('<input');
      });
    });

    describe('XSS prevention - event handlers', () => {
      it('should remove onclick handler', () => {
        const input = '<div onclick="evil()">Click me</div>';
        expect(sanitizeString(input)).not.toContain('onclick');
      });

      it('should remove onerror handler', () => {
        const input = '<img onerror="evil()" src="x">';
        expect(sanitizeString(input)).not.toContain('onerror');
      });

      it('should remove onload handler', () => {
        const input = '<body onload="evil()">Content</body>';
        expect(sanitizeString(input)).not.toContain('onload');
      });

      it('should remove onmouseover handler', () => {
        const input = '<div onmouseover="evil()">Hover</div>';
        expect(sanitizeString(input)).not.toContain('onmouseover');
      });

      it('should remove onfocus handler', () => {
        const input = '<input onfocus="evil()">';
        expect(sanitizeString(input)).not.toContain('onfocus');
      });
    });

    describe('XSS prevention - dangerous protocols', () => {
      it('should remove javascript: protocol', () => {
        const input = '<a href="javascript:evil()">Click</a>';
        expect(sanitizeString(input)).not.toContain('javascript:');
      });

      it('should remove vbscript: protocol', () => {
        const input = '<a href="vbscript:evil()">Click</a>';
        expect(sanitizeString(input)).not.toContain('vbscript:');
      });

      it('should remove data:text/html protocol', () => {
        const input = '<a href="data:text/html,<script>evil()</script>">Click</a>';
        expect(sanitizeString(input)).not.toContain('data:text/html');
      });

      it('should remove data:application/javascript protocol', () => {
        const input = '<a href="data:application/javascript,evil()">Click</a>';
        expect(sanitizeString(input)).not.toContain('data:application/javascript');
      });
    });

    describe('XSS prevention - template literals', () => {
      it('should remove template literal expressions', () => {
        const input = 'Hello ${alert(1)}';
        expect(sanitizeString(input)).not.toContain('${');
      });

      it('should remove nested template literals', () => {
        const input = '${${evil()}}';
        expect(sanitizeString(input)).not.toContain('${');
      });
    });

    describe('XSS prevention - expression attributes', () => {
      it('should remove expression() CSS', () => {
        const input = '<div style="width: expression(evil())">Content</div>';
        expect(sanitizeString(input)).not.toContain('expression(');
      });

      it('should remove url() with javascript', () => {
        const input = '<div style="background: url(javascript:evil())">Content</div>';
        expect(sanitizeString(input)).not.toContain('javascript:');
      });
    });

    describe('control character removal', () => {
      it('should remove null bytes', () => {
        const input = 'hello\0world';
        expect(sanitizeString(input)).toBe('helloworld');
      });

      it('should remove control characters', () => {
        const input = 'hello\x01\x02\x03world';
        expect(sanitizeString(input)).toBe('helloworld');
      });

      it('should preserve newlines and tabs', () => {
        // Common whitespace should be preserved
        const input = 'hello\nworld';
        expect(sanitizeString(input)).toContain('hello');
        expect(sanitizeString(input)).toContain('world');
      });
    });

    describe('length limiting', () => {
      it('should truncate very long strings', () => {
        // Prevents ReDoS and memory issues
        const input = 'a'.repeat(200000);
        const result = sanitizeString(input);
        expect(result.length).toBeLessThanOrEqual(100000);
      });
    });
  });

  describe('sanitizeUrl', () => {
    // URL sanitization for external links and API targets

    it('should return empty string for null input', () => {
      expect(sanitizeUrl(null)).toBe('');
    });

    it('should return empty string for undefined input', () => {
      expect(sanitizeUrl(undefined)).toBe('');
    });

    it('should accept valid https URLs', () => {
      const url = 'https://example.com/path?query=value';
      expect(sanitizeUrl(url)).toBe(url);
    });

    it('should accept valid http URLs', () => {
      const url = 'http://example.com/path';
      expect(sanitizeUrl(url)).toBe(url);
    });

    it('should reject javascript: URLs', () => {
      expect(sanitizeUrl('javascript:alert(1)')).toBe('');
    });

    it('should reject data: URLs', () => {
      expect(sanitizeUrl('data:text/html,<script>evil()</script>')).toBe('');
    });

    it('should reject file: URLs', () => {
      expect(sanitizeUrl('file:///etc/passwd')).toBe('');
    });

    it('should reject ftp: URLs', () => {
      expect(sanitizeUrl('ftp://files.example.com')).toBe('');
    });

    it('should reject invalid URLs', () => {
      expect(sanitizeUrl('not a url')).toBe('');
    });

    it('should normalize valid URLs', () => {
      const result = sanitizeUrl('https://example.com');
      expect(result).toMatch(/^https:\/\/example\.com\/?$/);
    });
  });

  describe('sanitizeHostname', () => {
    // Hostname sanitization for ping and port monitors

    it('should return empty string for null input', () => {
      expect(sanitizeHostname(null)).toBe('');
    });

    it('should accept valid hostnames', () => {
      expect(sanitizeHostname('example.com')).toBe('example.com');
    });

    it('should accept hostnames with subdomains', () => {
      expect(sanitizeHostname('www.example.com')).toBe('www.example.com');
    });

    it('should accept IPv4 addresses', () => {
      expect(sanitizeHostname('192.168.1.1')).toBe('192.168.1.1');
    });

    it('should remove invalid characters', () => {
      // sanitizeString is called first which removes <script> tags completely
      // Then invalid chars are removed leaving just 'example.com'
      expect(sanitizeHostname('example<script>.com')).toBe('example.com');
    });

    it('should remove spaces', () => {
      expect(sanitizeHostname('example .com')).toBe('example.com');
    });

    it('should allow hyphens', () => {
      expect(sanitizeHostname('my-server.example.com')).toBe('my-server.example.com');
    });
  });

  describe('sanitizeJson', () => {
    // JSON sanitization for headers and body payloads

    it('should return empty string for null input', () => {
      expect(sanitizeJson(null)).toBe('');
    });

    it('should return empty string for invalid JSON', () => {
      expect(sanitizeJson('not json')).toBe('');
      expect(sanitizeJson('{invalid')).toBe('');
    });

    it('should accept valid JSON objects', () => {
      const json = '{"key": "value"}';
      expect(JSON.parse(sanitizeJson(json))).toEqual({ key: 'value' });
    });

    it('should accept valid JSON arrays', () => {
      const json = '[1, 2, 3]';
      expect(JSON.parse(sanitizeJson(json))).toEqual([1, 2, 3]);
    });

    it('should normalize JSON formatting', () => {
      const json = '{"key":"value"}';
      const result = sanitizeJson(json);
      expect(result).toBe('{"key":"value"}');
    });

    it('should preserve complex JSON structures', () => {
      const json = '{"nested": {"deep": {"value": 123}}, "array": [1, 2, 3]}';
      expect(sanitizeJson(json)).toBeTruthy();
      expect(JSON.parse(sanitizeJson(json))).toEqual({
        nested: { deep: { value: 123 } },
        array: [1, 2, 3],
      });
    });
  });

  describe('sanitizeCredential', () => {
    // Credential sanitization - more permissive for auth data

    it('should return empty string for null input', () => {
      expect(sanitizeCredential(null)).toBe('');
    });

    it('should preserve normal credentials', () => {
      expect(sanitizeCredential('myP@ssw0rd!')).toBe('myP@ssw0rd!');
    });

    it('should preserve special characters common in passwords', () => {
      expect(sanitizeCredential('P@$$w0rd!#$%')).toBe('P@$$w0rd!#$%');
    });

    it('should remove HTML tags', () => {
      // The credential sanitizer uses a simpler regex that removes tags but may leave content
      const result = sanitizeCredential('<script>evil()</script>secret');
      expect(result).not.toContain('<script>');
      expect(result).toContain('secret');
    });

    it('should remove javascript: protocol', () => {
      expect(sanitizeCredential('javascript:alert(1)')).not.toContain('javascript:');
    });

    it('should remove null bytes', () => {
      expect(sanitizeCredential('pass\0word')).toBe('password');
    });
  });

  describe('sanitizeMonitorName', () => {
    // Monitor name sanitization for display

    it('should return empty string for null input', () => {
      expect(sanitizeMonitorName(null)).toBe('');
    });

    it('should accept alphanumeric names', () => {
      expect(sanitizeMonitorName('Monitor1')).toBe('Monitor1');
    });

    it('should allow spaces', () => {
      expect(sanitizeMonitorName('My Monitor')).toBe('My Monitor');
    });

    it('should allow hyphens and underscores', () => {
      expect(sanitizeMonitorName('my-monitor_name')).toBe('my-monitor_name');
    });

    it('should allow parentheses', () => {
      expect(sanitizeMonitorName('Monitor (Production)')).toBe('Monitor (Production)');
    });

    it('should remove special characters', () => {
      expect(sanitizeMonitorName('Monitor<script>')).toBe('Monitor');
    });

    it('should collapse multiple spaces', () => {
      expect(sanitizeMonitorName('My    Monitor')).toBe('My Monitor');
    });
  });

  describe('sanitizeInteger', () => {
    // Integer sanitization for ports, intervals, etc.

    it('should return undefined for null input', () => {
      expect(sanitizeInteger(null)).toBeUndefined();
    });

    it('should return undefined for undefined input', () => {
      expect(sanitizeInteger(undefined)).toBeUndefined();
    });

    it('should return undefined for empty string', () => {
      expect(sanitizeInteger('')).toBeUndefined();
    });

    it('should parse valid integer strings', () => {
      expect(sanitizeInteger('123')).toBe(123);
    });

    it('should accept number inputs', () => {
      expect(sanitizeInteger(456)).toBe(456);
    });

    it('should return undefined for non-numeric strings', () => {
      expect(sanitizeInteger('abc')).toBeUndefined();
    });

    it('should enforce minimum value', () => {
      expect(sanitizeInteger(5, 10)).toBe(10);
    });

    it('should enforce maximum value', () => {
      expect(sanitizeInteger(100, undefined, 50)).toBe(50);
    });

    it('should allow values within range', () => {
      expect(sanitizeInteger(25, 10, 50)).toBe(25);
    });
  });

  describe('sanitizeStatusCodes', () => {
    // Status code sanitization for HTTP monitors

    it('should return empty string for null input', () => {
      expect(sanitizeStatusCodes(null)).toBe('');
    });

    it('should accept single status code', () => {
      expect(sanitizeStatusCodes('200')).toBe('200');
    });

    it('should accept comma-separated codes', () => {
      expect(sanitizeStatusCodes('200, 201, 204')).toBe('200, 201, 204');
    });

    it('should accept status code ranges', () => {
      expect(sanitizeStatusCodes('200-299')).toBe('200-299');
    });

    it('should remove invalid characters', () => {
      expect(sanitizeStatusCodes('200<script>')).toBe('200');
    });

    it('should collapse multiple spaces', () => {
      expect(sanitizeStatusCodes('200,   201')).toBe('200, 201');
    });
  });

  describe('sanitizeHttpMethod', () => {
    // HTTP method sanitization

    it('should return GET for null input', () => {
      expect(sanitizeHttpMethod(null)).toBe('GET');
    });

    it('should return GET for undefined input', () => {
      expect(sanitizeHttpMethod(undefined)).toBe('GET');
    });

    it('should accept valid methods', () => {
      expect(sanitizeHttpMethod('GET')).toBe('GET');
      expect(sanitizeHttpMethod('POST')).toBe('POST');
      expect(sanitizeHttpMethod('PUT')).toBe('PUT');
      expect(sanitizeHttpMethod('DELETE')).toBe('DELETE');
      expect(sanitizeHttpMethod('PATCH')).toBe('PATCH');
      expect(sanitizeHttpMethod('HEAD')).toBe('HEAD');
      expect(sanitizeHttpMethod('OPTIONS')).toBe('OPTIONS');
    });

    it('should uppercase lowercase methods', () => {
      expect(sanitizeHttpMethod('get')).toBe('GET');
      expect(sanitizeHttpMethod('post')).toBe('POST');
    });

    it('should return GET for invalid methods', () => {
      expect(sanitizeHttpMethod('INVALID')).toBe('GET');
      expect(sanitizeHttpMethod('TRACE')).toBe('GET');
    });
  });

  describe('sanitizeMonitorFormData', () => {
    // Comprehensive form data sanitization

    it('should sanitize monitor name', () => {
      const data = { name: 'My <script>Monitor' };
      const result = sanitizeMonitorFormData(data);
      expect(result.name).toBe('My Monitor');
    });

    it('should sanitize URL targets for http_request type', () => {
      const data = {
        name: 'Test',
        target: 'https://example.com',
        type: 'http_request',
      };
      const result = sanitizeMonitorFormData(data);
      expect(result.target).toContain('https://example.com');
    });

    it('should sanitize hostname targets for ping_host type', () => {
      const data = {
        name: 'Test',
        target: 'example<script>.com',
        type: 'ping_host',
      };
      const result = sanitizeMonitorFormData(data);
      // sanitizeString removes <script> tags first, then sanitizeHostname runs
      expect(result.target).toBe('example.com');
    });

    it('should sanitize HTTP method', () => {
      const data = { httpConfig_method: 'post' };
      const result = sanitizeMonitorFormData(data);
      expect(result.httpConfig_method).toBe('POST');
    });

    it('should sanitize JSON headers', () => {
      const data = { httpConfig_headers: '{"Content-Type": "application/json"}' };
      const result = sanitizeMonitorFormData(data);
      expect(result.httpConfig_headers).toBeTruthy();
    });

    it('should sanitize status codes', () => {
      const data = { httpConfig_expectedStatusCodes: '200, 201<script>' };
      const result = sanitizeMonitorFormData(data);
      expect(result.httpConfig_expectedStatusCodes).toBe('200, 201');
    });

    it('should sanitize credentials', () => {
      const data = {
        httpConfig_authUsername: 'user<script>',
        httpConfig_authPassword: 'pass<script>',
      };
      const result = sanitizeMonitorFormData(data);
      expect(result.httpConfig_authUsername).not.toContain('<script>');
      expect(result.httpConfig_authPassword).not.toContain('<script>');
    });

    it('should sanitize port number', () => {
      const data = { portConfig_port: '443' };
      const result = sanitizeMonitorFormData(data);
      expect(result.portConfig_port).toBe(443);
    });

    it('should enforce port range', () => {
      const data = { portConfig_port: 70000 };
      const result = sanitizeMonitorFormData(data);
      expect(result.portConfig_port).toBe(65535);
    });

    it('should sanitize SSL days warning', () => {
      const data = { websiteConfig_sslDaysUntilExpirationWarning: '30' };
      const result = sanitizeMonitorFormData(data);
      expect(result.websiteConfig_sslDaysUntilExpirationWarning).toBe(30);
    });

    it('should enforce SSL days range', () => {
      const data = { websiteConfig_sslDaysUntilExpirationWarning: 500 };
      const result = sanitizeMonitorFormData(data);
      expect(result.websiteConfig_sslDaysUntilExpirationWarning).toBe(365);
    });
  });
});
