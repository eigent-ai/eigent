#!/usr/bin/env python3
"""
批量提取browser_log文件的示例脚本

展示如何批量处理多个project文件夹
"""

import os
from pathlib import Path
from extract_browser_logs import BrowserLogExtractor


def batch_extract_from_recent_projects(num_projects: int = 14):
    """
    从最近的N个project中批量提取browser_log

    Args:
        num_projects: 要处理的project数量
    """
    import time

    # 获取所有project文件夹
    dirs = [
        "/Users/puzhen/.eigent/12345",
        "/Users/puzhen/.eigent/pppzzz",
        "/Users/puzhen/.eigent/hentai"
    ]

    folders = []
    for base_dir in dirs:
        try:
            for item in Path(base_dir).glob("project*"):
                if item.is_dir():
                    stat = item.stat()
                    folders.append((stat.st_birthtime, str(item)))
        except Exception as e:
            continue

    # 按时间排序，取最近的N个
    folders.sort(reverse=True)
    recent_folders = folders[:num_projects]

    print(f"Processing {len(recent_folders)} recent project folders...")
    print("=" * 80)

    # 创建提取器
    extractor = BrowserLogExtractor()

    # 批量提取
    all_results = {}

    for i, (timestamp, project_dir) in enumerate(recent_folders, 1):
        project_name = Path(project_dir).name
        print(f"\n[{i}/{len(recent_folders)}] Processing: {project_name}")
        print("-" * 80)

        try:
            matching_logs = extractor.extract_matching_logs(project_dir)
            all_results[project_name] = matching_logs
        except Exception as e:
            print(f"Error processing {project_name}: {e}")
            all_results[project_name] = []

    # 输出总结
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)

    total_logs = 0
    for project_name, logs in all_results.items():
        print(f"{project_name}: {len(logs)} browser logs")
        total_logs += len(logs)

    print(f"\nTotal: {total_logs} browser log files found across {len(recent_folders)} projects")

    return all_results


def extract_and_organize_by_project(project_dir: str, output_base_dir: str):
    """
    提取browser_log并按project组织到输出目录

    Args:
        project_dir: project文件夹路径
        output_base_dir: 输出基础目录
    """
    project_name = Path(project_dir).name
    output_dir = Path(output_base_dir) / project_name / "browser_logs"

    extractor = BrowserLogExtractor()
    matching_logs = extractor.extract_matching_logs(project_dir, str(output_dir))

    return matching_logs


def extract_specific_project(project_dir: str):
    """
    提取指定project的browser_log

    Args:
        project_dir: project文件夹完整路径
    """
    print("=" * 80)
    print(f"Extracting browser logs for: {Path(project_dir).name}")
    print("=" * 80)

    extractor = BrowserLogExtractor()
    matching_logs = extractor.extract_matching_logs(project_dir)

    return matching_logs


def main():
    """主函数：展示不同的使用方式"""

    print("Browser Log Extraction Tool")
    print("=" * 80)
    print()
    print("选择操作：")
    print("1. 批量处理最近的14个project")
    print("2. 提取指定project的browser_log")
    print("3. 提取并组织到指定目录")
    print()

    choice = input("请选择 (1/2/3): ").strip()

    if choice == "1":
        # 批量处理
        results = batch_extract_from_recent_projects(num_projects=14)

    elif choice == "2":
        # 提取指定project
        project_dir = input("请输入project文件夹路径: ").strip()
        if project_dir:
            extract_specific_project(project_dir)
        else:
            print("Error: 未提供project路径")

    elif choice == "3":
        # 提取并组织
        project_dir = input("请输入project文件夹路径: ").strip()
        output_dir = input("请输入输出目录路径: ").strip()

        if project_dir and output_dir:
            extract_and_organize_by_project(project_dir, output_dir)
        else:
            print("Error: 未提供必要的路径")

    else:
        print("无效的选择")


if __name__ == "__main__":
    # 直接运行示例：批量处理最近的project
    batch_extract_from_recent_projects(num_projects=5)

    # 如果需要交互式选择，可以取消下面这行的注释
    # main()
