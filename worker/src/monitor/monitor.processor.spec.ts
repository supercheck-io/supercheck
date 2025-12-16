import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import {
  MonitorProcessor,
  MonitorProcessorUSEast,
  MonitorProcessorEUCentral,
  MonitorProcessorAsiaPacific,
} from './monitor.processor';
import { MonitorJobDataDto } from './dto/monitor-job.dto';
import { EXECUTE_MONITOR_JOB_NAME } from './monitor.constants';
import { MonitorExecutionResult } from './types/monitor-result.type';

// Mock MonitorService to avoid loading explicit dependencies like execa (ESM)
jest.mock('./monitor.service', () => {
  class MockMonitorService {
    executeMonitor = jest.fn();
    executeMonitorWithLocations = jest.fn();
    saveMonitorResults = jest.fn();
    saveDistributedMonitorResult = jest.fn();
  }
  return { MonitorService: MockMonitorService };
});

import { MonitorService } from './monitor.service';

describe('MonitorProcessor', () => {
  let monitorProcessor: MonitorProcessor;
  let monitorService: MonitorService;

  const mockMonitorService = {
    executeMonitor: jest.fn(),
    executeMonitorWithLocations: jest.fn(),
    saveMonitorResults: jest.fn(),
    saveDistributedMonitorResult: jest.fn(),
  };

  const mockJob = {
    id: 'job-123',
    name: EXECUTE_MONITOR_JOB_NAME,
    data: {
      monitorId: 'mon-123',
      type: 'http_request',
      target: 'https://example.com',
      config: {},
    } as MonitorJobDataDto,
  } as unknown as Job<MonitorJobDataDto, MonitorExecutionResult[], string>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MonitorProcessorUSEast, // Testing one of the regional processors as the concrete impl
        {
          provide: MonitorService,
          useValue: mockMonitorService,
        },
      ],
    }).compile();

    monitorProcessor = module.get<MonitorProcessorUSEast>(MonitorProcessorUSEast);
    monitorService = module.get<MonitorService>(MonitorService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('dependency injection', () => {
    it('should be defined', () => {
      expect(monitorProcessor).toBeDefined();
    });

    it('should inject MonitorService correctly', () => {
      // Access the protected property via casting to any
      expect((monitorProcessor as any).monitorService).toBeDefined();
      expect((monitorProcessor as any).monitorService).toBe(monitorService);
    });
  });

  describe('process', () => {
    it('should throw error for unknown job name', async () => {
      const unknownJob = { ...mockJob, name: 'unknown-job' };
      await expect(monitorProcessor.process(unknownJob as any)).rejects.toThrow(
        'Unknown job name: unknown-job',
      );
    });

    it('should execute specific location monitor when executionLocation is provided', async () => {
      const locationJob = {
        ...mockJob,
        data: {
          ...mockJob.data,
          executionLocation: 'us-east',
          executionGroupId: 'group-123',
        },
      } as unknown as Job<MonitorJobDataDto, MonitorExecutionResult[], string>;

      const mockResult: MonitorExecutionResult = {
        monitorId: 'mon-123',
        location: 'us-east',
        status: 'up',
        checkedAt: new Date(),
        isUp: true,
        details: {},
      };

      mockMonitorService.executeMonitor.mockResolvedValue(mockResult);

      const result = await monitorProcessor.process(locationJob);

      expect(mockMonitorService.executeMonitor).toHaveBeenCalledWith(
        locationJob.data,
        'us-east',
      );
      expect(mockMonitorService.saveDistributedMonitorResult).toHaveBeenCalledWith(
        mockResult,
        {
          executionGroupId: 'group-123',
          expectedLocations: undefined,
        },
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(mockResult);
    });

    it('should execute multi-location monitor logic when no executionLocation provided (legacy/single worker)', async () => {
      const locationJob = {
        ...mockJob,
        data: {
          ...mockJob.data,
          executionLocation: undefined,
        },
      } as unknown as Job<MonitorJobDataDto, MonitorExecutionResult[], string>;

      const mockResults: MonitorExecutionResult[] = [
        {
          monitorId: 'mon-123',
          location: 'us-east',
          status: 'up',
          checkedAt: new Date(),
          isUp: true,
          details: {},
        },
      ];

      mockMonitorService.executeMonitorWithLocations.mockResolvedValue(
        mockResults,
      );

      const result = await monitorProcessor.process(locationJob);

      expect(mockMonitorService.executeMonitorWithLocations).toHaveBeenCalledWith(
        locationJob.data,
      );
      expect(result).toBe(mockResults);
    });
  });

  describe('Regional Processors Instantiation', () => {
    // This explicitly tests the fix for the "undefined" error
    it('should instantiate MonitorProcessorUSEast with MonitorService', () => {
      const processor = new MonitorProcessorUSEast(mockMonitorService as any);
      expect((processor as any).monitorService).toBe(mockMonitorService);
    });

    it('should instantiate MonitorProcessorEUCentral with MonitorService', () => {
      const processor = new MonitorProcessorEUCentral(mockMonitorService as any);
      expect((processor as any).monitorService).toBe(mockMonitorService);
    });

    it('should instantiate MonitorProcessorAsiaPacific with MonitorService', () => {
      const processor = new MonitorProcessorAsiaPacific(
        mockMonitorService as any,
      );
      expect((processor as any).monitorService).toBe(mockMonitorService);
    });
  });
});
