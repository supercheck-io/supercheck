import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { S3Service } from '../../execution/services/s3.service';
import { ReportUploadService } from './report-upload.service';

describe('ReportUploadService', () => {
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
    const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'report-upload-'));
    const reportDir = path.join(runDir, 'report-test-123');

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
});
