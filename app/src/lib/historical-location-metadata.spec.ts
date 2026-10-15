import { buildLocationMetadataMap, getLocationDisplayMetadata } from './location-service';

const locations = [
  { code: 'eu-central', name: 'Europe', flag: '🇪🇺', region: 'EU', coordinates: null, isEnabled: true },
  { code: 'us-east', name: 'US East', flag: '🇺🇸', region: 'US', coordinates: null, isEnabled: false },
  { code: 'asia-pacific', name: 'Asia Pacific', flag: '🌏', region: 'APAC', coordinates: null, isEnabled: false },
];

describe('historical location metadata', () => {
  it('keeps enabled labels and flags', () => {
    expect(getLocationDisplayMetadata('eu-central', buildLocationMetadataMap(locations)))
      .toMatchObject({ name: 'Europe', flag: '🇪🇺' });
  });
  it.each(['us-east', 'asia-pacific'])('keeps %s readable and marks it inactive', (code) => {
    const location = locations.find((item) => item.code === code)!;
    expect(getLocationDisplayMetadata(code, buildLocationMetadataMap(locations)))
      .toMatchObject({ name: `${location.name} (inactive)`, flag: location.flag });
  });
  it('falls back to a readable code without inventing a flag for an unknown location', () => {
    expect(getLocationDisplayMetadata('retired-region', buildLocationMetadataMap(locations)))
      .toEqual({ code: 'retired-region', name: 'Retired Region', region: '' });
  });
});
