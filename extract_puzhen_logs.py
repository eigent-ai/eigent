#!/usr/bin/env python3
"""
为puzhen文件夹提取camel_logs和browser_logs

文件夹结构：
- 多个已解压的project文件夹（命名格式：XX_modelname_project_xxx）
- 统一的browser_log目录

功能：
1. 从每个project文件夹提取camel_logs中的conv文件
2. 根据conv文件的时间跨度，从browser_log目录匹配对应的browser_log
3. 将camel_logs和browser_logs组织在同一个输出文件夹中
"""

import os
import re
import shutil
from pathlib import Path
from datetime import datetime
from typing import List, Tuple, Optional, Dict


class PuzhenLogExtractor:
    """puzhen文件夹日志提取器"""

    def __init__(self, source_dir: str, browser_log_dir: str, output_dir: str):
        """
        初始化提取器

        Args:
            source_dir: 包含project文件夹的目录
            browser_log_dir: browser_log目录
            output_dir: 输出目录
        """
        self.source_dir = Path(source_dir)
        self.browser_log_dir = Path(browser_log_dir)
        self.output_dir = Path(output_dir)

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

    def get_conv_time_range(self, project_dir: Path) -> Optional[Tuple[datetime, datetime]]:
        """
        获取project文件夹中conv文件的时间跨度

        Args:
            project_dir: project文件夹路径

        Returns:
            (最早时间, 最晚时间) 或 None
        """
        # 查找camel_logs目录
        camel_logs_dirs = list(project_dir.rglob("**/camel_logs"))

        if not camel_logs_dirs:
            return None

        # 收集所有conv文件的时间
        timestamps = []

        for camel_logs_dir in camel_logs_dirs:
            conv_files = list(camel_logs_dir.glob("conv*.json"))

            for conv_file in conv_files:
                dt = self.parse_conv_filename_time(conv_file.name)
                if dt:
                    timestamps.append(dt)

        if not timestamps:
            return None

        return min(timestamps), max(timestamps)

    def find_matching_browser_logs(self, time_range: Tuple[datetime, datetime]) -> List[Path]:
        """
        在browser_log目录中查找匹配时间的browser_log

        Args:
            time_range: (最早时间, 最晚时间)

        Returns:
            匹配的browser_log文件列表
        """
        min_time, max_time = time_range
        matching_logs = []

        # 查找所有hybrid_browser日志
        for log_file in self.browser_log_dir.glob("hybrid_browser*.log"):
            log_time = self.parse_browser_log_time(log_file.name)

            if log_time is None:
                continue

            # 检查时间是否在跨度内
            if min_time <= log_time <= max_time:
                matching_logs.append(log_file)

        return sorted(matching_logs)

    def process_project(self, project_dir: Path) -> Dict[str, any]:
        """
        处理单个project文件夹

        Args:
            project_dir: project文件夹路径

        Returns:
            处理结果字典
        """
        project_name = project_dir.name
        result = {
            'project_name': project_name,
            'conv_count': 0,
            'browser_log_count': 0,
            'time_range': None,
            'success': False
        }

        print(f"\n{'='*80}")
        print(f"Processing: {project_name}")
        print(f"{'='*80}")

        # 获取时间跨度
        time_range = self.get_conv_time_range(project_dir)

        if time_range is None:
            print(f"  Warning: No conv files found")
            return result

        min_time, max_time = time_range
        result['time_range'] = time_range

        print(f"  Time range: {min_time.strftime('%Y-%m-%d %H:%M:%S')} to {max_time.strftime('%Y-%m-%d %H:%M:%S')}")

        # 创建输出目录
        output_project_dir = self.output_dir / project_name
        output_project_dir.mkdir(parents=True, exist_ok=True)

        # 复制camel_logs
        camel_output_dir = output_project_dir / "camel_logs"
        camel_output_dir.mkdir(parents=True, exist_ok=True)

        camel_logs_dirs = list(project_dir.rglob("**/camel_logs"))
        conv_count = 0

        for camel_dir in camel_logs_dirs:
            conv_files = list(camel_dir.glob("conv*.json"))
            for conv_file in conv_files:
                dst_file = camel_output_dir / conv_file.name
                shutil.copy2(conv_file, dst_file)
                conv_count += 1

        result['conv_count'] = conv_count
        print(f"  ✓ Copied {conv_count} conv files to camel_logs/")

        # 查找并复制匹配的browser_log
        matching_logs = self.find_matching_browser_logs(time_range)

        if matching_logs:
            browser_output_dir = output_project_dir / "browser_logs"
            browser_output_dir.mkdir(parents=True, exist_ok=True)

            for log_file in matching_logs:
                dst_file = browser_output_dir / log_file.name
                shutil.copy2(log_file, dst_file)
                log_time = self.parse_browser_log_time(log_file.name)
                print(f"  ✓ Matched: {log_file.name} ({log_time.strftime('%H:%M:%S')})")

            result['browser_log_count'] = len(matching_logs)
        else:
            print(f"  Warning: No matching browser logs found")

        result['success'] = True
        return result

    def process_all(self) -> Dict[str, List]:
        """
        处理所有project文件夹

        Returns:
            处理结果
        """
        # 查找所有project文件夹（匹配命名格式）
        project_dirs = []
        for item in self.source_dir.iterdir():
            if item.is_dir() and item.name != "browser_log":
                # 匹配格式：XX_modelname_project_xxx
                if "_project_" in item.name:
                    project_dirs.append(item)

        project_dirs.sort()

        print(f"\n{'='*80}")
        print(f"Puzhen Log Extraction")
        print(f"{'='*80}")
        print(f"Source directory: {self.source_dir}")
        print(f"Browser log directory: {self.browser_log_dir}")
        print(f"Output directory: {self.output_dir}")
        print(f"Found {len(project_dirs)} project folders")
        print(f"{'='*80}")

        # 处理每个project
        results = []
        for i, project_dir in enumerate(project_dirs, 1):
            print(f"\n[{i}/{len(project_dirs)}] {project_dir.name}")
            result = self.process_project(project_dir)
            results.append(result)

        # 统计
        total_conv = sum(r['conv_count'] for r in results)
        total_browser_logs = sum(r['browser_log_count'] for r in results)
        successful = sum(1 for r in results if r['success'])

        print(f"\n{'='*80}")
        print(f"Summary")
        print(f"{'='*80}")
        print(f"Total projects processed: {len(results)}")
        print(f"Successful: {successful}")
        print(f"Total conv files: {total_conv}")
        print(f"Total browser logs: {total_browser_logs}")
        print(f"Output directory: {self.output_dir}")
        print(f"{'='*80}")

        # 详细列表
        print(f"\nDetailed Results:")
        print(f"{'-'*80}")
        for result in results:
            if result['success']:
                print(f"{result['project_name']}:")
                print(f"  Conv files: {result['conv_count']}")
                print(f"  Browser logs: {result['browser_log_count']}")
                if result['time_range']:
                    min_t, max_t = result['time_range']
                    print(f"  Time range: {min_t.strftime('%Y-%m-%d %H:%M:%S')} to {max_t.strftime('%Y-%m-%d %H:%M:%S')}")
                print()

        return {'results': results, 'summary': {
            'total_projects': len(results),
            'successful': successful,
            'total_conv': total_conv,
            'total_browser_logs': total_browser_logs
        }}


def main():
    """主函数"""

    # 配置路径
    source_dir = "/Users/puzhen/Downloads/puzhen"
    browser_log_dir = "/Users/puzhen/Downloads/puzhen/browser_log"
    output_dir = "/Users/puzhen/Desktop/extracted_browser_logs/puzhen"

    # 创建提取器并运行
    extractor = PuzhenLogExtractor(source_dir, browser_log_dir, output_dir)
    results = extractor.process_all()


if __name__ == "__main__":
    main()
