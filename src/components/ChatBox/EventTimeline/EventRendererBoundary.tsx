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

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface EventRendererErrorDetails {
  nodeId: string;
  nodeKind: string;
}

type EventRendererErrorHandler = (
  error: Error,
  details: EventRendererErrorDetails,
  errorInfo: ErrorInfo
) => void;

interface EventRendererBoundaryProps {
  children: ReactNode;
  details: EventRendererErrorDetails;
  fallback: ReactNode;
  onError?: EventRendererErrorHandler;
  resetKey: string;
}

interface EventRendererBoundaryState {
  error: Error | null;
}

/** Keeps a broken renderer from taking down the rest of the chat timeline. */
export class EventRendererBoundary extends Component<
  EventRendererBoundaryProps,
  EventRendererBoundaryState
> {
  state: EventRendererBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): EventRendererBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.props.onError?.(error, this.props.details, errorInfo);
  }

  componentDidUpdate(previousProps: EventRendererBoundaryProps) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) return this.props.fallback;
    return this.props.children;
  }
}

export type {
  EventRendererBoundaryProps,
  EventRendererErrorDetails,
  EventRendererErrorHandler,
};
