import { MEMORY_LIMITS } from '../../common/constants/memory.constants';
import { S3Service } from './s3.service';

describe('S3Service file variable handling', () => {
  function createService() {
    const configService = {
      get: jest.fn((_key: string, defaultValue?: unknown) => defaultValue),
    };

    return new S3Service(configService as never);
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('preserves legacy file variables with unknown sizes by enforcing the remaining budget at download time', async () => {
    const service = createService();
    const downloadSpy = jest
      .spyOn(service, 'downloadFileToBuffer')
      .mockResolvedValue(Buffer.from('legacy-data'));
    jest
      .spyOn(service, 'getBucketForEntityType')
      .mockReturnValue('project-data-files');

    const result = await service.prepareFileVariables({
      LEGACY_FILE: {
        storagePath: 'projects/project-123/variables/legacy.csv',
        fileName: 'legacy.csv',
        mimeType: 'text/csv',
        fileSize: null,
      },
    });

    expect(downloadSpy).toHaveBeenCalledWith(
      'projects/project-123/variables/legacy.csv',
      'project-data-files',
      MEMORY_LIMITS.MAX_TOTAL_FILE_VARIABLES_BYTES,
    );
    expect(result.filePaths.LEGACY_FILE).toBe('data/LEGACY_FILE/legacy.csv');
    expect(result.additionalFiles['data/LEGACY_FILE/legacy.csv']).toBe(
      `base64:${Buffer.from('legacy-data').toString('base64')}`,
    );
  });

  it('rejects files whose known size already exceeds the remaining budget', async () => {
    const service = createService();
    const downloadSpy = jest.spyOn(service, 'downloadFileToBuffer');
    jest
      .spyOn(service, 'getBucketForEntityType')
      .mockReturnValue('project-data-files');

    await expect(
      service.prepareFileVariables({
        TOO_BIG: {
          storagePath: 'projects/project-123/variables/big.csv',
          fileName: 'big.csv',
          mimeType: 'text/csv',
          fileSize: MEMORY_LIMITS.MAX_TOTAL_FILE_VARIABLES_BYTES + 1,
        },
      }),
    ).rejects.toThrow('exceeds the 50 MB per-run limit');

    expect(downloadSpy).not.toHaveBeenCalled();
  });
});
