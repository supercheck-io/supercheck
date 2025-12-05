"use client";

import React, { useEffect, useRef, useCallback } from "react";
import type { editor } from "monaco-editor";

interface PerformanceMetrics {
  loadTime: number;
  renderTime: number;
  typingLatency: number;
  memoryUsage: number;
  errorCount: number;
}

interface PerformanceEntry {
  operation: string;
  startTime: number;
  endTime: number;
  duration: number;
  metadata?: Record<string, any>;
}

export const useMonacoPerformance = (
  editorInstance?: editor.IStandaloneCodeEditor | null
) => {
  const metricsRef = useRef<PerformanceMetrics>({
    loadTime: 0,
    renderTime: 0,
    typingLatency: 0,
    memoryUsage: 0,
    errorCount: 0,
  });

  const performanceLogRef = useRef<PerformanceEntry[]>([]);
  const typingStartTimeRef = useRef<number>(0);

  // Measure operation performance
  const measureOperation = useCallback(
    (
      operation: string,
      fn: () => void | Promise<void>,
      metadata?: Record<string, any>
    ) => {
      const startTime = performance.now();

      const execute = async () => {
        try {
          await fn();
          const endTime = performance.now();
          const duration = endTime - startTime;

          const entry: PerformanceEntry = {
            operation,
            startTime,
            endTime,
            duration,
            metadata,
          };

          performanceLogRef.current.push(entry);

          // Update specific metrics
          switch (operation) {
            case "editor-load":
              metricsRef.current.loadTime = duration;
              break;
            case "editor-render":
              metricsRef.current.renderTime = duration;
              break;
            case "typing":
              metricsRef.current.typingLatency = duration;
              break;
          }

          // Send to monitoring service in production
          if (process.env.NODE_ENV === "production" && duration > 100) {
            // TODO: Send to monitoring service
            console.warn(
              `Slow operation detected: ${operation} took ${duration.toFixed(
                2
              )}ms`
            );
          }
        } catch (error) {
          metricsRef.current.errorCount++;
          console.error(`[Monaco Performance] Error in ${operation}:`, error);
        }
      };

      return execute();
    },
    []
  );

  // Monitor typing performance
  const measureTypingStart = useCallback(() => {
    typingStartTimeRef.current = performance.now();
  }, []);

  const measureTypingEnd = useCallback(() => {
    if (typingStartTimeRef.current > 0) {
      const duration = performance.now() - typingStartTimeRef.current;
      metricsRef.current.typingLatency = duration;
      typingStartTimeRef.current = 0;

      return duration;
    }
    return 0;
  }, []);

  // Get memory usage
  const getMemoryUsage = useCallback(() => {
    if ("memory" in performance) {
      const memory = (performance as any).memory;
      metricsRef.current.memoryUsage = memory.usedJSHeapSize / 1024 / 1024; // MB
      return metricsRef.current.memoryUsage;
    }
    return 0;
  }, []);

  // Get current metrics
  const getMetrics = useCallback(() => {
    return { ...metricsRef.current };
  }, []);

  // Get performance log
  const getPerformanceLog = useCallback(() => {
    return [...performanceLogRef.current];
  }, []);

  // Clear performance log
  const clearPerformanceLog = useCallback(() => {
    performanceLogRef.current = [];
  }, []);

  // Monitor editor performance
  useEffect(() => {
    if (!editorInstance) return;

    let typingTimeout: NodeJS.Timeout;

    const handleContentChange = () => {
      measureTypingStart();

      // Clear existing timeout
      if (typingTimeout) {
        clearTimeout(typingTimeout);
      }

      // Measure typing latency after user stops typing
      typingTimeout = setTimeout(() => {
        measureTypingEnd();
      }, 500);
    };

    const handleLayoutChange = () => {
      measureOperation(
        "editor-layout",
        () => {
          // Layout change operations
        },
        { timestamp: Date.now() }
      );
    };

    // Subscribe to editor events
    const disposables = [
      editorInstance.onDidChangeModelContent(handleContentChange),
      editorInstance.onDidLayoutChange(handleLayoutChange),
    ];

    // Initial memory measurement
    getMemoryUsage();

    // Set up periodic memory monitoring
    const memoryInterval = setInterval(() => {
      getMemoryUsage();
    }, 10000); // Every 10 seconds

    return () => {
      // Cleanup
      disposables.forEach((d) => d.dispose());
      if (typingTimeout) {
        clearTimeout(typingTimeout);
      }
      clearInterval(memoryInterval);
    };
  }, [
    editorInstance,
    measureOperation,
    measureTypingStart,
    measureTypingEnd,
    getMemoryUsage,
  ]);

  // Generate performance recommendations - defined before generatePerformanceReport that uses it
  const generateRecommendations = useCallback(
    (metrics: PerformanceMetrics, avgTypingLatency: number): string[] => {
      const recommendations: string[] = [];

      if (metrics.loadTime > 1000) {
        recommendations.push(
          "Consider lazy loading editor features to improve load time"
        );
      }

      if (metrics.renderTime > 200) {
        recommendations.push(
          "Editor render time is high, consider reducing editor options"
        );
      }

      if (avgTypingLatency > 100) {
        recommendations.push(
          "Typing latency is high, check for expensive operations on content change"
        );
      }

      if (metrics.memoryUsage > 100) {
        recommendations.push(
          "Memory usage is high, consider implementing cleanup strategies"
        );
      }

      if (metrics.errorCount > 0) {
        recommendations.push(
          "Errors detected, review console logs for details"
        );
      }

      if (recommendations.length === 0) {
        recommendations.push("Performance is optimal");
      }

      return recommendations;
    },
    []
  );

  // Performance report generation
  const generatePerformanceReport = useCallback(() => {
    const metrics = getMetrics();
    const log = getPerformanceLog();

    const avgTypingLatency =
      log
        .filter((entry) => entry.operation === "typing")
        .reduce((sum, entry) => sum + entry.duration, 0) /
      Math.max(1, log.filter((entry) => entry.operation === "typing").length);

    const slowOperations = log.filter((entry) => entry.duration > 100);

    return {
      timestamp: new Date().toISOString(),
      metrics,
      summary: {
        totalOperations: log.length,
        averageTypingLatency: avgTypingLatency,
        slowOperationsCount: slowOperations.length,
        errorRate: (metrics.errorCount / Math.max(1, log.length)) * 100,
      },
      slowOperations: slowOperations.slice(0, 10), // Top 10 slow operations
      recommendations: generateRecommendations(metrics, avgTypingLatency),
    };
  }, [getMetrics, getPerformanceLog, generateRecommendations]);

  return {
    measureOperation,
    measureTypingStart,
    measureTypingEnd,
    getMetrics,
    getPerformanceLog,
    clearPerformanceLog,
    generatePerformanceReport,
    getMemoryUsage,
  };
};

// Performance monitoring context for global access
export const MonacoPerformanceContext = React.createContext<{
  metrics: PerformanceMetrics;
  generateReport: () => any;
}>({
  metrics: {
    loadTime: 0,
    renderTime: 0,
    typingLatency: 0,
    memoryUsage: 0,
    errorCount: 0,
  },
  generateReport: () => ({}),
});
