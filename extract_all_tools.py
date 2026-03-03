#!/usr/bin/env python3
"""
Extract all unique tool names from conversations.
"""

import json
import os
from collections import Counter


def extract_all_tool_names(base_dir, model_name):
    """
    Extract all unique tool names from all conversations.
    """
    tool_counter = Counter()
    tool_examples = {}  # Store example usage for each tool

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

                # Extract tool names from request messages
                if 'request' in data and 'messages' in data['request']:
                    for msg in data['request']['messages']:
                        # Check tool role messages
                        if msg.get('role') == 'tool':
                            tool_name = msg.get('name', '')
                            if tool_name and tool_name != '':
                                tool_counter[tool_name] += 1

                                # Store example if not already stored
                                if tool_name not in tool_examples:
                                    tool_examples[tool_name] = {
                                        'file': f"{folder}/{conv_file}",
                                        'content': msg.get('content', '')[:200]  # First 200 chars
                                    }

                        # Check assistant messages with tool_calls
                        elif msg.get('role') == 'assistant' and 'tool_calls' in msg:
                            if msg['tool_calls']:
                                for tc in msg['tool_calls']:
                                    if 'function' in tc and 'name' in tc['function']:
                                        tool_name = tc['function']['name']
                                        tool_counter[tool_name] += 1

                                        if tool_name not in tool_examples:
                                            tool_examples[tool_name] = {
                                                'file': f"{folder}/{conv_file}",
                                                'arguments': tc['function'].get('arguments', '')[:200]
                                            }

                # Check response for tool calls
                if 'response' in data and 'choices' in data['response']:
                    for choice in data['response']['choices']:
                        if 'message' in choice and 'tool_calls' in choice['message']:
                            if choice['message']['tool_calls']:
                                for tc in choice['message']['tool_calls']:
                                    if 'function' in tc and 'name' in tc['function']:
                                        tool_name = tc['function']['name']
                                        tool_counter[tool_name] += 1

                                        if tool_name not in tool_examples:
                                            tool_examples[tool_name] = {
                                                'file': f"{folder}/{conv_file}",
                                                'arguments': tc['function'].get('arguments', '')[:200]
                                            }

            except Exception as e:
                continue

    return tool_counter, tool_examples


def print_tool_analysis(base_dir):
    """
    Print tool usage analysis for both models.
    """
    print("\n" + "="*100)
    print("COMPLETE TOOL INVENTORY")
    print("="*100 + "\n")

    for model_name in ['claude-opus-4-5', 'gemini-3-pro-preview']:
        print(f"\n{'='*100}")
        print(f"MODEL: {model_name}")
        print(f"{'='*100}\n")

        tool_counter, tool_examples = extract_all_tool_names(base_dir, model_name)

        if not tool_counter:
            print("  No tools found (or tools not in standard format)\n")
            continue

        print(f"📊 TOTAL UNIQUE TOOLS: {len(tool_counter)}\n")
        print(f"{'Tool Name':<40} {'Usage Count':<15} {'Example File'}")
        print(f"{'-'*100}")

        for tool_name, count in tool_counter.most_common():
            example_file = tool_examples.get(tool_name, {}).get('file', 'N/A')
            # Truncate file path if too long
            if len(example_file) > 38:
                example_file = "..." + example_file[-35:]

            print(f"{tool_name:<40} {count:<15} {example_file}")

        # Print tool categories if we can infer them
        print(f"\n📁 TOOL CATEGORIES:\n")

        # Categorize tools by prefix
        browser_tools = [t for t in tool_counter if t.startswith('browser_')]
        file_tools = [t for t in tool_counter if any(x in t.lower() for x in ['file', 'read', 'write'])]
        shell_tools = [t for t in tool_counter if any(x in t.lower() for x in ['shell', 'exec', 'command'])]
        note_tools = [t for t in tool_counter if 'note' in t.lower()]
        other_tools = [t for t in tool_counter if t not in browser_tools + file_tools + shell_tools + note_tools]

        if browser_tools:
            print(f"  Browser Tools ({len(browser_tools)}):")
            for tool in sorted(browser_tools):
                print(f"    - {tool}: {tool_counter[tool]} calls")

        if file_tools:
            print(f"\n  File Tools ({len(file_tools)}):")
            for tool in sorted(file_tools):
                print(f"    - {tool}: {tool_counter[tool]} calls")

        if shell_tools:
            print(f"\n  Shell/Exec Tools ({len(shell_tools)}):")
            for tool in sorted(shell_tools):
                print(f"    - {tool}: {tool_counter[tool]} calls")

        if note_tools:
            print(f"\n  Note/Memory Tools ({len(note_tools)}):")
            for tool in sorted(note_tools):
                print(f"    - {tool}: {tool_counter[tool]} calls")

        if other_tools:
            print(f"\n  Other Tools ({len(other_tools)}):")
            for tool in sorted(other_tools):
                print(f"    - {tool}: {tool_counter[tool]} calls")

        print()

    print("\n" + "="*100 + "\n")


if __name__ == '__main__':
    base_directory = '/Users/puzhen/Desktop/extracted_browser_logs/waleed'
    print_tool_analysis(base_directory)
