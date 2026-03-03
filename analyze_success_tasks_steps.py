#!/usr/bin/env python3
"""
分析每个任务成功时的最短步骤数，以及完成率随步骤数的变化
"""

import json
import os
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

def count_browser_log_steps(log_dir):
    """
    统计browser_logs目录中的有效步数（排除get_tab_info）
    """
    browser_logs_dir = Path(log_dir) / 'browser_logs'
    if not browser_logs_dir.exists():
        return None

    # 查找.log文件
    log_files = list(browser_logs_dir.glob('*.log'))
    if not log_files:
        return None

    # 读取第一个log文件
    log_file = log_files[0]

    try:
        browser_actions = []
        with open(log_file, 'r', encoding='utf-8') as f:
            content = f.read().strip()

            # 尝试整体解析为JSON数组
            if content.startswith('['):
                browser_actions = json.loads(content)
            else:
                # 多个格式化的JSON对象，用 '}\n{' 分隔
                parts = re.split(r'\}\n\{', content)

                for i, part in enumerate(parts):
                    # 添加缺失的大括号
                    if i == 0:
                        json_str = part + '}'
                    elif i == len(parts) - 1:
                        json_str = '{' + part
                    else:
                        json_str = '{' + part + '}'

                    try:
                        obj = json.loads(json_str)
                        browser_actions.append(obj)
                    except json.JSONDecodeError:
                        continue

        # 统计有效步数（排除get_tab_info）
        valid_steps = sum(1 for item in browser_actions
                         if item.get('action') != 'get_tab_info')

        return valid_steps

    except Exception as e:
        print(f"  错误: 读取{log_file}时出错: {e}")
        return None

def analyze_success_tasks_by_steps(eval_file):
    """
    分析成功任务的步数分布
    """
    with open(eval_file, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # 按任务分组（user代表一个任务）
    # 每个user对应一个任务，有不同模型的执行结果
    tasks_by_user = defaultdict(list)

    for result in data['detailed_results']:
        user = result['user']
        tasks_by_user[user].append(result)

    print(f"总共有 {len(tasks_by_user)} 个不同的任务（按user分组）\n")

    # 分析每个任务
    task_analysis = []

    for user, task_results in tasks_by_user.items():
        print(f"分析任务: {user}")

        # 获取所有成功的执行结果及其步数
        success_attempts = []

        for result in task_results:
            if result['success']:
                # 获取browser log步数
                task_dir = result.get('task_dir')
                if task_dir and os.path.exists(task_dir):
                    steps = count_browser_log_steps(task_dir)
                    if steps is not None:
                        success_attempts.append({
                            'model': result['model'],
                            'steps': steps,
                            'task_num': result['task_num']
                        })
                        print(f"  ✓ {result['model']}: {steps} 步")

        # 如果有成功的执行
        if success_attempts:
            min_steps = min(attempt['steps'] for attempt in success_attempts)
            print(f"  最短成功步数: {min_steps}\n")

            task_analysis.append({
                'task_name': user,
                'min_steps': min_steps,
                'success_attempts': success_attempts,
                'total_attempts': len(task_results)
            })
        else:
            print(f"  没有成功的执行\n")

    return task_analysis, tasks_by_user

def analyze_completion_rate_by_steps(task_analysis, tasks_by_user):
    """
    分析完成率随最短步骤数的变化
    """
    # 按模型分组
    model_data = defaultdict(lambda: {
        'tasks_by_min_steps': defaultdict(list),
        'all_tasks': []
    })

    # 为每个任务记录最短步数
    task_min_steps = {}
    for task in task_analysis:
        task_min_steps[task['task_name']] = task['min_steps']

    # 收集每个模型在不同任务上的表现
    for user, task_results in tasks_by_user.items():
        min_steps = task_min_steps.get(user)

        if min_steps is None:
            continue  # 跳过没有成功记录的任务

        for result in task_results:
            model = result['model']
            success = result['success']

            # 获取该模型的实际步数
            task_dir = result.get('task_dir')
            actual_steps = None
            if task_dir and os.path.exists(task_dir):
                actual_steps = count_browser_log_steps(task_dir)

            task_record = {
                'task_name': user,
                'min_steps': min_steps,
                'actual_steps': actual_steps,
                'success': success
            }

            model_data[model]['all_tasks'].append(task_record)
            model_data[model]['tasks_by_min_steps'][min_steps].append(task_record)

    # 计算每个步数阈值的完成率
    print("\n" + "="*80)
    print("完成率随最短步骤数的变化分析")
    print("="*80 + "\n")

    for model in sorted(model_data.keys()):
        print(f"\n【{model}】")

        tasks_by_steps = model_data[model]['tasks_by_min_steps']
        all_tasks = model_data[model]['all_tasks']

        # 按步数排序
        sorted_steps = sorted(tasks_by_steps.keys())

        print(f"\n  按最短成功步数分组的完成率:")
        print(f"  {'最短步数':<12} {'任务数':<8} {'成功数':<8} {'完成率':<10}")
        print(f"  {'-'*40}")

        for steps in sorted_steps:
            tasks = tasks_by_steps[steps]
            success_count = sum(1 for t in tasks if t['success'])
            total = len(tasks)
            rate = (success_count / total * 100) if total > 0 else 0

            print(f"  {steps:<12} {total:<8} {success_count:<8} {rate:>8.2f}%")

        # 累积分析：步数<=X的完成率
        print(f"\n  累积完成率（步数<=阈值的任务）:")
        print(f"  {'步数阈值':<12} {'任务数':<8} {'成功数':<8} {'完成率':<10}")
        print(f"  {'-'*40}")

        for threshold in sorted_steps:
            # 找出所有最短步数<=threshold的任务
            relevant_tasks = [t for t in all_tasks if t['min_steps'] <= threshold]
            if relevant_tasks:
                success_count = sum(1 for t in relevant_tasks if t['success'])
                total = len(relevant_tasks)
                rate = (success_count / total * 100) if total > 0 else 0

                print(f"  <={threshold:<10} {total:<8} {success_count:<8} {rate:>8.2f}%")

    return model_data

def generate_summary_report(task_analysis, model_data):
    """生成总结报告"""
    print("\n" + "="*80)
    print("总结报告")
    print("="*80 + "\n")

    # 1. 最短步数分布
    print("【最短成功步数分布】")
    min_steps_list = [t['min_steps'] for t in task_analysis]
    if min_steps_list:
        print(f"  最小值: {min(min_steps_list)} 步")
        print(f"  最大值: {max(min_steps_list)} 步")
        print(f"  平均值: {sum(min_steps_list)/len(min_steps_list):.2f} 步")
        print(f"  中位数: {sorted(min_steps_list)[len(min_steps_list)//2]} 步")

    # 2. 各模型在不同难度任务上的表现
    print(f"\n【各模型整体完成率】")
    for model in sorted(model_data.keys()):
        all_tasks = model_data[model]['all_tasks']
        if all_tasks:
            success_count = sum(1 for t in all_tasks if t['success'])
            total = len(all_tasks)
            rate = (success_count / total * 100) if total > 0 else 0
            print(f"  {model}: {success_count}/{total} = {rate:.2f}%")

    # 3. 保存详细数据
    output_data = {
        'task_analysis': task_analysis,
        'model_analysis': {
            model: {
                'tasks_by_min_steps': {
                    str(k): v for k, v in data['tasks_by_min_steps'].items()
                },
                'all_tasks': data['all_tasks']
            }
            for model, data in model_data.items()
        }
    }

    output_file = '/Users/puzhen/Desktop/pre/camel_project/eigent/success_tasks_steps_analysis.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)

    print(f"\n详细数据已保存到: {output_file}")

if __name__ == '__main__':
    eval_file = '/Users/puzhen/Desktop/pre/camel_project/eigent/evaluation_matched_results.json'

    print("开始分析成功任务的步数分布...\n")

    task_analysis, tasks_by_user = analyze_success_tasks_by_steps(eval_file)

    model_data = analyze_completion_rate_by_steps(task_analysis, tasks_by_user)

    generate_summary_report(task_analysis, model_data)
