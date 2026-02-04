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

import animationData from '@/assets/animation/openning_animaiton.json';
import { AnimationJson } from '@/components/AnimationJson';
import { queryClient } from '@/lib/queryClient';
import AppRoutes from '@/routers/index';
import { stackClientApp } from '@/stack/client';
import { StackProvider, StackTheme } from '@stackframe/react';
import { QueryClientProvider } from '@tanstack/react-query';
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { useExecutionSubscription } from './hooks/useExecutionSubscription';
import { useTriggerTaskExecutor } from './hooks/useTriggerTaskExecutor';
import { hasStackKeys } from './lib';
import { useAuthStore } from './store/authStore';

const HAS_STACK_KEYS = hasStackKeys();

function App() {
  const navigate = useNavigate();
  const { setInitState } = useAuthStore();
  const [animationFinished, setAnimationFinished] = useState(false);
  const { isFirstLaunch, token } = useAuthStore();

  // Subscribe to execution events when user is authenticated
  // Note: Removed triggers.length check to prevent reconnection on every trigger update
  const shouldSubscribe = !!token;
  useExecutionSubscription(shouldSubscribe);

  // Execute triggered tasks automatically when WebSocket events are received
  useTriggerTaskExecutor();

  useEffect(() => {
    const handleShareCode = (event: any, share_token: string) => {
      navigate({
        pathname: '/',
        search: `?share_token=${encodeURIComponent(share_token)}`,
      });
    };

    //  listen version update notification
    const handleUpdateNotification = (data: {
      type: string;
      currentVersion: string;
      previousVersion: string;
      reason: string;
    }) => {
      console.log('receive version update notification:', data);

      if (data.type === 'version-update') {
        // handle version update logic
        console.log(
          `version from ${data.previousVersion} to ${data.currentVersion}`
        );
        console.log(`update reason: ${data.reason}`);
        setInitState('carousel');
      }
    };

    window.ipcRenderer?.on('auth-share-token-received', handleShareCode);
    window.electronAPI?.onUpdateNotification(handleUpdateNotification);

    return () => {
      window.ipcRenderer?.off('auth-share-token-received', handleShareCode);
      window.electronAPI?.removeAllListeners('update-notification');
    };
  }, [navigate, setInitState]);

  // render main content
  const renderMainContent = () => {
    if (isFirstLaunch && !animationFinished) {
      return (
        <AnimationJson
          onComplete={() => setAnimationFinished(true)}
          animationData={animationData}
        />
      );
    }
    return <AppRoutes />;
  };

  // render wrapper
  const renderWrapper = (children: React.ReactNode) => {
    if (HAS_STACK_KEYS) {
      return (
        <StackProvider app={stackClientApp}>
          <StackTheme>{children}</StackTheme>
          <Toaster style={{ zIndex: '999999 !important', position: 'fixed' }} />
        </StackProvider>
      );
    }
    return (
      <>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
        <Toaster style={{ zIndex: '999999 !important', position: 'fixed' }} />
      </>
    );
  };

  return renderWrapper(renderMainContent());
}

export default App;
