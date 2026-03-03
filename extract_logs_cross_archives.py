#!/usr/bin/env python3
"""
跨zip文件提取browser_log

适用场景：
- project和browser_log分别在不同的zip文件中
- 需要根据project中的conv时间跨度，在browser_log zip中找到匹配的日志

策略：
1. 先解压所有project*.zip，提取conv文件的时间跨度
2. 再解压所有browser_log*.zip，提取匹配时间的hybrid_browser日志
"""

import os
import re
import zipfile
import shutil
import tempfile
from pathlib import Path
from datetime import datetime
from typing import List, Tuple, Optional, Dict


class CrossArchiveExtractor:
    """跨归档文件提取browser_log的工具"""

    def __init__(self):
        """初始化提取器"""
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
            dt = datetime.strptime(f"{date_str}_{time_str}", "%Y%m%d_%H%M%S")
            return dt
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
            dt = datetime.strptime(f"{date_str}_{time_str}", "%Y%m%d_%H%M%S")
            return dt
        except ValueError:
            return None

    def extract_project_time_ranges(self, project_dir: Path, output_dir: Path) -> Dict[str, Tuple[datetime, datetime]]:
        """
        提取所有project zip文件的时间跨度，并复制camel_logs

        Args:
            project_dir: 包含project*.zip的目录
            output_dir: 输出目录

        Returns:
            {zip_name: (min_time, max_time)}
        """
        project_zips = sorted(project_dir.glob("project*.zip"))
        time_ranges = {}

        print(f"\n{'='*80}")
        print(f"Extracting time ranges from {len(project_zips)} project archives...")
        print(f"{'='*80}")

        for i, zip_path in enumerate(project_zips, 1):
            print(f"\n[{i}/{len(project_zips)}] Processing: {zip_path.name}")

            with tempfile.TemporaryDirectory() as temp_dir:
                temp_path = Path(temp_dir)

                try:
                    # 解压
                    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                        zip_ref.extractall(temp_path)

                    # 查找所有conv文件
                    conv_files = list(temp_path.rglob("**/conv*.json"))

                    if not conv_files:
                        print(f"  Warning: No conv files found")
                        continue

                    # 解析时间
                    timestamps = []
                    for conv_file in conv_files:
                        dt = self.parse_conv_filename_time(conv_file.name)
                        if dt:
                            timestamps.append(dt)

                    if not timestamps:
                        print(f"  Warning: No valid conv files found")
                        continue

                    min_time = min(timestamps)
                    max_time = max(timestamps)

                    time_ranges[zip_path.name] = (min_time, max_time)

                    print(f"  Time range: {min_time.strftime('%Y-%m-%d %H:%M:%S')} to {max_time.strftime('%Y-%m-%d %H:%M:%S')}")
                    print(f"  Conv files: {len(timestamps)}")

                    # 复制camel_logs到输出目录
                    project_output = output_dir / zip_path.stem
                    camel_output_dir = project_output / "camel_logs"
                    camel_output_dir.mkdir(parents=True, exist_ok=True)

                    for conv_file in conv_files:
                        dst_file = camel_output_dir / conv_file.name
                        shutil.copy2(conv_file, dst_file)

                    print(f"  ✓ Copied {len(conv_files)} conv files to camel_logs/")

                except Exception as e:
                    print(f"  Error: {e}")

        return time_ranges

    def extract_matching_browser_logs(self,
                                      browser_dir: Path,
                                      time_ranges: Dict[str, Tuple[datetime, datetime]],
                                      output_dir: Path) -> Dict[str, List[str]]:
        """
        从browser_log zip中提取匹配时间的日志

        Args:
            browser_dir: 包含browser_log*.zip的目录
            time_ranges: 项目时间跨度字典
            output_dir: 输出目录

        Returns:
            {project_name: [matched_log_files]}
        """
        browser_zips = sorted(browser_dir.glob("browser_log*.zip"))

        if not browser_zips:
            print("\nWarning: No browser_log zip files found")
            return {}

        print(f"\n{'='*80}")
        print(f"Extracting and matching browser logs...")
        print(f"{'='*80}")

        # 为每个project匹配browser_log
        results = {project_name: [] for project_name in time_ranges.keys()}

        # 遍历每个browser_log zip文件
        for i, zip_path in enumerate(browser_zips, 1):
            print(f"\n[{i}/{len(browser_zips)}] Processing: {zip_path.name}")

            with tempfile.TemporaryDirectory() as temp_dir:
                temp_path = Path(temp_dir)

                try:
                    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                        zip_ref.extractall(temp_path)

                    # 查找所有hybrid_browser日志
                    browser_files = list(temp_path.rglob("**/hybrid_browser*.log"))
                    print(f"  Found {len(browser_files)} browser logs")

                    # 匹配每个browser_log到project
                    for log_file in browser_files:
                        log_time = self.parse_browser_log_time(log_file.name)

                        if not log_time:
                            continue

                        # 检查是否匹配任何project
                        for project_name, (min_time, max_time) in time_ranges.items():
                            if min_time <= log_time <= max_time:
                                # 复制到输出目录的browser_logs子目录
                                project_output = output_dir / project_name.replace('.zip', '')
                                browser_output_dir = project_output / "browser_logs"
                                browser_output_dir.mkdir(parents=True, exist_ok=True)

                                dst_file = browser_output_dir / log_file.name
                                shutil.copy2(log_file, dst_file)

                                results[project_name].append(log_file.name)
                                print(f"    ✓ Matched {log_file.name} to {project_name}")

                except Exception as e:
                    print(f"  Error: {e}")

        # 输出匹配结果
        print(f"\n{'='*80}")
        print(f"Matching Summary")
        print(f"{'='*80}")

        for project_name, matched_logs in results.items():
            if matched_logs:
                min_time, max_time = time_ranges[project_name]
                print(f"\n{project_name}:")
                print(f"  Time range: {min_time.strftime('%Y-%m-%d %H:%M:%S')} to {max_time.strftime('%Y-%m-%d %H:%M:%S')}")
                print(f"  Matched {len(matched_logs)} browser logs")

        return results

    def process_directory(self, source_dir: str, output_base_dir: str):
        """
        处理包含project和browser_log分离的目录

        Args:
            source_dir: 源目录路径
            output_base_dir: 输出基础目录
        """
        source_path = Path(source_dir)
        output_path = Path(output_base_dir)

        if not source_path.exists():
            raise FileNotFoundError(f"Source directory not found: {source_dir}")

        # 创建输出目录
        dir_output = output_path / source_path.name
        dir_output.mkdir(parents=True, exist_ok=True)

        print(f"\n{'='*80}")
        print(f"Processing directory: {source_path.name}")
        print(f"Output: {dir_output}")
        print(f"{'='*80}")

        # Step 1: 提取project时间跨度并复制camel_logs
        time_ranges = self.extract_project_time_ranges(source_path, dir_output)

        if not time_ranges:
            print("\nNo valid project archives found or no conv files in projects")
            return

        # Step 2: 匹配并提取browser_log
        results = self.extract_matching_browser_logs(source_path, time_ranges, dir_output)

        # 统计
        total_logs = sum(len(logs) for logs in results.values())

        print(f"\n{'='*80}")
        print(f"Summary for {source_path.name}:")
        print(f"  Total projects: {len(time_ranges)}")
        print(f"  Total browser logs extracted: {total_logs}")
        print(f"  Output directory: {dir_output}")
        print(f"{'='*80}")

        return results


def main():
    """主函数"""

    # 要处理的目录（project和browser_log分离的）
    directories = [
        "/Users/puzhen/Downloads/waleed",
        "/Users/puzhen/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_pv2qqr16e4k622_c24e/msg/file/2025-11/saed"
    ]

    # 输出目录
    output_base_dir = "/Users/puzhen/Desktop/extracted_browser_logs_separated"

    print("Cross-Archive Browser Log Extraction")
    print("="*80)
    print(f"Output directory: {output_base_dir}")
    print()

    extractor = CrossArchiveExtractor()

    all_results = []

    for directory in directories:
        try:
            if Path(directory).exists():
                results = extractor.process_directory(directory, output_base_dir)
                all_results.append((directory, results))
            else:
                print(f"\nSkipping non-existent directory: {directory}")
        except Exception as e:
            print(f"\nError processing {directory}: {e}")
            continue

    # 总体统计
    print(f"\n\n{'='*80}")
    print(f"OVERALL SUMMARY")
    print(f"{'='*80}")

    for directory, results in all_results:
        dir_name = Path(directory).name
        total_logs = sum(len(logs) for logs in results.values()) if results else 0
        print(f"\n{dir_name}:")
        print(f"  Projects: {len(results) if results else 0}")
        print(f"  Browser logs: {total_logs}")

    print(f"{'='*80}")


if __name__ == "__main__":
    main()
