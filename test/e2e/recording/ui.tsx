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

import '@/api/http';
import ContentHeader from '@/components/Layout/ContentHeader';
import { ThemeProvider } from '@/components/Layout/ThemeProvider';
import { RecordingIndicator } from '@/components/Recording/RecordingIndicator';
import { SessionRecordingControl } from '@/components/Recording/SessionRecordingControl';
import { Button } from '@/components/ui/button';
import { DsText } from '@/components/ui/ds-text';
import { useRecordingStore } from '@/hooks/useRecording';
import { HostProvider } from '@/host';
import '@/i18n';
import type { RecordingState } from '@/service/recordingApi';
import { useAuthStore } from '@/store/authStore';
import '@/style/index.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import { useEffect } from 'react';
import ReactDOM from 'react-dom/client';

const params = new URLSearchParams(location.search);
const state = (params.get('state') ?? 'recording') as RecordingState;
useAuthStore.setState({
  token: null,
  appearanceMode: params.get('theme') === 'dark' ? 'dark' : 'light',
});
const host = {
  electronAPI: null,
  ipcRenderer: null,
  recording: { authorize: async () => null, revoke: async () => {} },
};
function Fixture() {
  useEffect(() => {
    useRecordingStore.setState({
      connected: true,
      account: 'fixture',
      capabilities: {
        available: state !== 'denied',
        reason: null,
        formats: ['video/mp4'],
      },
      recordings: [
        {
          id: 'fixture',
          version: 1,
          project_id: 'session',
          space_id: 'space',
          run_id: 'run',
          attempt_id: null,
          state,
          reason: null,
          created_at: Date.now() / 1000,
          started_at: Date.now() / 1000 - 65,
          ended_at: null,
          clips: [],
        },
      ],
    });
  }, []);
  return (
    <div className="min-h-screen bg-ds-neutral-subtle-default text-ds-ink-default-default">
      <ContentHeader title="Eigent" actions={<RecordingIndicator />} />
      <ContentHeader
        title="Session"
        actions={
          <SessionRecordingControl
            sessionId="session"
            compact={params.has('compact')}
          />
        }
      />
      <div className="flex flex-col gap-ds-stack-section p-ds-panel-inset">
        <DsText as="h1" role="section">
          Recording controls
        </DsText>
        <DsText role="base">
          This fixture renders the production recording controls with injected
          backend state. Media capture is tested separately.
        </DsText>
        <Button variant="secondary" size="sm">
          Another page
        </Button>
      </div>
    </div>
  );
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <HostProvider host={host}>
    <ThemeProvider>
      <Fixture />
    </ThemeProvider>
  </HostProvider>
);
