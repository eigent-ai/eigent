#!/usr/bin/env python3
"""
从指定文件夹中的zip归档文件提取对应时间的browser_log

功能：
1. 遍历指定文件夹中的所有zip文件
2. 临时解压每个zip文件
3. 找到camel_logs文件夹中的conv文件，获取时间跨度
4. 在同级目录中找到对应时间的hybrid_browser日志
5. 复制匹配的日志到输出目录
"""

import os
import re
import zipfile
import shutil
import tempfile
from pathlib import Path
from datetime import datetime
from typing import List, Tuple, Optional, Dict


class ArchiveLogExtractor:
    """从归档文件中提取browser_log的工具"""

    def __init__(self):
        """初始化提取器"""
        pass

    def parse_conv_filename_time(self, filename: str) -> Optional[datetime]:
        """
        从conv文件名中解析时间

        文件名格式: conv_YYYYMMDD_HHMMSS_xxx.json

        Args:
            filename: 文件名

        Returns:
            datetime对象 或 None
        """
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

    def get_conv_time_range_from_dir(self, directory: Path) -> Optional[Tuple[datetime, datetime]]:
        """
        从目录中获取conv文件的时间跨度（从文件名解析）
        递归搜索所有子目录中的camel_logs

        Args:
            directory: 包含camel_logs的目录

        Returns:
            (最早时间, 最晚时间) 或 None
        """
        # 递归查找所有camel_logs目录（支持任意深度）
        camel_logs_dirs = list(directory.rglob("**/camel_logs"))

        if not camel_logs_dirs:
            # 如果没找到camel_logs目录，尝试直接查找conv文件
            conv_files = list(directory.rglob("**/conv*.json"))
            if not conv_files:
                print(f"  Warning: No camel_logs or conv files found")
                return None

            # 直接从conv文件解析时间
            timestamps = []
            for conv_file in conv_files:
                dt = self.parse_conv_filename_time(conv_file.name)
                if dt:
                    timestamps.append(dt)

            if not timestamps:
                print(f"  Warning: No valid conv files found")
                return None

            return min(timestamps), max(timestamps)

        # 收集所有conv文件的时间（从文件名解析）
        timestamps = []

        for camel_logs_dir in camel_logs_dirs:
            conv_files = list(camel_logs_dir.glob("conv*.json"))

            for conv_file in conv_files:
                # 从文件名解析时间，而不是使用文件系统时间戳
                dt = self.parse_conv_filename_time(conv_file.name)
                if dt:
                    timestamps.append(dt)

        if not timestamps:
            print(f"  Warning: No valid conv files found in camel_logs")
            return None

        # 返回时间跨度
        min_time = min(timestamps)
        max_time = max(timestamps)

        return min_time, max_time

    def parse_browser_log_time(self, filename: str) -> Optional[datetime]:
        """
        从browser_log文件名中解析时间

        文件名格式: hybrid_browser_toolkit_ws_YYYYMMDD_HHMMSS_xxx.log

        Args:
            filename: 文件名

        Returns:
            datetime对象 或 None
        """
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

    def find_matching_browser_logs(self, directory: Path, time_range: Tuple[datetime, datetime]) -> List[Path]:
        """
        在目录中递归查找时间匹配的browser_log文件

        Args:
            directory: 要搜索的目录
            time_range: (最早时间, 最晚时间)

        Returns:
            匹配的browser_log文件路径列表
        """
        min_time, max_time = time_range
        matching_files = []

        # 递归查找所有hybrid_browser日志文件（支持任意深度）
        for log_file in directory.rglob("**/hybrid_browser*.log"):
            log_time = self.parse_browser_log_time(log_file.name)

            if log_time is None:
                continue

            # 检查时间是否在跨度内
            if min_time <= log_time <= max_time:
                matching_files.append(log_file)

        return sorted(matching_files)

    def process_zip_file(self, zip_path: Path, output_dir: Path) -> Dict[str, any]:
        """
        处理单个zip文件

        Args:
            zip_path: zip文件路径
            output_dir: 输出目录

        Returns:
            处理结果字典
        """
        result = {
            'zip_name': zip_path.name,
            'time_range': None,
            'browser_logs': [],
            'success': False,
            'error': None
        }

        # 创建临时目录
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            try:
                # 解压zip文件
                with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                    zip_ref.extractall(temp_path)

                # 获取conv文件的时间跨度
                time_range = self.get_conv_time_range_from_dir(temp_path)

                if time_range is None:
                    result['error'] = 'No conv files found'
                    return result

                result['time_range'] = time_range
                min_time, max_time = time_range

                print(f"    Time range: {min_time.strftime('%Y-%m-%d %H:%M:%S')} to {max_time.strftime('%Y-%m-%d %H:%M:%S')}")

                # 查找匹配的browser_log
                matching_logs = self.find_matching_browser_logs(temp_path, time_range)

                if not matching_logs:
                    print(f"    No matching browser logs found")
                    result['success'] = True
                    return result

                # 创建输出子目录（以zip文件名命名）
                zip_output_dir = output_dir / zip_path.stem
                zip_output_dir.mkdir(parents=True, exist_ok=True)

                # 复制camel_logs目录
                camel_logs_dirs = list(temp_path.rglob("**/camel_logs"))
                if camel_logs_dirs:
                    camel_output_dir = zip_output_dir / "camel_logs"
                    camel_output_dir.mkdir(parents=True, exist_ok=True)

                    for camel_dir in camel_logs_dirs:
                        conv_files = list(camel_dir.glob("conv*.json"))
                        for conv_file in conv_files:
                            dst_file = camel_output_dir / conv_file.name
                            shutil.copy2(conv_file, dst_file)

                    print(f"    ✓ Copied {len(list(camel_output_dir.glob('conv*.json')))} conv files to camel_logs/")

                # 创建browser_logs子目录并复制匹配的browser_log文件
                if matching_logs:
                    browser_output_dir = zip_output_dir / "browser_logs"
                    browser_output_dir.mkdir(parents=True, exist_ok=True)

                    for log_file in matching_logs:
                        dst_file = browser_output_dir / log_file.name
                        shutil.copy2(log_file, dst_file)
                        result['browser_logs'].append(log_file.name)

                        log_time = self.parse_browser_log_time(log_file.name)
                        print(f"    ✓ Extracted: {log_file.name} ({log_time.strftime('%Y-%m-%d %H:%M:%S')})")

                result['success'] = True

            except Exception as e:
                result['error'] = str(e)
                print(f"    Error: {e}")

        return result

    def process_directory(self, source_dir: str, output_base_dir: str) -> Dict[str, List]:
        """
        处理目录中的所有zip文件

        Args:
            source_dir: 源目录路径
            output_base_dir: 输出基础目录

        Returns:
            处理结果字典
        """
        source_path = Path(source_dir)
        output_path = Path(output_base_dir)

        if not source_path.exists():
            raise FileNotFoundError(f"Source directory not found: {source_dir}")

        # 创建输出目录（以源文件夹名命名）
        dir_output = output_path / source_path.name
        dir_output.mkdir(parents=True, exist_ok=True)

        # 查找所有zip文件
        zip_files = sorted(source_path.glob("*.zip"))

        if not zip_files:
            print(f"No zip files found in {source_dir}")
            return {'results': [], 'summary': {
                'total_zips': 0,
                'successful': 0,
                'total_browser_logs': 0,
                'output_dir': str(dir_output)
            }}

        print(f"\n{'='*80}")
        print(f"Processing directory: {source_path.name}")
        print(f"Found {len(zip_files)} zip files")
        print(f"{'='*80}")

        results = []

        for i, zip_file in enumerate(zip_files, 1):
            print(f"\n[{i}/{len(zip_files)}] Processing: {zip_file.name}")
            print(f"  {'-'*76}")

            result = self.process_zip_file(zip_file, dir_output)
            results.append(result)

        # 统计
        successful = sum(1 for r in results if r['success'])
        total_logs = sum(len(r['browser_logs']) for r in results)

        summary = {
            'total_zips': len(zip_files),
            'successful': successful,
            'total_browser_logs': total_logs,
            'output_dir': str(dir_output)
        }

        print(f"\n{'='*80}")
        print(f"Summary for {source_path.name}:")
        print(f"  Total zip files: {summary['total_zips']}")
        print(f"  Successfully processed: {summary['successful']}")
        print(f"  Total browser logs extracted: {summary['total_browser_logs']}")
        print(f"  Output directory: {summary['output_dir']}")
        print(f"{'='*80}")

        return {'results': results, 'summary': summary}


def batch_process_directories(directories: List[str], output_base_dir: str):
    """
    批量处理多个目录

    Args:
        directories: 目录列表
        output_base_dir: 输出基础目录
    """
    extractor = ArchiveLogExtractor()

    all_summaries = []

    for directory in directories:
        try:
            result = extractor.process_directory(directory, output_base_dir)
            all_summaries.append((directory, result['summary']))
        except Exception as e:
            print(f"\nError processing {directory}: {e}")
            continue

    # 总体统计
    print(f"\n\n{'='*80}")
    print(f"OVERALL SUMMARY")
    print(f"{'='*80}")

    total_zips = 0
    total_logs = 0

    for directory, summary in all_summaries:
        dir_name = Path(directory).name
        print(f"\n{dir_name}:")
        print(f"  Zip files: {summary['total_zips']}")
        print(f"  Browser logs: {summary['total_browser_logs']}")
        print(f"  Output: {summary['output_dir']}")

        total_zips += summary['total_zips']
        total_logs += summary['total_browser_logs']

    print(f"\n{'-'*80}")
    print(f"Total across all directories:")
    print(f"  Total zip files processed: {total_zips}")
    print(f"  Total browser logs extracted: {total_logs}")
    print(f"{'='*80}")


def main():
    """主函数"""

    # 定义要处理的目录
    directories = [
        "/Users/puzhen/Downloads/Tao sun",
        "/Users/puzhen/Downloads/pengcheng",
        "/Users/puzhen/Downloads/waleed",
        "/Users/puzhen/Downloads/puzhen",
        "/Users/puzhen/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_pv2qqr16e4k622_c24e/msg/file/2025-11/saed"
    ]

    # 输出目录
    output_base_dir = "/Users/puzhen/Desktop/extracted_browser_logs"

    print("Browser Log Extraction from Archives")
    print("="*80)
    print(f"Output directory: {output_base_dir}")
    print()

    # 批量处理
    batch_process_directories(directories, output_base_dir)


if __name__ == "__main__":
    main()
