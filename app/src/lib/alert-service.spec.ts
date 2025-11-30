/**
 * Alert Service Tests
 * 
 * Comprehensive test coverage for alert management
 * 
 * Test Categories:
 * - Alert CRUD Operations (create, read, update, delete)
 * - Alert History (save and query)
 * - Monitor Alerts (get alerts for monitor)
 * - Error Handling (database errors, invalid inputs)
 * - Edge Cases (empty results, concurrent operations)
 */

import { AlertService } from './alert-service';

// Mock database
jest.mock('@/utils/db', () => ({
  db: {
    insert: jest.fn(),
    select: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    query: {
      alerts: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
    },
  },
}));

import { db } from '@/utils/db';

const mockDb = db as jest.Mocked<typeof db>;

describe('AlertService', () => {
  let service: AlertService;

  // Test fixtures
  const testAlertId = 'alert-123';
  const testMonitorId = 'monitor-456';
  const testJobId = 'job-789';
  const testProviderId = 'provider-abc';

  const mockAlert = {
    id: testAlertId,
    name: 'Test Alert',
    description: 'Test alert description',
    monitorId: testMonitorId,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockAlertHistory = {
    type: 'monitor_down' as const,
    message: 'Monitor is down',
    target: 'https://example.com',
    targetType: 'monitor' as const,
    monitorId: testMonitorId,
    providerId: testProviderId,
    status: 'sent' as const,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = AlertService.getInstance();
    
    // Default mock implementations
    mockDb.query.alerts.findFirst.mockResolvedValue(mockAlert);
    mockDb.query.alerts.findMany.mockResolvedValue([mockAlert]);
    
    const mockInsertChain = {
      values: jest.fn().mockReturnThis(),
      returning: jest.fn().mockResolvedValue([mockAlert]),
    };
    mockDb.insert.mockReturnValue(mockInsertChain as any);
    
    const mockUpdateChain = {
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      returning: jest.fn().mockResolvedValue([mockAlert]),
    };
    mockDb.update.mockReturnValue(mockUpdateChain as any);
    
    const mockDeleteChain = {
      where: jest.fn().mockResolvedValue(undefined),
    };
    mockDb.delete.mockReturnValue(mockDeleteChain as any);
  });

  // ==========================================================================
  // SINGLETON PATTERN TESTS
  // ==========================================================================

  describe('Singleton Pattern', () => {
    it('should return same instance on multiple calls', () => {
      const instance1 = AlertService.getInstance();
      const instance2 = AlertService.getInstance();
      
      expect(instance1).toBe(instance2);
    });
  });

  // ==========================================================================
  // ALERT HISTORY TESTS
  // ==========================================================================

  describe('Alert History', () => {
    describe('saveAlertHistory', () => {
      describe('Positive Cases', () => {
        it('should save alert history for monitor', async () => {
          const mockInsertChain = {
            values: jest.fn().mockResolvedValue(undefined),
          };
          mockDb.insert.mockReturnValue(mockInsertChain as any);
          
          await service.saveAlertHistory(mockAlertHistory);
          
          expect(mockDb.insert).toHaveBeenCalled();
          expect(mockInsertChain.values).toHaveBeenCalledWith(
            expect.objectContaining({
              type: 'monitor_down',
              message: 'Monitor is down',
              target: 'https://example.com',
              targetType: 'monitor',
              monitorId: testMonitorId,
            })
          );
        });

        it('should save alert history for job', async () => {
          const mockInsertChain = {
            values: jest.fn().mockResolvedValue(undefined),
          };
          mockDb.insert.mockReturnValue(mockInsertChain as any);
          
          const jobAlert = {
            ...mockAlertHistory,
            targetType: 'job' as const,
            monitorId: undefined,
            jobId: testJobId,
          };
          
          await service.saveAlertHistory(jobAlert);
          
          expect(mockInsertChain.values).toHaveBeenCalledWith(
            expect.objectContaining({
              jobId: testJobId,
              targetType: 'job',
            })
          );
        });

        it('should include error message when provided', async () => {
          const mockInsertChain = {
            values: jest.fn().mockResolvedValue(undefined),
          };
          mockDb.insert.mockReturnValue(mockInsertChain as any);
          
          const alertWithError = {
            ...mockAlertHistory,
            status: 'failed' as const,
            errorMessage: 'Delivery failed',
          };
          
          await service.saveAlertHistory(alertWithError);
          
          expect(mockInsertChain.values).toHaveBeenCalledWith(
            expect.objectContaining({
              errorMessage: 'Delivery failed',
              status: 'failed',
            })
          );
        });

        it('should set sentAt timestamp', async () => {
          const mockInsertChain = {
            values: jest.fn().mockResolvedValue(undefined),
          };
          mockDb.insert.mockReturnValue(mockInsertChain as any);
          
          await service.saveAlertHistory(mockAlertHistory);
          
          expect(mockInsertChain.values).toHaveBeenCalledWith(
            expect.objectContaining({
              sentAt: expect.any(Date),
            })
          );
        });
      });

      describe('Negative Cases', () => {
        it('should handle database error gracefully', async () => {
          const mockInsertChain = {
            values: jest.fn().mockRejectedValue(new Error('DB error')),
          };
          mockDb.insert.mockReturnValue(mockInsertChain as any);
          
          // Should not throw
          await expect(service.saveAlertHistory(mockAlertHistory)).resolves.not.toThrow();
        });
      });

      describe('Edge Cases', () => {
        it('should handle null monitorId', async () => {
          const mockInsertChain = {
            values: jest.fn().mockResolvedValue(undefined),
          };
          mockDb.insert.mockReturnValue(mockInsertChain as any);
          
          const alertNoMonitor = {
            ...mockAlertHistory,
            monitorId: undefined,
          };
          
          await service.saveAlertHistory(alertNoMonitor);
          
          expect(mockInsertChain.values).toHaveBeenCalledWith(
            expect.objectContaining({
              monitorId: null,
            })
          );
        });

        it('should handle null errorMessage', async () => {
          const mockInsertChain = {
            values: jest.fn().mockResolvedValue(undefined),
          };
          mockDb.insert.mockReturnValue(mockInsertChain as any);
          
          await service.saveAlertHistory(mockAlertHistory);
          
          expect(mockInsertChain.values).toHaveBeenCalledWith(
            expect.objectContaining({
              errorMessage: null,
            })
          );
        });
      });
    });
  });

  // ==========================================================================
  // ALERT CRUD TESTS
  // ==========================================================================

  describe('Alert CRUD Operations', () => {
    describe('getAlertById', () => {
      describe('Positive Cases', () => {
        it('should return alert when found', async () => {
          mockDb.query.alerts.findFirst.mockResolvedValue(mockAlert);
          
          const result = await service.getAlertById(testAlertId);
          
          expect(result).toEqual(mockAlert);
        });
      });

      describe('Negative Cases', () => {
        it('should return null when not found', async () => {
          mockDb.query.alerts.findFirst.mockResolvedValue(null);
          
          const result = await service.getAlertById('non-existent');
          
          expect(result).toBeNull();
        });

        it('should return null on database error', async () => {
          mockDb.query.alerts.findFirst.mockRejectedValue(new Error('DB error'));
          
          const result = await service.getAlertById(testAlertId);
          
          expect(result).toBeNull();
        });
      });
    });

    describe('createAlert', () => {
      describe('Positive Cases', () => {
        it('should create and return new alert', async () => {
          const newAlertData = {
            name: 'New Alert',
            description: 'New alert description',
            monitorId: testMonitorId,
            enabled: true,
          };
          
          const result = await service.createAlert(newAlertData as any);
          
          expect(result).toEqual(mockAlert);
          expect(mockDb.insert).toHaveBeenCalled();
        });
      });

      describe('Negative Cases', () => {
        it('should throw error on database failure', async () => {
          const mockInsertChain = {
            values: jest.fn().mockReturnThis(),
            returning: jest.fn().mockRejectedValue(new Error('DB error')),
          };
          mockDb.insert.mockReturnValue(mockInsertChain as any);
          
          await expect(service.createAlert({} as any))
            .rejects.toThrow('Could not create alert');
        });
      });
    });

    describe('updateAlert', () => {
      describe('Positive Cases', () => {
        it('should update and return alert', async () => {
          const updateData = { name: 'Updated Alert' };
          
          const result = await service.updateAlert(testAlertId, updateData);
          
          expect(result).toEqual(mockAlert);
        });
      });

      describe('Negative Cases', () => {
        it('should throw error when alert not found', async () => {
          const mockUpdateChain = {
            set: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            returning: jest.fn().mockResolvedValue([]),
          };
          mockDb.update.mockReturnValue(mockUpdateChain as any);
          
          await expect(service.updateAlert('non-existent', {}))
            .rejects.toThrow('Could not update alert');
        });

        it('should throw error on database failure', async () => {
          const mockUpdateChain = {
            set: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            returning: jest.fn().mockRejectedValue(new Error('DB error')),
          };
          mockDb.update.mockReturnValue(mockUpdateChain as any);
          
          await expect(service.updateAlert(testAlertId, {}))
            .rejects.toThrow('Could not update alert');
        });
      });
    });

    describe('deleteAlert', () => {
      describe('Positive Cases', () => {
        it('should delete alert successfully', async () => {
          await expect(service.deleteAlert(testAlertId)).resolves.not.toThrow();
          expect(mockDb.delete).toHaveBeenCalled();
        });
      });

      describe('Negative Cases', () => {
        it('should throw error on database failure', async () => {
          const mockDeleteChain = {
            where: jest.fn().mockRejectedValue(new Error('DB error')),
          };
          mockDb.delete.mockReturnValue(mockDeleteChain as any);
          
          await expect(service.deleteAlert(testAlertId))
            .rejects.toThrow('Could not delete alert');
        });
      });
    });
  });

  // ==========================================================================
  // MONITOR ALERTS TESTS
  // ==========================================================================

  describe('Monitor Alerts', () => {
    describe('getAlertsForMonitor', () => {
      describe('Positive Cases', () => {
        it('should return alerts for monitor', async () => {
          const alerts = [mockAlert, { ...mockAlert, id: 'alert-456' }];
          mockDb.query.alerts.findMany.mockResolvedValue(alerts);
          
          const result = await service.getAlertsForMonitor(testMonitorId);
          
          expect(result).toEqual(alerts);
          expect(result).toHaveLength(2);
        });
      });

      describe('Negative Cases', () => {
        it('should return empty array when no alerts found', async () => {
          mockDb.query.alerts.findMany.mockResolvedValue([]);
          
          const result = await service.getAlertsForMonitor(testMonitorId);
          
          expect(result).toEqual([]);
        });

        it('should return empty array on database error', async () => {
          mockDb.query.alerts.findMany.mockRejectedValue(new Error('DB error'));
          
          const result = await service.getAlertsForMonitor(testMonitorId);
          
          expect(result).toEqual([]);
        });
      });
    });
  });

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    describe('Empty Inputs', () => {
      it('should handle empty alert ID', async () => {
        mockDb.query.alerts.findFirst.mockResolvedValue(null);
        
        const result = await service.getAlertById('');
        
        expect(result).toBeNull();
      });

      it('should handle empty monitor ID', async () => {
        mockDb.query.alerts.findMany.mockResolvedValue([]);
        
        const result = await service.getAlertsForMonitor('');
        
        expect(result).toEqual([]);
      });
    });

    describe('Special Characters', () => {
      it('should handle special characters in alert ID', async () => {
        const specialId = 'alert-<script>';
        mockDb.query.alerts.findFirst.mockResolvedValue(null);
        
        const result = await service.getAlertById(specialId);
        
        expect(result).toBeNull();
      });
    });

    describe('Concurrent Operations', () => {
      it('should handle concurrent getAlertById calls', async () => {
        mockDb.query.alerts.findFirst.mockResolvedValue(mockAlert);
        
        const promises = Array.from({ length: 5 }, () =>
          service.getAlertById(testAlertId)
        );
        
        const results = await Promise.all(promises);
        
        results.forEach(result => {
          expect(result).toEqual(mockAlert);
        });
      });
    });
  });

  // ==========================================================================
  // SECURITY TESTS
  // ==========================================================================

  describe('Security', () => {
    describe('Input Sanitization', () => {
      it('should not expose internal error details', async () => {
        mockDb.query.alerts.findFirst.mockRejectedValue(
          new Error('SQL injection attempted')
        );
        
        const result = await service.getAlertById(testAlertId);
        
        // Should return null, not expose error
        expect(result).toBeNull();
      });
    });

    describe('Error Messages', () => {
      it('should use generic error messages', async () => {
        const mockInsertChain = {
          values: jest.fn().mockReturnThis(),
          returning: jest.fn().mockRejectedValue(new Error('Sensitive DB error')),
        };
        mockDb.insert.mockReturnValue(mockInsertChain as any);
        
        await expect(service.createAlert({} as any))
          .rejects.toThrow('Could not create alert');
      });
    });
  });
});
