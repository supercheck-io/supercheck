import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'events';

export interface ResourceLimits {
  maxConcurrentConnections: number;
  maxMemoryUsageMB: number;
  maxCpuUsagePercent: number;
  maxExecutionTimeMs: number;
  maxResponseSizeMB: number;
  connectionTimeoutMs: number;
  idleTimeoutMs: number;
}

export interface ResourceUsage {
  activeConnections: number;
  memoryUsageMB: number;
  cpuUsagePercent: number;
  executionTimeMs: number;
  timestamp: Date;
}

export interface ConnectionPool {
  id: string;
  hostname: string;
  port: number;
  protocol: 'http:' | 'https:';
  connections: Set<any>;
  lastUsed: Date;
  created: Date;
  stats: {
    totalRequests: number;
    activeRequests: number;
    errors: number;
    avgResponseTime: number;
  };
}

@Injectable()
export class ResourceManagerService extends EventEmitter {
  private readonly logger = new Logger(ResourceManagerService.name);

  // Connection pools by hostname:port
  private connectionPools = new Map<string, ConnectionPool>();

  // Active resource tracking
  private activeResources = new Map<string, ResourceUsage>();

  // Resource limits configuration
  private limits: ResourceLimits = {
    maxConcurrentConnections: parseInt(
      process.env.MAX_CONCURRENT_CONNECTIONS || '100',
    ),
    maxMemoryUsageMB: parseInt(process.env.MAX_MEMORY_USAGE_MB || '512'),
    maxCpuUsagePercent: parseInt(process.env.MAX_CPU_USAGE_PERCENT || '80'),
    maxExecutionTimeMs: parseInt(process.env.MAX_EXECUTION_TIME_MS || '300000'), // 5 minutes
    maxResponseSizeMB: parseInt(process.env.MAX_RESPONSE_SIZE_MB || '10'),
    connectionTimeoutMs: parseInt(process.env.CONNECTION_TIMEOUT_MS || '30000'),
    idleTimeoutMs: parseInt(process.env.IDLE_TIMEOUT_MS || '60000'),
  };

  // Resource cleanup intervals
  private cleanupInterval: NodeJS.Timeout;
  private metricsInterval: NodeJS.Timeout;

  constructor() {
    super();
    this.startResourceMonitoring();
    this.startPeriodicCleanup();
  }

  // 🟡 HIGH PRIORITY: Resource management and monitoring

  /**
   * Get or create connection pool for a target
   */
  async getConnectionPool(
    hostname: string,
    port: number,
    protocol: 'http:' | 'https:' = 'https:',
  ): Promise<ConnectionPool> {
    const poolId = `${protocol}//${hostname}:${port}`;

    let pool = this.connectionPools.get(poolId);
    if (!pool) {
      pool = {
        id: poolId,
        hostname,
        port,
        protocol,
        connections: new Set(),
        lastUsed: new Date(),
        created: new Date(),
        stats: {
          totalRequests: 0,
          activeRequests: 0,
          errors: 0,
          avgResponseTime: 0,
        },
      };

      this.connectionPools.set(poolId, pool);
      this.logger.log(`Created connection pool: ${poolId}`);
    }

    pool.lastUsed = new Date();
    return pool;
  }

  /**
   * Acquire a connection from the pool
   */
  async acquireConnection(poolId: string): Promise<any> {
    const pool = this.connectionPools.get(poolId);
    if (!pool) {
      throw new Error(`Connection pool not found: ${poolId}`);
    }

    // Check connection limits
    if (
      this.getTotalActiveConnections() >= this.limits.maxConcurrentConnections
    ) {
      throw new Error('Maximum concurrent connections reached');
    }

    // Check memory limits
    const memoryUsage = this.getCurrentMemoryUsage();
    if (memoryUsage > this.limits.maxMemoryUsageMB) {
      throw new Error(
        `Memory limit exceeded: ${memoryUsage}MB > ${this.limits.maxMemoryUsageMB}MB`,
      );
    }

    // Create or reuse connection
    const connection = this.createConnection(pool);
    pool.connections.add(connection);
    pool.stats.activeRequests++;

    this.emit('connectionAcquired', { poolId, connectionId: connection.id });

    return connection;
  }

  /**
   * Release a connection back to the pool
   */
  async releaseConnection(poolId: string, connection: any): Promise<void> {
    const pool = this.connectionPools.get(poolId);
    if (!pool) {
      this.logger.warn(
        `Attempting to release connection to unknown pool: ${poolId}`,
      );
      return;
    }

    if (pool.connections.has(connection)) {
      pool.connections.delete(connection);
      pool.stats.activeRequests--;

      // Cleanup connection resources
      if (connection.destroy) {
        connection.destroy();
      }

      this.emit('connectionReleased', { poolId, connectionId: connection.id });
    }
  }

  /**
   * Create a new connection with proper configuration
   */
  private createConnection(pool: ConnectionPool): any {
    const connectionId = `conn_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // Create connection object with timeout and resource limits
    const connection = {
      id: connectionId,
      pool: pool.id,
      created: new Date(),
      lastUsed: new Date(),
      timeout: this.limits.connectionTimeoutMs,
      maxResponseSize: this.limits.maxResponseSizeMB * 1024 * 1024, // Convert to bytes

      // Resource cleanup methods
      destroy: () => {
        this.logger.debug(`Destroying connection: ${connectionId}`);
        // Connection-specific cleanup would go here
      },

      // Usage tracking
      trackRequest: (responseTimeMs: number, error?: any) => {
        pool.stats.totalRequests++;

        // Update average response time
        const prevAvg = pool.stats.avgResponseTime;
        const count = pool.stats.totalRequests;
        pool.stats.avgResponseTime =
          (prevAvg * (count - 1) + responseTimeMs) / count;

        if (error) {
          pool.stats.errors++;
        }

        connection.lastUsed = new Date();
      },
    };

    return connection;
  }

  /**
   * Execute operation with resource management
   */
  async executeWithResourceLimits<T>(
    operationId: string,
    operation: () => Promise<T>,
    options: {
      timeoutMs?: number;
      maxMemoryMB?: number;
      onProgress?: (progress: number) => void;
    } = {},
  ): Promise<T> {
    const timeoutMs = options.timeoutMs || this.limits.maxExecutionTimeMs;
    const startTime = Date.now();
    const startMemory = this.getCurrentMemoryUsage();

    // Track resource usage
    this.trackResourceUsage(operationId, {
      activeConnections: this.getTotalActiveConnections(),
      memoryUsageMB: startMemory,
      cpuUsagePercent: 0, // Would need CPU monitoring
      executionTimeMs: 0,
      timestamp: new Date(),
    });

    try {
      // Execute with timeout
      const result = await Promise.race([
        operation(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Operation timeout: ${timeoutMs}ms`)),
            timeoutMs,
          ),
        ),
      ]);

      const executionTime = Date.now() - startTime;
      const endMemory = this.getCurrentMemoryUsage();

      // Update resource tracking
      this.updateResourceUsage(operationId, {
        activeConnections: this.getTotalActiveConnections(),
        memoryUsageMB: endMemory,
        cpuUsagePercent: 0,
        executionTimeMs: executionTime,
        timestamp: new Date(),
      });

      this.logger.debug(
        `Operation ${operationId} completed in ${executionTime}ms`,
        {
          memoryDelta: endMemory - startMemory,
          executionTime,
        },
      );

      return result;
    } catch (error) {
      this.logger.error(`Operation ${operationId} failed:`, error);
      throw error;
    } finally {
      // Cleanup resource tracking
      this.activeResources.delete(operationId);
    }
  }

  /**
   * Get current memory usage in MB
   */
  private getCurrentMemoryUsage(): number {
    const memUsage = process.memoryUsage();
    return Math.round(memUsage.heapUsed / 1024 / 1024);
  }

  /**
   * Get total active connections across all pools
   */
  private getTotalActiveConnections(): number {
    let total = 0;
    for (const pool of this.connectionPools.values()) {
      total += pool.connections.size;
    }
    return total;
  }

  /**
   * Track resource usage for an operation
   */
  private trackResourceUsage(operationId: string, usage: ResourceUsage): void {
    this.activeResources.set(operationId, usage);

    // Check limits and emit warnings
    if (usage.memoryUsageMB > this.limits.maxMemoryUsageMB * 0.8) {
      this.emit('resourceWarning', {
        type: 'memory',
        usage: usage.memoryUsageMB,
        limit: this.limits.maxMemoryUsageMB,
        operationId,
      });
    }

    if (usage.activeConnections > this.limits.maxConcurrentConnections * 0.8) {
      this.emit('resourceWarning', {
        type: 'connections',
        usage: usage.activeConnections,
        limit: this.limits.maxConcurrentConnections,
        operationId,
      });
    }
  }

  /**
   * Update resource usage for an operation
   */
  private updateResourceUsage(operationId: string, usage: ResourceUsage): void {
    this.activeResources.set(operationId, usage);
  }

  /**
   * Start resource monitoring
   */
  private startResourceMonitoring(): void {
    this.metricsInterval = setInterval(() => {
      const memoryUsage = this.getCurrentMemoryUsage();
      const activeConnections = this.getTotalActiveConnections();
      const poolCount = this.connectionPools.size;

      this.emit('resourceMetrics', {
        memoryUsageMB: memoryUsage,
        activeConnections,
        poolCount,
        activeOperations: this.activeResources.size,
        timestamp: new Date(),
      });

      // Log warnings if approaching limits
      if (memoryUsage > this.limits.maxMemoryUsageMB * 0.9) {
        this.logger.warn(
          `High memory usage: ${memoryUsage}MB (limit: ${this.limits.maxMemoryUsageMB}MB)`,
        );
      }

      if (activeConnections > this.limits.maxConcurrentConnections * 0.9) {
        this.logger.warn(
          `High connection count: ${activeConnections} (limit: ${this.limits.maxConcurrentConnections})`,
        );
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Start periodic cleanup of unused resources
   */
  private startPeriodicCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleConnections();
      this.cleanupStaleOperations();
    }, 60000); // Every minute
  }

  /**
   * Cleanup idle connections
   */
  private cleanupIdleConnections(): void {
    const now = Date.now();
    const idleThreshold = this.limits.idleTimeoutMs;

    for (const [poolId, pool] of this.connectionPools.entries()) {
      const idleTime = now - pool.lastUsed.getTime();

      if (idleTime > idleThreshold && pool.connections.size === 0) {
        // Remove idle empty pools
        this.connectionPools.delete(poolId);
        this.logger.debug(`Removed idle connection pool: ${poolId}`);
      } else if (pool.connections.size > 0) {
        // Cleanup idle connections within the pool
        const connectionsToRemove: any[] = [];

        for (const connection of pool.connections) {
          const connIdleTime = now - connection.lastUsed.getTime();
          if (connIdleTime > idleThreshold) {
            connectionsToRemove.push(connection);
          }
        }

        for (const connection of connectionsToRemove) {
          pool.connections.delete(connection);
          if (connection.destroy) {
            connection.destroy();
          }
          this.logger.debug(`Cleaned up idle connection: ${connection.id}`);
        }

        if (connectionsToRemove.length > 0) {
          pool.stats.activeRequests = Math.max(
            0,
            pool.stats.activeRequests - connectionsToRemove.length,
          );
        }
      }
    }
  }

  /**
   * Cleanup stale operation tracking
   */
  private cleanupStaleOperations(): void {
    const now = Date.now();
    const staleThreshold = this.limits.maxExecutionTimeMs * 2; // Double the max execution time

    for (const [operationId, usage] of this.activeResources.entries()) {
      const age = now - usage.timestamp.getTime();
      if (age > staleThreshold) {
        this.activeResources.delete(operationId);
        this.logger.warn(`Cleaned up stale operation tracking: ${operationId}`);
      }
    }
  }

  /**
   * Get resource statistics
   */
  getResourceStats(): any {
    const totalConnections = this.getTotalActiveConnections();
    const memoryUsage = this.getCurrentMemoryUsage();

    return {
      limits: this.limits,
      current: {
        memoryUsageMB: memoryUsage,
        activeConnections: totalConnections,
        poolCount: this.connectionPools.size,
        activeOperations: this.activeResources.size,
      },
      pools: Array.from(this.connectionPools.values()).map((pool) => ({
        id: pool.id,
        hostname: pool.hostname,
        port: pool.port,
        protocol: pool.protocol,
        activeConnections: pool.connections.size,
        stats: pool.stats,
        lastUsed: pool.lastUsed,
        created: pool.created,
      })),
      utilization: {
        memoryPercent: (memoryUsage / this.limits.maxMemoryUsageMB) * 100,
        connectionsPercent:
          (totalConnections / this.limits.maxConcurrentConnections) * 100,
      },
      timestamp: new Date(),
    };
  }

  /**
   * Update resource limits
   */
  updateLimits(newLimits: Partial<ResourceLimits>): void {
    this.limits = { ...this.limits, ...newLimits };
    this.logger.log('Updated resource limits:', this.limits);
    this.emit('limitsUpdated', this.limits);
  }

  /**
   * Shutdown and cleanup all resources
   */
  async shutdown(): Promise<void> {
    this.logger.log('Shutting down resource manager...');

    // Clear intervals
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }

    // Cleanup all connections
    for (const pool of this.connectionPools.values()) {
      for (const connection of pool.connections) {
        if (connection.destroy) {
          connection.destroy();
        }
      }
      pool.connections.clear();
    }

    this.connectionPools.clear();
    this.activeResources.clear();

    this.logger.log('Resource manager shutdown complete');
  }
}
