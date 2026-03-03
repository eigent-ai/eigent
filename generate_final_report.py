#!/usr/bin/env python3
"""
生成最终综合报告：整合成功率和tool calling步数
"""

import json
from collections import defaultdict

def load_data():
    """加载所有数据"""
    # 读取tool calling分析
    with open('/Users/puzhen/Desktop/pre/camel_project/eigent/tool_calling_analysis.json', 'r') as f:
        tool_data = json.load(f)

    # 读取评估结果
    with open('/Users/puzhen/Desktop/pre/camel_project/eigent/evaluation_matched_results.json', 'r') as f:
        eval_data = json.load(f)

    return tool_data, eval_data

def match_tasks(tool_data, eval_data):
    """匹配tool calling数据和评估数据"""

    # 为每个模型创建任务映射
    task_mapping = {}

    for model in tool_data['models'].keys():
        task_mapping[model] = {
            'tool_tasks': {},  # task_key -> tool_calls
            'eval_tasks': {}   # index -> success
        }

        # 构建tool calling的任务映射 (user/task_num -> tool_calls)
        for task_detail in tool_data['models'][model]['task_details']:
            user = task_detail['user']
            task_num = task_detail['task_num']
            tool_calls = task_detail['tool_calls']
            task_key = f"{user}/{task_num}"
            task_mapping[model]['tool_tasks'][task_key] = tool_calls

    # 添加评估数据 - 使用model_in_dir来匹配实际的camel_logs
    for result in eval_data['detailed_results']:
        # 使用camel_logs目录中的实际模型名称
        model_in_dir = result.get('model_in_dir', result['model'])
        eval_model = result['model']  # action.log中的模型名

        if model_in_dir not in task_mapping:
            continue

        user = result['user']
        task_num = result['task_num']
        success = result['success']
        task_key = f"{user}/{task_num}"

        # 如果这个任务有tool calling数据，记录它到评估模型名下
        if task_key in task_mapping[model_in_dir]['tool_tasks']:
            tool_calls = task_mapping[model_in_dir]['tool_tasks'][task_key]

            # 确保评估模型名也有映射
            if eval_model not in task_mapping:
                task_mapping[eval_model] = {
                    'tool_tasks': {},
                    'eval_tasks': {}
                }

            if success:
                if 'success_tool_calls' not in task_mapping[eval_model]:
                    task_mapping[eval_model]['success_tool_calls'] = []
                task_mapping[eval_model]['success_tool_calls'].append(tool_calls)
            else:
                if 'failure_tool_calls' not in task_mapping[eval_model]:
                    task_mapping[eval_model]['failure_tool_calls'] = []
                task_mapping[eval_model]['failure_tool_calls'].append(tool_calls)

    return task_mapping

def generate_final_report(tool_data, eval_data):
    """生成最终报告"""

    # 匹配任务
    task_mapping = match_tasks(tool_data, eval_data)

    # 只处理有评估数据的模型，排除claude-sonnet-4-5
    models_to_analyze = ['claude-opus-4-5', 'gemini-3-pro-preview', 'gpt-5.1']

    results = []

    for model in models_to_analyze:
        if model not in eval_data['model_statistics']:
            continue

        eval_stats = eval_data['model_statistics'][model]
        tool_stats = tool_data['models'].get(model, {})

        if not tool_stats:
            continue

        # 计算成功率
        total_tasks = eval_stats['total_tasks']
        success_count = eval_stats['success_count']
        task_success_rate = (success_count / total_tasks * 100) if total_tasks > 0 else 0

        total_criteria = eval_stats['total_criteria']
        passed_criteria = eval_stats['total_passed']
        criteria_success_rate = (passed_criteria / total_criteria * 100) if total_criteria > 0 else 0

        # 计算平均步数
        avg_tool_calls = tool_stats['total_tool_calls'] / tool_stats['total_tasks']
        avg_api_calls = tool_stats['total_api_calls'] / tool_stats['total_tasks']

        # 计算成功任务的平均tool calling
        success_tool_calls = task_mapping[model].get('success_tool_calls', [])
        avg_success_tool_calls = sum(success_tool_calls) / len(success_tool_calls) if success_tool_calls else 0

        # 计算失败任务的平均tool calling
        failure_tool_calls = task_mapping[model].get('failure_tool_calls', [])
        avg_failure_tool_calls = sum(failure_tool_calls) / len(failure_tool_calls) if failure_tool_calls else 0

        results.append({
            'model': model,
            'task_success_rate': task_success_rate,
            'criteria_success_rate': criteria_success_rate,
            'avg_tool_calls': avg_tool_calls,
            'avg_api_calls': avg_api_calls,
            'avg_success_tool_calls': avg_success_tool_calls,
            'avg_failure_tool_calls': avg_failure_tool_calls,
            'total_tasks': total_tasks,
            'success_count': success_count,
            'failure_count': eval_stats['failure_count'],
            'success_tool_calls_list': success_tool_calls,
            'failure_tool_calls_list': failure_tool_calls
        })

    return results

def print_report(results):
    """打印报告"""
    print("\n" + "="*120)
    print("模型综合性能分析（基于Tool Calling步数）")
    print("="*120 + "\n")

    # 按任务成功率排序
    results.sort(key=lambda x: x['task_success_rate'], reverse=True)

    # 打印表头
    print(f"{'模型':<25} {'任务成功率':<12} {'子任务成功率':<14} {'平均Tool调用':<14} "
          f"{'成功任务Tool':<14} {'失败任务Tool':<14} {'平均API调用':<12} {'任务数':<8}")
    print("-" * 120)

    for r in results:
        print(f"{r['model']:<25} {r['task_success_rate']:>10.2f}% {r['criteria_success_rate']:>12.2f}% "
              f"{r['avg_tool_calls']:>12.2f} {r['avg_success_tool_calls']:>12.2f} "
              f"{r['avg_failure_tool_calls']:>12.2f} {r['avg_api_calls']:>10.2f} {r['total_tasks']:>6}")

    print("\n" + "="*120)
    print("详细说明")
    print("="*120 + "\n")

    for r in results:
        print(f"\n【{r['model']}】")
        print(f"  任务成功率: {r['task_success_rate']:.2f}% ({r['success_count']}/{r['total_tasks']})")
        print(f"  子任务成功率: {r['criteria_success_rate']:.2f}%")
        print(f"  ")
        print(f"  平均Tool调用数（所有任务）: {r['avg_tool_calls']:.2f}")
        print(f"  平均Tool调用数（成功任务）: {r['avg_success_tool_calls']:.2f}")
        print(f"  平均Tool调用数（失败任务）: {r['avg_failure_tool_calls']:.2f}")
        print(f"  平均API调用数: {r['avg_api_calls']:.2f}")

        if r['avg_success_tool_calls'] > 0 and r['avg_failure_tool_calls'] > 0:
            diff = r['avg_success_tool_calls'] - r['avg_failure_tool_calls']
            print(f"  ")
            if diff > 0:
                print(f"  💡 成功任务比失败任务平均多使用 {diff:.2f} 个Tool调用")
            else:
                print(f"  💡 失败任务比成功任务平均多使用 {abs(diff):.2f} 个Tool调用")

    print("\n" + "="*120)
    print("说明")
    print("="*120)
    print("• Tool调用数 = 实际的工具使用次数（如browser_click, browser_type等）")
    print("• API调用数 = 与模型的交互次数")
    print("• 成功任务Tool = 成功完成任务的平均Tool调用数")
    print("• 失败任务Tool = 失败任务的平均Tool调用数")

def save_report(results, output_file):
    """保存报告"""
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"\n详细数据已保存到: {output_file}")

if __name__ == '__main__':
    print("加载数据...")
    tool_data, eval_data = load_data()

    print("生成综合报告...")
    results = generate_final_report(tool_data, eval_data)

    print_report(results)

    output_file = '/Users/puzhen/Desktop/pre/camel_project/eigent/final_comprehensive_report.json'
    save_report(results, output_file)
