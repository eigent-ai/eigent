#!/usr/bin/env python3
"""
检查使用 @auto_listen_toolkit 的 toolkit 中哪些重写了基类的公开方法。
这些重写的方法不会被自动包装，可能导致日志缺失。
"""
import ast
import os
from pathlib import Path

toolkit_dir = Path("/Users/puzhen/Desktop/pre/camel_project/eigent/backend/app/utils/toolkit")

# 从 toolkit_listen.py 中读取 EXCLUDED_METHODS
EXCLUDED_METHODS = {
    'get_tools', 'get_can_use_tools', 'toolkit_name', 'run_mcp_server',
    'model_dump', 'model_dump_json', 'dict', 'json', 'copy', 'update'
}

def extract_methods_from_file(filepath):
    """提取文件中定义的所有公开方法"""
    with open(filepath, 'r', encoding='utf-8') as f:
        try:
            tree = ast.parse(f.read())
        except:
            return []

    methods = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            for item in node.body:
                if isinstance(item, ast.FunctionDef):
                    method_name = item.name
                    # 检查是否是公开方法（不以 _ 开头且不在排除列表中）
                    if not method_name.startswith('_') and method_name not in EXCLUDED_METHODS:
                        # 检查是否有 @listen_toolkit 装饰器（包括带括号的形式）
                        has_listen_decorator = any(
                            (isinstance(dec, ast.Name) and dec.id == 'listen_toolkit') or
                            (isinstance(dec, ast.Attribute) and dec.attr == 'listen_toolkit') or
                            (isinstance(dec, ast.Call) and
                             ((isinstance(dec.func, ast.Name) and dec.func.id == 'listen_toolkit') or
                              (isinstance(dec.func, ast.Attribute) and dec.func.attr == 'listen_toolkit')))
                            for dec in item.decorator_list
                        )
                        methods.append({
                            'name': method_name,
                            'has_decorator': has_listen_decorator,
                            'class': node.name
                        })
    return methods

def check_toolkit(filepath):
    """检查单个 toolkit 文件"""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # 检查是否使用 @auto_listen_toolkit
    if '@auto_listen_toolkit' not in content:
        return None

    methods = extract_methods_from_file(filepath)
    # 过滤掉 __init__ 和其他特殊方法
    public_methods = [m for m in methods if not m['name'].startswith('__')]

    if not public_methods:
        return None

    return {
        'file': filepath.name,
        'methods': public_methods
    }

# 检查所有 toolkit 文件
results = []
for filepath in toolkit_dir.glob("*_toolkit.py"):
    result = check_toolkit(filepath)
    if result:
        results.append(result)

# 输出结果
print("=" * 80)
print("使用 @auto_listen_toolkit 但重写了基类公开方法的 Toolkits")
print("=" * 80)
print()

for result in results:
    print(f"📁 {result['file']}")
    for method in result['methods']:
        decorator_status = "✅ 有 @listen_toolkit" if method['has_decorator'] else "❌ 缺少 @listen_toolkit"
        print(f"   └─ {method['name']}() - {decorator_status}")
    print()

print("=" * 80)
print(f"总计: {len(results)} 个 toolkit 重写了基类方法")
print("=" * 80)
