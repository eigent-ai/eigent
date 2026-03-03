"""
测试 message_integration 的参数移除问题

复现 browser_get_page_snapshot 收到 unexpected keyword argument 'message_title' 的错误
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

import inspect
from typing import Optional

print("=" * 80)
print("测试 message_integration 参数移除逻辑")
print("=" * 80)

# 模拟 _default_extract_params
def mock_default_extract_params(kwargs: dict) -> tuple:
    """模拟默认的参数提取"""
    print(f"\n[DEBUG] extract_params 被调用，kwargs: {list(kwargs.keys())}")

    title = kwargs.pop('message_title', '')
    desc = kwargs.pop('message_description', '')
    attach = kwargs.pop('message_attachment', '')

    print(f"[DEBUG] 提取后的 params: title='{title}', desc='{desc}', attach='{attach}'")
    print(f"[DEBUG] 提取后的 kwargs: {list(kwargs.keys())}")

    return (title, desc, attach)

# 测试场景1：参数存在
print("\n" + "=" * 80)
print("测试场景1：kwargs 中有 message_title 参数")
print("=" * 80)

kwargs1 = {
    'message_title': 'Test Title',
    'message_description': 'Test Description',
    'some_other_param': 'value'
}

print(f"\n调用前的 kwargs: {list(kwargs1.keys())}")
params1 = mock_default_extract_params(kwargs1)
print(f"调用后的 kwargs: {list(kwargs1.keys())}")

if 'message_title' in kwargs1:
    print("❌ 错误：message_title 没有被移除！")
else:
    print("✅ 正确：message_title 已被移除")

# 测试场景2：参数不存在
print("\n" + "=" * 80)
print("测试场景2：kwargs 中没有 message_* 参数")
print("=" * 80)

kwargs2 = {
    'some_other_param': 'value'
}

print(f"\n调用前的 kwargs: {list(kwargs2.keys())}")
params2 = mock_default_extract_params(kwargs2)
print(f"调用后的 kwargs: {list(kwargs2.keys())}")

# 测试场景3：模拟实际的工具调用
print("\n" + "=" * 80)
print("测试场景3：模拟实际的 browser_get_page_snapshot 调用")
print("=" * 80)

# 模拟原始函数
async def browser_get_page_snapshot() -> str:
    """原始函数不接受任何参数"""
    return "snapshot"

# 模拟 wrapper
async def wrapper_with_extract(**kwargs):
    """模拟 message_integration 的 wrapper"""
    print(f"\n[WRAPPER] 收到 kwargs: {list(kwargs.keys())}")

    # 提取参数（会修改 kwargs）
    params = mock_default_extract_params(kwargs)

    print(f"[WRAPPER] 提取后准备调用原函数，kwargs: {list(kwargs.keys())}")

    # 调用原函数
    try:
        result = await browser_get_page_snapshot(**kwargs)
        print(f"[WRAPPER] ✅ 原函数调用成功")
        return result
    except TypeError as e:
        print(f"[WRAPPER] ❌ 原函数调用失败: {e}")
        raise

# 测试调用
import asyncio

async def test_wrapper():
    print("\n情况1：传入 message_title")
    try:
        await wrapper_with_extract(message_title="Test", message_description="Desc")
        print("✅ 成功")
    except Exception as e:
        print(f"❌ 失败: {e}")

    print("\n情况2：不传入 message_*")
    try:
        await wrapper_with_extract()
        print("✅ 成功")
    except Exception as e:
        print(f"❌ 失败: {e}")

asyncio.run(test_wrapper())

# 分析问题
print("\n" + "=" * 80)
print("问题分析")
print("=" * 80)

print("""
如果测试显示：
- ✅ message_title 被正确移除
- ✅ wrapper 调用成功

那么 message_integration 的逻辑是正确的。

但如果实际运行时出现错误，可能的原因：
1. extract_params_callback 没有被正确调用
2. 参数在某个地方被重新添加
3. 有多层 wrapper，其中一层没有移除参数
4. 异步调用的时序问题
""")

print("\n下一步：检查实际代码中的调用链")
print("- 查看 browser_get_page_snapshot 是否被多次包装")
print("- 检查是否有其他 wrapper 也添加了 message_title")
print("- 验证 extract_params_callback 是否真的被调用")
