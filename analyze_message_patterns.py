#!/usr/bin/env python3
"""
Analyze message patterns to understand why claude-opus-4-5 uses more tokens.
"""

import json
import os
from collections import Counter, defaultdict


def analyze_conversation_structure(conv_path):
    """
    Analyze the structure of a conversation to understand message patterns.
    """
    try:
        with open(conv_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        analysis = {
            'file': os.path.basename(conv_path),
            'model': data.get('model', 'unknown'),
            'total_tokens': 0,
            'message_count': 0,
            'role_distribution': Counter(),
            'avg_message_token_estimate': 0,
            'has_tool_calls': False,
            'system_prompt_tokens': 0,
        }

        # Get token usage
        if 'response' in data and 'usage' in data['response']:
            usage = data['response']['usage']
            analysis['total_tokens'] = usage.get('total_tokens', 0)

        # Analyze request messages
        if 'request' in data and 'messages' in data['request']:
            messages = data['request']['messages']
            analysis['message_count'] = len(messages)

            for msg in messages:
                role = msg.get('role', 'unknown')
                analysis['role_distribution'][role] += 1

                # Estimate tokens for system messages (these add up in context)
                if role == 'system':
                    content = msg.get('content', '')
                    # Rough estimate: 1 token ≈ 4 characters
                    analysis['system_prompt_tokens'] = len(content) // 4

            if analysis['message_count'] > 0:
                analysis['avg_message_token_estimate'] = analysis['total_tokens'] / analysis['message_count']

        # Check for tool calls in response
        if 'response' in data and 'choices' in data['response']:
            for choice in data['response']['choices']:
                if 'message' in choice:
                    if choice['message'].get('tool_calls'):
                        analysis['has_tool_calls'] = True
                        break

        return analysis

    except Exception as e:
        print(f"Error analyzing {conv_path}: {e}")
        return None


def sample_conversations(base_dir, model_name, sample_size=10):
    """
    Sample conversations from a model to understand patterns.
    """
    all_convs = []

    for folder in sorted(os.listdir(base_dir)):
        folder_path = os.path.join(base_dir, folder)

        if not os.path.isdir(folder_path) or folder.startswith('.'):
            continue

        if '_' in folder:
            folder_model = folder.split('_', 1)[1]
            if folder_model != model_name:
                continue
        else:
            continue

        camel_logs_dir = os.path.join(folder_path, 'camel_logs')
        if not os.path.exists(camel_logs_dir):
            continue

        for conv_file in os.listdir(camel_logs_dir):
            if not conv_file.startswith('conv_') or not conv_file.endswith('.json'):
                continue

            conv_path = os.path.join(camel_logs_dir, conv_file)
            all_convs.append((conv_path, folder))

    # Sort by file path and sample evenly
    all_convs.sort()

    # Sample from beginning, middle, and end
    if len(all_convs) <= sample_size:
        sampled = all_convs
    else:
        step = len(all_convs) // sample_size
        sampled = [all_convs[i * step] for i in range(sample_size)]

    results = []
    for conv_path, folder in sampled:
        analysis = analyze_conversation_structure(conv_path)
        if analysis:
            analysis['folder'] = folder
            results.append(analysis)

    return results


def print_comparison(base_dir):
    """
    Compare message patterns between claude-opus-4-5 and gemini-3-pro-preview.
    """
    print("Sampling conversations from both models...\n")

    claude_samples = sample_conversations(base_dir, 'claude-opus-4-5', sample_size=15)
    gemini_samples = sample_conversations(base_dir, 'gemini-3-pro-preview', sample_size=15)

    print("="*100)
    print("MESSAGE PATTERN ANALYSIS")
    print("="*100)

    print("\n📋 CLAUDE-OPUS-4-5 SAMPLE CONVERSATIONS:\n")
    print(f"{'Folder':<25} {'Messages':<10} {'Total Tokens':<15} {'Tokens/Msg':<15} {'Roles':<30}")
    print("-"*100)

    claude_msg_counts = []
    claude_tokens_per_msg = []
    claude_role_dist = Counter()

    for conv in claude_samples:
        claude_msg_counts.append(conv['message_count'])
        claude_tokens_per_msg.append(conv['avg_message_token_estimate'])
        claude_role_dist.update(conv['role_distribution'])

        roles = ', '.join(f"{k}:{v}" for k, v in conv['role_distribution'].items())
        print(f"{conv['folder']:<25} {conv['message_count']:<10} {conv['total_tokens']:<15,} {conv['avg_message_token_estimate']:<15,.0f} {roles:<30}")

    print("\n📋 GEMINI-3-PRO-PREVIEW SAMPLE CONVERSATIONS:\n")
    print(f"{'Folder':<25} {'Messages':<10} {'Total Tokens':<15} {'Tokens/Msg':<15} {'Roles':<30}")
    print("-"*100)

    gemini_msg_counts = []
    gemini_tokens_per_msg = []
    gemini_role_dist = Counter()

    for conv in gemini_samples:
        gemini_msg_counts.append(conv['message_count'])
        gemini_tokens_per_msg.append(conv['avg_message_token_estimate'])
        gemini_role_dist.update(conv['role_distribution'])

        roles = ', '.join(f"{k}:{v}" for k, v in conv['role_distribution'].items())
        print(f"{conv['folder']:<25} {conv['message_count']:<10} {conv['total_tokens']:<15,} {conv['avg_message_token_estimate']:<15,.0f} {roles:<30}")

    # Print summary statistics
    print("\n" + "="*100)
    print("📊 SUMMARY STATISTICS")
    print("="*100 + "\n")

    print("MESSAGE COUNT DISTRIBUTION:")
    if claude_msg_counts:
        print(f"  claude-opus-4-5:")
        print(f"    Average: {sum(claude_msg_counts)/len(claude_msg_counts):.1f} messages")
        print(f"    Range:   {min(claude_msg_counts)} - {max(claude_msg_counts)} messages")
    if gemini_msg_counts:
        print(f"  gemini-3-pro-preview:")
        print(f"    Average: {sum(gemini_msg_counts)/len(gemini_msg_counts):.1f} messages")
        print(f"    Range:   {min(gemini_msg_counts)} - {max(gemini_msg_counts)} messages")

    print("\nTOKENS PER MESSAGE:")
    if claude_tokens_per_msg:
        print(f"  claude-opus-4-5:")
        print(f"    Average: {sum(claude_tokens_per_msg)/len(claude_tokens_per_msg):,.0f} tokens/message")
    if gemini_tokens_per_msg:
        print(f"  gemini-3-pro-preview:")
        print(f"    Average: {sum(gemini_tokens_per_msg)/len(gemini_tokens_per_msg):,.0f} tokens/message")

    print("\nROLE DISTRIBUTION (total across sample):")
    print(f"  claude-opus-4-5:")
    for role, count in claude_role_dist.most_common():
        print(f"    {role}: {count}")
    print(f"  gemini-3-pro-preview:")
    for role, count in gemini_role_dist.most_common():
        print(f"    {role}: {count}")

    print("\n" + "="*100)
    print("\n🔍 HYPOTHESIS:")
    print("="*100)

    claude_avg = sum(claude_msg_counts)/len(claude_msg_counts) if claude_msg_counts else 0
    gemini_avg = sum(gemini_msg_counts)/len(gemini_msg_counts) if gemini_msg_counts else 0

    if claude_avg > gemini_avg:
        diff = claude_avg - gemini_avg
        print(f"\nclaude-opus-4-5 has {diff:.1f} more messages per conversation on average.")
        print("\nPossible reasons:")
        print("1. Claude may require more back-and-forth interactions to complete tasks")
        print("2. Claude may use more tool calls or intermediate steps")
        print("3. The conversation history accumulates more context over multiple turns")
        print("4. Claude's responses may trigger more follow-up questions or validations")
        print("\nSince most tokens are prompt tokens (99.7%), each additional message")
        print("includes the full conversation history, causing exponential token growth.")

    print("\n" + "="*100 + "\n")


if __name__ == '__main__':
    base_directory = '/Users/puzhen/Desktop/extracted_browser_logs/waleed'
    print_comparison(base_directory)
