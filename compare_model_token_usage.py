#!/usr/bin/env python3
"""
Detailed comparison of token usage between claude-opus-4-5 and gemini-3-pro-preview.
"""

import json
import os
from collections import defaultdict
from pathlib import Path
import statistics


def analyze_conv_file(conv_path):
    """
    Analyze a single conversation file to extract detailed metrics.

    Returns:
        dict with metrics or None if error
    """
    try:
        with open(conv_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        metrics = {
            'file': os.path.basename(conv_path),
            'model': data.get('model', 'unknown'),
            'total_tokens': 0,
            'prompt_tokens': 0,
            'completion_tokens': 0,
            'message_count': 0,
            'user_message_length': 0,
            'system_message_length': 0,
            'assistant_response_length': 0,
        }

        # Extract usage
        if 'response' in data and 'usage' in data['response']:
            usage = data['response']['usage']
            metrics['total_tokens'] = usage.get('total_tokens', 0)
            metrics['prompt_tokens'] = usage.get('prompt_tokens', 0)
            metrics['completion_tokens'] = usage.get('completion_tokens', 0)

        # Analyze messages
        if 'request' in data and 'messages' in data['request']:
            messages = data['request']['messages']
            metrics['message_count'] = len(messages)

            for msg in messages:
                content = msg.get('content', '')
                role = msg.get('role', '')

                if role == 'system':
                    metrics['system_message_length'] = len(content)
                elif role == 'user':
                    metrics['user_message_length'] += len(content)
                elif role == 'assistant':
                    metrics['assistant_response_length'] += len(content)

        # Get response content length
        if 'response' in data and 'choices' in data['response']:
            for choice in data['response']['choices']:
                if 'message' in choice and 'content' in choice['message']:
                    content = choice['message']['content']
                    if content:
                        metrics['assistant_response_length'] = len(content)

        return metrics

    except Exception as e:
        print(f"Error analyzing {conv_path}: {e}")
        return None


def collect_model_data(base_dir, model_name):
    """
    Collect all conversation data for a specific model.

    Args:
        base_dir: Base directory containing model folders
        model_name: Name of the model to analyze

    Returns:
        List of metrics dictionaries
    """
    all_metrics = []

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

        # Process camel_logs
        camel_logs_dir = os.path.join(folder_path, 'camel_logs')
        if not os.path.exists(camel_logs_dir):
            continue

        for conv_file in os.listdir(camel_logs_dir):
            if not conv_file.startswith('conv_') or not conv_file.endswith('.json'):
                continue

            conv_path = os.path.join(camel_logs_dir, conv_file)
            metrics = analyze_conv_file(conv_path)

            if metrics:
                metrics['folder'] = folder
                all_metrics.append(metrics)

    return all_metrics


def calculate_statistics(metrics_list):
    """Calculate statistical summary from metrics list."""
    if not metrics_list:
        return {}

    stats = {
        'total_conversations': len(metrics_list),
        'total_tokens': sum(m['total_tokens'] for m in metrics_list),
        'total_prompt_tokens': sum(m['prompt_tokens'] for m in metrics_list),
        'total_completion_tokens': sum(m['completion_tokens'] for m in metrics_list),
        'avg_tokens_per_conv': statistics.mean(m['total_tokens'] for m in metrics_list),
        'median_tokens_per_conv': statistics.median(m['total_tokens'] for m in metrics_list),
        'max_tokens_per_conv': max(m['total_tokens'] for m in metrics_list),
        'min_tokens_per_conv': min(m['total_tokens'] for m in metrics_list),
        'avg_prompt_tokens': statistics.mean(m['prompt_tokens'] for m in metrics_list),
        'avg_completion_tokens': statistics.mean(m['completion_tokens'] for m in metrics_list),
        'avg_message_count': statistics.mean(m['message_count'] for m in metrics_list),
        'avg_user_message_length': statistics.mean(m['user_message_length'] for m in metrics_list),
        'avg_system_message_length': statistics.mean(m['system_message_length'] for m in metrics_list),
        'avg_assistant_response_length': statistics.mean(m['assistant_response_length'] for m in metrics_list),
    }

    return stats


def compare_models(base_dir, model1, model2):
    """
    Compare token usage patterns between two models.
    """
    print(f"Collecting data for {model1}...")
    model1_data = collect_model_data(base_dir, model1)

    print(f"Collecting data for {model2}...")
    model2_data = collect_model_data(base_dir, model2)

    print(f"\nCalculating statistics...")
    model1_stats = calculate_statistics(model1_data)
    model2_stats = calculate_statistics(model2_data)

    print("\n" + "="*100)
    print(f"DETAILED COMPARISON: {model1} vs {model2}")
    print("="*100 + "\n")

    # Basic counts
    print("📊 CONVERSATION COUNTS:")
    print(f"  {model1:30s}: {model1_stats['total_conversations']:>6} conversations")
    print(f"  {model2:30s}: {model2_stats['total_conversations']:>6} conversations")
    print()

    # Total tokens
    print("💰 TOTAL TOKEN USAGE:")
    print(f"  {model1:30s}: {model1_stats['total_tokens']:>12,} tokens")
    print(f"  {model2:30s}: {model2_stats['total_tokens']:>12,} tokens")
    print(f"  Difference: {model1_stats['total_tokens'] - model2_stats['total_tokens']:>12,} tokens ({(model1_stats['total_tokens'] / model2_stats['total_tokens'] - 1) * 100:.1f}% more)")
    print()

    # Average tokens per conversation
    print("📈 AVERAGE TOKENS PER CONVERSATION:")
    print(f"  {model1:30s}: {model1_stats['avg_tokens_per_conv']:>12,.1f} tokens/conv")
    print(f"  {model2:30s}: {model2_stats['avg_tokens_per_conv']:>12,.1f} tokens/conv")
    print(f"  Difference: {model1_stats['avg_tokens_per_conv'] - model2_stats['avg_tokens_per_conv']:>12,.1f} tokens/conv ({(model1_stats['avg_tokens_per_conv'] / model2_stats['avg_tokens_per_conv'] - 1) * 100:.1f}% more)")
    print()

    # Median tokens
    print("📊 MEDIAN TOKENS PER CONVERSATION:")
    print(f"  {model1:30s}: {model1_stats['median_tokens_per_conv']:>12,.1f} tokens")
    print(f"  {model2:30s}: {model2_stats['median_tokens_per_conv']:>12,.1f} tokens")
    print()

    # Min/Max tokens
    print("📏 TOKEN RANGE PER CONVERSATION:")
    print(f"  {model1:30s}: {model1_stats['min_tokens_per_conv']:>8,} (min) to {model1_stats['max_tokens_per_conv']:>8,} (max)")
    print(f"  {model2:30s}: {model2_stats['min_tokens_per_conv']:>8,} (min) to {model2_stats['max_tokens_per_conv']:>8,} (max)")
    print()

    # Prompt vs Completion breakdown
    print("🔍 PROMPT vs COMPLETION TOKENS:")
    print(f"  {model1}:")
    print(f"    Average Prompt:     {model1_stats['avg_prompt_tokens']:>12,.1f} ({model1_stats['avg_prompt_tokens'] / model1_stats['avg_tokens_per_conv'] * 100:.1f}%)")
    print(f"    Average Completion: {model1_stats['avg_completion_tokens']:>12,.1f} ({model1_stats['avg_completion_tokens'] / model1_stats['avg_tokens_per_conv'] * 100:.1f}%)")
    print(f"  {model2}:")
    print(f"    Average Prompt:     {model2_stats['avg_prompt_tokens']:>12,.1f} ({model2_stats['avg_prompt_tokens'] / model2_stats['avg_tokens_per_conv'] * 100:.1f}%)")
    print(f"    Average Completion: {model2_stats['avg_completion_tokens']:>12,.1f} ({model2_stats['avg_completion_tokens'] / model2_stats['avg_tokens_per_conv'] * 100:.1f}%)")
    print()

    # Message analysis
    print("💬 MESSAGE ANALYSIS:")
    print(f"  {model1}:")
    print(f"    Avg messages per conv:        {model1_stats['avg_message_count']:>10,.1f}")
    print(f"    Avg system message length:    {model1_stats['avg_system_message_length']:>10,.1f} chars")
    print(f"    Avg user message length:      {model1_stats['avg_user_message_length']:>10,.1f} chars")
    print(f"    Avg assistant response length:{model1_stats['avg_assistant_response_length']:>10,.1f} chars")
    print(f"  {model2}:")
    print(f"    Avg messages per conv:        {model2_stats['avg_message_count']:>10,.1f}")
    print(f"    Avg system message length:    {model2_stats['avg_system_message_length']:>10,.1f} chars")
    print(f"    Avg user message length:      {model2_stats['avg_user_message_length']:>10,.1f} chars")
    print(f"    Avg assistant response length:{model2_stats['avg_assistant_response_length']:>10,.1f} chars")
    print()

    # Key insights
    print("="*100)
    print("🔑 KEY INSIGHTS:")
    print("="*100)

    token_ratio = model1_stats['avg_tokens_per_conv'] / model2_stats['avg_tokens_per_conv']
    message_ratio = model1_stats['avg_message_count'] / model2_stats['avg_message_count']

    print(f"\n1. {model1} uses {token_ratio:.2f}x more tokens per conversation on average")
    print(f"2. {model1} has {message_ratio:.2f}x more messages per conversation on average")
    print(f"3. Prompt token difference: {model1} uses {model1_stats['avg_prompt_tokens'] - model2_stats['avg_prompt_tokens']:,.0f} more prompt tokens per conversation")
    print(f"4. Completion token difference: {model1} uses {model1_stats['avg_completion_tokens'] - model2_stats['avg_completion_tokens']:,.0f} more completion tokens per conversation")

    # Analyze top token consumers
    print(f"\n5. TOP 5 HIGHEST TOKEN CONVERSATIONS:")
    print(f"\n   {model1}:")
    top5_model1 = sorted(model1_data, key=lambda x: x['total_tokens'], reverse=True)[:5]
    for i, conv in enumerate(top5_model1, 1):
        print(f"     {i}. {conv['folder']}/{conv['file']}: {conv['total_tokens']:,} tokens ({conv['message_count']} messages)")

    print(f"\n   {model2}:")
    top5_model2 = sorted(model2_data, key=lambda x: x['total_tokens'], reverse=True)[:5]
    for i, conv in enumerate(top5_model2, 1):
        print(f"     {i}. {conv['folder']}/{conv['file']}: {conv['total_tokens']:,} tokens ({conv['message_count']} messages)")

    print("\n" + "="*100 + "\n")

    # Return data for JSON export
    return {
        'model1': model1,
        'model2': model2,
        'model1_stats': model1_stats,
        'model2_stats': model2_stats,
        'model1_top_consumers': top5_model1,
        'model2_top_consumers': top5_model2
    }


if __name__ == '__main__':
    base_directory = '/Users/puzhen/Desktop/extracted_browser_logs/waleed'

    # Compare claude-opus-4-5 vs gemini-3-pro-preview
    comparison = compare_models(
        base_directory,
        'claude-opus-4-5',
        'gemini-3-pro-preview'
    )

    # Save detailed comparison to JSON
    output_file = '/Users/puzhen/Desktop/pre/camel_project/eigent/model_comparison_detailed.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(comparison, f, indent=2, ensure_ascii=False)

    print(f"Detailed comparison saved to: {output_file}")
