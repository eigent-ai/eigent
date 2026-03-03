#!/usr/bin/env python3
"""
测试 ContextVar 在同步和异步环境中的传播
"""
import asyncio
import sys
from contextvars import ContextVar

# 定义一个ContextVar
test_var: ContextVar[str] = ContextVar("test_var", default="")


def context_manager(value: str):
    """模拟 set_process_task"""
    from contextlib import contextmanager

    @contextmanager
    def _ctx():
        token = test_var.set(value)
        try:
            yield
        finally:
            test_var.reset(token)

    return _ctx()


def sync_function():
    """同步函数读取ContextVar"""
    value = test_var.get("")
    print(f"[SYNC] Inside sync_function: ContextVar = '{value}'")
    return value


async def async_function():
    """异步函数读取ContextVar"""
    value = test_var.get("")
    print(f"[ASYNC] Inside async_function: ContextVar = '{value}'")
    return value


def decorator_sync(func):
    """装饰器在同步函数调用前读取ContextVar"""
    def wrapper(*args, **kwargs):
        value = test_var.get("")
        print(f"[DECORATOR_SYNC] Before calling {func.__name__}: ContextVar = '{value}'")
        result = func(*args, **kwargs)
        return result
    return wrapper


def decorator_async(func):
    """装饰器在异步函数调用前读取ContextVar"""
    async def wrapper(*args, **kwargs):
        value = test_var.get("")
        print(f"[DECORATOR_ASYNC] Before calling {func.__name__}: ContextVar = '{value}'")
        result = await func(*args, **kwargs)
        return result
    return wrapper


@decorator_sync
def decorated_sync_function():
    """被装饰的同步函数"""
    value = test_var.get("")
    print(f"[DECORATED_SYNC] Inside decorated_sync_function: ContextVar = '{value}'")
    return value


@decorator_async
async def decorated_async_function():
    """被装饰的异步函数"""
    value = test_var.get("")
    print(f"[DECORATED_ASYNC] Inside decorated_async_function: ContextVar = '{value}'")
    return value


def test_sync_propagation():
    """测试同步环境中的传播"""
    print("\n" + "="*60)
    print("TEST 1: 同步环境中的 ContextVar 传播")
    print("="*60)

    print("\n1.1 直接调用同步函数:")
    with context_manager("sync_test_value"):
        print(f"[CONTEXT] Inside context manager: ContextVar = '{test_var.get('')}'")
        sync_function()

    print("\n1.2 调用被装饰的同步函数:")
    with context_manager("decorated_sync_value"):
        print(f"[CONTEXT] Inside context manager: ContextVar = '{test_var.get('')}'")
        decorated_sync_function()


async def test_async_propagation():
    """测试异步环境中的传播"""
    print("\n" + "="*60)
    print("TEST 2: 异步环境中的 ContextVar 传播")
    print("="*60)

    print("\n2.1 直接调用异步函数:")
    with context_manager("async_test_value"):
        print(f"[CONTEXT] Inside context manager: ContextVar = '{test_var.get('')}'")
        await async_function()

    print("\n2.2 调用被装饰的异步函数:")
    with context_manager("decorated_async_value"):
        print(f"[CONTEXT] Inside context manager: ContextVar = '{test_var.get('')}'")
        await decorated_async_function()


def test_mixed_propagation():
    """测试混合环境（同步函数内调用异步函数）"""
    print("\n" + "="*60)
    print("TEST 3: 混合环境中的 ContextVar 传播")
    print("="*60)

    print("\n3.1 同步函数内调用异步函数:")
    with context_manager("mixed_test_value"):
        print(f"[CONTEXT] Inside context manager: ContextVar = '{test_var.get('')}'")
        # 在同步上下文中运行异步函数
        asyncio.run(async_function())


def simulate_agent_tool_call():
    """模拟 Agent 调用工具的实际场景"""
    print("\n" + "="*60)
    print("TEST 4: 模拟 Agent 工具调用场景")
    print("="*60)

    class MockToolkit:
        def __init__(self):
            self.api_task_id = "mock_api_task_id"
            self.agent_name = "mock_agent"

        def toolkit_name(self):
            return "Mock Toolkit"

    @decorator_sync
    def tool_method(self):
        """模拟工具方法"""
        value = test_var.get("")
        print(f"[TOOL] Inside tool_method: ContextVar = '{value}'")
        return f"Tool executed with context: {value}"

    # 模拟 agent.py 中的 _execute_tool
    def execute_tool(tool_func, process_task_id):
        print(f"\n[AGENT] About to execute tool with process_task_id: {process_task_id}")

        # 模拟 agent.py:367
        with context_manager(process_task_id):
            print(f"[AGENT] Inside 'with set_process_task': ContextVar = '{test_var.get('')}'")

            # 调用工具（工具被 @listen_toolkit 装饰）
            toolkit = MockToolkit()
            result = tool_func(toolkit)

            print(f"[AGENT] After tool execution: result = {result}")

        print(f"[AGENT] After 'with' block: ContextVar = '{test_var.get('')}'")

    # 执行测试
    execute_tool(tool_method, "test_process_task_123")


async def simulate_async_agent_tool_call():
    """模拟 Agent 异步调用工具的实际场景"""
    print("\n" + "="*60)
    print("TEST 5: 模拟 Agent 异步工具调用场景")
    print("="*60)

    class MockToolkit:
        def __init__(self):
            self.api_task_id = "mock_api_task_id"
            self.agent_name = "mock_agent"

        def toolkit_name(self):
            return "Mock Toolkit"

    @decorator_async
    async def async_tool_method(self):
        """模拟异步工具方法"""
        value = test_var.get("")
        print(f"[ASYNC_TOOL] Inside async_tool_method: ContextVar = '{value}'")
        return f"Async tool executed with context: {value}"

    # 模拟 agent.py 中的 _aexecute_tool
    async def execute_async_tool(tool_func, process_task_id):
        print(f"\n[ASYNC_AGENT] About to execute async tool with process_task_id: {process_task_id}")

        # 模拟 agent.py:478
        with context_manager(process_task_id):
            print(f"[ASYNC_AGENT] Inside 'with set_process_task': ContextVar = '{test_var.get('')}'")

            # 调用异步工具
            toolkit = MockToolkit()
            result = await tool_func(toolkit)

            print(f"[ASYNC_AGENT] After tool execution: result = {result}")

        print(f"[ASYNC_AGENT] After 'with' block: ContextVar = '{test_var.get('')}'")

    # 执行测试
    await execute_async_tool(async_tool_method, "async_process_task_456")


def main():
    print("\n" + "="*70)
    print(" ContextVar 传播测试套件 ")
    print("="*70)

    # 测试1: 同步传播
    test_sync_propagation()

    # 测试2: 异步传播
    asyncio.run(test_async_propagation())

    # 测试3: 混合传播
    test_mixed_propagation()

    # 测试4: 模拟同步工具调用
    simulate_agent_tool_call()

    # 测试5: 模拟异步工具调用
    asyncio.run(simulate_async_agent_tool_call())

    print("\n" + "="*70)
    print(" 所有测试完成 ")
    print("="*70)
    print("\n如果所有测试都显示了正确的 ContextVar 值，说明传播是正常的")
    print("如果某些测试显示空值，说明该场景下 ContextVar 传播失败")


if __name__ == "__main__":
    main()
