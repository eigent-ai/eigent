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
import i18n from '@/i18n';
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
        <div className="flex h-screen w-full items-center justify-center bg-ds-neutral-subtle-default p-4">
          <div className="flex max-w-md flex-col items-center gap-6 rounded-xl border border-x border-y border-solid border-ds-hairline-default-default bg-ds-neutral-default-default p-8 text-center shadow-lg">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-ds-bg-warning-subtle-default">
              <AlertTriangle className="h-8 w-8 text-ds-text-warning-strong-default" />
            </div>
            <div className="flex flex-col gap-2">
              <h1 className="!text-ds-text-section font-bold text-ds-ink-default-default">
                {i18n.t('layout.something-went-wrong', {
                  defaultValue: 'Something went wrong',
                })}
              </h1>
              <p className="!text-ds-text-base text-ds-ink-muted-default">
                {i18n.t('layout.unexpected-error-refresh', {
                  defaultValue:
                    'An unexpected error occurred. Please try refreshing the page.',
                })}
              </p>
            </div>
            {this.state.error && (
              <div className="w-full rounded-lg bg-ds-neutral-strong-default p-4 text-left">
                <p className="mb-2 !text-ds-text-meta font-medium text-ds-ink-muted-default">
                  {i18n.t('layout.error-details', {
                    defaultValue: 'Error details:',
                  })}
                </p>
                <p className="max-h-32 overflow-y-auto font-mono !text-ds-text-meta text-ds-ink-default-default">
                  {this.state.error.toString()}
                </p>
              </div>
            )}
            <div className="flex gap-3">
              <Button
                variant="outline"
                size="md"
                onClick={this.handleReset}
                className="gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                {i18n.t('layout.refresh-page', {
                  defaultValue: 'Refresh Page',
                })}
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
