#!/usr/bin/env python3
import json
import os
import hashlib
from pathlib import Path
from collections import defaultdict

def get_file_hash(filepath):
    """计算文件的 MD5 hash"""
    hash_md5 = hashlib.md5()
    try:
        with open(filepath, "rb") as f:
            for chunk in iter(lambda: f.read(4096), b""):
                hash_md5.update(chunk)
        return hash_md5.hexdigest()
    except Exception as e:
        return None

def check_dataset(base_path, dataset_name, json_filename, images_dirname):
    """检查单个数据集"""
    print(f"\n{'='*80}")
    print(f"检查数据集: {dataset_name}")
    print(f"{'='*80}")

    dataset_path = Path(base_path) / dataset_name
    json_path = dataset_path / json_filename
    images_path = dataset_path / images_dirname

    # 读取 JSON 文件
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        print(f"✓ JSON 文件加载成功: {len(data)} 条记录")
    except Exception as e:
        print(f"✗ 无法读取 JSON 文件: {e}")
        return

    # 获取所有实际存在的图片文件
    if images_path.exists():
        actual_images = set(f.name for f in images_path.iterdir() if f.is_file() and not f.name.startswith('.'))
        print(f"✓ 图片目录中共有 {len(actual_images)} 个文件")
    else:
        print(f"✗ 图片目录不存在: {images_path}")
        return

    # 提取 JSON 中引用的所有图片
    referenced_images = set()
    for item in data:
        # 尝试多个可能的字段名
        image_ref = None
        for field in ['image_file', 'image', 'image_path', 'file', 'filename']:
            if field in item and item[field]:
                image_ref = item[field]
                break

        if image_ref and isinstance(image_ref, str):
            filename = os.path.basename(image_ref)
            referenced_images.add(filename)

    print(f"✓ JSON 中引用了 {len(referenced_images)} 个不同的图片")

    # 检查引用的图片是否都存在
    missing_images = referenced_images - actual_images
    unused_images = actual_images - referenced_images

    if missing_images:
        print(f"\n✗ 缺失的图片 ({len(missing_images)} 个):")
        for img in sorted(list(missing_images)[:10]):  # 只显示前10个
            print(f"  - {img}")
        if len(missing_images) > 10:
            print(f"  ... 还有 {len(missing_images) - 10} 个")
    else:
        print(f"\n✓ 所有引用的图片都存在!")

    if unused_images:
        print(f"\n⚠ 未被引用的图片 ({len(unused_images)} 个):")
        for img in sorted(list(unused_images)[:10]):  # 只显示前10个
            print(f"  - {img}")
        if len(unused_images) > 10:
            print(f"  ... 还有 {len(unused_images) - 10} 个")
    else:
        print(f"\n✓ 所有图片都被引用!")

    return images_path, actual_images

def check_duplicate_images(datasets_info):
    """检查所有数据集中是否有重复的图片"""
    print(f"\n{'='*80}")
    print(f"检查重复图片")
    print(f"{'='*80}")

    hash_to_files = defaultdict(list)
    total_files = 0

    for dataset_name, (images_path, image_files) in datasets_info.items():
        print(f"\n正在计算 {dataset_name} 的图片哈希值...")
        for img_file in image_files:
            if img_file.startswith('.'):
                continue
            filepath = images_path / img_file
            file_hash = get_file_hash(filepath)
            if file_hash:
                hash_to_files[file_hash].append((dataset_name, img_file))
                total_files += 1

    print(f"\n共检查了 {total_files} 个图片文件")

    # 找出重复的
    duplicates = {h: files for h, files in hash_to_files.items() if len(files) > 1}

    if duplicates:
        print(f"\n✗ 发现 {len(duplicates)} 组重复图片:")
        for i, (file_hash, files) in enumerate(list(duplicates.items())[:20], 1):
            print(f"\n  组 {i} (hash: {file_hash[:12]}...):")
            for dataset, filename in files:
                print(f"    - {dataset}/{filename}")
        if len(duplicates) > 20:
            print(f"\n  ... 还有 {len(duplicates) - 20} 组重复")
    else:
        print(f"\n✓ 没有发现重复的图片!")

    return duplicates

def main():
    base_path = "/Users/puzhen/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_pv2qqr16e4k622_c24e/msg/file/2025-11/CAMEL_Ant_1130"

    datasets = [
        ("material", "material_data.json", "material_images"),
        ("mechanical_engineer", "mechanical_engineer_data.json", "mechanical_engineer_images"),
        ("music", "music_data.json", "music_images"),
    ]

    datasets_info = {}

    # 检查每个数据集
    for dataset_name, json_file, images_dir in datasets:
        result = check_dataset(base_path, dataset_name, json_file, images_dir)
        if result:
            datasets_info[dataset_name] = result

    # 检查跨数据集的重复图片
    if datasets_info:
        check_duplicate_images(datasets_info)

    print(f"\n{'='*80}")
    print("检查完成!")
    print(f"{'='*80}\n")

if __name__ == "__main__":
    main()
