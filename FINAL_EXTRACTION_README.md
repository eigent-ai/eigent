# Browser Log 提取工具 - 最终版本

## 概述

这套工具可以从zip归档文件中自动提取camel_logs（conv文件）和对应时间段的browser_log文件，并将它们组织在同一个文件夹中。

## 已完成的提取任务

### ✅ 成功提取的文件夹

#### 1. Tao sun
- **位置**: `/Users/puzhen/Downloads/Tao sun`
- **提取结果**: 12个文件夹
- **Conv文件**: 442个
- **Browser logs**: 12个
- **输出**: `/Users/puzhen/Desktop/extracted_browser_logs/Tao sun`

#### 2. pengcheng
- **位置**: `/Users/puzhen/Downloads/pengcheng`
- **提取结果**: 5个文件夹
- **Conv文件**: 312个
- **Browser logs**: 5个
- **输出**: `/Users/puzhen/Desktop/extracted_browser_logs/pengcheng`

#### 3. waleed
- **位置**: `/Users/puzhen/Downloads/waleed`
- **提取结果**: 12个文件夹（project和browser_log分离）
- **Conv文件**: 494个
- **Browser logs**: 12个
- **输出**: `/Users/puzhen/Desktop/extracted_browser_logs_separated/waleed`

### ❌ 未提取的文件夹

#### 4. puzhen
- **原因**: 目录中没有zip文件

#### 5. saed
- **原因**: 所有project zip文件中都没有conv文件

## 输出目录结构

每个提取的项目文件夹都包含两个子目录：

```
project_name/
├── camel_logs/          # 所有conv*.json文件
│   ├── conv_20251126_211710_133734.json
│   ├── conv_20251126_211714_711336.json
│   └── ...
└── browser_logs/        # 对应时间段的hybrid_browser日志
    └── hybrid_browser_toolkit_ws_20251126_211730_9fa16e0b.log
```

### 示例：查看某个项目的文件

```bash
# Tao sun - Archive
ls /Users/puzhen/Desktop/extracted_browser_logs/'Tao sun'/Archive/camel_logs/
ls /Users/puzhen/Desktop/extracted_browser_logs/'Tao sun'/Archive/browser_logs/

# waleed - project_1
ls /Users/puzhen/Desktop/extracted_browser_logs_separated/waleed/project_1/camel_logs/
ls /Users/puzhen/Desktop/extracted_browser_logs_separated/waleed/project_1/browser_logs/
```

## 使用的工具

### 1. extract_logs_from_archives.py

**适用场景**: project和browser_log在同一个zip文件中

**功能**:
- 解压zip文件
- 递归搜索camel_logs目录和conv文件
- 提取conv文件的时间跨度
- 在同一zip中查找对应时间的hybrid_browser日志
- 将camel_logs和browser_logs组织在同一文件夹

**使用方法**:
```bash
python3 extract_logs_from_archives.py
```

**处理的文件夹**:
- Tao sun
- pengcheng

### 2. extract_logs_cross_archives.py

**适用场景**: project*.zip和browser_log*.zip分离

**功能**:
- 从project*.zip提取conv文件和时间跨度
- 从browser_log*.zip提取匹配时间的日志
- 将camel_logs和browser_logs组织在同一文件夹

**使用方法**:
```bash
python3 extract_logs_cross_archives.py
```

**处理的文件夹**:
- waleed

### 3. extract_browser_logs.py 和 batch_extract_browser_logs.py

**适用场景**: 本地project文件夹和统一的browser_log目录

**功能**:
- 从.eigent中的project文件夹提取browser_log
- 从backend/browser_log目录匹配对应时间的日志

**使用方法**:
```python
from extract_browser_logs import BrowserLogExtractor

extractor = BrowserLogExtractor()
extractor.extract_matching_logs("/path/to/project", "/output/dir")
```

## 核心算法

### 时间解析

所有工具都基于文件名时间戳进行匹配：

1. **Conv文件**: `conv_YYYYMMDD_HHMMSS_xxx.json`
2. **Browser日志**: `hybrid_browser_toolkit_ws_YYYYMMDD_HHMMSS_xxx.log`

### 匹配逻辑

1. 扫描所有conv文件，提取时间戳
2. 计算时间跨度（最早时间 → 最晚时间）
3. 查找时间在该跨度内的browser_log文件
4. 将camel_logs和browser_logs复制到同一输出目录

### 特性

- ✅ 支持任意深度的目录嵌套
- ✅ 自动排除typescript日志
- ✅ 递归搜索camel_logs和browser_log
- ✅ 非破坏性操作（只复制，不删除）
- ✅ 使用临时目录处理zip文件

## 统计总结

### 总体统计

| 文件夹 | 提取的项目 | Conv文件 | Browser Logs |
|--------|-----------|---------|--------------|
| Tao sun | 12 | 442 | 12 |
| pengcheng | 5 | 312 | 5 |
| waleed | 12 | 494 | 12 |
| **总计** | **29** | **1,248** | **29** |

### 文件分布

- **平均每个项目**: 43个conv文件 + 1个browser_log
- **最多conv文件**: waleed/project_9 (128个conv文件)
- **最少conv文件**: Tao sun/Archive (3) (19个conv文件)

## 验证提取结果

### 快速验证脚本

```bash
#!/bin/bash

echo "=== 提取结果验证 ==="
echo

# Tao sun
echo "Tao sun:"
echo "  文件夹数: $(find '/Users/puzhen/Desktop/extracted_browser_logs/Tao sun' -type d -name 'camel_logs' | wc -l)"
echo "  Conv文件: $(find '/Users/puzhen/Desktop/extracted_browser_logs/Tao sun' -name 'conv*.json' | wc -l)"
echo "  Browser logs: $(find '/Users/puzhen/Desktop/extracted_browser_logs/Tao sun' -name '*.log' | wc -l)"
echo

# pengcheng
echo "pengcheng:"
echo "  文件夹数: $(find '/Users/puzhen/Desktop/extracted_browser_logs/pengcheng' -type d -name 'camel_logs' | wc -l)"
echo "  Conv文件: $(find '/Users/puzhen/Desktop/extracted_browser_logs/pengcheng' -name 'conv*.json' | wc -l)"
echo "  Browser logs: $(find '/Users/puzhen/Desktop/extracted_browser_logs/pengcheng' -name '*.log' | wc -l)"
echo

# waleed
echo "waleed:"
echo "  文件夹数: $(find '/Users/puzhen/Desktop/extracted_browser_logs_separated/waleed' -type d -name 'camel_logs' | wc -l)"
echo "  Conv文件: $(find '/Users/puzhen/Desktop/extracted_browser_logs_separated/waleed' -name 'conv*.json' | wc -l)"
echo "  Browser logs: $(find '/Users/puzhen/Desktop/extracted_browser_logs_separated/waleed' -name '*.log' | wc -l)"
```

### 检查单个项目

```bash
# 查看项目结构
tree -L 2 "/Users/puzhen/Desktop/extracted_browser_logs/Tao sun/Archive"

# 输出示例:
# Archive/
# ├── camel_logs/
# │   ├── conv_20251126_211710_133734.json
# │   └── ... (22 files)
# └── browser_logs/
#     └── hybrid_browser_toolkit_ws_20251126_211730_9fa16e0b.log
```

## 故障排除

### 问题1: 没有找到browser_log

**可能原因**:
- Conv文件和browser_log的时间不重叠
- Browser_log文件名格式不正确
- Browser_log在不同的zip文件中

**解决方案**:
- 检查conv文件的时间范围
- 确认browser_log文件名格式
- 如果project和browser_log分离，使用extract_logs_cross_archives.py

### 问题2: 提取的文件夹是空的

**可能原因**:
- Zip文件中没有camel_logs目录
- Conv文件格式不正确

**解决方案**:
- 手动检查zip文件内容
- 确认conv文件命名符合格式

### 问题3: 脚本运行很慢

**原因**: 需要解压大量zip文件并搜索文件

**优化**:
- 使用SSD硬盘
- 确保有足够的临时磁盘空间
- 一次只处理一个文件夹

## 下一步操作建议

### 1. 压缩归档

将提取的结果压缩以节省空间：

```bash
cd /Users/puzhen/Desktop
tar -czf extracted_logs_backup_$(date +%Y%m%d).tar.gz extracted_browser_logs*
```

### 2. 数据分析

使用提取的conv文件进行数据分析：

```python
import json
from pathlib import Path

# 读取所有conv文件
conv_dir = Path("/Users/puzhen/Desktop/extracted_browser_logs/Tao sun/Archive/camel_logs")
for conv_file in conv_dir.glob("conv*.json"):
    with open(conv_file, 'r') as f:
        data = json.load(f)
        # 进行分析...
```

### 3. 日志分析

分析browser_log中的错误和警告：

```bash
# 搜索错误
grep -r "error" "/Users/puzhen/Desktop/extracted_browser_logs" --include="*.log"

# 统计日志大小
find "/Users/puzhen/Desktop/extracted_browser_logs" -name "*.log" -exec ls -lh {} \; | awk '{print $5, $9}'
```

## 文件清单

提取工具相关文件：

```
eigent/
├── extract_logs_from_archives.py          # 同一zip内提取
├── extract_logs_cross_archives.py         # 跨zip文件提取
├── extract_browser_logs.py                # 本地project提取
├── batch_extract_browser_logs.py          # 批量本地提取
├── EXTRACTION_SUMMARY.md                  # 提取结果总结
├── FINAL_EXTRACTION_README.md             # 本文档
└── BROWSER_LOG_EXTRACTION_README.md       # 原始工具文档
```

## 完成时间

提取完成时间: 2025-11-27 22:40

处理耗时: 约15分钟

## 联系与支持

如有问题，请检查：
1. 文件路径是否正确
2. Zip文件是否完整
3. 磁盘空间是否足够
4. Python版本是否>=3.7
