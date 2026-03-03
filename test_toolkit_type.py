#!/usr/bin/env python3
import sys
import asyncio
from pathlib import Path
backend_path = Path(__file__).parent / "backend"
sys.path.insert(0, str(backend_path))

from app.utils.agent import search_agent
from app.model.chat import Chat
from app.service.task import create_task_lock

async def main():
    options = Chat(
        task_id='test',
        project_id='test',
        question='test',
        email='test@test.com',
        model_platform='openai',
        model_type='gpt-4o-mini',
        api_key='test',
        cdp_browsers=[{'port': 9223, 'isExternal': False, 'name': 'Test', 'id': 'test-1'}]
    )

    task_lock = create_task_lock(options.project_id)
    agent = search_agent(options)

    if hasattr(agent, '_browser_toolkit'):
        toolkit = agent._browser_toolkit
        print(f'✅ Has _browser_toolkit')
        print(f'   Type: {type(toolkit)}')
        print(f'   Class name: {toolkit.__class__.__name__}')
        print(f'   Is HybridBrowserToolkit: {toolkit.__class__.__name__ == "HybridBrowserToolkit"}')

        # Check RegisteredAgentToolkit
        from camel.toolkits import RegisteredAgentToolkit
        print(f'   Is RegisteredAgentToolkit: {isinstance(toolkit, RegisteredAgentToolkit)}')
        print(f'   MRO: {[c.__name__ for c in toolkit.__class__.__mro__]}')
    else:
        print('❌ No _browser_toolkit')

if __name__ == '__main__':
    asyncio.run(main())
