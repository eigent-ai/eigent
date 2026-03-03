#!/usr/bin/env python3
"""
Analyze what tools claude-opus-4-5 is calling in conversations.
"""

import json
import os
from collections import Counter, defaultdict


def extract_tool_calls(conv_path):
    """
    Extract all tool calls from a conversation file.
    """
    try:
        with open(conv_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        tool_info = {
            'file': os.path.basename(conv_path),
            'folder': None,
            'tools_called': [],
            'tool_count': 0,
            'total_tokens': 0,
            'message_count': 0,
        }

        # Get basic stats
        if 'response' in data and 'usage' in data['response']:
            usage = data['response']['usage']
            tool_info['total_tokens'] = usage.get('total_tokens', 0)

        # Count messages
        if 'request' in data and 'messages' in data['request']:
            tool_info['message_count'] = len(data['request']['messages'])

            # Look through messages for tool calls
            messages = data['request']['messages']
            for msg in messages:
                # Check if this is an assistant message with tool calls
                if msg.get('role') == 'assistant':
                    # Try to parse content as JSON if it looks like tool calls
                    content = msg.get('content', '')

                    # Some systems store tool_calls separately
                    if 'tool_calls' in msg:
                        for tool_call in msg['tool_calls']:
                            if 'function' in tool_call:
                                tool_name = tool_call['function'].get('name', 'unknown')
                                tool_info['tools_called'].append(tool_name)
                                tool_info['tool_count'] += 1

                # Check tool response messages
                elif msg.get('role') == 'tool':
                    tool_name = msg.get('name', 'unknown')
                    if tool_name not in ['unknown', '']:
                        # This is a tool response, the tool was called
                        # We might have already counted it from assistant message
                        pass

        # Also check response for tool calls
        if 'response' in data and 'choices' in data['response']:
            for choice in data['response']['choices']:
                if 'message' in choice and 'tool_calls' in choice['message']:
                    tool_calls = choice['message']['tool_calls']
                    if tool_calls:
                        for tool_call in tool_calls:
                            if 'function' in tool_call:
                                tool_name = tool_call['function'].get('name', 'unknown')
                                tool_info['tools_called'].append(tool_name)
                                tool_info['tool_count'] += 1

        return tool_info

    except Exception as e:
        print(f"Error processing {conv_path}: {e}")
        return None


def analyze_model_tools(base_dir, model_name):
    """
    Analyze all tool usage for a specific model.
    """
    all_tool_data = []
    tool_counter = Counter()

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
            tool_info = extract_tool_calls(conv_path)

            if tool_info:
                tool_info['folder'] = folder
                all_tool_data.append(tool_info)

                # Count tool usage
                for tool in tool_info['tools_called']:
                    tool_counter[tool] += 1

    return all_tool_data, tool_counter


def analyze_tool_message_patterns(base_dir, model_name):
    """
    Analyze tool-related messages by examining message roles.
    """
    tool_role_stats = {
        'conversations_with_tools': 0,
        'conversations_without_tools': 0,
        'total_tool_messages': 0,
        'total_assistant_messages': 0,
        'avg_tools_per_conv': 0,
        'tool_call_pattern': Counter(),
    }

    conversations_with_tools = []

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

            try:
                with open(conv_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)

                if 'request' not in data or 'messages' not in data['request']:
                    continue

                messages = data['request']['messages']
                role_counter = Counter()

                for msg in messages:
                    role = msg.get('role', 'unknown')
                    role_counter[role] += 1

                tool_count = role_counter.get('tool', 0)
                assistant_count = role_counter.get('assistant', 0)

                tool_role_stats['total_tool_messages'] += tool_count
                tool_role_stats['total_assistant_messages'] += assistant_count

                if tool_count > 0:
                    tool_role_stats['conversations_with_tools'] += 1
                    conversations_with_tools.append({
                        'folder': folder,
                        'file': conv_file,
                        'tool_count': tool_count,
                        'assistant_count': assistant_count,
                        'total_messages': len(messages),
                        'total_tokens': data.get('response', {}).get('usage', {}).get('total_tokens', 0)
                    })
                else:
                    tool_role_stats['conversations_without_tools'] += 1

                # Track tool call patterns (how many tools per conversation)
                tool_role_stats['tool_call_pattern'][tool_count] += 1

            except Exception as e:
                continue

    if tool_role_stats['conversations_with_tools'] > 0:
        tool_role_stats['avg_tools_per_conv'] = (
            tool_role_stats['total_tool_messages'] /
            tool_role_stats['conversations_with_tools']
        )

    return tool_role_stats, conversations_with_tools


def print_analysis(base_dir, model_name='claude-opus-4-5'):
    """
    Print comprehensive tool usage analysis.
    """
    print(f"\n{'='*100}")
    print(f"TOOL USAGE ANALYSIS: {model_name}")
    print(f"{'='*100}\n")

    # Analyze tool role patterns
    print("Analyzing tool message patterns...")
    role_stats, conversations_with_tools = analyze_tool_message_patterns(base_dir, model_name)

    print(f"\n📊 TOOL USAGE STATISTICS:\n")
    print(f"  Total conversations analyzed:     {role_stats['conversations_with_tools'] + role_stats['conversations_without_tools']}")
    print(f"  Conversations WITH tool calls:    {role_stats['conversations_with_tools']} ({role_stats['conversations_with_tools'] / (role_stats['conversations_with_tools'] + role_stats['conversations_without_tools']) * 100:.1f}%)")
    print(f"  Conversations WITHOUT tool calls: {role_stats['conversations_without_tools']} ({role_stats['conversations_without_tools'] / (role_stats['conversations_with_tools'] + role_stats['conversations_without_tools']) * 100:.1f}%)")
    print(f"  Total tool messages:              {role_stats['total_tool_messages']}")
    print(f"  Total assistant messages:         {role_stats['total_assistant_messages']}")
    print(f"  Avg tool calls per conv (w/ tools): {role_stats['avg_tools_per_conv']:.1f}")

    print(f"\n📈 TOOL CALL DISTRIBUTION:\n")
    print(f"  Tool Calls    Conversations")
    print(f"  {'-'*10}    {'-'*15}")
    for tool_count in sorted(role_stats['tool_call_pattern'].keys()):
        conv_count = role_stats['tool_call_pattern'][tool_count]
        if tool_count > 0:  # Only show conversations with tools
            print(f"  {tool_count:>10}    {conv_count:>15} conversations")

    # Show top tool-heavy conversations
    print(f"\n🔥 TOP 10 CONVERSATIONS BY TOOL USAGE:\n")
    print(f"{'Folder':<25} {'File':<35} {'Tools':<8} {'Msgs':<8} {'Tokens':<12}")
    print(f"{'-'*100}")

    top_conversations = sorted(conversations_with_tools, key=lambda x: x['tool_count'], reverse=True)[:10]
    for conv in top_conversations:
        print(f"{conv['folder']:<25} {conv['file']:<35} {conv['tool_count']:<8} {conv['total_messages']:<8} {conv['total_tokens']:<12,}")

    # Try to extract specific tool names
    print(f"\n\n{'='*100}")
    print(f"ATTEMPTING TO IDENTIFY SPECIFIC TOOLS...")
    print(f"{'='*100}\n")

    # Sample some conversations to see actual tool names
    print("Sampling conversations to identify tool names...\n")

    sample_size = min(5, len(conversations_with_tools))
    if sample_size > 0:
        import random
        samples = random.sample(conversations_with_tools, sample_size)

        for i, conv in enumerate(samples, 1):
            conv_path = os.path.join(base_dir, conv['folder'], 'camel_logs', conv['file'])
            print(f"Sample {i}: {conv['folder']}/{conv['file']}")
            print(f"  Tool calls: {conv['tool_count']}, Messages: {conv['total_messages']}")

            # Try to read and extract tool info
            try:
                with open(conv_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)

                # Look for tool names in messages
                tool_names_found = set()
                if 'request' in data and 'messages' in data['request']:
                    for msg in data['request']['messages']:
                        if msg.get('role') == 'tool':
                            # Check for 'name' field
                            if 'name' in msg:
                                tool_names_found.add(msg['name'])

                # Check response for tool calls
                if 'response' in data and 'choices' in data['response']:
                    for choice in data['response']['choices']:
                        if 'message' in choice and 'tool_calls' in choice['message']:
                            if choice['message']['tool_calls']:
                                for tc in choice['message']['tool_calls']:
                                    if 'function' in tc and 'name' in tc['function']:
                                        tool_names_found.add(tc['function']['name'])

                if tool_names_found:
                    print(f"  Tools found: {', '.join(sorted(tool_names_found))}")
                else:
                    print(f"  Tools found: (tool names not in standard format)")
            except Exception as e:
                print(f"  Error reading: {e}")
            print()

    print(f"\n{'='*100}\n")


if __name__ == '__main__':
    base_directory = '/Users/puzhen/Desktop/extracted_browser_logs/waleed'

    print_analysis(base_directory, 'claude-opus-4-5')

    # Also compare with gemini
    print("\n\n" + "="*100)
    print("COMPARISON: gemini-3-pro-preview")
    print("="*100)
    print_analysis(base_directory, 'gemini-3-pro-preview')
