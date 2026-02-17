import { render, screen, waitFor } from '@testing-library/react';
import { VariableDialog } from './variable-dialog';
import type { Variable } from './schema';

const secretVariable: Variable = {
  id: 'var-secret',
  key: 'API_KEY',
  value: undefined,
  isSecret: 'true',
  description: 'secret key',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const plainVariable: Variable = {
  id: 'var-plain',
  key: 'BASE_URL',
  value: 'https://example.com',
  isSecret: 'false',
  description: 'base url',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('VariableDialog', () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    Object.defineProperty(global, 'ResizeObserver', {
      value: ResizeObserverMock,
      writable: true,
      configurable: true,
    });
  });

  beforeEach(() => {
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('loads decrypted secret value for users who can view secrets', async () => {
    const fetchMock = global.fetch as unknown as jest.Mock;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            id: 'var-secret',
            key: 'API_KEY',
            value: '[ENCRYPTED]',
            isSecret: true,
            description: 'secret key',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            id: 'var-secret',
            key: 'API_KEY',
            value: 'decrypted-secret-value',
          },
        }),
      });

    render(
      <VariableDialog
        open
        onOpenChange={jest.fn()}
        projectId="project-1"
        variable={secretVariable}
        onSuccess={jest.fn()}
        canViewSecrets
      />
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/projects/project-1/variables/var-secret',
      expect.objectContaining({ cache: 'no-store' })
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/projects/project-1/variables/var-secret/decrypt',
      expect.objectContaining({ method: 'POST', cache: 'no-store' })
    );

    await waitFor(() => {
      const valueInput = screen.getByLabelText(/Value \*/i) as HTMLInputElement;
      expect(valueInput.value).toBe('decrypted-secret-value');
    });
  });

  it('does not fetch decrypted secret value when user cannot view secrets', async () => {
    const fetchMock = global.fetch as unknown as jest.Mock;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          id: 'var-secret',
          key: 'API_KEY',
          value: '[ENCRYPTED]',
          isSecret: true,
          description: 'secret key',
        },
      }),
    });

    render(
      <VariableDialog
        open
        onOpenChange={jest.fn()}
        projectId="project-1"
        variable={secretVariable}
        onSuccess={jest.fn()}
        canViewSecrets={false}
      />
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      const keyInput = screen.getByLabelText(/Variable Name \*/i) as HTMLInputElement;
      expect(keyInput.value).toBe('API_KEY');
    });

    const valueInput = screen.getByLabelText(/Value \*/i) as HTMLInputElement;
    expect(valueInput.value).toBe('');
    expect(
      screen.getByText('Leave value blank to keep the current secret unchanged.')
    ).toBeInTheDocument();
  });

  it('loads existing value for regular variables', async () => {
    const fetchMock = global.fetch as unknown as jest.Mock;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          id: 'var-plain',
          key: 'BASE_URL',
          value: 'https://example.com',
          isSecret: false,
          description: 'base url',
        },
      }),
    });

    render(
      <VariableDialog
        open
        onOpenChange={jest.fn()}
        projectId="project-1"
        variable={plainVariable}
        onSuccess={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      const valueInput = screen.getByLabelText(/Value \*/i) as HTMLInputElement;
      expect(valueInput.value).toBe('https://example.com');
    });
  });
});
