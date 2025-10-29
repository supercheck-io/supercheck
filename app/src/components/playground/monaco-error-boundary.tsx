"use client";

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class MonacoErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[Monaco Error Boundary] Caught error:', error, errorInfo);
    
    this.setState({
      error,
      errorInfo
    });

    // Call custom error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // Log to external monitoring service in production
    if (process.env.NODE_ENV === 'production') {
      // TODO: Integrate with error monitoring service
      console.warn('Production error logging would happen here');
    }
  }

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    });
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback UI
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <div className="flex flex-col items-center justify-center p-8 h-full bg-muted/20 rounded-lg border">
          <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
          
          <div className="max-w-md text-center space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                Editor Error
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                The code editor encountered an unexpected error. This might be due to 
                invalid syntax or a temporary issue.
              </p>
            </div>

            <Alert variant="destructive" className="text-left">
              <AlertDescription className="text-xs">
                {this.state.error?.message || 'Unknown error occurred'}
              </AlertDescription>
            </Alert>

            <div className="flex gap-2 justify-center">
              <Button 
                onClick={this.handleRetry}
                size="sm"
                variant="default"
                className="flex items-center gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Retry
              </Button>
              
              <Button 
                onClick={() => window.location.reload()}
                size="sm"
                variant="outline"
              >
                Reload Page
              </Button>
            </div>

            {process.env.NODE_ENV === 'development' && this.state.errorInfo && (
              <details className="text-left mt-4">
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                  Error Details (Development)
                </summary>
                <pre className="text-xs bg-muted p-2 rounded mt-2 overflow-auto max-h-32">
                  {this.state.errorInfo.componentStack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Hook version for functional components
export const useMonacoErrorBoundary = () => {
  const [error, setError] = React.useState<Error | null>(null);
  const [errorInfo, setErrorInfo] = React.useState<ErrorInfo | null>(null);

  const resetError = React.useCallback(() => {
    setError(null);
    setErrorInfo(null);
  }, []);

  const captureError = React.useCallback((error: Error, info: ErrorInfo) => {
    console.error('[Monaco Error Hook] Captured error:', error, info);
    setError(error);
    setErrorInfo(info);
  }, []);

  return {
    error,
    errorInfo,
    hasError: !!error,
    resetError,
    captureError
  };
};