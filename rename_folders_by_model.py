#!/usr/bin/env python3
"""
重命名提取的文件夹，格式：index_modelname

从每个camel_logs中第一个conv*.json文件读取model键值
重命名为：01_modelname, 02_modelname, ...
"""

import json
import os
from pathlib import Path
from typing import Optional


def get_model_from_camel_logs(camel_logs_dir: Path) -> Optional[str]:
    """
    从camel_logs目录中的第一个conv文件获取model名称

    Args:
        camel_logs_dir: camel_logs目录路径

    Returns:
        model名称，如果失败返回None
    """
    # 查找第一个conv文件
    conv_files = sorted(camel_logs_dir.glob("conv*.json"))

    if not conv_files:
        return None

    first_conv = conv_files[0]

    try:
        with open(first_conv, 'r', encoding='utf-8') as f:
            data = json.load(f)
            model = data.get('model', None)
            if model:
                # 清理model名称，移除特殊字符
                model = model.replace('/', '_').replace('\\', '_')
                return model
    except Exception as e:
        print(f"    Error reading {first_conv.name}: {e}")
        return None

    return None


def rename_folders_in_directory(base_dir: Path, dry_run: bool = True):
    """
    重命名目录中的所有文件夹

    Args:
        base_dir: 基础目录
        dry_run: 是否为测试模式（不实际重命名）
    """
    if not base_dir.exists():
        print(f"Directory not found: {base_dir}")
        return

    print(f"\n{'='*80}")
    print(f"Processing: {base_dir.name}")
    print(f"{'='*80}")

    # 获取所有包含camel_logs的文件夹
    folders = []
    for item in base_dir.iterdir():
        if item.is_dir():
            camel_logs_dir = item / "camel_logs"
            if camel_logs_dir.exists():
                folders.append(item)

    # 按名称排序
    folders.sort(key=lambda x: x.name)

    print(f"Found {len(folders)} folders with camel_logs\n")

    # 处理每个文件夹
    renames = []
    for i, folder in enumerate(folders, 1):
        camel_logs_dir = folder / "camel_logs"
        model = get_model_from_camel_logs(camel_logs_dir)

        if model:
            # 生成新名称：index_modelname
            new_name = f"{i:02d}_{model}"
            new_path = folder.parent / new_name

            # 检查是否需要重命名
            if folder.name != new_name:
                renames.append((folder, new_path, model))
                print(f"{i:2d}. {folder.name}")
                print(f"    Model: {model}")
                print(f"    New name: {new_name}")
            else:
                print(f"{i:2d}. {folder.name} (already correctly named)")
        else:
            print(f"{i:2d}. {folder.name}")
            print(f"    Warning: Could not extract model name")

        print()

    # 执行重命名
    if renames:
        print(f"\n{'='*80}")
        if dry_run:
            print(f"DRY RUN - Would rename {len(renames)} folders:")
        else:
            print(f"Renaming {len(renames)} folders:")
        print(f"{'='*80}\n")

        for old_path, new_path, model in renames:
            if dry_run:
                print(f"Would rename: {old_path.name} -> {new_path.name}")
            else:
                try:
                    old_path.rename(new_path)
                    print(f"✓ Renamed: {old_path.name} -> {new_path.name}")
                except Exception as e:
                    print(f"✗ Failed to rename {old_path.name}: {e}")

    else:
        print("\nNo folders need to be renamed.")


def main():
    """主函数"""

    # 需要处理的目录
    directories = [
        "/Users/puzhen/Desktop/extracted_browser_logs/Tao sun",
        "/Users/puzhen/Desktop/extracted_browser_logs/pengcheng",
        "/Users/puzhen/Desktop/extracted_browser_logs/waleed",
        "/Users/puzhen/Desktop/extracted_browser_logs/puzhen",
        "/Users/puzhen/Desktop/extracted_browser_logs/saed",
    ]

    print("="*80)
    print("Folder Renaming Tool - Add Index and Model Name")
    print("="*80)
    print("\nThis will rename folders to: 01_modelname, 02_modelname, etc.")
    print("Model name is extracted from the first conv*.json file in camel_logs/")
    print()

    # 首先以dry-run模式运行，显示将要做的更改
    print("\n" + "="*80)
    print("STEP 1: DRY RUN (Preview Changes)")
    print("="*80)

    for directory in directories:
        dir_path = Path(directory)
        if dir_path.exists():
            rename_folders_in_directory(dir_path, dry_run=True)

    # 询问用户是否继续
    print("\n" + "="*80)
    print("STEP 2: Confirm and Execute")
    print("="*80)

    response = input("\nDo you want to proceed with the renaming? (yes/no): ").strip().lower()

    if response in ['yes', 'y']:
        print("\nProceeding with renaming...\n")

        for directory in directories:
            dir_path = Path(directory)
            if dir_path.exists():
                rename_folders_in_directory(dir_path, dry_run=False)

        print("\n" + "="*80)
        print("Renaming Complete!")
        print("="*80)
    else:
        print("\nRenaming cancelled.")


if __name__ == "__main__":
    main()
