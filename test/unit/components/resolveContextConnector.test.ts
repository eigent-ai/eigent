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

import {
  resolveContextConnector,
  type ContextConnector,
} from '@/components/Session/SidePanel/sections/buildContextItems';
import { describe, expect, it } from 'vitest';

const notion: ContextConnector = {
  service: 'notion',
  displayName: 'Notion',
};
const slack: ContextConnector = {
  service: 'slack',
  displayName: 'Slack',
};

describe('resolveContextConnector', () => {
  it('matches a provider-prefixed toolkit by name', () => {
    expect(
      resolveContextConnector('NotionMCPToolkit', 'search', '', [notion, slack])
    ).toBe(notion);
  });

  it('matches a provider by method when the toolkit is generic', () => {
    expect(
      resolveContextConnector('MCPToolkit', 'slack_send_message', '', [
        notion,
        slack,
      ])
    ).toBe(slack);
  });

  it('assumes the only connector for a connector gateway call', () => {
    expect(
      resolveContextConnector('ConnectorGateway', 'call', '', [slack])
    ).toBe(slack);
    expect(
      resolveContextConnector('connector_gateway', 'call', '', [slack])
    ).toBe(slack);
  });

  it('stays generic for an unidentified MCP call even with one connector', () => {
    expect(
      resolveContextConnector('MCPToolkit', 'call', '', [slack])
    ).toBeNull();
  });

  it('stays generic when a gateway call cannot pick between connectors', () => {
    expect(
      resolveContextConnector('ConnectorGateway', 'call', '', [notion, slack])
    ).toBeNull();
  });
});
