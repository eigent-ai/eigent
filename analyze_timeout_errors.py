#!/usr/bin/env python3
"""
分析camel_logs中的timeout错误
"""

import json
import re
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

def analyze_timeout_errors(extracted_logs_dir):
    """分析所有camel_logs中的timeout错误"""

    timeout_stats = defaultdict(lambda: {
        'total_timeouts': 0,
        'tasks_with_timeout': [],
        'timeout_details': []
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

            # 检查该任务是否有timeout错误
            task_has_timeout = False
            timeout_count = 0

            json_files = list(camel_logs_dir.glob('*.json'))

            for json_file in json_files:
                try:
                    with open(json_file, 'r', encoding='utf-8') as f:
                        data = json.load(f)

                    # 将整个JSON转为字符串搜索
                    json_str = json.dumps(data, ensure_ascii=False)

                    # 查找TimeoutError
                    if 'TimeoutError' in json_str:
                        timeout_count += 1
                        task_has_timeout = True

                        # 提取错误信息
                        timeout_matches = re.findall(
                            r'TimeoutError[:\s]+([^"\\n]+)',
                            json_str
                        )

                        if timeout_matches:
                            for match in timeout_matches:
                                timeout_stats[model_name]['timeout_details'].append({
                                    'user': user_dir.name,
                                    'task_num': task_num,
                                    'error': match.strip()
                                })

                except Exception as e:
                    print(f"  错误读取 {json_file}: {e}")

            if task_has_timeout:
                timeout_stats[model_name]['total_timeouts'] += timeout_count
                timeout_stats[model_name]['tasks_with_timeout'].append({
                    'user': user_dir.name,
                    'task_num': task_num,
                    'timeout_count': timeout_count
                })
                print(f"  {task_dir.name}: 发现 {timeout_count} 个timeout错误")

    return dict(timeout_stats)

def print_timeout_analysis(timeout_stats):
    """打印timeout分析结果"""
    print("\n" + "="*80)
    print("Timeout错误分析")
    print("="*80 + "\n")

    # 按模型名称排序
    sorted_models = sorted(timeout_stats.items())

    for model_name, stats in sorted_models:
        print(f"\n【模型: {model_name}】")
        print(f"  总timeout错误数: {stats['total_timeouts']}")
        print(f"  出现timeout的任务数: {len(stats['tasks_with_timeout'])}")

        if stats['tasks_with_timeout']:
            print(f"\n  任务列表:")
            for task in stats['tasks_with_timeout']:
                print(f"    {task['user']}/Task{task['task_num']}: {task['timeout_count']} 个timeout")

        # 显示前3个错误详情
        if stats['timeout_details']:
            print(f"\n  错误详情示例:")
            for detail in stats['timeout_details'][:3]:
                print(f"    {detail['user']}/Task{detail['task_num']}: {detail['error']}")

    # 打印汇总统计
    print("\n" + "="*80)
    print("汇总统计")
    print("="*80 + "\n")

    total_timeouts = sum(stats['total_timeouts'] for stats in timeout_stats.values())
    total_tasks = sum(len(stats['tasks_with_timeout']) for stats in timeout_stats.values())

    print(f"总模型数: {len(timeout_stats)}")
    print(f"总timeout错误数: {total_timeouts}")
    print(f"出现timeout的任务数: {total_tasks}")

def save_timeout_analysis(timeout_stats, output_file):
    """保存分析结果到JSON文件"""
    output_data = {
        'models': timeout_stats,
        'summary': {
            'total_models': len(timeout_stats),
            'total_timeouts': sum(stats['total_timeouts'] for stats in timeout_stats.values()),
            'total_tasks_with_timeout': sum(len(stats['tasks_with_timeout']) for stats in timeout_stats.values())
        }
    }

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)

    print(f"\n分析结果已保存到: {output_file}")

if __name__ == '__main__':
    extracted_logs_dir = '/Users/puzhen/Desktop/extracted_browser_logs'
    output_file = '/Users/puzhen/Desktop/pre/camel_project/eigent/timeout_error_analysis.json'

    print("开始分析camel_logs中的timeout错误...\n")

    timeout_stats = analyze_timeout_errors(extracted_logs_dir)

    print_timeout_analysis(timeout_stats)

    save_timeout_analysis(timeout_stats, output_file)
