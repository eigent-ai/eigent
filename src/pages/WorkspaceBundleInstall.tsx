import { WorkspaceBundleInstallWizard } from '@/components/WorkspaceBundle/WorkspaceBundleInstallWizard';
import { useSearchParams } from 'react-router-dom';

export default function WorkspaceBundleInstall() {
  const [searchParams] = useSearchParams();
  return (
    <main className="h-full overflow-y-auto bg-ds-bg-neutral-muted-default px-6 py-8">
      <WorkspaceBundleInstallWizard
        initialHandle={searchParams.get('handle') || ''}
        initialProposalId={searchParams.get('proposal') || ''}
      />
    </main>
  );
}
