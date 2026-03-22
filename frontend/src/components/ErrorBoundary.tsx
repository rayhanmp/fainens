import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { Button } from './ui/Button';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: { componentStack: string } | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: { componentStack: string }) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({ error, errorInfo });

    // Could send to error reporting service here
    // e.g., Sentry, LogRocket, etc.
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--color-background)]">
          <div className="max-w-lg w-full">
            <div className="border-4 border-[var(--color-border)] bg-white p-8 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
              {/* Icon */}
              <div className="flex justify-center mb-6">
                <div className="w-20 h-20 bg-[var(--color-danger)]/20 border-4 border-[var(--color-danger)] flex items-center justify-center">
                  <AlertTriangle className="w-10 h-10 text-[var(--color-danger)]" />
                </div>
              </div>

              {/* Title */}
              <h1 className="font-mono text-2xl font-bold text-center mb-4">
                Something Went Wrong
              </h1>

              {/* Error Message */}
              <p className="text-[var(--color-text-secondary)] text-center mb-6">
                The app encountered an unexpected error. Don't worry, your data is safe.
              </p>

              {/* Error Details (collapsible) */}
              {this.state.error && (
                <div className="mb-6">
                  <details className="border-2 border-[var(--color-border)]">
                    <summary className="p-3 bg-gray-50 cursor-pointer font-mono text-sm">
                      Error Details (for developers)
                    </summary>
                    <div className="p-3 bg-gray-100 text-xs font-mono overflow-auto max-h-40">
                      <p className="text-[var(--color-danger)] font-bold mb-2">
                        {this.state.error.name}: {this.state.error.message}
                      </p>
                      {this.state.errorInfo && (
                        <pre className="whitespace-pre-wrap">
                          {this.state.errorInfo.componentStack}
                        </pre>
                      )}
                    </div>
                  </details>
                </div>
              )}

              {/* Actions */}
              <div className="space-y-3">
                <Button onClick={this.handleReload} className="w-full">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Reload Page
                </Button>
                <Button variant="secondary" onClick={this.handleGoHome} className="w-full">
                  <Home className="w-4 h-4 mr-2" />
                  Go to Dashboard
                </Button>
              </div>

              {/* Footer */}
              <p className="text-xs text-[var(--color-muted)] text-center mt-6">
                If this error persists, please check the console for details or restart the app.
              </p>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
