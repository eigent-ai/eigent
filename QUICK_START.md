# 快速开始指南

## 提取结果位置

所有提取的文件都已准备好，位于：

### 📁 提取完成的文件夹

```
/Users/puzhen/Desktop/extracted_browser_logs/
├── Tao sun/        (12个项目)
└── pengcheng/      (5个项目)

/Users/puzhen/Desktop/extracted_browser_logs_separated/
└── waleed/         (12个项目)
```

## 📊 快速统计

| 文件夹 | 项目数 | Conv文件 | Browser Logs |
|--------|--------|---------|--------------|
| Tao sun | 12 | 442 | 12 |
| pengcheng | 5 | 312 | 5 |
| waleed | 12 | 494 | 12 |
| **总计** | **29** | **1,248** | **29** |

## 📂 目录结构

每个项目文件夹包含：
```
项目名称/
├── camel_logs/          # 所有conv*.json文件
└── browser_logs/        # 对应时间的hybrid_browser日志
```

## 🔍 查看示例

```bash
# 查看Tao sun的Archive项目
ls "/Users/puzhen/Desktop/extracted_browser_logs/Tao sun/Archive/camel_logs/"
ls "/Users/puzhen/Desktop/extracted_browser_logs/Tao sun/Archive/browser_logs/"

# 查看waleed的project_1
ls "/Users/puzhen/Desktop/extracted_browser_logs_separated/waleed/project_1/camel_logs/"
ls "/Users/puzhen/Desktop/extracted_browser_logs_separated/waleed/project_1/browser_logs/"
```

## 🚀 重新运行提取（如需要）

```bash
# 如果需要重新提取Tao sun和pengcheng
python3 extract_logs_from_archives.py

# 如果需要重新提取waleed
python3 extract_logs_cross_archives.py
```

## 📦 压缩归档（备份）

```bash
cd /Users/puzhen/Desktop
tar -czf extracted_logs_$(date +%Y%m%d).tar.gz extracted_browser_logs*

# 压缩完成后可以删除原始文件夹（可选）
# rm -rf extracted_browser_logs*
```

## 🔧 工具说明

- **extract_logs_from_archives.py**: 从单个zip中提取（Tao sun, pengcheng）
- **extract_logs_cross_archives.py**: 跨zip文件提取（waleed）
- **extract_browser_logs.py**: 从本地project文件夹提取

## 📖 详细文档

- `FINAL_EXTRACTION_README.md` - 完整使用指南
- `EXTRACTION_SUMMARY.md` - 提取结果详细总结
- `BROWSER_LOG_EXTRACTION_README.md` - 工具原理说明

## ✅ 提取完成

所有29个项目的camel_logs和browser_logs已成功提取并组织完成！
