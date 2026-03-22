import { useEffect } from 'react';
import { useToast } from './components/ui/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RouterProvider } from '@tanstack/react-router';
import type { Router } from '@tanstack/react-router';

interface AppProps {
  router: Router<any, any, any>;
}

export function App({ router }: AppProps) {
  const { ToastContainer, error } = useToast();

  // Global error handler for API calls
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      console.error('Global error:', event.error);
      error('An unexpected error occurred', event.error?.message);
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('Unhandled promise rejection:', event.reason);
      error('An unexpected error occurred', event.reason?.message || 'Unknown error');
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  return (
    <ErrorBoundary>
      <RouterProvider router={router} />
      <ToastContainer />
    </ErrorBoundary>
  );
}
