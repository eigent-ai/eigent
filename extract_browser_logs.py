#!/usr/bin/env python3
"""
算法：根据project文件夹提取对应时间段的browser_log文件

功能：
1. 从project文件夹中找到所有conv文件
2. 获取conv文件的创建时间跨度（最早到最晚）
3. 从browser_log目录中提取时间有重叠的browser_log文件
4. 排除typescript相关的log文件
"""

import os
import re
from pathlib import Path
from datetime import datetime
from typing import List, Tuple, Optional


class BrowserLogExtractor:
    """browser_log文件提取器"""

    def __init__(self, browser_log_dir: str = "/Users/puzhen/Desktop/pre/camel_project/eigent/backend/browser_log"):
        """
        初始化提取器

        Args:
            browser_log_dir: browser_log文件夹路径
        """
        self.browser_log_dir = Path(browser_log_dir)

    def get_conv_time_range(self, project_dir: str) -> Optional[Tuple[datetime, datetime]]:
        """
        获取project文件夹中conv文件的时间跨度

        Args:
            project_dir: project文件夹路径

        Returns:
            (最早时间, 最晚时间) 或 None（如果没有找到conv文件）
        """
        project_path = Path(project_dir)

        if not project_path.exists():
            raise FileNotFoundError(f"Project directory not found: {project_dir}")

        # 找到所有conv文件
        conv_files = list(project_path.rglob("conv*.json"))

        if not conv_files:
            print(f"Warning: No conv files found in {project_dir}")
            return None

        # 提取所有conv文件的创建时间
        timestamps = []
        for conv_file in conv_files:
            timestamp = conv_file.stat().st_birthtime
            timestamps.append(timestamp)

        # 返回时间跨度
        min_timestamp = min(timestamps)
        max_timestamp = max(timestamps)

        min_time = datetime.fromtimestamp(min_timestamp)
        max_time = datetime.fromtimestamp(max_timestamp)

        return min_time, max_time

    def parse_browser_log_time(self, filename: str) -> Optional[datetime]:
        """
        从browser_log文件名中解析时间

        文件名格式: hybrid_browser_toolkit_ws_YYYYMMDD_HHMMSS_xxx.log

        Args:
            filename: 文件名

        Returns:
            datetime对象 或 None（如果解析失败）
        """
        # 匹配模式: hybrid_browser_toolkit_ws_YYYYMMDD_HHMMSS_xxx.log
        pattern = r'hybrid_browser_toolkit_ws_(\d{8})_(\d{6})_\w+\.log'
        match = re.match(pattern, filename)

        if not match:
            return None

        date_str = match.group(1)  # YYYYMMDD
        time_str = match.group(2)  # HHMMSS

        try:
            # 解析时间
            dt = datetime.strptime(f"{date_str}_{time_str}", "%Y%m%d_%H%M%S")
            return dt
        except ValueError:
            return None

    def extract_matching_logs(self, project_dir: str, output_dir: Optional[str] = None) -> List[str]:
        """
        提取与project时间跨度重叠的browser_log文件

        Args:
            project_dir: project文件夹路径
            output_dir: 输出目录（可选，如果提供则复制文件到该目录）

        Returns:
            匹配的browser_log文件路径列表
        """
        # 获取conv文件的时间跨度
        time_range = self.get_conv_time_range(project_dir)

        if time_range is None:
            print("No conv files found, cannot extract browser logs")
            return []

        min_time, max_time = time_range

        print(f"Project: {Path(project_dir).name}")
        print(f"Time range: {min_time.strftime('%Y-%m-%d %H:%M:%S')} to {max_time.strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"Duration: {(max_time - min_time).total_seconds():.1f} seconds")
        print()

        # 遍历browser_log目录，找到时间重叠的文件
        matching_files = []

        if not self.browser_log_dir.exists():
            raise FileNotFoundError(f"Browser log directory not found: {self.browser_log_dir}")

        for log_file in self.browser_log_dir.iterdir():
            if not log_file.is_file():
                continue

            # 跳过typescript相关的log
            if 'typescript' in log_file.name.lower():
                continue

            # 解析文件名中的时间
            log_time = self.parse_browser_log_time(log_file.name)

            if log_time is None:
                continue

            # 检查时间是否重叠
            # 考虑到browser_log可能会持续一段时间，我们给一些缓冲时间
            # 如果log文件时间在 [min_time - buffer, max_time + buffer] 范围内，就认为重叠
            if min_time <= log_time <= max_time:
                matching_files.append(str(log_file))

        # 按时间排序
        matching_files.sort()

        print(f"Found {len(matching_files)} matching browser log files:")
        for i, f in enumerate(matching_files, 1):
            filename = Path(f).name
            log_time = self.parse_browser_log_time(filename)
            print(f"  {i}. {filename} ({log_time.strftime('%Y-%m-%d %H:%M:%S')})")

        # 如果提供了输出目录，复制文件
        if output_dir:
            output_path = Path(output_dir)
            output_path.mkdir(parents=True, exist_ok=True)

            import shutil
            for src_file in matching_files:
                dst_file = output_path / Path(src_file).name
                shutil.copy2(src_file, dst_file)

            print(f"\nCopied {len(matching_files)} files to {output_dir}")

        return matching_files


def main():
    """示例用法"""
    extractor = BrowserLogExtractor()

    # 示例1: 提取单个project的browser_log
    project_dir = "/Users/puzhen/.eigent/hentai/project_1764177547496-7110"

    print("=" * 60)
    print("示例1: 提取单个project的browser_log")
    print("=" * 60)

    matching_logs = extractor.extract_matching_logs(project_dir)

    print("\n" + "=" * 60)
    print("示例2: 提取并复制到指定目录")
    print("=" * 60)

    # 示例2: 提取并复制到指定目录
    output_dir = "/tmp/extracted_browser_logs"
    matching_logs = extractor.extract_matching_logs(project_dir, output_dir)


if __name__ == "__main__":
    main()
