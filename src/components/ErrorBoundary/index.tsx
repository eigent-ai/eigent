// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ error, errorInfo });
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    // Log error details for debugging
    console.error('Error Stack:', error.stack);
    console.error('Component Stack:', errorInfo.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      // If a custom fallback is provided, use it
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <div className="bg-ds-bg-neutral-subtle-default p-4 flex h-screen w-full items-center justify-center">
          <div className="max-w-md gap-6 rounded-xl border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default p-8 shadow-lg flex flex-col items-center border border-solid text-center">
            <div className="bg-warning/10 h-16 w-16 flex items-center justify-center rounded-full">
              <AlertTriangle className="text-warning h-8 w-8" />
            </div>
            <div className="gap-2 flex flex-col">
              <h1 className="text-xl font-bold text-ds-text-neutral-default-default">
                Something went wrong
              </h1>
              <p className="text-sm text-ds-text-neutral-muted-default">
                An unexpected error occurred. Please try refreshing the page.
              </p>
            </div>
            {this.state.error && (
              <div className="rounded-lg bg-ds-bg-neutral-strong-default p-4 w-full text-left">
                <p className="mb-2 text-xs font-medium text-ds-text-neutral-muted-default">
                  Error details:
                </p>
                <p className="max-h-32 font-mono text-xs text-ds-text-neutral-default-default overflow-y-auto">
                  {this.state.error.toString()}
                </p>
              </div>
            )}
            <div className="gap-3 flex">
              <Button
                variant="outline"
                size="md"
                onClick={this.handleReset}
                className="gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh Page
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
