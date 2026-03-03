#!/usr/bin/env python3
"""
计算去除timeout失败任务后的成功率
"""

import json

def load_data():
    """加载数据"""
    # 读取评估结果
    with open('/Users/puzhen/Desktop/pre/camel_project/eigent/evaluation_matched_results.json', 'r') as f:
        eval_data = json.load(f)

    # 读取timeout分析结果
    with open('/Users/puzhen/Desktop/pre/camel_project/eigent/timeout_error_analysis.json', 'r') as f:
        timeout_data = json.load(f)

    return eval_data, timeout_data

def create_timeout_task_set(timeout_data):
    """创建timeout任务集合"""
    timeout_tasks = {}

    for model, stats in timeout_data['models'].items():
        timeout_tasks[model] = set()
        for task in stats['tasks_with_timeout']:
            task_key = f"{task['user']}/{task['task_num']}"
            timeout_tasks[model].add(task_key)

    return timeout_tasks

def calculate_success_rate_without_timeout(eval_data, timeout_tasks):
    """计算去除timeout任务后的成功率"""

    # 只处理三个主要模型
    models_to_analyze = ['claude-opus-4-5', 'gemini-3-pro-preview', 'gpt-5.1']

    results = []

    for model in models_to_analyze:
        if model not in eval_data['model_statistics']:
            continue

        # 获取timeout任务集合
        timeout_set = timeout_tasks.get(model, set())

        # 统计去除timeout后的数据
        total_tasks = 0
        success_count = 0
        total_criteria = 0
        passed_criteria = 0

        failed_tasks_removed = []
        failed_tasks_kept = []

        # 从model_statistics中的tasks遍历
        for task in eval_data['model_statistics'][model]['tasks']:
            task_key = f"{task['user']}/{task['task_num']}"

            # 如果是失败任务且有timeout，跳过
            if not task['success'] and task_key in timeout_set:
                failed_tasks_removed.append(task_key)
                continue

            # 计入统计
            total_tasks += 1
            if task['success']:
                success_count += 1
            else:
                failed_tasks_kept.append(task_key)

            # 统计子任务
            total_criteria += task['total_criteria']
            passed_criteria += task['passed_count']

        # 计算成功率
        task_success_rate = (success_count / total_tasks * 100) if total_tasks > 0 else 0
        criteria_success_rate = (passed_criteria / total_criteria * 100) if total_criteria > 0 else 0

        # 获取原始统计
        orig_stats = eval_data['model_statistics'][model]
        removed_count = len(failed_tasks_removed)

        results.append({
            'model': model,
            'original_total': orig_stats['total_tasks'],
            'original_success': orig_stats['success_count'],
            'original_failure': orig_stats['failure_count'],
            'original_task_success_rate': (orig_stats['success_count'] / orig_stats['total_tasks'] * 100),
            'timeout_failures_removed': removed_count,
            'new_total': total_tasks,
            'new_success': success_count,
            'new_failure': total_tasks - success_count,
            'new_task_success_rate': task_success_rate,
            'new_criteria_success_rate': criteria_success_rate,
            'failed_tasks_removed': failed_tasks_removed,
            'failed_tasks_kept': failed_tasks_kept
        })

    return results

def print_comparison_report(results):
    """打印对比报告"""
    print("\n" + "="*100)
    print("去除Timeout失败任务后的成功率对比")
    print("="*100 + "\n")

    # 按新成功率排序
    results.sort(key=lambda x: x['new_task_success_rate'], reverse=True)

    # 打印表头
    print(f"{'模型':<25} {'原始成功率':<12} {'去除Timeout后':<14} {'提升':<10} "
          f"{'原始任务数':<12} {'新任务数':<10} {'移除失败':<10}")
    print("-" * 100)

    for r in results:
        improvement = r['new_task_success_rate'] - r['original_task_success_rate']
        improvement_str = f"+{improvement:.2f}%" if improvement > 0 else f"{improvement:.2f}%"

        print(f"{r['model']:<25} {r['original_task_success_rate']:>10.2f}% "
              f"{r['new_task_success_rate']:>12.2f}% {improvement_str:>8} "
              f"{r['original_total']:>10} {r['new_total']:>8} {r['timeout_failures_removed']:>8}")

    print("\n" + "="*100)
    print("详细说明")
    print("="*100 + "\n")

    for r in results:
        print(f"\n【{r['model']}】")
        print(f"  原始统计:")
        print(f"    总任务数: {r['original_total']}")
        print(f"    成功: {r['original_success']} ({r['original_task_success_rate']:.2f}%)")
        print(f"    失败: {r['original_failure']}")

        print(f"\n  去除{r['timeout_failures_removed']}个timeout失败任务后:")
        print(f"    总任务数: {r['new_total']}")
        print(f"    成功: {r['new_success']} ({r['new_task_success_rate']:.2f}%)")
        print(f"    失败: {r['new_failure']}")
        print(f"    子任务成功率: {r['new_criteria_success_rate']:.2f}%")

        improvement = r['new_task_success_rate'] - r['original_task_success_rate']
        if improvement > 0:
            print(f"\n  💡 成功率提升: +{improvement:.2f}%")

        if r['failed_tasks_removed']:
            print(f"\n  移除的timeout失败任务:")
            for task in r['failed_tasks_removed']:
                print(f"    - {task}")

        if r['failed_tasks_kept']:
            print(f"\n  保留的非timeout失败任务:")
            for task in r['failed_tasks_kept']:
                print(f"    - {task}")

def save_comparison_report(results, output_file):
    """保存对比报告"""
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"\n详细数据已保存到: {output_file}")

if __name__ == '__main__':
    print("加载数据...")
    eval_data, timeout_data = load_data()

    print("创建timeout任务映射...")
    timeout_tasks = create_timeout_task_set(timeout_data)

    print("计算去除timeout后的成功率...\n")
    results = calculate_success_rate_without_timeout(eval_data, timeout_tasks)

    print_comparison_report(results)

    output_file = '/Users/puzhen/Desktop/pre/camel_project/eigent/success_rate_without_timeout.json'
    save_comparison_report(results, output_file)
