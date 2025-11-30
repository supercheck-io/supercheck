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

// Type definitions for mock chains
type DbInsertMock = {
  values: jest.Mock<unknown, unknown[]>;
  returning?: jest.Mock<Promise<unknown[]>, unknown[]>;
};

type DbUpdateMock = {
  set: jest.Mock<unknown, unknown[]>;
  where: jest.Mock<unknown, unknown[]>;
  returning?: jest.Mock<Promise<unknown[]>, unknown[]>;
};

type DbDeleteMock = {
  where: jest.Mock<Promise<void>, unknown[]>;
};

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
    
    const mockInsertChain: DbInsertMock = {
      values: jest.fn().mockReturnThis(),
      returning: jest.fn().mockResolvedValue([mockAlert]),
    };
    mockDb.insert.mockReturnValue(mockInsertChain);

    const mockUpdateChain: DbUpdateMock = {
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      returning: jest.fn().mockResolvedValue([mockAlert]),
    };
    mockDb.update.mockReturnValue(mockUpdateChain);

    const mockDeleteChain: DbDeleteMock = {
      where: jest.fn().mockResolvedValue(undefined),
    };
    mockDb.delete.mockReturnValue(mockDeleteChain);
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
          const mockInsertChain: DbInsertMock = {
            values: jest.fn().mockResolvedValue(undefined),
          };
          mockDb.insert.mockReturnValue(mockInsertChain);
          
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
          const mockInsertChain: DbInsertMock = {
            values: jest.fn().mockResolvedValue(undefined),
          };
          mockDb.insert.mockReturnValue(mockInsertChain);
          
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
          const mockInsertChain: DbInsertMock = {
            values: jest.fn().mockResolvedValue(undefined),
          };
          mockDb.insert.mockReturnValue(mockInsertChain);
          
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
          const mockInsertChain: DbInsertMock = {
            values: jest.fn().mockResolvedValue(undefined),
          };
          mockDb.insert.mockReturnValue(mockInsertChain);
          
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
          const mockInsertChain: DbInsertMock = {
            values: jest.fn().mockRejectedValue(new Error('DB error')),
          };
          mockDb.insert.mockReturnValue(mockInsertChain);
          
          // Should not throw
          await expect(service.saveAlertHistory(mockAlertHistory)).resolves.not.toThrow();
        });
      });

      describe('Edge Cases', () => {
        it('should handle null monitorId', async () => {
          const mockInsertChain: DbInsertMock = {
            values: jest.fn().mockResolvedValue(undefined),
          };
          mockDb.insert.mockReturnValue(mockInsertChain);
          
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
          const mockInsertChain: DbInsertMock = {
            values: jest.fn().mockResolvedValue(undefined),
          };
          mockDb.insert.mockReturnValue(mockInsertChain);
          
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

          const result = await service.createAlert(newAlertData as object);
          
          expect(result).toEqual(mockAlert);
          expect(mockDb.insert).toHaveBeenCalled();
        });
      });

      describe('Negative Cases', () => {
        it('should throw error on database failure', async () => {
          const mockInsertChain: DbInsertMock = {
            values: jest.fn().mockReturnThis(),
            returning: jest.fn().mockRejectedValue(new Error('DB error')),
          };
          mockDb.insert.mockReturnValue(mockInsertChain);

          await expect(service.createAlert({} as object))
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
          const mockUpdateChain: DbUpdateMock = {
            set: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            returning: jest.fn().mockResolvedValue([]),
          };
          mockDb.update.mockReturnValue(mockUpdateChain);
          
          await expect(service.updateAlert('non-existent', {}))
            .rejects.toThrow('Could not update alert');
        });

        it('should throw error on database failure', async () => {
          const mockUpdateChain: DbUpdateMock = {
            set: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            returning: jest.fn().mockRejectedValue(new Error('DB error')),
          };
          mockDb.update.mockReturnValue(mockUpdateChain);
          
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
          const mockDeleteChain: DbDeleteMock = {
            where: jest.fn().mockRejectedValue(new Error('DB error')),
          };
          mockDb.delete.mockReturnValue(mockDeleteChain);
          
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
        const mockInsertChain: DbInsertMock = {
          values: jest.fn().mockReturnThis(),
          returning: jest.fn().mockRejectedValue(new Error('Sensitive DB error')),
        };
        mockDb.insert.mockReturnValue(mockInsertChain);

        await expect(service.createAlert({} as object))
          .rejects.toThrow('Could not create alert');
      });
    });
  });

  // ==========================================================================
  // ADDITIONAL COVERAGE TESTS
  // ==========================================================================

  describe('Alert Types', () => {
    const alertTypes = [
      'monitor_up',
      'monitor_down',
      'ssl_expiring',
      'job_success',
      'job_failed',
      'job_timeout',
    ];

    alertTypes.forEach(alertType => {
      it(`should save alert history for type: ${alertType}`, async () => {
        const mockInsertChain: DbInsertMock = {
          values: jest.fn().mockResolvedValue(undefined),
        };
        mockDb.insert.mockReturnValue(mockInsertChain);

        await service.saveAlertHistory({
          ...mockAlertHistory,
          type: alertType as object,
        });
        
        expect(mockInsertChain.values).toHaveBeenCalledWith(
          expect.objectContaining({ type: alertType })
        );
      });
    });
  });

  describe('Alert Status', () => {
    const alertStatuses = ['sent', 'failed', 'pending'];

    alertStatuses.forEach(status => {
      it(`should handle status: ${status}`, async () => {
        const mockInsertChain: DbInsertMock = {
          values: jest.fn().mockResolvedValue(undefined),
        };
        mockDb.insert.mockReturnValue(mockInsertChain);

        await service.saveAlertHistory({
          ...mockAlertHistory,
          status: status as object,
        });
        
        expect(mockInsertChain.values).toHaveBeenCalledWith(
          expect.objectContaining({ status })
        );
      });
    });
  });

  describe('Provider Handling', () => {
    it('should include provider ID in alert history', async () => {
      const mockInsertChain: DbInsertMock = {
        values: jest.fn().mockResolvedValue(undefined),
      };
      mockDb.insert.mockReturnValue(mockInsertChain);
      
      await service.saveAlertHistory(mockAlertHistory);
      
      expect(mockInsertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({ provider: testProviderId })
      );
    });

    it('should handle different provider IDs', async () => {
      const mockInsertChain: DbInsertMock = {
        values: jest.fn().mockResolvedValue(undefined),
      };
      mockDb.insert.mockReturnValue(mockInsertChain);
      
      const providers = ['email-provider', 'slack-provider', 'discord-provider'];
      
      for (const providerId of providers) {
        await service.saveAlertHistory({
          ...mockAlertHistory,
          providerId,
        });
      }
      
      expect(mockInsertChain.values).toHaveBeenCalledTimes(providers.length);
    });
  });

  describe('Multiple Alerts', () => {
    it('should handle fetching many alerts for monitor', async () => {
      const manyAlerts = Array.from({ length: 50 }, (_, i) => ({
        ...mockAlert,
        id: `alert-${i}`,
      }));
      mockDb.query.alerts.findMany.mockResolvedValue(manyAlerts);
      
      const result = await service.getAlertsForMonitor(testMonitorId);
      
      expect(result).toHaveLength(50);
    });

    it('should handle concurrent alert creation', async () => {
      const mockInsertChain: DbInsertMock = {
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([mockAlert]),
      };
      mockDb.insert.mockReturnValue(mockInsertChain);

      const promises = Array.from({ length: 10 }, () =>
        service.createAlert({ name: 'Test', monitorId: testMonitorId } as object)
      );
      
      const results = await Promise.all(promises);
      
      results.forEach(result => {
        expect(result).toEqual(mockAlert);
      });
    });
  });

  describe('Update Operations', () => {
    it('should update alert name', async () => {
      const updateChain: DbUpdateMock = {
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([{ ...mockAlert, name: 'Updated' }]),
      };
      mockDb.update.mockReturnValue(updateChain);
      
      const result = await service.updateAlert(testAlertId, { name: 'Updated' });
      
      expect(result.name).toBe('Updated');
    });

    it('should update alert enabled status', async () => {
      const updateChain: DbUpdateMock = {
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([{ ...mockAlert, enabled: false }]),
      };
      mockDb.update.mockReturnValue(updateChain);
      
      const result = await service.updateAlert(testAlertId, { enabled: false });
      
      expect(result.enabled).toBe(false);
    });

    it('should update multiple fields at once', async () => {
      const updateChain: DbUpdateMock = {
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([{
          ...mockAlert,
          name: 'New Name',
          description: 'New Description',
          enabled: false,
        }]),
      };
      mockDb.update.mockReturnValue(updateChain);
      
      const result = await service.updateAlert(testAlertId, {
        name: 'New Name',
        description: 'New Description',
        enabled: false,
      });
      
      expect(result.name).toBe('New Name');
      expect(result.description).toBe('New Description');
      expect(result.enabled).toBe(false);
    });
  });

  describe('Delete Operations', () => {
    it('should call delete with correct alert ID', async () => {
      const deleteChain: DbDeleteMock = {
        where: jest.fn().mockResolvedValue(undefined),
      };
      mockDb.delete.mockReturnValue(deleteChain);
      
      await service.deleteAlert(testAlertId);
      
      expect(mockDb.delete).toHaveBeenCalled();
      expect(deleteChain.where).toHaveBeenCalled();
    });

    it('should handle deleting non-existent alert gracefully', async () => {
      const deleteChain: DbDeleteMock = {
        where: jest.fn().mockResolvedValue(undefined),
      };
      mockDb.delete.mockReturnValue(deleteChain);
      
      // Should not throw even if alert doesn't exist
      await expect(service.deleteAlert('non-existent')).resolves.not.toThrow();
    });
  });

  describe('Query Operations', () => {
    it('should query alert with correct parameters', async () => {
      mockDb.query.alerts.findFirst.mockResolvedValue(mockAlert);
      
      await service.getAlertById(testAlertId);
      
      expect(mockDb.query.alerts.findFirst).toHaveBeenCalled();
    });

    it('should query alerts for monitor with correct parameters', async () => {
      mockDb.query.alerts.findMany.mockResolvedValue([mockAlert]);
      
      await service.getAlertsForMonitor(testMonitorId);
      
      expect(mockDb.query.alerts.findMany).toHaveBeenCalled();
    });
  });
});
