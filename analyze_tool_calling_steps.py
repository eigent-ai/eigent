#!/usr/bin/env python3
"""
按照camel_logs中的tool calling数量统计步数
"""

import json
from pathlib import Path
from collections import defaultdict

def normalize_model_name(model_name):
    """统一模型名称"""
    model_name = model_name.upper().strip()
    if 'GPT' in model_name or 'GPT-5' in model_name:
        return 'gpt-5.1'
    elif 'GEMINI' in model_name or 'GEMINI-3' in model_name:
        return 'gemini-3-pro-preview'
    elif 'CLAUDE OPUS' in model_name or 'OPUS' in model_name:
        return 'claude-opus-4-5'
    elif 'CLAUDE SONNET' in model_name or 'SONNET' in model_name:
        return 'claude-sonnet-4-5'
    else:
        return model_name.lower()

def count_tool_calls_in_json(json_file):
    """统计单个JSON文件中的tool calls数量"""
    try:
        with open(json_file, 'r', encoding='utf-8') as f:
            data = json.load(f)

        # 检查response中的tool_calls
        if 'response' in data and 'choices' in data['response']:
            for choice in data['response']['choices']:
                if 'message' in choice and 'tool_calls' in choice['message']:
                    tool_calls = choice['message']['tool_calls']
                    if tool_calls:
                        return len(tool_calls)

        return 0
    except Exception as e:
        print(f"错误读取 {json_file}: {e}")
        return 0

def analyze_camel_logs(extracted_logs_dir):
    """分析所有camel_logs中的tool calling数量"""

    model_stats = defaultdict(lambda: {
        'total_tasks': 0,
        'total_tool_calls': 0,
        'total_api_calls': 0,
        'task_details': []
    })

    base_path = Path(extracted_logs_dir)

    for user_dir in sorted(base_path.iterdir()):
        if not user_dir.is_dir() or user_dir.name.startswith('.'):
            continue

        print(f"处理用户: {user_dir.name}")

        for task_dir in sorted(user_dir.iterdir()):
            if not task_dir.is_dir():
                continue

            # 提取任务信息
            dir_name = task_dir.name
            parts = dir_name.split('_', 1)
            if len(parts) < 2:
                continue

            task_num = parts[0]
            model_name = normalize_model_name(parts[1])

            # 查找camel_logs目录
            camel_logs_dir = task_dir / 'camel_logs'
            if not camel_logs_dir.exists():
                continue

            # 统计该任务的tool calls
            json_files = list(camel_logs_dir.glob('*.json'))
            total_tool_calls = 0
            api_call_count = len(json_files)

            for json_file in json_files:
                tool_calls = count_tool_calls_in_json(json_file)
                total_tool_calls += tool_calls

            # 更新统计
            model_stats[model_name]['total_tasks'] += 1
            model_stats[model_name]['total_tool_calls'] += total_tool_calls
            model_stats[model_name]['total_api_calls'] += api_call_count

            model_stats[model_name]['task_details'].append({
                'user': user_dir.name,
                'task_num': task_num,
                'tool_calls': total_tool_calls,
                'api_calls': api_call_count
            })

            print(f"  {task_dir.name}: API调用={api_call_count}, Tool调用={total_tool_calls}")

    return dict(model_stats)

def print_analysis(model_stats):
    """打印分析结果"""
    print("\n" + "="*80)
    print("基于Tool Calling的步数分析")
    print("="*80 + "\n")

    # 按模型名称排序
    sorted_models = sorted(model_stats.items())

    for model_name, stats in sorted_models:
        avg_tool_calls = stats['total_tool_calls'] / stats['total_tasks'] if stats['total_tasks'] > 0 else 0
        avg_api_calls = stats['total_api_calls'] / stats['total_tasks'] if stats['total_tasks'] > 0 else 0

        print(f"\n【模型: {model_name}】")
        print(f"  任务数量: {stats['total_tasks']}")
        print(f"  总Tool调用数: {stats['total_tool_calls']}")
        print(f"  总API调用数: {stats['total_api_calls']}")
        print(f"  平均Tool调用/任务: {avg_tool_calls:.2f}")
        print(f"  平均API调用/任务: {avg_api_calls:.2f}")

        # 显示每个任务的详情
        print(f"\n  任务详情:")
        for detail in sorted(stats['task_details'], key=lambda x: (x['user'], x['task_num'])):
            print(f"    {detail['user']}/Task{detail['task_num']}: "
                  f"Tool调用={detail['tool_calls']}, "
                  f"API调用={detail['api_calls']}")

    # 打印汇总统计
    print("\n" + "="*80)
    print("汇总统计")
    print("="*80 + "\n")

    total_tasks = sum(stats['total_tasks'] for stats in model_stats.values())
    total_tool_calls = sum(stats['total_tool_calls'] for stats in model_stats.values())
    total_api_calls = sum(stats['total_api_calls'] for stats in model_stats.values())

    print(f"总模型数: {len(model_stats)}")
    print(f"总任务数: {total_tasks}")
    print(f"总Tool调用数: {total_tool_calls}")
    print(f"总API调用数: {total_api_calls}")

    if total_tasks > 0:
        print(f"\n全局平均Tool调用/任务: {total_tool_calls/total_tasks:.2f}")
        print(f"全局平均API调用/任务: {total_api_calls/total_tasks:.2f}")

def save_analysis_to_file(model_stats, output_file):
    """保存分析结果到JSON文件"""
    output_data = {
        'models': model_stats,
        'summary': {
            'total_models': len(model_stats),
            'total_tasks': sum(stats['total_tasks'] for stats in model_stats.values()),
            'total_tool_calls': sum(stats['total_tool_calls'] for stats in model_stats.values()),
            'total_api_calls': sum(stats['total_api_calls'] for stats in model_stats.values())
        }
    }

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)

    print(f"\n分析结果已保存到: {output_file}")

if __name__ == '__main__':
    extracted_logs_dir = '/Users/puzhen/Desktop/extracted_browser_logs'
    output_file = '/Users/puzhen/Desktop/pre/camel_project/eigent/tool_calling_analysis.json'

    print("开始分析camel_logs中的tool calling数据...\n")

    model_stats = analyze_camel_logs(extracted_logs_dir)

    print_analysis(model_stats)

    save_analysis_to_file(model_stats, output_file)
