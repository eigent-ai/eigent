#!/usr/bin/env python3
"""
Simple count of browser actions using grep for claude-opus-4-5 vs gemini-3-pro-preview.
"""

import os
import subprocess
from collections import defaultdict


def count_actions_in_file(file_path):
    """Count actions in a file using grep."""
    try:
        result = subprocess.run(
            ['grep', '-o', '"action"', file_path],
            capture_output=True,
            text=True
        )
        count = len(result.stdout.strip().split('\n')) if result.stdout.strip() else 0
        return count
    except Exception as e:
        print(f"Error counting actions in {file_path}: {e}")
        return 0


def analyze_model_actions(base_dir, model_name):
    """
    Count browser actions for a specific model.
    """
    stats = {
        'total_actions': 0,
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
            continue

        # Process all log files
        for log_file in os.listdir(browser_logs_dir):
            if not log_file.endswith('.log'):
                continue

            log_path = os.path.join(browser_logs_dir, log_file)
            action_count = count_actions_in_file(log_path)

            stats['total_actions'] += action_count
            stats['logs'].append({
                'folder': folder,
                'file': log_file,
                'actions': action_count
            })

            print(f"  {folder}: {action_count} actions")

    return stats


def main():
    base_dir = '/Users/puzhen/Desktop/extracted_browser_logs/waleed'

    print("Counting browser actions...\n")
    print("claude-opus-4-5:")
    claude_stats = analyze_model_actions(base_dir, 'claude-opus-4-5')

    print("\ngemini-3-pro-preview:")
    gemini_stats = analyze_model_actions(base_dir, 'gemini-3-pro-preview')

    print("\n" + "="*100)
    print("BROWSER ACTIONS SUMMARY")
    print("="*100 + "\n")

    print(f"{'Model':<35} {'Total Actions':<20} {'Tasks':<10} {'Avg Actions/Task':<20}")
    print("-"*100)

    claude_avg = claude_stats['total_actions'] / len(claude_stats['logs']) if claude_stats['logs'] else 0
    gemini_avg = gemini_stats['total_actions'] / len(gemini_stats['logs']) if gemini_stats['logs'] else 0

    print(f"{'claude-opus-4-5':<35} {claude_stats['total_actions']:<20,} {len(claude_stats['logs']):<10} {claude_avg:<20,.1f}")
    print(f"{'gemini-3-pro-preview':<35} {gemini_stats['total_actions']:<20,} {len(gemini_stats['logs']):<10} {gemini_avg:<20,.1f}")

    print("\n" + "="*100)
    print("KEY INSIGHTS")
    print("="*100 + "\n")

    if gemini_stats['total_actions'] > 0:
        ratio = claude_stats['total_actions'] / gemini_stats['total_actions']
        diff = claude_stats['total_actions'] - gemini_stats['total_actions']
        print(f"1. claude-opus-4-5 performs {ratio:.2f}x more browser actions than gemini-3-pro-preview")
        print(f"   Total difference: {diff:,} actions ({(ratio - 1) * 100:.1f}% more)")

    if gemini_avg > 0:
        avg_ratio = claude_avg / gemini_avg
        avg_diff = claude_avg - gemini_avg
        print(f"\n2. On average per task:")
        print(f"   claude-opus-4-5: {claude_avg:.1f} actions/task")
        print(f"   gemini-3-pro-preview: {gemini_avg:.1f} actions/task")
        print(f"   Ratio: {avg_ratio:.2f}x ({avg_diff:+.1f} actions difference)")

    print(f"\n3. More browser actions means:")
    print(f"   ✓ More DOM snapshots included in API requests")
    print(f"   ✓ Longer prompt context (each action adds snapshot text)")
    print(f"   ✓ Higher token consumption")
    print(f"   ✓ More API calls to process actions")

    print(f"\n4. This correlates with our previous findings:")
    print(f"   • claude-opus-4-5 uses 1.96x more tokens")
    print(f"   • claude-opus-4-5 has 1.71x more messages per conversation")
    print(f"   • claude-opus-4-5 performs {ratio:.2f}x more browser actions")
    print(f"   → All metrics point to a more thorough but token-intensive approach")

    print("\n" + "="*100 + "\n")


if __name__ == '__main__':
    main()
