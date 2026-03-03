"""
深度测试：message_integration 双重包装问题

复现场景：
1. toolkit被message_integration包装
2. agent保存了包装后的toolkit引用
3. agent clone时，从包装后的toolkit创建新toolkit
4. 新toolkit再次被包装
5. 导致双重包装，message_title参数无法正确移除
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

import inspect

print("=" * 80)
print("测试 message_integration 双重包装问题")
print("=" * 80)

# 模拟一个简单的toolkit
class MockToolkit:
    def __init__(self, name):
        self.name = name
        self.call_count = 0

    async def browser_get_page_snapshot(self) -> str:
        """原始函数，不接受message_title参数"""
        self.call_count += 1
        return f"snapshot from {self.name}"

    def get_tools(self):
        """返回工具列表"""
        return [self.browser_get_page_snapshot]

# 模拟message_integration的包装
class MockMessageIntegration:
    def register_toolkits(self, toolkit):
        """模拟register_toolkits的包装行为"""
        print(f"\n[MESSAGE_INTEGRATION] 包装 toolkit: {toolkit.name}")

        # 获取toolkit的所有方法
        for attr_name in dir(toolkit):
            if attr_name.startswith('_'):
                continue

            attr = getattr(toolkit, attr_name)
            if callable(attr) and attr_name not in ['get_tools']:
                print(f"  包装方法: {attr_name}")

                # 创建wrapper
                original_func = attr

                async def wrapper(**kwargs):
                    # 提取message参数
                    message_title = kwargs.pop('message_title', '')
                    message_description = kwargs.pop('message_description', '')

                    print(f"    [WRAPPER] 移除参数: message_title='{message_title}'")
                    print(f"    [WRAPPER] 剩余参数: {list(kwargs.keys())}")

                    # 调用原始函数
                    result = await original_func(**kwargs)
                    return result

                # 添加message_title到签名
                orig_sig = inspect.signature(original_func)
                new_params = list(orig_sig.parameters.values()) + [
                    inspect.Parameter('message_title', inspect.Parameter.KEYWORD_ONLY, default=''),
                    inspect.Parameter('message_description', inspect.Parameter.KEYWORD_ONLY, default=''),
                ]
                wrapper.__signature__ = inspect.Signature(new_params)
                wrapper.__name__ = attr_name

                # 保存对原始toolkit的引用
                wrapper.__self__ = toolkit

                # 替换方法
                setattr(toolkit, attr_name, wrapper)

        return toolkit

# 测试场景1：单次包装（正确）
print("\n" + "=" * 80)
print("场景1：单次包装（main分支 - 正确）")
print("=" * 80)

toolkit1 = MockToolkit("toolkit1")
message_integration = MockMessageIntegration()

# 包装一次
wrapped_toolkit1 = message_integration.register_toolkits(toolkit1)

# 调用工具
import asyncio

async def test_single_wrap():
    print("\n测试调用包装后的工具:")
    try:
        result = await wrapped_toolkit1.browser_get_page_snapshot(
            message_title="Test",
            message_description="Desc"
        )
        print(f"✅ 成功: {result}")
    except TypeError as e:
        print(f"❌ 失败: {e}")

asyncio.run(test_single_wrap())

# 测试场景2：双重包装（错误）
print("\n" + "=" * 80)
print("场景2：双重包装（当前分支 - 错误）")
print("=" * 80)

toolkit2 = MockToolkit("toolkit2")

# 第一次包装
wrapped_toolkit2 = message_integration.register_toolkits(toolkit2)

print("\n模拟 agent clone:")
print("clone时会从 wrapped_toolkit2（已包装）创建新toolkit")
print("但实际上我们没有创建新toolkit，而是再次包装同一个toolkit")

# 模拟错误的clone行为：再次包装已包装的toolkit
print("\n再次包装...")
double_wrapped_toolkit2 = message_integration.register_toolkits(wrapped_toolkit2)

# 调用工具
async def test_double_wrap():
    print("\n测试调用双重包装的工具:")
    try:
        result = await double_wrapped_toolkit2.browser_get_page_snapshot(
            message_title="Test",
            message_description="Desc"
        )
        print(f"✅ 成功: {result}")
    except TypeError as e:
        print(f"❌ 失败: {e}")

asyncio.run(test_double_wrap())

# 分析问题
print("\n" + "=" * 80)
print("问题分析")
print("=" * 80)

print("""
Main分支（正确）：
```python
# 1. 保存未包装的引用
web_toolkit_for_agent_registration = web_toolkit_custom  # 原始toolkit

# 2. 包装toolkit
web_toolkit_custom = message_integration.register_toolkits(web_toolkit_custom)

# 3. agent clone时
# 使用未包装的引用创建新toolkit，然后包装
# 结果：单层包装 ✅
```

当前分支（错误）：
```python
# 1. 包装toolkit
web_toolkit_custom = message_integration.register_toolkits(web_toolkit_custom)

# 2. 保存已包装的引用
web_toolkit_for_agent_registration = web_toolkit_custom  # ❌ 已包装！

# 3. agent clone时
# 使用已包装的引用创建新toolkit（实际是包装后的toolkit），再次包装
# 结果：双层包装 ❌
```

双重包装的问题：
1. 外层wrapper移除message_title
2. 调用内层func（也是一个wrapper）
3. 内层wrapper期望移除message_title，但参数已被外层移除
4. 内层wrapper调用原始func时没有移除参数（因为参数不存在）
5. 实际上是外层移除了，但可能有时序问题
6. 或者：外层wrapper的__self__指向内层wrapper，导致引用混乱
""")

print("\n修复方法：")
print("恢复main分支的逻辑：")
print("```python")
print("# 先保存未包装的引用")
print("web_toolkit_for_agent_registration = web_toolkit_custom")
print("")
print("# 再包装toolkit")
print("web_toolkit_custom = message_integration.register_toolkits(web_toolkit_custom)")
print("```")
