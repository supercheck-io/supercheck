import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { LocationFilterDropdown } from './location-filter-dropdown';

jest.mock('@/hooks/use-locations', () => ({
  useLocationMetadata: () => ({ locations: [
    { code: 'eu-central', name: 'Europe', flag: '🇪🇺', region: 'EU', coordinates: null, isEnabled: true },
    { code: 'us-east', name: 'US East', flag: '🇺🇸', region: 'US', coordinates: null, isEnabled: false },
  ] }),
}));
jest.mock('@/components/ui/select', () => ({
  Select: ({ children, value, onValueChange }: { children: React.ReactNode; value: string; onValueChange: (value: string) => void }) =>
    <select aria-label="Location" value={value} onChange={(event) => onValueChange(event.target.value)}>{children}</select>,
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => <option value={value}>{children}</option>,
}));

it('shows enabled, inactive and unknown historical locations and keeps their filter codes selectable', () => {
  const onChange = jest.fn();
  render(<LocationFilterDropdown selectedLocation="all" availableLocations={['eu-central', 'us-east', 'retired-region']} onLocationChange={onChange} />);
  expect(screen.getByRole('option', { name: /Europe/ })).toHaveTextContent('🇪🇺');
  expect(screen.getByRole('option', { name: /US East \(inactive\)/ })).toHaveTextContent('🇺🇸');
  expect(screen.getByRole('option', { name: 'Retired Region' })).toBeEnabled();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'us-east' } });
  expect(onChange).toHaveBeenCalledWith('us-east');
});
