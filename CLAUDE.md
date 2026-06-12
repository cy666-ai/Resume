# Resume 项目

本项目用于执行"筛选简历"skill，对候选人简历进行自动化筛选、评分和报告生成。

## 核心流程

1. 从 `简历/` 目录读取 PDF/JPG 简历（仅根层级，不递归子文件夹）
2. 使用 `pdftotext -raw` 提取 PDF 文本，正则清洗 Boss直聘的 hash 混淆字符
3. 基于 `skills_config.json` 中的岗位技能要求进行关键词匹配评分
4. 生成分组报告（总览、候选人简述、岗位对照、总结建议）
5. 按评分将简历归档到「优秀简历」/「其他简历」子目录

## 技术要点

- PDF 解析使用系统预装的 `pdftotext`（poppler），不依赖 Node 库
- 评分引擎：requiredSkills 匹配率 × 70 + preferredSkills 匹配率 × 30
- 报告第二部分为"候选人简述"（姓名、分、推荐等级、简短总结），不做逐项匹配展开
- 岗位技能配置从 `references/岗位.md` 中的任职要求提取

## 关键文件

- `.claude/skills/筛选简历/SKILL.md` — skill 定义
- `.claude/skills/筛选简历/scripts/generate_report.js` — 报告生成脚本
- `.claude/skills/筛选简历/templates/skills_config.json` — 岗位技能配置
- `.claude/skills/筛选简历/references/岗位.md` — 岗位要求原文



