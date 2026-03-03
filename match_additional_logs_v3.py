#!/usr/bin/env python3
"""
匹配额外的browser_log到camel_logs - 最终版本

任务1: pengcheng - 从Downloads/pengcheng的project文件夹匹配到微信文件夹的browser_log
任务2: saed - 从Downloads/saed的project zip提取camel_logs，匹配到微信文件夹的browser_log
"""

import os
import re
import shutil
import zipfile
import tempfile
from pathlib import Path
from datetime import datetime
from typing import List, Tuple, Optional, Dict


class AdditionalLogMatcher:
    """额外日志匹配器"""

    def __init__(self):
        pass

    def parse_conv_filename_time(self, filename: str) -> Optional[datetime]:
        """从conv文件名中解析时间"""
        pattern = r'conv_(\d{8})_(\d{6})_\d+\.json'
        match = re.match(pattern, filename)
        if not match:
            return None
        date_str = match.group(1)
        time_str = match.group(2)
        try:
            return datetime.strptime(f"{date_str}_{time_str}", "%Y%m%d_%H%M%S")
        except ValueError:
            return None

    def parse_browser_log_time(self, filename: str) -> Optional[datetime]:
        """从browser_log文件名中解析时间"""
        pattern = r'hybrid_browser_toolkit_ws_(\d{8})_(\d{6})_\w+\.log'
        match = re.match(pattern, filename)
        if not match:
            return None
        date_str = match.group(1)
        time_str = match.group(2)
        try:
            return datetime.strptime(f"{date_str}_{time_str}", "%Y%m%d_%H%M%S")
        except ValueError:
            return None

    def match_pengcheng_projects(self,
                                 project_source_dir: str,
                                 browser_log_source: str,
                                 output_dir: str):
        """
        任务1: 从Downloads/pengcheng的project文件夹匹配browser_log

        Args:
            project_source_dir: Downloads/pengcheng目录
            browser_log_source: 微信文件夹中的browser_log目录
            output_dir: 输出目录
        """
        project_path = Path(project_source_dir)
        browser_source = Path(browser_log_source)
        output_path = Path(output_dir)

        print(f"\n{'='*80}")
        print(f"Task 1: Matching pengcheng projects")
        print(f"Projects from: {project_source_dir}")
        print(f"Browser logs from: {browser_log_source}")
        print(f"{'='*80}")

        # 获取所有browser_log
        browser_logs = {}
        for log_file in browser_source.glob("hybrid_browser*.log"):
            log_time = self.parse_browser_log_time(log_file.name)
            if log_time:
                browser_logs[log_file.name] = (log_time, log_file)

        print(f"\nFound {len(browser_logs)} browser logs")
        if browser_logs:
            times = [t for t, _ in browser_logs.values()]
            print(f"Time range: {min(times).strftime('%Y-%m-%d %H:%M')} to {max(times).strftime('%Y-%m-%d %H:%M')}")

        # 查找所有project文件夹（不是zip）
        project_dirs = [d for d in project_path.iterdir()
                       if d.is_dir() and d.name.startswith('project_')]

        # 查找所有project zip文件
        project_zips = sorted(project_path.glob("project*.zip"))

        # 查找所有Archive zip文件
        archive_zips = sorted(project_path.glob("Archive*.zip"))

        print(f"\nFound {len(project_dirs)} project directories")
        print(f"Found {len(project_zips)} project zip files")
        print(f"Found {len(archive_zips)} Archive zip files")

        matched_count = 0

        # 先处理已解压的文件夹
        for project_dir in sorted(project_dirs):
            print(f"\n{project_dir.name}:")

            # 查找camel_logs
            camel_logs_dirs = list(project_dir.rglob("**/camel_logs"))

            if not camel_logs_dirs:
                print(f"  No camel_logs found")
                continue

            # 收集所有conv文件
            all_conv_files = []
            for camel_dir in camel_logs_dirs:
                all_conv_files.extend(camel_dir.glob("conv*.json"))

            if not all_conv_files:
                print(f"  No conv files found")
                continue

            # 解析时间
            timestamps = []
            for conv_file in all_conv_files:
                dt = self.parse_conv_filename_time(conv_file.name)
                if dt:
                    timestamps.append(dt)

            if not timestamps:
                print(f"  No valid conv files")
                continue

            min_time = min(timestamps)
            max_time = max(timestamps)

            print(f"  Conv time: {min_time.strftime('%Y-%m-%d %H:%M:%S')} to {max_time.strftime('%Y-%m-%d %H:%M:%S')}")
            print(f"  Conv files: {len(timestamps)}")

            # 创建输出目录
            project_output = output_path / project_dir.name
            camel_output = project_output / "camel_logs"
            browser_output = project_output / "browser_logs"
            camel_output.mkdir(parents=True, exist_ok=True)
            browser_output.mkdir(parents=True, exist_ok=True)

            # 复制camel_logs
            for conv_file in all_conv_files:
                shutil.copy2(conv_file, camel_output / conv_file.name)

            # 匹配browser_log
            project_matched = 0
            for log_name, (log_time, log_path) in browser_logs.items():
                if min_time <= log_time <= max_time:
                    shutil.copy2(log_path, browser_output / log_name)
                    project_matched += 1
                    print(f"  ✓ Matched: {log_name} ({log_time.strftime('%H:%M:%S')})")

            matched_count += project_matched

            if project_matched == 0:
                print(f"  No matching browser logs")

        # 然后处理zip文件
        print(f"\nProcessing project zip files...")

        for i, zip_path in enumerate(project_zips, 1):
            print(f"\n[{i}/{len(project_zips)}] {zip_path.name}")

            with tempfile.TemporaryDirectory() as temp_dir:
                temp_path = Path(temp_dir)

                try:
                    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                        zip_ref.extractall(temp_path)

                    # 查找conv文件
                    conv_files = list(temp_path.rglob("**/conv*.json"))

                    if not conv_files:
                        print(f"  No conv files found")
                        continue

                    # 解析时间
                    timestamps = []
                    for conv_file in conv_files:
                        dt = self.parse_conv_filename_time(conv_file.name)
                        if dt:
                            timestamps.append(dt)

                    if not timestamps:
                        print(f"  No valid conv files")
                        continue

                    min_time = min(timestamps)
                    max_time = max(timestamps)

                    print(f"  Conv time: {min_time.strftime('%Y-%m-%d %H:%M:%S')} to {max_time.strftime('%Y-%m-%d %H:%M:%S')}")
                    print(f"  Conv files: {len(timestamps)}")

                    # 创建输出目录
                    project_output = output_path / zip_path.stem
                    camel_output = project_output / "camel_logs"
                    browser_output = project_output / "browser_logs"
                    camel_output.mkdir(parents=True, exist_ok=True)
                    browser_output.mkdir(parents=True, exist_ok=True)

                    # 复制conv文件
                    for conv_file in conv_files:
                        shutil.copy2(conv_file, camel_output / conv_file.name)

                    # 匹配browser_log
                    project_matched = 0
                    for log_name, (log_time, log_path) in browser_logs.items():
                        if min_time <= log_time <= max_time:
                            shutil.copy2(log_path, browser_output / log_name)
                            project_matched += 1
                            print(f"  ✓ Matched: {log_name} ({log_time.strftime('%H:%M:%S')})")

                    matched_count += project_matched

                    if project_matched == 0:
                        print(f"  No matching browser logs")

                except Exception as e:
                    print(f"  Error: {e}")

        # 最后处理Archive zip文件（这些已经包含browser_log在内）
        if archive_zips:
            print(f"\nProcessing Archive zip files...")

            for i, zip_path in enumerate(archive_zips, 1):
                print(f"\n[{i}/{len(archive_zips)}] {zip_path.name}")

                with tempfile.TemporaryDirectory() as temp_dir:
                    temp_path = Path(temp_dir)

                    try:
                        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                            zip_ref.extractall(temp_path)

                        # 查找conv文件
                        conv_files = list(temp_path.rglob("**/conv*.json"))

                        if not conv_files:
                            print(f"  No conv files found")
                            continue

                        # 解析时间
                        timestamps = []
                        for conv_file in conv_files:
                            dt = self.parse_conv_filename_time(conv_file.name)
                            if dt:
                                timestamps.append(dt)

                        if not timestamps:
                            print(f"  No valid conv files")
                            continue

                        min_time = min(timestamps)
                        max_time = max(timestamps)

                        print(f"  Conv time: {min_time.strftime('%Y-%m-%d %H:%M:%S')} to {max_time.strftime('%Y-%m-%d %H:%M:%S')}")
                        print(f"  Conv files: {len(timestamps)}")

                        # 创建输出目录
                        project_output = output_path / zip_path.stem
                        camel_output = project_output / "camel_logs"
                        browser_output = project_output / "browser_logs"
                        camel_output.mkdir(parents=True, exist_ok=True)
                        browser_output.mkdir(parents=True, exist_ok=True)

                        # 复制conv文件
                        for conv_file in conv_files:
                            shutil.copy2(conv_file, camel_output / conv_file.name)

                        # 查找Archive内部的browser_log
                        archive_browser_logs = list(temp_path.rglob("**/hybrid_browser*.log"))

                        if archive_browser_logs:
                            print(f"  Found {len(archive_browser_logs)} browser logs in archive")
                            for log_file in archive_browser_logs:
                                shutil.copy2(log_file, browser_output / log_file.name)
                                print(f"  ✓ Copied: {log_file.name}")
                            matched_count += len(archive_browser_logs)
                        else:
                            print(f"  No browser logs found in archive")

                    except Exception as e:
                        print(f"  Error: {e}")

        total_projects = len(project_dirs) + len(project_zips) + len(archive_zips)
        print(f"\n{'='*80}")
        print(f"Summary: Matched {matched_count} browser logs across {total_projects} projects")
        print(f"  Directories: {len(project_dirs)}")
        print(f"  Project zips: {len(project_zips)}")
        print(f"  Archive zips: {len(archive_zips)}")
        print(f"Output: {output_path}")
        print(f"{'='*80}")

    def match_saed_logs(self,
                        project_zip_dir: str,
                        browser_log_zip_dir: str,
                        output_dir: str):
        """
        任务2: 从Downloads/saed提取camel_logs，匹配到微信文件夹/saed的browser_log
        """
        project_path = Path(project_zip_dir)
        browser_path = Path(browser_log_zip_dir)
        output_path = Path(output_dir)

        print(f"\n{'='*80}")
        print(f"Task 2: Matching saed logs")
        print(f"Projects from: {project_zip_dir}")
        print(f"Browser logs from: {browser_log_zip_dir}")
        print(f"{'='*80}")

        # 获取project zip文件
        project_zips = sorted(project_path.glob("project*.zip"))
        print(f"\nFound {len(project_zips)} project zip files")

        # 获取browser_log zip文件
        browser_zips = sorted(browser_path.glob("browser_log*.zip"))
        print(f"Found {len(browser_zips)} browser_log zip files")

        # 先收集所有browser_log
        print(f"\nExtracting browser logs from zip files...")
        temp_browser_dir = Path("/tmp/saed_browser_logs_temp")
        temp_browser_dir.mkdir(exist_ok=True)

        browser_logs = {}

        for i, browser_zip in enumerate(browser_zips, 1):
            print(f"  [{i}/{len(browser_zips)}] {browser_zip.name}")

            with tempfile.TemporaryDirectory() as temp_dir:
                temp_path = Path(temp_dir)

                try:
                    with zipfile.ZipFile(browser_zip, 'r') as zip_ref:
                        zip_ref.extractall(temp_path)

                    log_files = list(temp_path.rglob("**/hybrid_browser*.log"))

                    for log_file in log_files:
                        log_time = self.parse_browser_log_time(log_file.name)
                        if log_time:
                            saved_path = temp_browser_dir / log_file.name
                            if not saved_path.exists():
                                shutil.copy2(log_file, saved_path)
                            browser_logs[log_file.name] = (log_time, saved_path)

                except Exception as e:
                    print(f"    Error: {e}")

        print(f"Total browser logs collected: {len(browser_logs)}")

        if browser_logs:
            times = [t for t, _ in browser_logs.values()]
            print(f"Browser log time range: {min(times).strftime('%Y-%m-%d %H:%M')} to {max(times).strftime('%Y-%m-%d %H:%M')}")

        # 处理每个project zip
        matched_count = 0

        print(f"\nProcessing project zips...")

        for i, zip_path in enumerate(project_zips, 1):
            print(f"\n[{i}/{len(project_zips)}] {zip_path.name}")

            with tempfile.TemporaryDirectory() as temp_dir:
                temp_path = Path(temp_dir)

                try:
                    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                        zip_ref.extractall(temp_path)

                    # 查找conv文件
                    conv_files = list(temp_path.rglob("**/conv*.json"))

                    if not conv_files:
                        print(f"  No conv files found")
                        continue

                    # 解析时间
                    timestamps = []
                    for conv_file in conv_files:
                        dt = self.parse_conv_filename_time(conv_file.name)
                        if dt:
                            timestamps.append(dt)

                    if not timestamps:
                        print(f"  No valid conv files")
                        continue

                    min_time = min(timestamps)
                    max_time = max(timestamps)

                    print(f"  Conv time: {min_time.strftime('%Y-%m-%d %H:%M:%S')} to {max_time.strftime('%Y-%m-%d %H:%M:%S')}")
                    print(f"  Conv files: {len(timestamps)}")

                    # 创建输出目录
                    project_output = output_path / zip_path.stem
                    camel_output = project_output / "camel_logs"
                    browser_output = project_output / "browser_logs"
                    camel_output.mkdir(parents=True, exist_ok=True)
                    browser_output.mkdir(parents=True, exist_ok=True)

                    # 复制conv文件
                    for conv_file in conv_files:
                        shutil.copy2(conv_file, camel_output / conv_file.name)

                    # 匹配browser_log
                    project_matched = 0
                    for log_name, (log_time, log_path) in browser_logs.items():
                        if min_time <= log_time <= max_time:
                            shutil.copy2(log_path, browser_output / log_name)
                            project_matched += 1
                            print(f"  ✓ Matched: {log_name} ({log_time.strftime('%H:%M:%S')})")

                    matched_count += project_matched

                    if project_matched == 0:
                        print(f"  No matching browser logs")

                except Exception as e:
                    print(f"  Error: {e}")

        # 清理临时目录
        shutil.rmtree(temp_browser_dir, ignore_errors=True)

        print(f"\n{'='*80}")
        print(f"Summary: Matched {matched_count} browser logs across {len(project_zips)} projects")
        print(f"Output: {output_path}")
        print(f"{'='*80}")


def main():
    """主函数"""
    matcher = AdditionalLogMatcher()

    print("Additional Log Matching Tool v3")
    print("="*80)

    # 任务1: pengcheng
    print("\n>>> Task 1: Matching pengcheng projects")
    matcher.match_pengcheng_projects(
        project_source_dir="/Users/puzhen/Downloads/pengcheng",
        browser_log_source="/Users/puzhen/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_pv2qqr16e4k622_c24e/msg/file/2025-11/browser_log",
        output_dir="/Users/puzhen/Desktop/matched_logs/pengcheng"
    )

    # 任务2: saed
    print("\n\n>>> Task 2: Matching saed logs")
    matcher.match_saed_logs(
        project_zip_dir="/Users/puzhen/Downloads/saed",
        browser_log_zip_dir="/Users/puzhen/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_pv2qqr16e4k622_c24e/msg/file/2025-11/saed",
        output_dir="/Users/puzhen/Desktop/matched_logs/saed"
    )

    print("\n\n" + "="*80)
    print("All tasks completed!")
    print("Check /Users/puzhen/Desktop/matched_logs/ for results")
    print("="*80)


if __name__ == "__main__":
    main()
