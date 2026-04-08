import { LocationService, type LocationConfig } from './location.service';

describe('LocationService', () => {
  const service = new LocationService();
  const multiLocationConfig: LocationConfig = {
    enabled: true,
    locations: ['us-east', 'eu-central'],
    threshold: 50,
    strategy: 'majority',
  };

  it('ignores configured locations that do not have results in the current cycle', () => {
    expect(
      service.calculateAggregatedStatus(
        {
          'us-east': true,
        },
        multiLocationConfig,
      ),
    ).toBe('up');
  });

  it('falls back to configured locations when no results are available', () => {
    expect(
      service.calculateAggregatedStatus(
        {} as Record<string, boolean>,
        multiLocationConfig,
      ),
    ).toBe('down');
  });
});
