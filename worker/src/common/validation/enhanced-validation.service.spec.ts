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

  it('preserves the explicit internal-target opt-in', () => {
    expect(
      service.validateAndSanitizeUrl(
        'http://[::ffff:172.18.0.5]:3000/api/health',
        { allowInternalTargets: true },
      ),
    ).toMatchObject({ valid: true });
  });
});
