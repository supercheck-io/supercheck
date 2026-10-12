import {
  getDefaultExpectedStatusCodes,
  getStatusCategory,
  isClientErrorStatus,
  isExpectedStatus,
  isRedirectStatus,
  isServerErrorStatus,
  isSuccessStatus,
  isValidHttpMethod,
  methodSupportsBody,
} from './http-validators';

describe('http-validators', () => {
  describe('isExpectedStatus', () => {
    it('defaults to 2xx when no pattern is provided', () => {
      expect(isExpectedStatus(200)).toBe(true);
      expect(isExpectedStatus(204)).toBe(true);
      expect(isExpectedStatus(299)).toBe(true);
      expect(isExpectedStatus(199)).toBe(false);
      expect(isExpectedStatus(300)).toBe(false);
      expect(isExpectedStatus(404)).toBe(false);
    });

    it('defaults to 2xx when the pattern is empty or whitespace', () => {
      expect(isExpectedStatus(201, '')).toBe(true);
      expect(isExpectedStatus(201, '   ')).toBe(true);
      expect(isExpectedStatus(500, '   ')).toBe(false);
    });

    it.each([
      [200, '2xx'],
      [299, '2xx'],
      [404, '4xx'],
      [500, '5xx'],
    ])('supports wildcard pattern %s with "%s"', (status, pattern) => {
      expect(isExpectedStatus(status, pattern)).toBe(true);
    });

    it('rejects a status outside the wildcard class', () => {
      expect(isExpectedStatus(404, '2xx')).toBe(false);
    });

    it.each([
      [200, '200-299'],
      [250, '200-299'],
      [299, '200-299'],
    ])('supports range pattern for %s', (status, pattern) => {
      expect(isExpectedStatus(status, pattern)).toBe(true);
    });

    it('rejects a status outside the range', () => {
      expect(isExpectedStatus(300, '200-299')).toBe(false);
      expect(isExpectedStatus(199, '200-299')).toBe(false);
    });

    it('supports comma-separated values', () => {
      expect(isExpectedStatus(200, '200,404,500')).toBe(true);
      expect(isExpectedStatus(404, '200,404,500')).toBe(true);
      expect(isExpectedStatus(500, '200,404,500')).toBe(true);
      expect(isExpectedStatus(201, '200,404,500')).toBe(false);
    });

    it('ignores whitespace around comma-separated values', () => {
      expect(isExpectedStatus(404, ' 200 , 404 , 500 ')).toBe(true);
    });

    it('supports a specific status code', () => {
      expect(isExpectedStatus(204, '204')).toBe(true);
      expect(isExpectedStatus(205, '204')).toBe(false);
    });

    it('supports mixed patterns', () => {
      expect(isExpectedStatus(301, '200-299,3xx')).toBe(true);
      expect(isExpectedStatus(404, '200-299,3xx,404')).toBe(true);
      expect(isExpectedStatus(500, '200-299,3xx')).toBe(false);
    });
  });

  describe('isValidHttpMethod', () => {
    it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])(
      'accepts %s',
      (method) => {
        expect(isValidHttpMethod(method)).toBe(true);
      },
    );

    it('is case-insensitive', () => {
      expect(isValidHttpMethod('get')).toBe(true);
      expect(isValidHttpMethod('Post')).toBe(true);
    });

    it.each(['TRACE', 'CONNECT', 'FOO', ''])('rejects %s', (method) => {
      expect(isValidHttpMethod(method)).toBe(false);
    });
  });

  describe('methodSupportsBody', () => {
    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
      'supports body for %s',
      (method) => {
        expect(methodSupportsBody(method)).toBe(true);
      },
    );

    it('is case-insensitive', () => {
      expect(methodSupportsBody('post')).toBe(true);
    });

    it.each(['GET', 'HEAD', 'OPTIONS'])(
      'does not support body for %s',
      (method) => {
        expect(methodSupportsBody(method)).toBe(false);
      },
    );
  });

  describe('getDefaultExpectedStatusCodes', () => {
    it('allows only 2xx for website monitors', () => {
      expect(getDefaultExpectedStatusCodes('website')).toBe('200-299');
    });

    it('allows redirects for HTTP request monitors', () => {
      expect(getDefaultExpectedStatusCodes('http_request')).toBe(
        '200-299,300-399',
      );
    });

    it('falls back to 2xx for unknown monitor types', () => {
      expect(getDefaultExpectedStatusCodes('port')).toBe('200-299');
      expect(getDefaultExpectedStatusCodes('')).toBe('200-299');
    });
  });

  describe('status class helpers', () => {
    it.each([
      [199, false],
      [200, true],
      [299, true],
      [300, false],
    ])('isSuccessStatus(%s) === %s', (status, expected) => {
      expect(isSuccessStatus(status)).toBe(expected);
    });

    it.each([
      [299, false],
      [300, true],
      [399, true],
      [400, false],
    ])('isRedirectStatus(%s) === %s', (status, expected) => {
      expect(isRedirectStatus(status)).toBe(expected);
    });

    it.each([
      [399, false],
      [400, true],
      [499, true],
      [500, false],
    ])('isClientErrorStatus(%s) === %s', (status, expected) => {
      expect(isClientErrorStatus(status)).toBe(expected);
    });

    it.each([
      [499, false],
      [500, true],
      [599, true],
      [600, false],
    ])('isServerErrorStatus(%s) === %s', (status, expected) => {
      expect(isServerErrorStatus(status)).toBe(expected);
    });
  });

  describe('getStatusCategory', () => {
    it.each([
      [200, 'Success'],
      [301, 'Redirect'],
      [404, 'Client Error'],
      [503, 'Server Error'],
      [100, 'Unknown'],
      [600, 'Unknown'],
    ])('categorizes %s as %s', (status, category) => {
      expect(getStatusCategory(status)).toBe(category);
    });
  });
});
