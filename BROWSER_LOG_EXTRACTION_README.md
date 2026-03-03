# Browser Log 提取工具

## 概述

这个工具可以根据project文件夹自动提取对应时间段的browser_log文件。

## 工作原理

1. 扫描project文件夹中的所有`conv*.json`文件
2. 获取这些conv文件的创建时间跨度（最早时间到最晚时间）
3. 从`backend/browser_log`目录中找到时间在该跨度内的browser_log文件
4. 自动排除typescript相关的log文件

## 文件说明

- `extract_browser_logs.py` - 核心提取算法
- `batch_extract_browser_logs.py` - 批量处理工具
- `BROWSER_LOG_EXTRACTION_README.md` - 本文档

## 使用方法

### 方法1: 提取单个project的browser_log

```python
from extract_browser_logs import BrowserLogExtractor

extractor = BrowserLogExtractor()

# 提取指定project的browser_log
project_dir = "/Users/puzhen/.eigent/hentai/project_1764177547496-7110"
matching_logs = extractor.extract_matching_logs(project_dir)

# 输出匹配的文件列表
for log_file in matching_logs:
    print(log_file)
```

### 方法2: 提取并复制到指定目录

```python
from extract_browser_logs import BrowserLogExtractor

extractor = BrowserLogExtractor()

project_dir = "/Users/puzhen/.eigent/hentai/project_1764177547496-7110"
output_dir = "/tmp/my_browser_logs"

# 提取并复制文件
matching_logs = extractor.extract_matching_logs(project_dir, output_dir)
```

### 方法3: 批量处理多个project

```python
from batch_extract_browser_logs import batch_extract_from_recent_projects

# 批量处理最近的14个project
results = batch_extract_from_recent_projects(num_projects=14)

# results是一个字典：{project_name: [log_files]}
for project_name, log_files in results.items():
    print(f"{project_name}: {len(log_files)} logs")
```

### 方法4: 命令行直接运行

```bash
# 测试单个project提取
python3 extract_browser_logs.py

# 批量处理最近的5个project
python3 batch_extract_browser_logs.py
```

## 配置

### 修改browser_log目录路径

如果browser_log目录不在默认位置，可以在初始化时指定：

```python
extractor = BrowserLogExtractor(
    browser_log_dir="/your/custom/path/to/browser_log"
)
```

### 修改批量处理的project数量

```python
# 处理最近的20个project
results = batch_extract_from_recent_projects(num_projects=20)
```

## 输出示例

```
Project: project_1764177547496-7110
Time range: 2025-11-27 01:23:55 to 2025-11-27 01:30:36
Duration: 400.4 seconds

Found 1 matching browser log files:
  1. hybrid_browser_toolkit_ws_20251127_012550_f7047235.log (2025-11-27 01:25:50)
```

## 高级用法

### 自定义提取逻辑

```python
from extract_browser_logs import BrowserLogExtractor
from pathlib import Path

extractor = BrowserLogExtractor()

# 获取时间跨度
project_dir = "/Users/puzhen/.eigent/hentai/project_1764177547496-7110"
time_range = extractor.get_conv_time_range(project_dir)

if time_range:
    min_time, max_time = time_range
    print(f"Time range: {min_time} to {max_time}")

    # 可以基于这个时间跨度做自定义处理
    # ...
```

### 按project组织输出

```python
from batch_extract_browser_logs import extract_and_organize_by_project

project_dir = "/Users/puzhen/.eigent/hentai/project_1764177547496-7110"
output_base = "/Users/puzhen/Desktop/organized_logs"

# 会创建: /Users/puzhen/Desktop/organized_logs/project_xxx/browser_logs/
logs = extract_and_organize_by_project(project_dir, output_base)
```

## 注意事项

1. **时间匹配精度**: 算法基于文件名中的时间戳进行匹配，只会提取时间完全在conv文件跨度内的browser_log
2. **文件名格式**: browser_log文件名必须符合格式 `hybrid_browser_toolkit_ws_YYYYMMDD_HHMMSS_*.log`
3. **typescript日志**: 所有包含"typescript"字样的日志文件都会被自动排除
4. **文件权限**: 确保有读取project文件夹和browser_log文件夹的权限

## 测试结果

最近5个project的测试结果：

```
project_1764177547496-7110: 1 browser logs
project_1764177070122-9512: 1 browser logs
project_1764176534707-8625: 1 browser logs
project_1764175505326-1997: 1 browser logs
project_1764175255499-4995: 1 browser logs

Total: 5 browser log files found across 5 projects
```

## 故障排除

### 问题: 没有找到任何browser_log

**可能原因**:
1. conv文件的时间和browser_log的时间没有重叠
2. browser_log文件名格式不符合要求
3. browser_log目录路径不正确

**解决方法**:
```python
# 检查时间跨度
time_range = extractor.get_conv_time_range(project_dir)
print(f"Project time range: {time_range}")

# 手动检查browser_log目录
import os
print(os.listdir("/Users/puzhen/Desktop/pre/camel_project/eigent/backend/browser_log"))
```

### 问题: FileNotFoundError

**解决方法**: 检查路径是否正确
```python
from pathlib import Path

project_dir = "/path/to/project"
if not Path(project_dir).exists():
    print(f"Directory does not exist: {project_dir}")
```

## License

MIT
