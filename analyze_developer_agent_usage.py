#!/usr/bin/env python3
"""
分析每个模型在camel_logs中调用developer agent的情况
"""

import os
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

def check_developer_agent_in_camel_logs(camel_logs_dir):
    """
    检查camel_logs目录中是否有调用developer agent
    搜索特定字符串: "You are a Lead Software Engineer, a master-level coding assistant"

    返回: (是否调用, 调用次数, 包含developer agent的文件列表)
    """
    has_developer_agent = False
    developer_agent_count = 0
    files_with_developer_agent = []

    # 要搜索的字符串
    search_string = "You are a Lead Software Engineer, a master-level coding assistant"

    # 遍历camel_logs目录中的所有JSON文件
    for json_file in Path(camel_logs_dir).glob('*.json'):
        try:
            with open(json_file, 'r', encoding='utf-8') as f:
                content = f.read()

            # 搜索特定字符串
            if search_string in content:
                has_developer_agent = True
                # 计算出现次数
                count = content.count(search_string)
                developer_agent_count += count
                files_with_developer_agent.append({
                    'file': json_file.name,
                    'count': count
                })

        except Exception as e:
            print(f"  错误: 读取 {json_file} 时出错: {e}")

    return has_developer_agent, developer_agent_count, files_with_developer_agent

def analyze_developer_agent_usage(extracted_logs_dir):
    """
    分析所有模型的developer agent使用情况
    """
    model_stats = defaultdict(lambda: {
        'total_tasks': 0,
        'tasks_with_developer_agent': 0,
        'total_developer_agent_calls': 0,
        'task_details': []
    })

    # 遍历所有用户目录
    for user_dir in sorted(Path(extracted_logs_dir).iterdir()):
        if not user_dir.is_dir() or user_dir.name.startswith('.'):
            continue

        print(f"\n处理用户: {user_dir.name}")

        # 遍历该用户下的所有任务目录
        for task_dir in sorted(user_dir.iterdir()):
            if not task_dir.is_dir():
                continue

            # 查找camel_logs目录
            camel_logs_dir = task_dir / 'camel_logs'
            if not camel_logs_dir.exists() or not camel_logs_dir.is_dir():
                continue

            # 提取模型名称
            dir_name = task_dir.name
            parts = dir_name.split('_', 1)
            if len(parts) < 2:
                continue

            task_num = parts[0]
            model_name = normalize_model_name(parts[1])

            # 检查developer agent
            has_dev_agent, dev_agent_count, files_with_dev = check_developer_agent_in_camel_logs(camel_logs_dir)

            # 更新统计
            model_stats[model_name]['total_tasks'] += 1
            model_stats[model_name]['total_developer_agent_calls'] += dev_agent_count

            if has_dev_agent:
                model_stats[model_name]['tasks_with_developer_agent'] += 1
                status = "✓"
            else:
                status = "✗"

            # 记录详情
            model_stats[model_name]['task_details'].append({
                'user': user_dir.name,
                'task_num': task_num,
                'has_developer_agent': has_dev_agent,
                'developer_agent_count': dev_agent_count,
                'files': files_with_dev
            })

            if has_dev_agent:
                print(f"  {status} {task_dir.name}: 发现 {dev_agent_count} 次developer agent调用")
            else:
                print(f"  {status} {task_dir.name}: 未发现developer agent")

    return dict(model_stats)

def print_developer_agent_report(model_stats):
    """打印developer agent使用报告"""
    print("\n" + "="*80)
    print("Developer Agent 使用情况分析报告")
    print("="*80 + "\n")

    # 按模型排序
    sorted_models = sorted(model_stats.items())

    # 打印汇总表
    print(f"{'模型':<30} {'总任务数':<12} {'使用DA任务':<14} {'使用率':<10} {'总调用次数':<12}")
    print("-" * 80)

    for model_name, stats in sorted_models:
        total_tasks = stats['total_tasks']
        tasks_with_da = stats['tasks_with_developer_agent']
        usage_rate = (tasks_with_da / total_tasks * 100) if total_tasks > 0 else 0
        total_calls = stats['total_developer_agent_calls']

        print(f"{model_name:<30} {total_tasks:<12} {tasks_with_da:<14} {usage_rate:>8.2f}% {total_calls:<12}")

    # 打印详细统计
    print("\n" + "="*80)
    print("详细统计")
    print("="*80 + "\n")

    for model_name, stats in sorted_models:
        total_tasks = stats['total_tasks']
        tasks_with_da = stats['tasks_with_developer_agent']
        usage_rate = (tasks_with_da / total_tasks * 100) if total_tasks > 0 else 0

        print(f"\n【模型: {model_name}】")
        print(f"  总任务数: {total_tasks}")
        print(f"  使用Developer Agent的任务数: {tasks_with_da}")
        print(f"  使用率: {usage_rate:.2f}%")
        print(f"  总调用次数: {stats['total_developer_agent_calls']}")

        # 显示使用developer agent的任务
        if tasks_with_da > 0:
            print(f"\n  使用Developer Agent的任务:")
            for detail in stats['task_details']:
                if detail['has_developer_agent']:
                    print(f"    {detail['user']}/Task{detail['task_num']}: {detail['developer_agent_count']} 次调用")
                    for file_info in detail['files']:
                        print(f"      - {file_info['file']}: {file_info['count']} 次")

def save_developer_agent_report(model_stats, output_file):
    """保存报告到JSON"""
    output_data = {
        'summary': {
            'total_models': len(model_stats),
        },
        'model_statistics': model_stats
    }

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)

    print(f"\n详细报告已保存到: {output_file}")

if __name__ == '__main__':
    extracted_logs_dir = '/Users/puzhen/Desktop/extracted_browser_logs'
    output_file = '/Users/puzhen/Desktop/pre/camel_project/eigent/developer_agent_usage_report.json'

    print("开始分析Developer Agent使用情况...")
    print(f"数据目录: {extracted_logs_dir}\n")

    # 执行分析
    model_stats = analyze_developer_agent_usage(extracted_logs_dir)

    # 打印报告
    print_developer_agent_report(model_stats)

    # 保存报告
    save_developer_agent_report(model_stats, output_file)
