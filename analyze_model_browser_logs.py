#!/usr/bin/env python3
"""
分析每个模型的browser_log数据
按模型统计有效步数（排除action为get_tab_info的记录）
"""

import os
import json
from collections import defaultdict
from pathlib import Path

def normalize_model_name(model_name):
    """
    统一模型名称
    """
    # 移除日期后缀
    if model_name.startswith('gpt-5.1'):
        return 'gpt-5.1'
    elif model_name.startswith('claude-opus-4-5'):
        return 'claude-opus-4-5'
    elif model_name.startswith('claude-sonnet-4-5'):
        return 'claude-sonnet-4-5'
    elif 'gemini-3-pro-preview' in model_name or 'gemini-3-pro-preview' in model_name.lower():
        return 'gemini-3-pro-preview'
    else:
        return model_name


def analyze_browser_logs(base_dir):
    """
    分析所有模型的browser_log数据

    Args:
        base_dir: extracted_browser_logs的路径

    Returns:
        dict: 按模型分类的统计数据
    """
    # 用于存储每个模型的数据
    model_stats = defaultdict(lambda: {
        'total_tasks': 0,
        'total_steps': 0,
        'valid_steps': 0,  # 排除get_tab_info后的步数
        'get_tab_info_count': 0,
        'task_details': []
    })

    # 遍历所有用户目录
    base_path = Path(base_dir)
    for user_dir in base_path.iterdir():
        if not user_dir.is_dir() or user_dir.name.startswith('.'):
            continue

        print(f"处理用户: {user_dir.name}")

        # 遍历该用户下的所有任务目录
        for task_dir in user_dir.iterdir():
            if not task_dir.is_dir():
                continue

            # 提取模型名称（格式：01_gpt-5.1）
            dir_name = task_dir.name
            parts = dir_name.split('_', 1)
            if len(parts) < 2:
                continue

            task_num = parts[0]
            model_name = normalize_model_name(parts[1])

            # 查找browser_logs目录
            browser_logs_dir = task_dir / 'browser_logs'
            if not browser_logs_dir.exists():
                print(f"  警告: 未找到 {browser_logs_dir}")
                continue

            # 查找.log文件
            log_files = list(browser_logs_dir.glob('*.log'))
            if not log_files:
                print(f"  警告: 未找到browser log文件 in {browser_logs_dir}")
                continue

            # 处理每个log文件（通常只有一个）
            for log_file in log_files:
                try:
                    # 读取并解析日志文件
                    browser_actions = []
                    with open(log_file, 'r', encoding='utf-8') as f:
                        content = f.read().strip()

                        # 尝试整体解析为JSON数组
                        if content.startswith('['):
                            browser_actions = json.loads(content)
                        else:
                            # 多个格式化的JSON对象，用 '}\n{' 分隔
                            import re
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

                    # 统计步数
                    total_steps = len(browser_actions)
                    valid_steps = sum(1 for item in browser_actions
                                     if item.get('action') != 'get_tab_info')
                    get_tab_info_count = total_steps - valid_steps

                    # 更新模型统计
                    model_stats[model_name]['total_tasks'] += 1
                    model_stats[model_name]['total_steps'] += total_steps
                    model_stats[model_name]['valid_steps'] += valid_steps
                    model_stats[model_name]['get_tab_info_count'] += get_tab_info_count

                    # 记录任务详情
                    model_stats[model_name]['task_details'].append({
                        'user': user_dir.name,
                        'task': task_num,
                        'total_steps': total_steps,
                        'valid_steps': valid_steps,
                        'get_tab_info_count': get_tab_info_count
                    })

                    print(f"  {task_dir.name}: 总步数={total_steps}, 有效步数={valid_steps}")

                except json.JSONDecodeError as e:
                    print(f"  错误: 无法解析 {log_file}: {e}")
                except Exception as e:
                    print(f"  错误: 处理 {log_file} 时出错: {e}")

    return dict(model_stats)


def print_analysis(model_stats):
    """打印分析结果"""
    print("\n" + "="*80)
    print("模型Browser Log分析报告（按模型分类）")
    print("="*80 + "\n")

    # 按模型名称排序
    sorted_models = sorted(model_stats.items())

    for model_name, stats in sorted_models:
        print(f"\n【模型: {model_name}】")
        print(f"  任务数量: {stats['total_tasks']}")
        print(f"  总步数: {stats['total_steps']}")
        print(f"  有效步数（排除get_tab_info）: {stats['valid_steps']}")
        print(f"  get_tab_info次数: {stats['get_tab_info_count']}")

        if stats['total_tasks'] > 0:
            avg_total = stats['total_steps'] / stats['total_tasks']
            avg_valid = stats['valid_steps'] / stats['total_tasks']
            print(f"  平均总步数/任务: {avg_total:.2f}")
            print(f"  平均有效步数/任务: {avg_valid:.2f}")

        # 显示每个任务的详情
        print(f"\n  任务详情:")
        for detail in sorted(stats['task_details'], key=lambda x: (x['user'], x['task'])):
            print(f"    {detail['user']}/Task{detail['task']}: "
                  f"总={detail['total_steps']}, "
                  f"有效={detail['valid_steps']}, "
                  f"get_tab_info={detail['get_tab_info_count']}")

    # 打印汇总统计
    print("\n" + "="*80)
    print("汇总统计")
    print("="*80 + "\n")

    total_tasks = sum(stats['total_tasks'] for stats in model_stats.values())
    total_steps = sum(stats['total_steps'] for stats in model_stats.values())
    total_valid = sum(stats['valid_steps'] for stats in model_stats.values())
    total_get_tab_info = sum(stats['get_tab_info_count'] for stats in model_stats.values())

    print(f"总模型数: {len(model_stats)}")
    print(f"总任务数: {total_tasks}")
    print(f"总步数: {total_steps}")
    print(f"总有效步数: {total_valid}")
    print(f"总get_tab_info次数: {total_get_tab_info}")

    if total_tasks > 0:
        print(f"\n全局平均总步数/任务: {total_steps/total_tasks:.2f}")
        print(f"全局平均有效步数/任务: {total_valid/total_tasks:.2f}")


def save_analysis_to_file(model_stats, output_file):
    """将分析结果保存到JSON文件"""
    output_data = {
        'models': model_stats,
        'summary': {
            'total_models': len(model_stats),
            'total_tasks': sum(stats['total_tasks'] for stats in model_stats.values()),
            'total_steps': sum(stats['total_steps'] for stats in model_stats.values()),
            'total_valid_steps': sum(stats['valid_steps'] for stats in model_stats.values()),
            'total_get_tab_info': sum(stats['get_tab_info_count'] for stats in model_stats.values())
        }
    }

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)

    print(f"\n分析结果已保存到: {output_file}")


if __name__ == '__main__':
    base_dir = '/Users/puzhen/Desktop/extracted_browser_logs'

    print("开始分析browser_log数据...")
    print(f"数据目录: {base_dir}\n")

    # 执行分析
    model_stats = analyze_browser_logs(base_dir)

    # 打印结果
    print_analysis(model_stats)

    # 保存到文件
    output_file = '/Users/puzhen/Desktop/pre/camel_project/eigent/model_browser_log_analysis.json'
    save_analysis_to_file(model_stats, output_file)
