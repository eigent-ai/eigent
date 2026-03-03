#!/usr/bin/env python3
"""
Test to verify message_integration preserves toolkit instance references
"""
import sys
sys.path.insert(0, 'backend')

from app.utils.toolkit.terminal_toolkit import TerminalToolkit
from camel.toolkits.message_integration import ToolkitMessageIntegration
from camel.toolkits import FunctionTool

# Create toolkit instance
terminal_toolkit = TerminalToolkit(
    api_task_id="test-task-123",
    agent_name="test_agent",
    safe_mode=True,
    clone_current_env=False
)

print("=" * 80)
print("Testing message_integration structure preservation")
print("=" * 80)

# Check original method
print("\n1. Original method (before message_integration):")
print(f"   Method: {terminal_toolkit.shell_exec}")
print(f"   Has __self__: {hasattr(terminal_toolkit.shell_exec, '__self__')}")
if hasattr(terminal_toolkit.shell_exec, '__self__'):
    print(f"   __self__ type: {type(terminal_toolkit.shell_exec.__self__)}")
    print(f"   __self__ has toolkit_name: {hasattr(terminal_toolkit.shell_exec.__self__, 'toolkit_name')}")
    if hasattr(terminal_toolkit.shell_exec.__self__, 'toolkit_name'):
        print(f"   toolkit_name(): {terminal_toolkit.shell_exec.__self__.toolkit_name()}")

# Register with message_integration
message_integration = ToolkitMessageIntegration()
enhanced_tools = message_integration.register_functions([terminal_toolkit.shell_exec])

print("\n2. After message_integration.register_functions:")
print(f"   Number of tools: {len(enhanced_tools)}")
print(f"   Tool type: {type(enhanced_tools[0])}")
print(f"   Tool is FunctionTool: {isinstance(enhanced_tools[0], FunctionTool)}")

tool = enhanced_tools[0]
print(f"\n3. Checking FunctionTool structure:")
print(f"   tool.func type: {type(tool.func)}")
print(f"   tool.func has __self__: {hasattr(tool.func, '__self__')}")

if hasattr(tool.func, '__self__'):
    print(f"   tool.func.__self__ type: {type(tool.func.__self__)}")
    print(f"   tool.func.__self__ is TerminalToolkit: {isinstance(tool.func.__self__, TerminalToolkit)}")

    toolkit_instance = tool.func.__self__
    print(f"\n4. Toolkit instance attributes:")
    print(f"   Has toolkit_name attr: {hasattr(toolkit_instance, 'toolkit_name')}")
    print(f"   toolkit_name is callable: {callable(getattr(toolkit_instance, 'toolkit_name', None))}")

    if hasattr(toolkit_instance, 'toolkit_name') and callable(toolkit_instance.toolkit_name):
        print(f"   toolkit_name() result: {toolkit_instance.toolkit_name()}")

# Check for __toolkit_instance__ attribute (alternative storage)
print(f"\n5. Alternative storage check:")
print(f"   tool.func has __toolkit_instance__: {hasattr(tool.func, '__toolkit_instance__')}")
if hasattr(tool.func, '__toolkit_instance__'):
    print(f"   __toolkit_instance__ type: {type(tool.func.__toolkit_instance__)}")

# Check enhanced flag
print(f"\n6. Enhancement flag:")
print(f"   tool.func has __message_integration_enhanced__: {hasattr(tool.func, '__message_integration_enhanced__')}")
if hasattr(tool.func, '__message_integration_enhanced__'):
    print(f"   __message_integration_enhanced__: {tool.func.__message_integration_enhanced__}")

# Simulate the extraction logic from agent.py
print("\n" + "=" * 80)
print("Simulating toolkit name extraction from agent.py")
print("=" * 80)

toolkit_name = None

# Method 1: Check _toolkit_name attribute
if hasattr(tool, "_toolkit_name"):
    toolkit_name = tool._toolkit_name
    print("✓ Method 1 succeeded: _toolkit_name attribute")
else:
    print("✗ Method 1 failed: no _toolkit_name attribute")

# Method 2: For MCP tools, check if func has __self__ (the toolkit instance)
if not toolkit_name and hasattr(tool, "func") and hasattr(tool.func, "__self__"):
    toolkit_instance = tool.func.__self__
    if hasattr(toolkit_instance, "toolkit_name") and callable(toolkit_instance.toolkit_name):
        toolkit_name = toolkit_instance.toolkit_name()
        print("✓ Method 2 succeeded: extracted from tool.func.__self__.toolkit_name()")
    else:
        print("✗ Method 2 failed: toolkit_name not callable")
else:
    print("✗ Method 2 failed: tool.func or tool.func.__self__ not found")

# Method 3: Check if tool.func is a bound method with toolkit
if not toolkit_name and hasattr(tool, "func"):
    if hasattr(tool.func, "func") and hasattr(tool.func.func, "__self__"):
        toolkit_instance = tool.func.func.__self__
        if hasattr(toolkit_instance, "toolkit_name") and callable(toolkit_instance.toolkit_name):
            toolkit_name = toolkit_instance.toolkit_name()
            print("✓ Method 3 succeeded: extracted from tool.func.func.__self__.toolkit_name()")
        else:
            print("✗ Method 3 failed: toolkit_name not callable")
    else:
        print("✗ Method 3 failed: tool.func.func or tool.func.func.__self__ not found")

# Default fallback
if not toolkit_name:
    toolkit_name = "mcp_toolkit"
    print("⚠ Using default fallback: mcp_toolkit")

print("\n" + "=" * 80)
print(f"FINAL RESULT: {toolkit_name}")
print("=" * 80)

if toolkit_name == "Terminal Toolkit":
    print("✅ SUCCESS: Correct toolkit name extracted!")
else:
    print(f"❌ FAILURE: Got '{toolkit_name}' instead of 'Terminal Toolkit'")
