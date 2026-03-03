#!/usr/bin/env python3
"""
测试 Terminal Toolkit 的 shell_exec 方法是否被正确装饰，能够记录日志
"""
import sys
sys.path.insert(0, '/Users/puzhen/Desktop/pre/camel_project/eigent/backend')

from app.utils.toolkit.terminal_toolkit import TerminalToolkit
import inspect

# 检查 TerminalToolkit 的 shell_exec 方法
print("=" * 80)
print("检查 TerminalToolkit.shell_exec 方法")
print("=" * 80)
print()

# 获取 shell_exec 方法
shell_exec_method = getattr(TerminalToolkit, 'shell_exec', None)

if shell_exec_method is None:
    print("❌ shell_exec 方法不存在！")
    sys.exit(1)

print(f"✅ shell_exec 方法存在")
print(f"   类型: {type(shell_exec_method)}")
print(f"   名称: {shell_exec_method.__name__}")

# 检查是否有 __wrapped__ 属性（被装饰器包装的标志）
if hasattr(shell_exec_method, '__wrapped__'):
    print(f"✅ 方法已被装饰器包装（有 __wrapped__ 属性）")
    print(f"   原始方法: {shell_exec_method.__wrapped__}")
else:
    print(f"⚠️  方法没有 __wrapped__ 属性")

# 检查是否是协程函数
if inspect.iscoroutinefunction(shell_exec_method):
    print(f"   方法类型: async 方法")
else:
    print(f"   方法类型: sync 方法")

# 检查方法的源代码来判断是否被装饰
print()
print("方法签名:")
print(f"   {inspect.signature(shell_exec_method)}")

# 检查闭包变量（装饰器通常会创建闭包）
if hasattr(shell_exec_method, '__code__'):
    co_freevars = shell_exec_method.__code__.co_freevars
    if co_freevars:
        print(f"✅ 方法有闭包变量: {co_freevars}")
        if 'toolkit' in co_freevars:
            print(f"   ✅ 包含 'toolkit' 变量，可能已被 @listen_toolkit 装饰")
    else:
        print(f"   ⚠️  方法没有闭包变量")

print()
print("=" * 80)
print("检查其他重写的方法")
print("=" * 80)
print()

# 检查 shutdown 方法（classmethod，不应该被装饰）
shutdown_method = getattr(TerminalToolkit, 'shutdown', None)
if shutdown_method:
    print(f"shutdown 方法:")
    print(f"   类型: {type(shutdown_method)}")
    if isinstance(shutdown_method, classmethod):
        print(f"   ✅ 是 classmethod，不应被装饰")

print()
print("=" * 80)
print("总结")
print("=" * 80)
print()

# 判断是否修复成功
if hasattr(shell_exec_method, '__wrapped__') or (
    hasattr(shell_exec_method, '__code__') and
    'toolkit' in shell_exec_method.__code__.co_freevars
):
    print("✅ Terminal Toolkit 的 shell_exec 方法已被正确装饰！")
    print("   预期：调用 shell_exec 时会记录 TOOLKIT ACTIVATE/DEACTIVATE 日志")
else:
    print("❌ Terminal Toolkit 的 shell_exec 方法可能未被装饰")
    print("   问题：可能不会记录工具调用日志")
