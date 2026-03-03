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

def main():
    base_path = "/Users/puzhen/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_pv2qqr16e4k622_c24e/msg/file/2025-11/CAMEL_Ant_1130"

    datasets = [
        ("material", "material_images"),
        ("mechanical_engineer", "mechanical_engineer_images"),
        ("music", "music_images"),
    ]

    print("正在计算所有图片的哈希值...")
    hash_to_files = defaultdict(list)

    for dataset_name, images_dirname in datasets:
        images_path = Path(base_path) / dataset_name / images_dirname
        if not images_path.exists():
            continue

        image_files = [f for f in images_path.iterdir() if f.is_file() and not f.name.startswith('.')]

        print(f"  处理 {dataset_name}: {len(image_files)} 个文件...")
        for img_file in image_files:
            file_hash = get_file_hash(img_file)
            if file_hash:
                hash_to_files[file_hash].append((dataset_name, img_file.name, img_file))

    # 找出重复的
    duplicates = {h: files for h, files in hash_to_files.items() if len(files) > 1}

    print(f"\n发现 {len(duplicates)} 组重复图片")

    # 生成详细报告
    with open('/Users/puzhen/Desktop/pre/camel_project/eigent/duplicate_images_report.txt', 'w', encoding='utf-8') as f:
        f.write("重复图片详细报告\n")
        f.write("=" * 80 + "\n\n")

        for i, (file_hash, files) in enumerate(sorted(duplicates.items()), 1):
            f.write(f"组 {i} - Hash: {file_hash}\n")
            f.write(f"  重复数量: {len(files)} 个文件\n")
            for dataset, filename, filepath in files:
                f.write(f"    [{dataset}] {filename}\n")
            f.write("\n")

    # 生成删除脚本（保留每组的第一个，删除其余的）
    with open('/Users/puzhen/Desktop/pre/camel_project/eigent/remove_duplicates.sh', 'w', encoding='utf-8') as f:
        f.write("#!/bin/bash\n")
        f.write("# 删除重复图片的脚本\n")
        f.write("# 每组重复图片保留第一个，删除其余的\n\n")
        f.write("# 请仔细检查后再执行！\n\n")

        total_to_delete = 0
        for file_hash, files in sorted(duplicates.items()):
            # 保留第一个，删除其余的
            f.write(f"# Hash: {file_hash} - 保留: {files[0][1]}\n")
            for dataset, filename, filepath in files[1:]:
                f.write(f'rm "{filepath}"\n')
                total_to_delete += 1

        f.write(f"\n# 总共将删除 {total_to_delete} 个重复文件\n")

    # 使脚本可执行
    os.chmod('/Users/puzhen/Desktop/pre/camel_project/eigent/remove_duplicates.sh', 0o755)

    # 生成 JSON 格式的详细信息
    duplicate_info = []
    for file_hash, files in duplicates.items():
        group = {
            'hash': file_hash,
            'count': len(files),
            'files': [{'dataset': d, 'filename': f, 'path': str(p)} for d, f, p in files]
        }
        duplicate_info.append(group)

    with open('/Users/puzhen/Desktop/pre/camel_project/eigent/duplicate_images.json', 'w', encoding='utf-8') as f:
        json.dump(duplicate_info, f, indent=2, ensure_ascii=False)

    print(f"\n生成的文件:")
    print(f"  1. duplicate_images_report.txt - 详细的文本报告")
    print(f"  2. remove_duplicates.sh - 删除重复文件的脚本")
    print(f"  3. duplicate_images.json - JSON 格式的重复信息")
    print(f"\n共有 {total_to_delete} 个重复文件可以删除")

if __name__ == "__main__":
    main()
