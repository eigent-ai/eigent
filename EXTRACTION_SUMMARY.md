# Browser Log 提取结果总结

## 提取完成时间
2025-11-27

## 处理的文件夹

### 方式1: 同一zip文件内提取（extract_logs_from_archives.py）

适用于：project和browser_log在同一个zip文件中

#### 1. Tao sun (`/Users/puzhen/Downloads/Tao sun`)
- **Zip文件数**: 12
- **成功提取**: 12个browser_log
- **输出目录**: `/Users/puzhen/Desktop/extracted_browser_logs/Tao sun`

提取的Archives:
- Archive.zip → hybrid_browser_toolkit_ws_20251126_211730_9fa16e0b.log
- Archive (1).zip → hybrid_browser_toolkit_ws_20251126_212247_6212929e.log
- Archive (2).zip → hybrid_browser_toolkit_ws_20251126_212658_f5763238.log
- Archive (3).zip → hybrid_browser_toolkit_ws_20251126_220639_81b7df31.log
- Archive (4).zip → hybrid_browser_toolkit_ws_20251126_222232_7af45b54.log
- Archive (5).zip → hybrid_browser_toolkit_ws_20251126_223807_87bd7539.log
- Archive (6).zip → hybrid_browser_toolkit_ws_20251126_203548_337dab7b.log
- Archive (7).zip → hybrid_browser_toolkit_ws_20251126_204554_bc6d2ae8.log
- Archive (8).zip → hybrid_browser_toolkit_ws_20251126_210133_23ccf8ae.log
- Archive (9).zip → hybrid_browser_toolkit_ws_20251126_213416_71a2fb18.log
- Archive (10).zip → hybrid_browser_toolkit_ws_20251126_214153_4a973371.log
- Archive (11).zip → hybrid_browser_toolkit_ws_20251126_215529_d53e572a.log

#### 2. pengcheng (`/Users/puzhen/Downloads/pengcheng`)
- **Zip文件数**: 12
- **成功提取**: 5个browser_log
- **输出目录**: `/Users/puzhen/Desktop/extracted_browser_logs/pengcheng`

提取的Archives:
- Archive.zip → hybrid_browser_toolkit_ws_20251127_134319_2631678c.log
- Archive (1).zip → hybrid_browser_toolkit_ws_20251127_160417_64e0830a.log
- Archive (2).zip → hybrid_browser_toolkit_ws_20251127_141851_71255a21.log
- Archive (3).zip → hybrid_browser_toolkit_ws_20251127_143444_1d2ce74f.log
- Archive (4).zip → hybrid_browser_toolkit_ws_20251127_154148_141fc189.log

**注意**: 另外7个zip文件（project_*）没有包含匹配的browser_log

### 方式2: 跨zip文件提取（extract_logs_cross_archives.py）

适用于：project*.zip和browser_log*.zip分离的情况

#### 3. waleed (`/Users/puzhen/Downloads/waleed`)
- **Project文件数**: 12
- **Browser_log文件数**: 12
- **成功提取**: 12个browser_log（每个project 1个）
- **输出目录**: `/Users/puzhen/Desktop/extracted_browser_logs_separated/waleed`

每个project提取的browser_log:
- project_1 (时间: 2025-11-26 11:20:28 - 11:22:18)
- project_2 (时间: 2025-11-26 11:56:47 - 11:59:00)
- project_3 (时间: 2025-11-26 12:06:16 - 12:08:40)
- project_4 (时间: 2025-11-26 12:18:25 - 12:28:10)
- project_5 (时间: 2025-11-26 12:41:30 - 12:55:44)
- project_6 (时间: 2025-11-26 13:01:40 - 13:08:41)
- project_7 (时间: 2025-11-26 13:13:47 - 13:17:19)
- project_8 (时间: 2025-11-26 13:34:58 - 13:40:05)
- project_9 (时间: 2025-11-26 14:04:03 - 14:19:02)
- project_10 (时间: 2025-11-26 14:26:58 - 14:33:16)
- project_11 (时间: 2025-11-26 14:39:27 - 14:42:54)
- project_12 (时间: 2025-11-26 14:47:05 - 14:53:57)

#### 4. puzhen (`/Users/puzhen/Downloads/puzhen`)
- **状态**: 目录中没有zip文件
- **提取结果**: 0

#### 5. saed (`/Users/puzhen/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_pv2qqr16e4k622_c24e/msg/file/2025-11/saed`)
- **Zip文件数**: 23个project + 11个browser_log
- **提取结果**: 0
- **原因**: 所有project*.zip中都没有找到conv文件

## 总计

### 成功提取的browser_log统计
- **Tao sun**: 12个
- **pengcheng**: 5个
- **waleed**: 12个
- **puzhen**: 0个
- **saed**: 0个

**总计**: **29个** browser_log文件成功提取

### 输出目录结构

每个提取的文件夹都包含两个子目录：
- **camel_logs/**: 包含所有conv*.json文件
- **browser_logs/**: 包含对应时间段的hybrid_browser日志

```
/Users/puzhen/Desktop/extracted_browser_logs/
├── Tao sun/
│   ├── Archive/
│   │   ├── camel_logs/
│   │   │   ├── conv_20251126_211710_133734.json
│   │   │   ├── conv_20251126_211714_711336.json
│   │   │   └── ... (22 conv files)
│   │   └── browser_logs/
│   │       └── hybrid_browser_toolkit_ws_20251126_211730_9fa16e0b.log
│   ├── Archive (1)/
│   │   ├── camel_logs/ (22 conv files)
│   │   └── browser_logs/ (1 log)
│   └── ... (12 archives total)
│
└── pengcheng/
    ├── Archive/
    │   ├── camel_logs/ (51 conv files)
    │   └── browser_logs/ (1 log)
    └── ... (5 archives total)

/Users/puzhen/Desktop/extracted_browser_logs_separated/
└── waleed/
    ├── project_1/
    │   ├── camel_logs/ (23 conv files)
    │   └── browser_logs/ (1 log)
    ├── project_2/
    │   ├── camel_logs/ (35 conv files)
    │   └── browser_logs/ (1 log)
    └── ... (12 projects total)

统计：
- Tao sun: 12个文件夹，442个conv文件，12个browser_log
- pengcheng: 5个文件夹，312个conv文件，5个browser_log
- waleed: 12个文件夹，494个conv文件，12个browser_log
```

## 使用的工具

### 1. extract_logs_from_archives.py
- **功能**: 从单个zip文件中提取camel_logs和对应时间的hybrid_browser日志
- **适用场景**: project和browser_log在同一个zip文件中
- **使用方法**:
  ```bash
  python3 extract_logs_from_archives.py
  ```

### 2. extract_logs_cross_archives.py
- **功能**: 跨多个zip文件提取browser_log
- **适用场景**: project*.zip和browser_log*.zip分离
- **使用方法**:
  ```bash
  python3 extract_logs_cross_archives.py
  ```

### 3. extract_browser_logs.py
- **功能**: 从project文件夹提取browser_log（从backend/browser_log目录）
- **适用场景**: 本地project文件夹和统一的browser_log目录
- **使用方法**:
  ```python
  from extract_browser_logs import BrowserLogExtractor
  extractor = BrowserLogExtractor()
  extractor.extract_matching_logs("/path/to/project")
  ```

## 核心算法

所有提取工具都基于相同的核心算法：

1. **时间解析**: 从文件名中解析时间戳
   - Conv文件: `conv_YYYYMMDD_HHMMSS_*.json`
   - Browser日志: `hybrid_browser_toolkit_ws_YYYYMMDD_HHMMSS_*.log`

2. **时间匹配**: 获取project中所有conv文件的时间跨度，然后匹配该时间范围内的browser_log

3. **递归搜索**: 支持在zip文件内任意深度搜索camel_logs和browser_log文件

4. **自动排除**: 自动排除typescript相关的日志文件

## 问题和解决方案

### 问题1: saed文件夹中的project没有conv文件
**原因**: project zip文件中不包含camel_logs或conv文件
**状态**: 无法提取（没有时间基准）

### 问题2: 文件时间戳在解压后改变
**解决**: 改为从文件名解析时间，而不是使用文件系统时间戳

### 问题3: project和browser_log在不同的zip文件中
**解决**: 创建了专门的cross-archive提取工具

## 备注

- 所有提取操作都是非破坏性的（只复制，不删除原文件）
- 使用临时目录处理zip文件，不会污染源目录
- 支持任意深度的目录嵌套
- 自动创建输出目录结构
