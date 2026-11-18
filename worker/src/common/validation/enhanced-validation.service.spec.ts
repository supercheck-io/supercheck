import { EnhancedValidationService } from './enhanced-validation.service';

describe('EnhancedValidationService URL validation', () => {
  const service = new EnhancedValidationService();

  it.each([
    'http://[::ffff:172.18.0.5]:3000/api/health',
    'http://[::ffff:ac12:5]:3000/api/health',
  ])('rejects the reported IPv4-mapped IPv6 bypass: %s', (url) => {
    expect(service.validateAndSanitizeUrl(url)).toMatchObject({
      valid: false,
    });
  });

  it('keeps the case of the path and query (servers may treat them case-sensitively)', () => {
    expect(
      service.validateAndSanitizeUrl(
        '  https://Api.Example.com/v1/Rates?from=Hamburg&sig=AbC  ',
      ),
    ).toEqual({
      valid: true,
      sanitized: 'https://Api.Example.com/v1/Rates?from=Hamburg&sig=AbC',
    });
  });

  it('still rejects an uppercase private host', () => {
    expect(
      service.validateAndSanitizeUrl('http://LOCALHOST:3000/Admin'),
    ).toMatchObject({ valid: false });
    // URL parsing keeps host case for non-special schemes.
    expect(
      service.validateAndSanitizeUrl('custom://LOCALHOST/x', {
        allowedProtocols: ['custom:'],
      }),
    ).toMatchObject({ valid: false });
  });

  it('preserves the explicit internal-target opt-in', () => {
    expect(
      service.validateAndSanitizeUrl(
        'http://[::ffff:172.18.0.5]:3000/api/health',
        { allowInternalTargets: true },
      ),
    ).toMatchObject({ valid: true });
  });
});
