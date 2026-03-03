#!/usr/bin/env python3
"""
计算每个模型的token总数
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

def extract_tokens_from_camel_logs(extracted_logs_dir):
    """
    从所有camel_logs目录中提取token使用信息

    返回: dict，按模型分类的token统计
    """
    token_stats = defaultdict(lambda: {
        'total_tokens': 0,
        'prompt_tokens': 0,
        'completion_tokens': 0,
        'total_requests': 0,
        'tasks': defaultdict(lambda: {
            'total_tokens': 0,
            'prompt_tokens': 0,
            'completion_tokens': 0,
            'requests': 0
        })
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

            # 提取任务信息
            dir_name = task_dir.name
            parts = dir_name.split('_', 1)
            if len(parts) < 2:
                continue

            task_num = parts[0]
            model_name_raw = parts[1]
            model_name = normalize_model_name(model_name_raw)

            # 查找camel_logs目录
            camel_logs_dir = task_dir / 'camel_logs'
            if not camel_logs_dir.exists():
                continue

            # 处理该目录下的所有JSON文件
            task_total = 0
            task_prompt = 0
            task_completion = 0
            task_requests = 0

            for json_file in camel_logs_dir.glob('*.json'):
                try:
                    with open(json_file, 'r', encoding='utf-8') as f:
                        data = json.load(f)

                    # 提取token使用信息
                    if 'response' in data and 'usage' in data['response']:
                        usage = data['response']['usage']

                        total = usage.get('total_tokens', 0)
                        prompt = usage.get('prompt_tokens', 0)
                        completion = usage.get('completion_tokens', 0)

                        task_total += total
                        task_prompt += prompt
                        task_completion += completion
                        task_requests += 1

                except json.JSONDecodeError:
                    print(f"  警告: 无法解析 {json_file}")
                except Exception as e:
                    print(f"  错误: 处理 {json_file} 时出错: {e}")

            # 更新模型统计
            if task_requests > 0:
                task_key = f"{user_dir.name}/{task_num}"
                token_stats[model_name]['tasks'][task_key]['total_tokens'] = task_total
                token_stats[model_name]['tasks'][task_key]['prompt_tokens'] = task_prompt
                token_stats[model_name]['tasks'][task_key]['completion_tokens'] = task_completion
                token_stats[model_name]['tasks'][task_key]['requests'] = task_requests

                token_stats[model_name]['total_tokens'] += task_total
                token_stats[model_name]['prompt_tokens'] += task_prompt
                token_stats[model_name]['completion_tokens'] += task_completion
                token_stats[model_name]['total_requests'] += task_requests

                print(f"  {task_dir.name}: {task_total:,} tokens ({task_requests} 请求)")

    return dict(token_stats)

def print_token_report(token_stats):
    """打印token使用报告"""
    print("\n" + "="*80)
    print("模型Token使用分析报告")
    print("="*80 + "\n")

    # 按总token数排序
    sorted_models = sorted(token_stats.items(), key=lambda x: x[1]['total_tokens'], reverse=True)

    # 打印表头
    print(f"{'模型':<30} {'总Tokens':<15} {'Prompt':<15} {'Completion':<15} {'请求数':<10}")
    print("-" * 80)

    for model, stats in sorted_models:
        print(f"{model:<30} {stats['total_tokens']:>13,} {stats['prompt_tokens']:>13,} "
              f"{stats['completion_tokens']:>13,} {stats['total_requests']:>8}")

    # 详细统计
    print("\n" + "="*80)
    print("详细统计")
    print("="*80 + "\n")

    for model, stats in sorted_models:
        task_count = len(stats['tasks'])
        avg_tokens_per_task = stats['total_tokens'] / task_count if task_count > 0 else 0
        avg_tokens_per_request = stats['total_tokens'] / stats['total_requests'] if stats['total_requests'] > 0 else 0

        print(f"\n【{model}】")
        print(f"  总Token数: {stats['total_tokens']:,}")
        print(f"  - Prompt Tokens: {stats['prompt_tokens']:,}")
        print(f"  - Completion Tokens: {stats['completion_tokens']:,}")
        print(f"  总请求数: {stats['total_requests']:,}")
        print(f"  任务数: {task_count}")
        print(f"  平均Tokens/任务: {avg_tokens_per_task:,.2f}")
        print(f"  平均Tokens/请求: {avg_tokens_per_request:,.2f}")

def save_token_report(token_stats, output_file):
    """保存token报告到JSON"""
    # 转换defaultdict为普通dict以便JSON序列化
    output_data = {}
    for model, stats in token_stats.items():
        output_data[model] = {
            'total_tokens': stats['total_tokens'],
            'prompt_tokens': stats['prompt_tokens'],
            'completion_tokens': stats['completion_tokens'],
            'total_requests': stats['total_requests'],
            'tasks': dict(stats['tasks'])
        }

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)

    print(f"\nToken统计已保存到: {output_file}")

if __name__ == '__main__':
    extracted_logs_dir = '/Users/puzhen/Desktop/extracted_browser_logs'
    output_file = '/Users/puzhen/Desktop/pre/camel_project/eigent/token_usage_report.json'

    print("开始统计token使用...\n")
    token_stats = extract_tokens_from_camel_logs(extracted_logs_dir)

    print_token_report(token_stats)
    save_token_report(token_stats, output_file)
