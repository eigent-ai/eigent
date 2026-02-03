# Skills Feature Documentation

## 概述

Skills 功能允许用户通过上传自定义技能文件来扩展 AI Agent 的能力。这些技能文件包含特定领域的知识和操作指南，使 Agent 能够更好地完成特定任务。

## 功能特性

### 前端界面

在 **Settings > MCP & Tools** 页面中新增了 **Skills** 管理区域，提供以下功能：

1. **查看技能列表**
   - 显示所有已上传的技能文件
   - 显示文件大小和最后修改时间
   - 支持折叠/展开视图

2. **上传技能**
   - 点击 "Upload Skill" 按钮
   - 支持拖拽上传
   - 支持文件格式：`.md`, `.txt`, `.markdown`
   - 上传后自动刷新列表

3. **下载技能**
   - 点击技能列表中的下载图标
   - 自动下载技能文件到本地

4. **删除技能**
   - 点击技能列表中的删除图标
   - 确认后删除技能文件

### 后端 API

新增 Skill Controller (`backend/app/controller/skill_controller.py`)，提供以下接口：

#### 1. 获取技能列表

```
GET /skills
```

返回所有技能文件的信息列表

#### 2. 获取技能内容

```
GET /skills/{skill_name}
```

下载指定技能文件

#### 3. 上传技能

```
POST /skills/upload
```

上传新的技能文件（FormData）

#### 4. 删除技能

```
DELETE /skills/{skill_name}
```

删除指定技能文件

## 技能文件结构

技能文件使用 Markdown 格式，建议包含以下部分：

```markdown
# Skill Title

## Purpose

说明技能的用途

## Instructions

详细的操作步骤或知识点

## Examples

使用示例

## Prerequisites

前置条件或依赖
```

## 技能加载机制

Skills 通过 MCP (Model Context Protocol) 集成到系统中：

1. **Skills Loader MCP Server** (`mcp/skills-loader/index.js`)
   - 提供 `list_skills` 工具：列出所有技能文件
   - 提供 `get_skill` 工具：获取指定技能内容

2. **技能目录**
   - 默认位置：`{项目根目录}/skills/`
   - 可通过环境变量 `SKILLS_DIR` 自定义

3. **Agent 使用**
   - Agent 可通过 skills-loader MCP 访问技能
   - 技能内容作为上下文提供给 Agent
   - Agent 根据任务需求选择合适的技能

## 使用流程

### 1. 创建技能文件

创建一个 `.md` 文件，例如 `web-scraping-skill.md`：

```markdown
# Web Scraping Skill

## Purpose

Guide agents on how to properly scrape websites

## Instructions

1. Check robots.txt first
2. Use appropriate rate limiting
3. Handle errors gracefully
4. Return structured data

## Example

When scraping a product page:

- Extract product name, price, description
- Handle missing data gracefully
- Respect site's terms of service
```

### 2. 上传技能

1. 打开应用，进入 **Settings** > **MCP & Tools**
2. 找到 **Skills** 部分
3. 点击 **Upload Skill** 按钮
4. 选择或拖拽你的技能文件
5. 点击 **Upload**

### 3. 验证上传

- 上传成功后，技能会出现在列表中
- 可以下载查看内容
- Agent 现在可以使用这个技能

### 4. 管理技能

- **更新**：删除旧版本，上传新版本
- **删除**：点击删除图标并确认
- **备份**：下载所有技能文件保存到本地

## 技术实现细节

### 前端组件

1. **SkillList.tsx**
   - 显示技能列表
   - 提供下载和删除操作

2. **SkillUploadDialog.tsx**
   - 文件上传对话框
   - 支持拖拽上传
   - 文件类型验证

3. **SkillDeleteDialog.tsx**
   - 删除确认对话框
   - 防止误删除

### 后端实现

1. **skill_controller.py**
   - 处理所有技能相关的 API 请求
   - 文件安全检查（路径遍历保护）
   - 支持的文件类型限制

2. **router.py**
   - 注册 skill controller
   - 添加 "/skills" 路由前缀

### MCP 集成

1. **skills-loader/index.js**
   - MCP Server 实现
   - 提供技能列表和内容访问
   - 路径安全检查

## 安全考虑

1. **文件类型限制**
   - 只允许 `.md`, `.txt`, `.markdown` 文件
   - 前端和后端双重验证

2. **路径遍历保护**
   - 后端验证文件路径
   - 防止访问 skills 目录外的文件

3. **文件名检查**
   - 过滤隐藏文件（以 `.` 开头）
   - URL 编码处理特殊字符

## 未来扩展

1. **技能分类**
   - 支持技能分组
   - 按类别筛选

2. **技能模板**
   - 提供预定义模板
   - 快速创建标准技能

3. **技能市场**
   - 分享和下载社区技能
   - 技能评分和评论

4. **版本控制**
   - 技能版本管理
   - 回滚到旧版本

5. **技能验证**
   - 语法检查
   - 内容质量评估

## 参考资料

- [CAMEL-AI Skills Documentation](https://docs.camel-ai.org/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Markdown Guide](https://www.markdownguide.org/)

## 示例技能

项目中包含一个示例技能文件：`skills/example-skill.md`

查看这个文件可以了解技能文件的推荐结构和最佳实践。
