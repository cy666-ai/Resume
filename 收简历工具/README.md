# 收简历工具 — Boss 直聘批量索取简历

## 环境要求

- Python 3.8+
- Microsoft Edge 浏览器

## 安装

```bash
pip install -r requirements.txt
playwright install chromium
```

## 使用

```bash
python collect_resumes.py
```

## 功能说明

自动在 Boss 直聘「单聊」页面批量索取候选人简历：

1. 使用 Cookie 自动登录
2. 遍历当前页所有候选人，依次：
   - 点击「沟通」
   - 点击「求简历」
   - 点击「确定」
   - 关闭聊天面板
3. 自动翻页继续处理
4. 全部完成后输出统计

## Cookie 更新

如果 Cookie 过期，程序会检测到登录页面并暂停，让你手动登录。
登录完成后按 Enter 继续。

你也可以编辑 `COOKIES` 变量更新 Cookie。