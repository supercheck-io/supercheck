import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { S3Service } from '../../execution/services/s3.service';
import { ReportUploadService } from './report-upload.service';

describe('ReportUploadService', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => fs.rm(directory, { recursive: true, force: true })),
    );
  });

  async function createRunDirectory() {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'report-upload-'),
    );
    temporaryDirectories.push(directory);
    return directory;
  }

  function createS3ServiceMock() {
    return {
      getBucketForEntityType: jest
        .fn()
        .mockReturnValue('playwright-job-artifacts'),
      getBaseUrlForEntity: jest
        .fn()
        .mockReturnValue(
          'https://storage.example/playwright-job-artifacts/execution-123/report',
        ),
      uploadDirectory: jest.fn(),
    } as unknown as jest.Mocked<S3Service>;
  }

  it('returns the storage upload error when an HTML report exists but upload fails', async () => {
    const s3Service = createS3ServiceMock();
    const service = new ReportUploadService(s3Service);
    const runDir = await createRunDirectory();
    const reportDir = path.join(runDir, 'html');

    await fs.mkdir(reportDir, { recursive: true });
    await fs.writeFile(path.join(reportDir, 'index.html'), '<html></html>');
    s3Service.uploadDirectory.mockRejectedValue(new Error('Access Denied'));

    const result = await service.uploadReport({
      runDir,
      testId: 'test-12345678',
      executionId: 'execution-123',
      s3ReportKeyPrefix: 'execution-123/report',
      entityType: 'job',
    });

    expect(result).toEqual({
      success: false,
      reportUrl: null,
      error: 'Access Denied',
    });
  });

  it('uploads only the configured reporter output when other HTML directories exist', async () => {
    const s3Service = createS3ServiceMock();
    const service = new ReportUploadService(s3Service);
    const runDir = await createRunDirectory();
    for (const directory of ['html', 'pw-report', 'report-test-123']) {
      await fs.mkdir(path.join(runDir, directory));
      await fs.writeFile(
        path.join(runDir, directory, 'index.html'),
        `<html>${directory}</html>`,
      );
    }

    const result = await service.uploadReport({
      runDir,
      testId: 'test-12345678',
      executionId: 'execution-123',
      s3ReportKeyPrefix: 'execution-123/report',
      entityType: 'job',
    });

    expect(result.success).toBe(true);
    expect(s3Service.uploadDirectory).toHaveBeenCalledTimes(1);
    expect(s3Service.uploadDirectory.mock.calls[0][0]).toBe(
      path.join(runDir, 'html'),
    );
  });

  it('does not substitute arbitrary extracted HTML when reporter output is missing', async () => {
    const s3Service = createS3ServiceMock();
    const service = new ReportUploadService(s3Service);
    const runDir = await createRunDirectory();
    const directory = path.join(runDir, 'nested', 'attachment');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      path.join(directory, 'index.html'),
      '<html>attachment</html>',
    );

    const result = await service.uploadReport({
      runDir,
      testId: 'test-12345678',
      executionId: 'execution-123',
      s3ReportKeyPrefix: 'execution-123/report',
      entityType: 'job',
    });

    expect(result).toEqual({
      success: false,
      reportUrl: null,
      error: 'Report not found',
    });
    expect(s3Service.uploadDirectory).not.toHaveBeenCalled();
  });
});
