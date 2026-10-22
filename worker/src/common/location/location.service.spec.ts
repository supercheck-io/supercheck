import { LocationService, type LocationConfig } from './location.service';

describe('LocationService', () => {
  const service = new LocationService();
  const multiLocationConfig: LocationConfig = {
    enabled: true,
    locations: ['us-east', 'eu-central'],
    threshold: 50,
    strategy: 'majority',
  };

  it('uses configured locations as the majority denominator', () => {
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
    expect(service.calculateAggregatedStatus({}, multiLocationConfig)).toBe(
      'down',
    );
  });
  it('does not report all locations up when one configured location is missing', () => {
    expect(
      service.calculateAggregatedStatus(
        { 'us-east': true },
        { ...multiLocationConfig, strategy: 'all' },
      ),
    ).toBe('partial');
  });

  it('ignores results outside the configured locations', () => {
    expect(
      service.calculateAggregatedStatus(
        { other: true },
        { ...multiLocationConfig, strategy: 'any' },
      ),
    ).toBe('down');
  });

  it('counts missing locations toward the majority threshold', () => {
    expect(
      service.calculateAggregatedStatus(
        { 'us-east': true },
        { ...multiLocationConfig, threshold: 75 },
      ),
    ).toBe('partial');
  });
});
