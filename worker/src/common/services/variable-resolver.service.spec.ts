import { VariableResolverService } from './variable-resolver.service';
import type { DbService } from '../../db/db.service';

describe('VariableResolverService', () => {
  it('fails execution when project variables cannot be loaded', async () => {
    const dbService = {
      getProjectVariables: jest.fn().mockRejectedValue(new Error('offline')),
    } as unknown as DbService;
    const service = new VariableResolverService(dbService);

    await expect(service.resolveProjectVariables('project-1')).rejects.toThrow(
      'Failed to securely resolve project variables',
    );
  });

  it('does not silently omit a secret that cannot be decrypted', async () => {
    const dbService = {
      getProjectVariables: jest.fn().mockResolvedValue([
        {
          key: 'API_TOKEN',
          type: 'secret',
          isSecret: true,
          encryptedValue: 'invalid-envelope',
          value: '',
        },
      ]),
    } as unknown as DbService;
    const service = new VariableResolverService(dbService);

    await expect(service.resolveProjectVariables('project-1')).rejects.toThrow(
      'Failed to securely resolve project variables',
    );
  });
});
