/** @jest-environment node */
jest.mock('@/lib/auth-context', () => ({ requireAuthContext: jest.fn(), isAuthError: jest.fn() }));
jest.mock('@/lib/location-registry', () => ({ getLocationDisplayData: jest.fn(), getEnabledLocations: jest.fn() }));
jest.mock('@/lib/logger/index', () => ({ createLogger: () => ({ error: jest.fn() }) }));

import { requireAuthContext, isAuthError } from '@/lib/auth-context';
import { getLocationDisplayData, getEnabledLocations } from '@/lib/location-registry';
import { GET } from './route';
import { GET as enabledGET } from '../route';

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(requireAuthContext).mockResolvedValue({} as Awaited<ReturnType<typeof requireAuthContext>>);
  jest.mocked(isAuthError).mockReturnValue(false);
});

it('serves display metadata to ordinary authenticated users without changing the enabled-locations endpoint', async () => {
  const enabled = { code: 'eu-central', name: 'Europe', region: 'EU', flag: '🇪🇺', coordinates: null, isEnabled: true };
  const disabled = { ...enabled, code: 'us-east', name: 'US East', isEnabled: false };
  jest.mocked(getLocationDisplayData).mockResolvedValue([enabled, disabled]);
  jest.mocked(getEnabledLocations).mockResolvedValue([enabled] as Awaited<ReturnType<typeof getEnabledLocations>>);
  expect(await (await GET()).json()).toEqual({ success: true, data: [enabled, disabled] });
  expect(getEnabledLocations).not.toHaveBeenCalled();
  expect(await (await enabledGET()).json()).toEqual({ success: true, data: [enabled] });
});

it('requires authentication before reading metadata', async () => {
  jest.mocked(requireAuthContext).mockRejectedValue(new Error('Authentication required'));
  jest.mocked(isAuthError).mockReturnValue(true);
  expect((await GET()).status).toBe(401);
  expect(getLocationDisplayData).not.toHaveBeenCalled();
});

it('returns a generic error when metadata cannot be read', async () => {
  jest.mocked(getLocationDisplayData).mockRejectedValue(new Error('private database detail'));
  const response = await GET();
  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain('private database detail');
});
