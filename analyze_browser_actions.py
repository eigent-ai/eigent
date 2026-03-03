#!/usr/bin/env python3
"""
Analyze browser actions from browser logs for claude-opus-4-5 vs gemini-3-pro-preview.
"""

import json
import os
from collections import defaultdict, Counter


def count_actions_in_log(log_file_path):
    """
    Count actions in a single browser log file.

    Returns:
        dict with action counts and statistics
    """
    try:
        # Read the entire file
        with open(log_file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # Split by lines and parse each JSON object
        lines = content.strip().split('\n')
        actions = []
        action_types = Counter()
        total_execution_time = 0

        for line in lines:
            if not line.strip():
                continue
            try:
                action_data = json.loads(line)
                action_type = action_data.get('action', 'unknown')
                execution_time = action_data.get('execution_time_ms', 0)

                actions.append({
                    'type': action_type,
                    'timestamp': action_data.get('timestamp'),
                    'execution_time_ms': execution_time
                })

                action_types[action_type] += 1
                total_execution_time += execution_time

            except json.JSONDecodeError:
                continue

        return {
            'total_actions': len(actions),
            'action_types': dict(action_types),
            'total_execution_time_ms': total_execution_time,
            'actions': actions
        }

    except Exception as e:
        print(f"Error reading {log_file_path}: {e}")
        return None


def analyze_browser_logs(base_dir, model_name):
    """
    Analyze all browser logs for a specific model.

    Args:
        base_dir: Base directory containing model folders
        model_name: Name of the model to analyze

    Returns:
        dict with aggregated statistics
    """
    model_stats = {
        'total_actions': 0,
        'total_logs': 0,
        'action_types': Counter(),
        'total_execution_time_ms': 0,
        'logs': []
    }

    for folder in sorted(os.listdir(base_dir)):
        folder_path = os.path.join(base_dir, folder)

        if not os.path.isdir(folder_path) or folder.startswith('.'):
            continue

        # Check if this folder belongs to the target model
        if '_' in folder:
            folder_model = folder.split('_', 1)[1]
            if folder_model != model_name:
                continue
        else:
            continue

        # Look for browser_logs directory
        browser_logs_dir = os.path.join(folder_path, 'browser_logs')
        if not os.path.exists(browser_logs_dir):
            print(f"No browser_logs found in {folder}")
            continue

        # Process all log files in browser_logs
        for log_file in os.listdir(browser_logs_dir):
            if not log_file.endswith('.log'):
                continue

            log_path = os.path.join(browser_logs_dir, log_file)
            log_stats = count_actions_in_log(log_path)

            if log_stats:
                model_stats['total_actions'] += log_stats['total_actions']
                model_stats['total_logs'] += 1
                model_stats['action_types'].update(log_stats['action_types'])
                model_stats['total_execution_time_ms'] += log_stats['total_execution_time_ms']

                model_stats['logs'].append({
                    'folder': folder,
                    'file': log_file,
                    'actions': log_stats['total_actions'],
                    'action_types': log_stats['action_types']
                })

                print(f"Processed {folder}/{log_file}: {log_stats['total_actions']} actions")

    return model_stats


def compare_browser_actions(base_dir):
    """
    Compare browser actions between claude-opus-4-5 and gemini-3-pro-preview.
    """
    print("Analyzing browser actions...\n")

    claude_stats = analyze_browser_logs(base_dir, 'claude-opus-4-5')
    print()
    gemini_stats = analyze_browser_logs(base_dir, 'gemini-3-pro-preview')

    print("\n" + "="*100)
    print("BROWSER ACTIONS COMPARISON: claude-opus-4-5 vs gemini-3-pro-preview")
    print("="*100 + "\n")

    # Overall statistics
    print("📊 OVERALL STATISTICS:\n")
    print(f"{'Model':<30} {'Total Actions':<20} {'Logs':<10} {'Avg Actions/Log':<20}")
    print("-"*100)

    claude_avg = claude_stats['total_actions'] / claude_stats['total_logs'] if claude_stats['total_logs'] > 0 else 0
    gemini_avg = gemini_stats['total_actions'] / gemini_stats['total_logs'] if gemini_stats['total_logs'] > 0 else 0

    print(f"{'claude-opus-4-5':<30} {claude_stats['total_actions']:<20,} {claude_stats['total_logs']:<10} {claude_avg:<20,.1f}")
    print(f"{'gemini-3-pro-preview':<30} {gemini_stats['total_actions']:<20,} {gemini_stats['total_logs']:<10} {gemini_avg:<20,.1f}")

    if gemini_stats['total_actions'] > 0:
        ratio = claude_stats['total_actions'] / gemini_stats['total_actions']
        print(f"\n💡 claude-opus-4-5 uses {ratio:.2f}x browser actions compared to gemini-3-pro-preview")
        diff = claude_stats['total_actions'] - gemini_stats['total_actions']
        print(f"   Difference: {diff:,} actions ({(ratio - 1) * 100:.1f}% more)")

    # Action types breakdown
    print("\n" + "="*100)
    print("🔍 ACTION TYPES BREAKDOWN:\n")

    all_action_types = set(claude_stats['action_types'].keys()) | set(gemini_stats['action_types'].keys())

    print(f"{'Action Type':<30} {'claude-opus-4-5':<20} {'gemini-3-pro-preview':<25} {'Difference':<15}")
    print("-"*100)

    for action_type in sorted(all_action_types):
        claude_count = claude_stats['action_types'].get(action_type, 0)
        gemini_count = gemini_stats['action_types'].get(action_type, 0)
        diff = claude_count - gemini_count

        print(f"{action_type:<30} {claude_count:<20,} {gemini_count:<25,} {diff:>+15,}")

    # Execution time comparison
    print("\n" + "="*100)
    print("⏱️  EXECUTION TIME:\n")

    claude_time_sec = claude_stats['total_execution_time_ms'] / 1000
    gemini_time_sec = gemini_stats['total_execution_time_ms'] / 1000

    print(f"claude-opus-4-5:        {claude_time_sec:>12,.1f} seconds ({claude_time_sec/60:>8,.1f} minutes)")
    print(f"gemini-3-pro-preview:   {gemini_time_sec:>12,.1f} seconds ({gemini_time_sec/60:>8,.1f} minutes)")

    if gemini_time_sec > 0:
        time_ratio = claude_time_sec / gemini_time_sec
        print(f"\nTime ratio: {time_ratio:.2f}x")

    # Per-log breakdown
    print("\n" + "="*100)
    print("📋 PER-LOG BREAKDOWN:\n")

    print("claude-opus-4-5:")
    for log_info in claude_stats['logs']:
        print(f"  {log_info['folder']}: {log_info['actions']} actions")

    print("\ngemini-3-pro-preview:")
    for log_info in gemini_stats['logs']:
        print(f"  {log_info['folder']}: {log_info['actions']} actions")

    print("\n" + "="*100)
    print("\n🎯 KEY FINDINGS:\n")
    print("="*100 + "\n")

    if claude_avg > gemini_avg:
        print(f"1. claude-opus-4-5 performs {claude_avg - gemini_avg:.1f} more browser actions per task on average")

    # Find the most different action type
    max_diff_action = None
    max_diff = 0
    for action_type in all_action_types:
        diff = abs(claude_stats['action_types'].get(action_type, 0) - gemini_stats['action_types'].get(action_type, 0))
        if diff > max_diff:
            max_diff = diff
            max_diff_action = action_type

    if max_diff_action:
        claude_count = claude_stats['action_types'].get(max_diff_action, 0)
        gemini_count = gemini_stats['action_types'].get(max_diff_action, 0)
        print(f"2. Biggest difference is in '{max_diff_action}' actions:")
        print(f"   claude: {claude_count:,} | gemini: {gemini_count:,} | diff: {claude_count - gemini_count:+,}")

    print(f"\n3. More browser actions correlate with more API calls and tokens:")
    print(f"   More actions → More snapshots → Longer prompts → Higher token usage")

    print("\n" + "="*100 + "\n")

    # Return data for JSON export
    return {
        'claude_opus_4_5': {
            'total_actions': claude_stats['total_actions'],
            'total_logs': claude_stats['total_logs'],
            'avg_actions_per_log': claude_avg,
            'action_types': dict(claude_stats['action_types']),
            'execution_time_seconds': claude_time_sec,
            'logs': claude_stats['logs']
        },
        'gemini_3_pro_preview': {
            'total_actions': gemini_stats['total_actions'],
            'total_logs': gemini_stats['total_logs'],
            'avg_actions_per_log': gemini_avg,
            'action_types': dict(gemini_stats['action_types']),
            'execution_time_seconds': gemini_time_sec,
            'logs': gemini_stats['logs']
        }
    }


if __name__ == '__main__':
    base_directory = '/Users/puzhen/Desktop/extracted_browser_logs/waleed'

    comparison = compare_browser_actions(base_directory)

    # Save to JSON
    output_file = '/Users/puzhen/Desktop/pre/camel_project/eigent/browser_action_comparison.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(comparison, f, indent=2, ensure_ascii=False)

    print(f"Results saved to: {output_file}")
