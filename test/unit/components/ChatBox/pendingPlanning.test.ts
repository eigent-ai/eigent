import { isPlanSplittingPhase } from '@/components/ChatBox/TaskBox/PlanTaskBox/utils';
import { ChatTaskStatus } from '@/types/constants';
import { expect, it } from 'vitest';
it('does not label a persisted request with no execution evidence as task splitting', () => {
  expect(
    isPlanSplittingPhase({
      durableRunStatus: 'pending',
      status: ChatTaskStatus.PENDING,
      messages: [{ role: 'user', content: 'Hello' }],
    })
  ).toBe(false);
});
