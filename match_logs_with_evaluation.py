#!/usr/bin/env python3
"""
将action.log中的评估结果与extracted_browser_logs中的camel_logs对应起来
通过查找extracted_browser_logs中的camel_logs目录来精确匹配
"""

import os
import re
import json
import subprocess
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

def parse_action_log(log_file):
    """
    解析action.log文件，提取每个任务的评估结果

    返回: list of dict，每个dict包含模型名、成功状态和评估细节
    """
    tasks = []

    with open(log_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    i = 1  # 跳过标题行
    while i < len(lines):
        line = lines[i].strip()

        # 检查是否是模型任务开始行
        if '\t' in line:
            parts = line.split('\t')
            if len(parts) >= 2:
                model_name = normalize_model_name(parts[0])
                success = parts[1].strip().lower() == 'true'

                # 提取评估细节
                evaluation_details = []
                i += 1

                # 收集所有评估项
                while i < len(lines):
                    detail_line = lines[i].strip()

                    # 如果遇到下一个任务或空行后的任务，退出
                    if detail_line and '\t' in detail_line and len(detail_line.split('\t')) >= 2:
                        break

                    if detail_line and (detail_line.startswith('•') or detail_line.startswith('◦')):
                        # 判断是成功还是失败
                        is_success = '✓' in detail_line or '√' in detail_line
                        is_failure = 'X' in detail_line or 'x' in detail_line

                        # 清理文本
                        clean_detail = re.sub(r'[•◦✓√Xx]\s*', '', detail_line).strip()

                        if clean_detail:
                            evaluation_details.append({
                                'description': clean_detail,
                                'passed': is_success and not is_failure
                            })

                    i += 1

                # 添加任务记录
                tasks.append({
                    'model': model_name,
                    'success': success,
                    'evaluation_details': evaluation_details,
                    'passed_count': sum(1 for d in evaluation_details if d['passed']),
                    'failed_count': sum(1 for d in evaluation_details if not d['passed']),
                    'total_criteria': len(evaluation_details)
                })

                continue

        i += 1

    return tasks

def get_sorted_zip_files(test_folder):
    """
    获取test_folder中按创建时间排序的zip文件

    返回: list of (timestamp, filepath)
    """
    zip_files = []

    zip_paths = list(Path(test_folder).glob('*.zip'))
    if not zip_paths:
        return []

    # 使用stat命令获取创建时间
    cmd = ['stat', '-f', '%B %N'] + [str(p) for p in zip_paths]
    result = subprocess.run(cmd, capture_output=True, text=True)

    for line in result.stdout.strip().split('\n'):
        if line:
            parts = line.split(' ', 1)
            if len(parts) == 2:
                timestamp = int(parts[0])
                filepath = parts[1]
                zip_files.append((timestamp, filepath))

    # 按时间戳排序
    zip_files.sort(key=lambda x: x[0])

    return zip_files

def find_all_camel_logs(extracted_logs_dir):
    """
    查找所有的camel_logs目录，按用户和任务编号排序

    返回: list of dict，包含用户、任务编号、模型、camel_logs路径等
    """
    camel_logs_list = []

    for user_dir in sorted(Path(extracted_logs_dir).iterdir()):
        if not user_dir.is_dir() or user_dir.name.startswith('.'):
            continue

        for task_dir in sorted(user_dir.iterdir()):
            if not task_dir.is_dir():
                continue

            # 查找camel_logs目录
            camel_logs_dir = task_dir / 'camel_logs'
            if camel_logs_dir.exists() and camel_logs_dir.is_dir():
                # 提取任务编号和模型名
                dir_name = task_dir.name
                parts = dir_name.split('_', 1)
                if len(parts) >= 2:
                    task_num = parts[0]
                    model_name_raw = parts[1]
                    model_name = normalize_model_name(model_name_raw)

                    camel_logs_list.append({
                        'user': user_dir.name,
                        'task_num': task_num,
                        'model': model_name,
                        'model_raw': model_name_raw,
                        'camel_logs_path': str(camel_logs_dir),
                        'task_dir': str(task_dir)
                    })

    return camel_logs_list

def match_action_to_camel_logs(action_tasks, test_folder, extracted_logs_dir):
    """
    将action.log中的任务通过zip文件的创建时间匹配到camel_logs

    逻辑：
    1. test_folder中的zip按创建时间排序
    2. zip文件和action.log的顺序一致
    3. 查找每个zip对应的camel_logs目录
    4. 匹配成功的进行关联
    5. 最后三个claude opus 4.5任务特殊映射到saed目录
    """
    # 获取按时间排序的zip文件
    zip_files = get_sorted_zip_files(test_folder)
    print(f"找到 {len(zip_files)} 个zip文件")

    # 获取所有camel_logs
    camel_logs_list = find_all_camel_logs(extracted_logs_dir)
    print(f"找到 {len(camel_logs_list)} 个camel_logs目录")

    # 为最后三个claude opus 4.5任务准备特殊映射
    special_mappings = []
    for i in [1, 2, 3]:
        special_dir = Path(extracted_logs_dir) / 'saed' / f'claude_opus_4-5_{i}'
        if special_dir.exists():
            camel_logs_dir = special_dir / 'camel_logs'
            if camel_logs_dir.exists():
                special_mappings.append({
                    'user': 'saed',
                    'task_num': f'claude_opus_4-5_{i}',
                    'model': 'claude-opus-4-5',
                    'model_raw': f'claude_opus_4-5_{i}',
                    'camel_logs_path': str(camel_logs_dir),
                    'task_dir': str(special_dir)
                })
                print(f"找到特殊映射: saed/claude_opus_4-5_{i}")

    # 直接按顺序匹配
    matched_results = []
    total_tasks = len(action_tasks)

    for i, action_task in enumerate(action_tasks):
        # 检查是否是最后三个任务且模型为claude-opus-4-5
        is_last_three_opus = (i >= total_tasks - 3) and (action_task['model'] == 'claude-opus-4-5')

        if is_last_three_opus:
            # 使用特殊映射
            special_index = i - (total_tasks - 3)
            if special_index < len(special_mappings):
                camel_log = special_mappings[special_index]
                model_match = True
                print(f"第{i+1}个任务使用特殊映射: saed/claude_opus_4-5_{special_index + 1}")
            else:
                print(f"警告: 第{i+1}个任务缺少特殊映射")
                continue
        else:
            # 使用常规匹配
            if i < len(camel_logs_list):
                camel_log = camel_logs_list[i]
                model_match = action_task['model'] == camel_log['model']
            else:
                print(f"警告: action.log第{i+1}个任务没有对应的camel_logs")
                continue

        matched_results.append({
            'index': i + 1,
            'user': camel_log['user'],
            'task_num': camel_log['task_num'],
            'model': action_task['model'],
            'model_in_dir': camel_log['model'],
            'model_match': model_match,
            'success': action_task['success'],
            'passed_count': action_task['passed_count'],
            'failed_count': action_task['failed_count'],
            'total_criteria': action_task['total_criteria'],
            'evaluation_details': action_task['evaluation_details'],
            'camel_logs_path': camel_log['camel_logs_path'],
            'task_dir': camel_log['task_dir']
        })

        if not model_match and not is_last_three_opus:
            print(f"警告: 第{i+1}个任务模型不匹配: action.log={action_task['model']}, extracted={camel_log['model']}")

    return matched_results

def generate_report(matched_results, output_file):
    """生成分析报告"""

    # 按模型分组统计（使用action.log中的模型名）
    model_stats = defaultdict(lambda: {
        'total_tasks': 0,
        'success_count': 0,
        'failure_count': 0,
        'total_criteria': 0,
        'total_passed': 0,
        'total_failed': 0,
        'tasks': []
    })

    for result in matched_results:
        model = result['model']
        model_stats[model]['total_tasks'] += 1
        model_stats[model]['total_criteria'] += result['total_criteria']
        model_stats[model]['total_passed'] += result['passed_count']
        model_stats[model]['total_failed'] += result['failed_count']

        if result['success']:
            model_stats[model]['success_count'] += 1
        else:
            model_stats[model]['failure_count'] += 1

        model_stats[model]['tasks'].append(result)

    # 打印报告
    print("\n" + "="*80)
    print("任务评估结果分析报告（基于action.log）")
    print("="*80 + "\n")

    print(f"总任务数: {len(matched_results)}")
    print(f"模型匹配成功: {sum(1 for r in matched_results if r.get('model_match', False))} 个")
    print(f"模型不匹配: {sum(1 for r in matched_results if not r.get('model_match', False))} 个\n")

    for model in sorted(model_stats.keys()):
        stats = model_stats[model]
        success_rate = (stats['success_count'] / stats['total_tasks'] * 100) if stats['total_tasks'] > 0 else 0
        criteria_pass_rate = (stats['total_passed'] / stats['total_criteria'] * 100) if stats['total_criteria'] > 0 else 0

        print(f"\n【模型: {model}】")
        print(f"  总任务数: {stats['total_tasks']}")
        print(f"  成功任务: {stats['success_count']}")
        print(f"  失败任务: {stats['failure_count']}")
        print(f"  任务成功率: {success_rate:.2f}%")
        print(f"  总评估标准数: {stats['total_criteria']}")
        print(f"  通过标准数: {stats['total_passed']}")
        print(f"  失败标准数: {stats['total_failed']}")
        print(f"  标准通过率: {criteria_pass_rate:.2f}%")

    # 保存到JSON文件
    output_data = {
        'summary': {
            'total_tasks': len(matched_results),
            'matched_models': sum(1 for r in matched_results if r.get('model_match', False)),
            'mismatched_models': sum(1 for r in matched_results if not r.get('model_match', False))
        },
        'model_statistics': dict(model_stats),
        'detailed_results': matched_results
    }

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)

    print(f"\n详细结果已保存到: {output_file}")

def parse_debug_log(log_file):
    """
    解析debug.log文件（没有标题行，直接从第一行开始）
    """
    tasks = []

    with open(log_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    i = 0  # debug.log没有标题行，从第0行开始
    while i < len(lines):
        line = lines[i].strip()

        # 检查是否是模型任务开始行
        if '\t' in line:
            parts = line.split('\t')
            if len(parts) >= 2:
                model_name = normalize_model_name(parts[0])
                success = parts[1].strip().lower() == 'true'

                # 提取评估细节
                evaluation_details = []
                i += 1

                # 收集所有评估项
                while i < len(lines):
                    detail_line = lines[i].strip()

                    # 如果遇到下一个任务，退出
                    if detail_line and '\t' in detail_line and len(detail_line.split('\t')) >= 2:
                        break

                    if detail_line and (detail_line.startswith('•') or detail_line.startswith('◦')):
                        # 判断是成功还是失败
                        is_success = '✓' in detail_line or '√' in detail_line
                        is_failure = 'X' in detail_line or 'x' in detail_line

                        # 清理文本
                        clean_detail = re.sub(r'[•◦✓√Xx]\s*', '', detail_line).strip()

                        if clean_detail:
                            evaluation_details.append({
                                'description': clean_detail,
                                'passed': is_success and not is_failure
                            })

                    i += 1

                # 添加任务记录
                tasks.append({
                    'model': model_name,
                    'success': success,
                    'evaluation_details': evaluation_details,
                    'passed_count': sum(1 for d in evaluation_details if d['passed']),
                    'failed_count': sum(1 for d in evaluation_details if not d['passed']),
                    'total_criteria': len(evaluation_details)
                })

                continue

        i += 1

    return tasks


def match_debug_log_to_puzhen(debug_log_file, extracted_logs_dir):
    """
    将debug.log映射到puzhen目录下的camel_logs

    映射规则：
    - debug.log的任务顺序对应puzhen目录下的任务编号
    - 唯一失败的任务（第3个，GPT-5.1）映射到06_gpt-5.1
    """
    print("\n开始解析debug.log...")
    debug_tasks = parse_debug_log(debug_log_file)
    print(f"从debug.log中解析出 {len(debug_tasks)} 个任务")

    # 获取puzhen目录下的所有任务
    puzhen_dir = Path(extracted_logs_dir) / 'puzhen'
    puzhen_tasks = []

    for task_dir in sorted(puzhen_dir.iterdir()):
        if task_dir.is_dir():
            camel_logs_dir = task_dir / 'camel_logs'
            if camel_logs_dir.exists():
                dir_name = task_dir.name
                parts = dir_name.split('_', 1)
                if len(parts) >= 2:
                    task_num = parts[0]
                    model_name_raw = parts[1]
                    model_name = normalize_model_name(model_name_raw)

                    puzhen_tasks.append({
                        'task_num': task_num,
                        'model': model_name,
                        'model_raw': model_name_raw,
                        'camel_logs_path': str(camel_logs_dir),
                        'task_dir': str(task_dir)
                    })

    print(f"puzhen目录下找到 {len(puzhen_tasks)} 个任务")

    # 手动映射规则
    # debug.log第3个任务（失败的GPT-5.1）映射到06_gpt-5.1
    manual_mappings = {
        2: '06'  # 索引2是第3个任务，映射到task_num='06'
    }

    matched_results = []

    for i, debug_task in enumerate(debug_tasks):
        # 检查是否有手动映射
        if i in manual_mappings:
            target_task_num = manual_mappings[i]
            puzhen_task = next((t for t in puzhen_tasks if t['task_num'] == target_task_num), None)
            if puzhen_task:
                print(f"debug.log第{i+1}个任务手动映射到 puzhen/{puzhen_task['task_num']}_{puzhen_task['model_raw']}")
            else:
                print(f"警告: 找不到puzhen/任务{target_task_num}")
                continue
        else:
            # 按顺序自动映射
            if i < len(puzhen_tasks):
                puzhen_task = puzhen_tasks[i]
            else:
                print(f"警告: debug.log第{i+1}个任务没有对应的puzhen任务")
                continue

        model_match = debug_task['model'] == puzhen_task['model']

        matched_results.append({
            'index': i + 1,
            'user': 'puzhen',
            'task_num': puzhen_task['task_num'],
            'model': debug_task['model'],
            'model_in_dir': puzhen_task['model'],
            'model_match': model_match,
            'success': debug_task['success'],
            'passed_count': debug_task['passed_count'],
            'failed_count': debug_task['failed_count'],
            'total_criteria': debug_task['total_criteria'],
            'evaluation_details': debug_task['evaluation_details'],
            'camel_logs_path': puzhen_task['camel_logs_path'],
            'task_dir': puzhen_task['task_dir']
        })

        if not model_match:
            print(f"警告: debug.log第{i+1}个任务模型不匹配: debug={debug_task['model']}, puzhen={puzhen_task['model']}")

    return matched_results


if __name__ == '__main__':
    action_log = '/Users/puzhen/Desktop/pre/camel_project/eigent/action.log'
    debug_log = '/Users/puzhen/Desktop/pre/camel_project/eigent/debug.log'
    test_folder = '/Users/puzhen/Downloads/test_folder'
    extracted_logs_dir = '/Users/puzhen/Desktop/extracted_browser_logs'
    output_file = '/Users/puzhen/Desktop/pre/camel_project/eigent/evaluation_matched_results.json'

    print("开始解析action.log...")
    action_tasks = parse_action_log(action_log)
    print(f"从action.log中解析出 {len(action_tasks)} 个任务\n")

    print("开始匹配action.log的camel_logs...")
    action_matched = match_action_to_camel_logs(action_tasks, test_folder, extracted_logs_dir)

    print("\n" + "="*80)
    print("开始处理debug.log...")
    debug_matched = match_debug_log_to_puzhen(debug_log, extracted_logs_dir)

    # 合并两组结果
    all_matched_results = action_matched + debug_matched

    print("\n生成综合分析报告...")
    generate_report(all_matched_results, output_file)
