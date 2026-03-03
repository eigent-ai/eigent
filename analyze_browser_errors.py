#!/usr/bin/env python3
"""
分析browser_log中的error比例
"""

import os
import json
import re
from pathlib import Path
from collections import defaultdict

def normalize_model_name(model_name):
    """统一模型名称"""
    if 'gpt' in model_name.lower() or 'gpt-5' in model_name.lower():
        return 'gpt-5.1'
    elif 'gemini' in model_name.lower():
        return 'gemini-3-pro-preview'
    elif 'opus' in model_name.lower():
        return 'claude-opus-4-5'
    elif 'sonnet' in model_name.lower():
        return 'claude-sonnet-4-5'
    else:
        return model_name.lower()

def analyze_browser_logs_errors(extracted_logs_dir):
    """
    分析所有browser_log中的错误
    """
    model_stats = defaultdict(lambda: {
        'total_tasks': 0,
        'total_actions': 0,
        'total_errors': 0,
        'tasks_with_errors': 0,
        'task_details': []
    })

    base_path = Path(extracted_logs_dir)

    # 遍历所有用户目录
    for user_dir in sorted(base_path.iterdir()):
        if not user_dir.is_dir() or user_dir.name.startswith('.'):
            continue

        print(f"处理用户: {user_dir.name}")

        # 遍历该用户下的所有任务目录
        for task_dir in sorted(user_dir.iterdir()):
            if not task_dir.is_dir():
                continue

            # 提取模型名称
            dir_name = task_dir.name
            parts = dir_name.split('_', 1)
            if len(parts) < 2:
                continue

            task_num = parts[0]
            model_name = normalize_model_name(parts[1])

            # 查找browser_logs目录
            browser_logs_dir = task_dir / 'browser_logs'
            if not browser_logs_dir.exists():
                continue

            # 查找.log文件
            log_files = list(browser_logs_dir.glob('*.log'))
            if not log_files:
                continue

            # 处理每个log文件
            for log_file in log_files:
                try:
                    # 读取并解析JSON Lines格式的日志
                    browser_actions = []
                    with open(log_file, 'r', encoding='utf-8') as f:
                        content = f.read().strip()

                        # 多个格式化的JSON对象，用 '}\n{' 分隔
                        parts_list = re.split(r'\}\n\{', content)

                        for i, part in enumerate(parts_list):
                            # 添加缺失的大括号
                            if i == 0:
                                json_str = part + '}'
                            elif i == len(parts_list) - 1:
                                json_str = '{' + part
                            else:
                                json_str = '{' + part + '}'

                            try:
                                obj = json.loads(json_str)
                                browser_actions.append(obj)
                            except json.JSONDecodeError:
                                continue

                    # 分析错误
                    total_actions = len(browser_actions)
                    error_count = 0
                    error_details = []

                    for action in browser_actions:
                        # 确保action是dict
                        if not isinstance(action, dict):
                            continue

                        # 检查是否有错误
                        # 方式1: outputs.success = false
                        outputs = action.get('outputs', {})

                        # 确保outputs是dict
                        if not isinstance(outputs, dict):
                            continue

                        success = outputs.get('success', True)

                        # 方式2: 检查message中是否包含error
                        message = outputs.get('message', '')

                        # 方式3: 检查是否有error字段
                        error = outputs.get('error', None)

                        is_error = (not success) or error or ('error' in str(message).lower() and 'no error' not in str(message).lower())

                        if is_error:
                            error_count += 1
                            error_details.append({
                                'action': action.get('action', 'unknown'),
                                'timestamp': action.get('timestamp', ''),
                                'message': str(message)[:200],  # 限制长度
                                'success': success
                            })

                    error_rate = (error_count / total_actions * 100) if total_actions > 0 else 0
                    has_errors = error_count > 0

                    # 更新模型统计
                    model_stats[model_name]['total_tasks'] += 1
                    model_stats[model_name]['total_actions'] += total_actions
                    model_stats[model_name]['total_errors'] += error_count
                    if has_errors:
                        model_stats[model_name]['tasks_with_errors'] += 1

                    # 记录任务详情
                    model_stats[model_name]['task_details'].append({
                        'user': user_dir.name,
                        'task': task_num,
                        'total_actions': total_actions,
                        'error_count': error_count,
                        'error_rate': error_rate,
                        'error_details': error_details[:5] if error_details else []  # 只保留前5个错误
                    })

                    if error_count > 0:
                        print(f"  {task_dir.name}: {total_actions}个操作, {error_count}个错误 ({error_rate:.1f}%)")
                    else:
                        print(f"  {task_dir.name}: {total_actions}个操作, 无错误")

                except Exception as e:
                    print(f"  错误: 处理 {log_file} 时出错: {e}")

    return dict(model_stats)

def print_error_analysis(model_stats):
    """打印错误分析报告"""
    print("\n" + "="*80)
    print("Browser Log 错误分析报告")
    print("="*80 + "\n")

    # 按模型名称排序
    sorted_models = sorted(model_stats.items())

    # 打印表头
    print(f"{'模型':<25} {'任务数':<8} {'总操作数':<10} {'错误数':<8} {'错误率':<10} {'有错任务数':<12}")
    print("-" * 80)

    for model_name, stats in sorted_models:
        total_tasks = stats['total_tasks']
        total_actions = stats['total_actions']
        total_errors = stats['total_errors']
        tasks_with_errors = stats['tasks_with_errors']

        error_rate = (total_errors / total_actions * 100) if total_actions > 0 else 0
        task_error_rate = (tasks_with_errors / total_tasks * 100) if total_tasks > 0 else 0

        print(f"{model_name:<25} {total_tasks:<8} {total_actions:<10} {total_errors:<8} "
              f"{error_rate:>8.2f}% {tasks_with_errors:<6} ({task_error_rate:.1f}%)")

    print("\n" + "="*80)
    print("详细统计")
    print("="*80 + "\n")

    for model_name, stats in sorted_models:
        print(f"\n【模型: {model_name}】")
        print(f"  任务数量: {stats['total_tasks']}")
        print(f"  总操作数: {stats['total_actions']}")
        print(f"  总错误数: {stats['total_errors']}")
        print(f"  操作错误率: {(stats['total_errors']/stats['total_actions']*100) if stats['total_actions'] > 0 else 0:.2f}%")
        print(f"  有错误的任务数: {stats['tasks_with_errors']}")
        print(f"  任务错误率: {(stats['tasks_with_errors']/stats['total_tasks']*100) if stats['total_tasks'] > 0 else 0:.2f}%")

        # 计算平均错误率
        if stats['total_tasks'] > 0:
            avg_errors_per_task = stats['total_errors'] / stats['total_tasks']
            print(f"  平均每任务错误数: {avg_errors_per_task:.2f}")

        # 显示错误最多的任务
        tasks_by_errors = sorted(stats['task_details'], key=lambda x: x['error_count'], reverse=True)
        print(f"\n  错误最多的任务 (Top 5):")
        for i, task in enumerate(tasks_by_errors[:5]):
            if task['error_count'] > 0:
                print(f"    {i+1}. {task['user']}/Task{task['task']}: "
                      f"{task['error_count']}个错误 ({task['error_rate']:.1f}%) "
                      f"/ {task['total_actions']}个操作")

def save_error_analysis(model_stats, output_file):
    """保存错误分析到JSON文件"""
    output_data = {
        'models': model_stats,
        'summary': {
            'total_models': len(model_stats),
            'total_tasks': sum(stats['total_tasks'] for stats in model_stats.values()),
            'total_actions': sum(stats['total_actions'] for stats in model_stats.values()),
            'total_errors': sum(stats['total_errors'] for stats in model_stats.values())
        }
    }

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)

    print(f"\n错误分析结果已保存到: {output_file}")

if __name__ == '__main__':
    extracted_logs_dir = '/Users/puzhen/Desktop/extracted_browser_logs'
    output_file = '/Users/puzhen/Desktop/pre/camel_project/eigent/browser_error_analysis.json'

    print("开始分析browser_log中的错误...\n")

    # 执行分析
    model_stats = analyze_browser_logs_errors(extracted_logs_dir)

    # 打印结果
    print_error_analysis(model_stats)

    # 保存到文件
    save_error_analysis(model_stats, output_file)
