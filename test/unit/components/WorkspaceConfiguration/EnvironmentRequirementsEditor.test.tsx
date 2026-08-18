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

import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { EnvironmentRequirementsEditor } from '@/components/WorkspaceConfiguration/EnvironmentRequirementsEditor';
import type { WorkspaceEnvironmentVariableRequirement } from '@/service/workspaceConfigurationApi';

function Harness({
  initial,
}: {
  initial: WorkspaceEnvironmentVariableRequirement[];
}) {
  const [variables, setVariables] = useState(initial);
  return (
    <>
      <EnvironmentRequirementsEditor
        variables={variables}
        onChange={setVariables}
      />
      <output data-testid="state">{JSON.stringify(variables)}</output>
    </>
  );
}

describe('EnvironmentRequirementsEditor', () => {
  it('removes a shareable example when a requirement becomes sensitive', () => {
    render(
      <Harness
        initial={[
          {
            name: 'DEPLOY_ENV',
            required: true,
            sensitive: false,
            description: 'Deployment environment',
            example: 'staging',
          },
        ]}
      />
    );

    expect(screen.getByDisplayValue('staging')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('switch', { name: 'Sensitive DEPLOY_ENV' })
    );

    expect(screen.queryByDisplayValue('staging')).toBeNull();
    expect(screen.getByTestId('state')).toHaveTextContent('"sensitive":true');
    expect(screen.getByTestId('state')).not.toHaveTextContent('"example"');
    expect(
      screen.getByText(
        'The recipient will provide this value locally during setup.'
      )
    ).toBeInTheDocument();
  });

  it('adds sensitive requirements by default without a value field', () => {
    render(<Harness initial={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByDisplayValue('ENV_VAR_1')).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: 'Required ENV_VAR_1' })
    ).toBeChecked();
    expect(
      screen.getByRole('switch', { name: 'Sensitive ENV_VAR_1' })
    ).toBeChecked();
    expect(screen.queryByText('Safe example')).toBeNull();
  });

  it('flags invalid and duplicate portable names before autosave', () => {
    render(
      <Harness
        initial={[
          { name: 'DUPLICATE', required: true, sensitive: true },
          { name: 'DUPLICATE', required: false, sensitive: true },
        ]}
      />
    );

    expect(screen.getAllByText('Variable names must be unique.')).toHaveLength(
      2
    );
    fireEvent.change(screen.getAllByDisplayValue('DUPLICATE')[1], {
      target: { value: 'not portable' },
    });
    expect(
      screen.getByText(
        'Use a portable environment variable name such as API_TOKEN.'
      )
    ).toBeInTheDocument();
  });
});
