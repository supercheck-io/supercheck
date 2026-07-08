import { MEMORY_LIMITS } from '../../common/constants/memory.constants';
import { S3Service } from './s3.service';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

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

  it('uploads cloud directories without requiring bucket list or create permissions', async () => {
    const service = createService();
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 's3-service-'));
    const sdkClient = {
      send: jest.fn().mockRejectedValue(new Error('Access Denied')),
    };

    (service as unknown as { s3Client: { send: jest.Mock } }).s3Client =
      sdkClient;

    jest
      .spyOn(service, 'uploadFile')
      .mockImplementation(async (_localFilePath, s3Key) => s3Key);

    await fs.writeFile(path.join(tempDir, 'index.html'), '<html></html>');

    const uploadedKeys = await service.uploadDirectory(
      tempDir,
      'execution-123/report',
      'playwright-job-artifacts',
      'execution-123',
      'job',
    );

    expect(uploadedKeys).toEqual(['execution-123/report/index.html']);
    expect(sdkClient.send).not.toHaveBeenCalled();
  });
});
