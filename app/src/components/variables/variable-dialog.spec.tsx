import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VariableDialog } from './variable-dialog';
import type { Variable } from './schema';

const secretVariable: Variable = {
  id: 'var-secret',
  key: 'API_KEY',
  value: undefined,
  isSecret: 'true',
  type: 'secret',
  description: 'secret key',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const plainVariable: Variable = {
  id: 'var-plain',
  key: 'BASE_URL',
  value: 'https://example.com',
  isSecret: 'false',
  type: 'variable',
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

  it('does not decrypt on open and only reveals after an explicit click', async () => {
    const fetchMock = global.fetch as unknown as jest.Mock;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { id: 'var-secret', key: 'API_KEY', value: '[ENCRYPTED]', isSecret: true, description: 'secret key' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { value: 'decrypted-secret-value' } }),
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
      expect((screen.getByLabelText(/Variable Name \*/i) as HTMLInputElement).value).toBe('API_KEY');
    });
    const valueInput = screen.getByLabelText(/Value \*/i) as HTMLInputElement;
    expect(valueInput.value).toBe('');
    expect(valueInput.placeholder).toBe('Leave blank to keep the current value');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Reveal current value/i }));

    await waitFor(() => {
      expect(valueInput.value).toBe('decrypted-secret-value');
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/projects/project-1/variables/var-secret/decrypt',
      expect.objectContaining({ method: 'POST', cache: 'no-store' })
    );
  });

  it('does not PUT a revealed secret back unless it was edited, and shows the reserved-name message', async () => {
    const fetchMock = global.fetch as unknown as jest.Mock;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { id: 'var-secret', key: 'API_KEY', value: '[ENCRYPTED]', isSecret: true } }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true, data: { value: 'plain' } }) })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          success: false,
          error: 'Cannot use system reserved variable names',
          details: [{ path: ['key'], message: 'Cannot use system reserved variable names' }],
        }),
      });

    render(
      <VariableDialog open onOpenChange={jest.fn()} projectId="project-1" variable={secretVariable} onSuccess={jest.fn()} canViewSecrets />
    );
    await waitFor(() => {
      expect((screen.getByLabelText(/Variable Name \*/i) as HTMLInputElement).value).toBe('API_KEY');
    });
    fireEvent.click(screen.getByRole('button', { name: /Reveal current value/i }));
    await waitFor(() => {
      expect((screen.getByLabelText(/Value \*/i) as HTMLInputElement).value).toBe('plain');
    });
    fireEvent.click(screen.getByRole('button', { name: /^(Update|Save)/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const body = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(body).not.toHaveProperty('value');
    expect(await screen.findByText('Cannot use system reserved variable names')).toBeInTheDocument();
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
