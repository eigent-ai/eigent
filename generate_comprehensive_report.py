#!/usr/bin/env python3
"""
生成综合分析报告：整合成功率、子任务成功率和平均步数
"""

import json
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

def load_evaluation_results(eval_file):
    """加载评估结果"""
    with open(eval_file, 'r', encoding='utf-8') as f:
        return json.load(f)

def load_browser_log_analysis(browser_log_file):
    """加载browser log分析结果"""
    with open(browser_log_file, 'r', encoding='utf-8') as f:
        return json.load(f)

def generate_comprehensive_report(eval_data, browser_data):
    """生成综合报告"""

    # 从评估数据中获取模型统计
    eval_stats = eval_data['model_statistics']

    # 从browser log数据中获取步数统计
    browser_stats = browser_data['models']

    # 整合数据
    comprehensive_stats = {}

    for model in eval_stats.keys():
        eval_model_data = eval_stats[model]

        # 查找对应的browser log数据
        browser_model_data = browser_stats.get(model, None)

        # 计算任务成功率
        total_tasks = eval_model_data['total_tasks']
        success_count = eval_model_data['success_count']
        task_success_rate = (success_count / total_tasks * 100) if total_tasks > 0 else 0

        # 计算子任务（评估标准）成功率
        total_criteria = eval_model_data['total_criteria']
        passed_criteria = eval_model_data['total_passed']
        criteria_success_rate = (passed_criteria / total_criteria * 100) if total_criteria > 0 else 0

        # 获取平均步数
        if browser_model_data:
            avg_total_steps = browser_model_data['total_steps'] / browser_model_data['total_tasks']
            avg_valid_steps = browser_model_data['valid_steps'] / browser_model_data['total_tasks']
        else:
            avg_total_steps = 0
            avg_valid_steps = 0

        comprehensive_stats[model] = {
            'total_tasks': total_tasks,
            'success_count': success_count,
            'failure_count': eval_model_data['failure_count'],
            'task_success_rate': task_success_rate,
            'total_criteria': total_criteria,
            'passed_criteria': passed_criteria,
            'failed_criteria': eval_model_data['total_failed'],
            'criteria_success_rate': criteria_success_rate,
            'avg_total_steps': avg_total_steps,
            'avg_valid_steps': avg_valid_steps,
            'browser_tasks': browser_model_data['total_tasks'] if browser_model_data else 0
        }

    return comprehensive_stats

def print_comprehensive_report(stats):
    """打印综合报告"""
    print("\n" + "="*100)
    print("模型综合性能分析报告")
    print("="*100 + "\n")

    # 按任务成功率排序
    sorted_models = sorted(stats.items(), key=lambda x: x[1]['task_success_rate'], reverse=True)

    # 打印表头
    print(f"{'模型':<25} {'任务成功率':<12} {'子任务成功率':<14} {'平均总步数':<12} {'平均有效步数':<14} {'任务数':<8}")
    print("-" * 100)

    for model, data in sorted_models:
        print(f"{model:<25} {data['task_success_rate']:>10.2f}% {data['criteria_success_rate']:>12.2f}% "
              f"{data['avg_total_steps']:>10.2f} {data['avg_valid_steps']:>12.2f} {data['total_tasks']:>6}")

    print("\n" + "="*100)
    print("详细统计")
    print("="*100 + "\n")

    for model, data in sorted_models:
        print(f"\n【{model}】")
        print(f"  总任务数: {data['total_tasks']}")
        print(f"  成功任务: {data['success_count']}")
        print(f"  失败任务: {data['failure_count']}")
        print(f"  任务成功率: {data['task_success_rate']:.2f}%")
        print(f"  ")
        print(f"  总评估标准数: {data['total_criteria']}")
        print(f"  通过标准数: {data['passed_criteria']}")
        print(f"  失败标准数: {data['failed_criteria']}")
        print(f"  子任务成功率: {data['criteria_success_rate']:.2f}%")
        print(f"  ")
        print(f"  平均总步数: {data['avg_total_steps']:.2f}")
        print(f"  平均有效步数（排除get_tab_info）: {data['avg_valid_steps']:.2f}")

        if data['browser_tasks'] != data['total_tasks']:
            print(f"  注意: browser log中有{data['browser_tasks']}个任务，评估数据中有{data['total_tasks']}个任务")

def save_comprehensive_report(stats, output_file):
    """保存综合报告到JSON"""
    output_data = {
        'summary': {
            'total_models': len(stats),
            'models': stats
        }
    }

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)

    print(f"\n综合报告已保存到: {output_file}")

if __name__ == '__main__':
    eval_file = '/Users/puzhen/Desktop/pre/camel_project/eigent/evaluation_matched_results.json'
    browser_file = '/Users/puzhen/Desktop/pre/camel_project/eigent/model_browser_log_analysis.json'
    output_file = '/Users/puzhen/Desktop/pre/camel_project/eigent/comprehensive_model_report.json'

    print("加载评估结果...")
    eval_data = load_evaluation_results(eval_file)

    print("加载browser log分析...")
    browser_data = load_browser_log_analysis(browser_file)

    print("生成综合报告...\n")
    comprehensive_stats = generate_comprehensive_report(eval_data, browser_data)

    print_comprehensive_report(comprehensive_stats)

    save_comprehensive_report(comprehensive_stats, output_file)
