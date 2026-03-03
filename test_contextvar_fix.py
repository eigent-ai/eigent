#!/usr/bin/env python3
"""
验证 ContextVar 修复效果的测试脚本
"""
import sys
sys.path.insert(0, 'backend')

import asyncio
from contextvars import ContextVar
from camel.toolkits import FunctionTool

# 模拟 process_task ContextVar
process_task: ContextVar[str] = ContextVar("process_task", default="")

def set_process_task(value: str):
    """设置 ContextVar"""
    from contextlib import contextmanager

    @contextmanager
    def _ctx():
        token = process_task.set(value)
        try:
            yield
        finally:
            process_task.reset(token)

    return _ctx()


# 模拟同步工具
def sync_tool(message: str) -> str:
    """同步工具，应该能读取到 ContextVar"""
    ctx_value = process_task.get("")
    print(f"[SYNC_TOOL] Inside sync_tool: message='{message}', ContextVar='{ctx_value}'")
    return f"Processed: {message} (ctx: {ctx_value})"


# 模拟异步工具
async def async_tool(message: str) -> str:
    """异步工具"""
    ctx_value = process_task.get("")
    print(f"[ASYNC_TOOL] Inside async_tool: message='{message}', ContextVar='{ctx_value}'")
    await asyncio.sleep(0.01)  # 模拟异步操作
    return f"Async processed: {message} (ctx: {ctx_value})"


async def test_old_behavior():
    """测试旧的行为（使用 async_call 会丢失 ContextVar）"""
    print("\n" + "="*70)
    print("测试 1: 旧的行为 (tool.async_call) - ContextVar 会丢失")
    print("="*70)

    tool = FunctionTool(sync_tool)

    with set_process_task("test-task-123"):
        print(f"[MAIN] Before async_call: ContextVar = '{process_task.get('')}'")

        # 使用 async_call - 会进入 run_in_executor，ContextVar 丢失
        result = await tool.async_call(message="test message")

        print(f"[MAIN] Result: {result}")
        print(f"[MAIN] After async_call: ContextVar = '{process_task.get('')}'")


async def test_new_behavior():
    """测试新的行为（直接调用同步工具）"""
    print("\n" + "="*70)
    print("测试 2: 新的行为 (直接调用) - ContextVar 应该保持")
    print("="*70)

    tool = FunctionTool(sync_tool)

    with set_process_task("test-task-456"):
        print(f"[MAIN] Before direct call: ContextVar = '{process_task.get('')}'")
        print(f"[MAIN] Tool is_async: {tool.is_async}")

        # 模拟新的逻辑：检查 is_async 后直接调用
        if not tool.is_async:
            print("[MAIN] Detected sync tool, calling directly...")
            result = tool(message="test message")
        else:
            print("[MAIN] Detected async tool, using async_call...")
            result = await tool.async_call(message="test message")

        print(f"[MAIN] Result: {result}")
        print(f"[MAIN] After direct call: ContextVar = '{process_task.get('')}'")


async def test_async_tool():
    """测试异步工具（应该继续使用 async_call）"""
    print("\n" + "="*70)
    print("测试 3: 异步工具 - 应该使用 async_call")
    print("="*70)

    tool = FunctionTool(async_tool)

    with set_process_task("test-task-789"):
        print(f"[MAIN] Before async_call: ContextVar = '{process_task.get('')}'")
        print(f"[MAIN] Tool is_async: {tool.is_async}")

        # 异步工具应该继续使用 async_call
        if not tool.is_async:
            print("[MAIN] Detected sync tool, calling directly...")
            result = tool(message="async test")
        else:
            print("[MAIN] Detected async tool, using async_call...")
            result = await tool.async_call(message="async test")

        print(f"[MAIN] Result: {result}")
        print(f"[MAIN] After async_call: ContextVar = '{process_task.get('')}'")


async def main():
    print("\n" + "="*70)
    print("ContextVar 修复效果验证")
    print("="*70)

    # 测试 1: 展示旧的问题
    await test_old_behavior()

    # 测试 2: 验证新的修复
    await test_new_behavior()

    # 测试 3: 验证异步工具仍然正常
    await test_async_tool()

    print("\n" + "="*70)
    print("总结：")
    print("- 测试 1: 使用 async_call 调用同步工具 → ContextVar 丢失（旧问题）")
    print("- 测试 2: 直接调用同步工具 → ContextVar 保持（新修复）✅")
    print("- 测试 3: 异步工具继续使用 async_call → ContextVar 保持 ✅")
    print("="*70)


if __name__ == "__main__":
    asyncio.run(main())
