import { AgentPluginImportWizard } from '@/components/WorkspaceBundle/AgentPluginImportWizard';
import { useSearchParams } from 'react-router-dom';

export default function AgentPluginImport() {
  const [searchParams] = useSearchParams();
  return (
    <main className="h-full overflow-y-auto bg-ds-bg-neutral-muted-default px-6 py-8">
      <AgentPluginImportWizard
        initialTargetSpaceId={searchParams.get('target_space_id')}
      />
    </main>
  );
}
