#!/usr/bin/env python3
"""
Calculate total tokens for each model in waleed's extracted browser logs.
"""

import json
import os
from collections import defaultdict
from pathlib import Path


def calculate_model_tokens(base_dir):
    """
    Calculate total tokens for each model from conv files.

    Args:
        base_dir: Base directory containing model folders

    Returns:
        Dictionary with model names as keys and token statistics as values
    """
    model_stats = defaultdict(lambda: {
        'total_tokens': 0,
        'prompt_tokens': 0,
        'completion_tokens': 0,
        'file_count': 0,
        'folders': []
    })

    # Iterate through all folders in the base directory
    for folder in sorted(os.listdir(base_dir)):
        folder_path = os.path.join(base_dir, folder)

        # Skip non-directories and hidden files
        if not os.path.isdir(folder_path) or folder.startswith('.'):
            continue

        # Extract model name from folder (format: XX_model-name)
        if '_' in folder:
            model_name = folder.split('_', 1)[1]
        else:
            continue

        # Look for camel_logs directory
        camel_logs_dir = os.path.join(folder_path, 'camel_logs')
        if not os.path.exists(camel_logs_dir):
            print(f"Warning: No camel_logs found in {folder}")
            continue

        # Process all conv_*.json files
        folder_total = 0
        folder_prompt = 0
        folder_completion = 0
        file_count = 0

        for conv_file in os.listdir(camel_logs_dir):
            if not conv_file.startswith('conv_') or not conv_file.endswith('.json'):
                continue

            conv_path = os.path.join(camel_logs_dir, conv_file)

            try:
                with open(conv_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)

                # Extract token usage from response
                if 'response' in data and 'usage' in data['response']:
                    usage = data['response']['usage']
                    total = usage.get('total_tokens', 0)
                    prompt = usage.get('prompt_tokens', 0)
                    completion = usage.get('completion_tokens', 0)

                    folder_total += total
                    folder_prompt += prompt
                    folder_completion += completion
                    file_count += 1

            except Exception as e:
                print(f"Error processing {conv_path}: {e}")
                continue

        # Add to model stats
        if file_count > 0:
            model_stats[model_name]['total_tokens'] += folder_total
            model_stats[model_name]['prompt_tokens'] += folder_prompt
            model_stats[model_name]['completion_tokens'] += folder_completion
            model_stats[model_name]['file_count'] += file_count
            model_stats[model_name]['folders'].append({
                'folder': folder,
                'total_tokens': folder_total,
                'file_count': file_count
            })

            print(f"Processed {folder}: {file_count} files, {folder_total:,} total tokens")

    return dict(model_stats)


def print_summary(model_stats):
    """Print a summary of token usage by model."""
    print("\n" + "="*80)
    print("WALEED'S MODEL TOKEN USAGE SUMMARY")
    print("="*80 + "\n")

    # Sort by model name
    for model_name in sorted(model_stats.keys()):
        stats = model_stats[model_name]
        print(f"Model: {model_name}")
        print(f"  Total Tokens:      {stats['total_tokens']:>12,}")
        print(f"  Prompt Tokens:     {stats['prompt_tokens']:>12,}")
        print(f"  Completion Tokens: {stats['completion_tokens']:>12,}")
        print(f"  Conv Files:        {stats['file_count']:>12,}")
        print(f"  Task Folders:      {len(stats['folders']):>12,}")

        # Show folder breakdown
        if stats['folders']:
            print(f"\n  Folder breakdown:")
            for folder_info in stats['folders']:
                print(f"    {folder_info['folder']}: {folder_info['total_tokens']:,} tokens ({folder_info['file_count']} files)")
        print()

    # Print grand total
    print("="*80)
    grand_total = sum(stats['total_tokens'] for stats in model_stats.values())
    grand_prompt = sum(stats['prompt_tokens'] for stats in model_stats.values())
    grand_completion = sum(stats['completion_tokens'] for stats in model_stats.values())
    total_files = sum(stats['file_count'] for stats in model_stats.values())

    print(f"GRAND TOTAL:")
    print(f"  Total Tokens:      {grand_total:>12,}")
    print(f"  Prompt Tokens:     {grand_prompt:>12,}")
    print(f"  Completion Tokens: {grand_completion:>12,}")
    print(f"  Total Conv Files:  {total_files:>12,}")
    print("="*80 + "\n")


def save_to_json(model_stats, output_file):
    """Save the statistics to a JSON file."""
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(model_stats, f, indent=2, ensure_ascii=False)
    print(f"Results saved to: {output_file}")


if __name__ == '__main__':
    base_directory = '/Users/puzhen/Desktop/extracted_browser_logs/waleed'
    output_file = '/Users/puzhen/Desktop/pre/camel_project/eigent/waleed_token_usage.json'

    print(f"Scanning directory: {base_directory}\n")

    # Calculate token statistics
    model_stats = calculate_model_tokens(base_directory)

    # Print summary
    print_summary(model_stats)

    # Save to JSON
    save_to_json(model_stats, output_file)
