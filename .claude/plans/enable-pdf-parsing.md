# 启用 PDF 解析 — 实施计划

## 背景

`generate_report.js` 目前对 62 份简历中仅 3 人有深度分析（硬编码），其余均使用默认评分（skill:65, exp:65, edu:70），因为 PDF 内容未被解析。

Boss直聘下载的 PDF 简历特点是：
- 带有反爬取混淆文本层（随机 hash 字符串掺入）
- `pdftotext` 已可用（Git Bash 自带的 poppler 工具）
- `-raw` 模式提取效果最好，文本量 600-2500 chars/份
- 可通过正则清洗去除 hash 噪声

## 实施步骤

### 步骤1：在 generate_report.js 中添加 PDF 解析模块

**新增函数：**
- `extractPdfText(filePath)` — 调用 `pdftotext -raw` 提取文本
- `cleanBossText(rawText)` — 清洗 Boss直聘 的 hash 干扰字符串
- `parseResumeText(text, positionConfig)` — 从清洗后的文本中提取技能关键词、教育信息、经验年限

### 步骤2：实现关键词匹配评分引擎

- 将 `skills_config.json` 中的 `requiredSkills` 和 `preferredSkills` 作为匹配词库
- 从清洗后的文本中检测每个技能关键词的出现
- **技能匹配度评分**：requiredSkills 匹配率 × 70 + preferredSkills 匹配率 × 30
- **经验匹配度评分**：基于文本中出现的经验年数关键词推断
- **教育匹配度评分**：检测学历关键词（本科/硕士/博士）匹配

### 步骤3：更新 buildCandidateAnalyses 函数

- 保留现有的硬编码分析（钱生、郭宝才、吕冰倩 — 人工分析更准确）
- 对其他候选人生成分析时，调用 PDF 解析 + 关键词匹配
- 自动填充：matchedSkills、missingSkills、skillScore、expScore、analysis 等字段

### 步骤4：学校信息自动补全建议

- 在解析 PDF 文本时，尝试提取学校/教育信息
- 提取到的学校信息打印在控制台，供用户手动补充到 skills_config.json 的 candidateSchools

## 技术决策

1. **使用 pdftotext 而非 node 库** — `pdftotext` 已预装，`pdf-parse` 未安装且需要安装 Canvas 等重量级依赖
2. **使用 -raw 模式** — 测试表明 -raw 模式对 Boss直聘 PDF 提取的文本最多，布局最连贯
3. **保留硬编码分析** — 已有的 3 人分析由人工/LLM 生成，质量高于自动分析

## 影响范围

- 只修改一个文件：`generate_report.js`
- 不改动 `skills_config.json` 结构
- 不改动 CSV 报告格式
- 不改动简历分类逻辑