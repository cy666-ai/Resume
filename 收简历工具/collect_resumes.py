"""
Boss 直聘批量收简历工具

工作流程：
  1. 脚本自动启动 Edge（调试模式）
  2. 你在打开的 Edge 中手动登录 Boss 直聘，进入「单聊」页面
  3. 脚本自动检测到页面后开始自动化操作
"""

import asyncio
import json
import os
import random
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
TARGET_URL = "https://www.zhipin.com/web/chat/geek/manage_v2"
DEBUG_PORT = 9222
DEBUG_URL = f"http://127.0.0.1:{DEBUG_PORT}"

stats = {"total": 0, "success": 0, "skipped": 0, "errors": 0}


def start_edge_with_debug_port():
    """启动 Edge 调试模式"""
    edge_paths = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    for path in edge_paths:
        if os.path.exists(path):
            print(f"启动 Edge 浏览器（调试端口 {DEBUG_PORT}）...")
            subprocess.Popen(
                [path, f"--remote-debugging-port={DEBUG_PORT}"],
                shell=True,
            )
            return True
    print("未找到 Edge 浏览器")
    return False


async def wait_for_debug_port(timeout=30):
    """等待 Edge 调试端口就绪"""
    import urllib.request
    start = time.time()
    while time.time() - start < timeout:
        try:
            urllib.request.urlopen(DEBUG_URL, timeout=2)
            return True
        except Exception:
            await asyncio.sleep(1)
    return False


async def random_delay(min_ms=800, max_ms=2000):
    ms = random.randint(min_ms, max_ms)
    await asyncio.sleep(ms / 1000)


async def process_candidate(page, index, total_count):
    """处理单个候选人：点击沟通 -> 求简历 -> 确定 -> 关闭"""
    print(f"\n处理第 {index}/{total_count} 个候选人...")
    await random_delay(500, 1000)

    try:
        # --- 点击"沟通" ---
        print("  点击「沟通」...")
        chat_btn = await page.query_selector(
            'a.btn-startchat, button:has-text("沟通"), [class*="chat-btn"]'
        )
        if not chat_btn:
            clicked = await page.evaluate(
                f"""() => {{
                    const btns = document.querySelectorAll('a.btn-startchat, button:has-text("沟通"), [class*="chat-btn"]');
                    if (btns[{index - 1}]) {{ btns[{index - 1}].click(); return true; }}
                    return false;
                }}"""
            )
            if not clicked:
                print("  - 未找到沟通按钮")
                stats["skipped"] += 1
                return
        else:
            await chat_btn.click()
        await random_delay(2000, 3000)

        # --- 点击"求简历" ---
        print("  点击「求简历」...")
        clicked_resume = False
        for selector in [
            'button:has-text("求简历")',
            'a:has-text("求简历")',
            '[class*="resume"]',
            '[class*="request"]',
        ]:
            btn = await page.query_selector(selector)
            if btn:
                text = await btn.inner_text()
                if "求简历" in text:
                    await btn.click()
                    clicked_resume = True
                    print("  - 已点击「求简历」")
                    break

        if not clicked_resume:
            print("  扫描「求简历」...")
            elements = await page.query_selector_all("button, a, span, div")
            for el in elements:
                try:
                    text = await el.inner_text()
                    if text.strip() == "求简历":
                        await el.click()
                        clicked_resume = True
                        print("  - 已点击「求简历」（扫描模式）")
                        break
                except Exception:
                    continue

        if clicked_resume:
            await random_delay(1000, 2000)

            # --- 点击"确定" ---
            print("  确认索取...")
            confirmed = False
            for selector in [
                'button:has-text("确定")',
                'a:has-text("确定")',
                'button:has-text("确认")',
                '[class*="dialog"] button:has-text("确定")',
                'button:has-text("好的")',
            ]:
                btn = await page.query_selector(selector)
                if btn:
                    text = await btn.inner_text()
                    if any(kw in text for kw in ["确定", "确认", "好的"]):
                        await btn.click()
                        confirmed = True
                        print("  - 已点击「确定」")
                        break

            if not confirmed:
                elements = await page.query_selector_all("button, a, span, div")
                for el in elements:
                    try:
                        text = await el.inner_text()
                        if text.strip() == "确定":
                            await el.click()
                            confirmed = True
                            print("  - 已点击「确定」（扫描模式）")
                            break
                    except Exception:
                        continue

            if not confirmed:
                print("  - 未找到「确定」，可能已自动确认")

            await random_delay(1500, 2500)

        # --- 关闭聊天面板 ---
        print("  关闭聊天面板...")
        try:
            close_btn = await page.query_selector(
                'i.icon-close, [class*="close"], button[class*="close"]'
            )
            if close_btn:
                await close_btn.click()
            else:
                await page.keyboard.press("Escape")
        except Exception:
            await page.keyboard.press("Escape")

        await random_delay(1000, 1500)
        print(f"  - 完成")
        stats["success"] += 1

    except Exception as e:
        print(f"  - 出错：{e}")
        stats["errors"] += 1
        try:
            await page.keyboard.press("Escape")
        except Exception:
            pass
        await random_delay(1000, 2000)


async def go_to_next_page(page, current_page_num):
    try:
        next_btn = await page.query_selector(
            'a.next, button.next, [class*="next"], a:has-text("下一页"), button:has-text("下一页")'
        )
        if not next_btn:
            print("未找到「下一页」按钮，已在最后一页")
            return False

        is_disabled = await next_btn.evaluate(
            "el => el.classList.contains('disabled') || el.disabled"
        )
        if is_disabled:
            print("「下一页」按钮已禁用，已到最后一页")
            return False

        print(f"切换到第 {current_page_num + 1} 页...")
        await next_btn.click()
        await random_delay(2000, 3000)
        await page.wait_for_load_state("networkidle")
        return True

    except Exception as e:
        print(f"切换分页失败：{e}")
        return False


async def find_chat_buttons(page):
    buttons = []
    try:
        buttons = await page.query_selector_all(
            'a.btn-startchat, button:has-text("沟通"), [class*="chat-btn"], [class*="startchat"]'
        )
    except Exception:
        pass

    if not buttons:
        try:
            all_el = await page.query_selector_all("button, a, [role='button']")
            for el in all_el:
                try:
                    text = await el.inner_text()
                    if text.strip() in ("沟通", "立即沟通"):
                        buttons.append(el)
                except Exception:
                    continue
        except Exception:
            pass

    if not buttons:
        try:
            data = await page.evaluate("""() => {
                const all = document.querySelectorAll('button, a, li, div[class*="item"], div[class*="card"]');
                const result = [];
                all.forEach((el, i) => {
                    const t = (el.innerText || '').trim();
                    if (t === '沟通' || t === '立即沟通') result.push(i);
                });
                return result;
            }""")
            if data:
                all_el = await page.query_selector_all(
                    "button, a, li, div[class*='item'], div[class*='card']"
                )
                for idx in data:
                    if idx < len(all_el):
                        buttons.append(all_el[idx])
        except Exception:
            pass

    return buttons


async def main():
    print("Boss 直聘批量收简历工具\n")

    # 1. 启动 Edge（调试模式）
    if not start_edge_with_debug_port():
        return

    print("等待浏览器启动...")
    if not await wait_for_debug_port():
        print("Edge 启动超时，请手动以调试模式启动 Edge")
        return

    print("Edge 浏览器已就绪\n")

    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        # 2. 连接 Edge
        print(f"连接 Edge...")
        try:
            browser = await p.chromium.connect_over_cdp(DEBUG_URL)
            print("已连接\n")
        except Exception as e:
            print(f"连接失败：{e}")
            return

        # 3. 获取页面并导航到 Boss 直聘
        page = browser.contexts[0].pages[0] if browser.contexts and browser.contexts[0].pages else await browser.contexts[0].new_page()

        print(f"打开 Boss 直聘（{TARGET_URL}）...")
        try:
            await page.goto(TARGET_URL, wait_until="domcontentloaded", timeout=30000)
        except Exception:
            pass

        # 检查是否跳到登录页
        await asyncio.sleep(2)
        current_url = page.url
        found = False

        if "login" in current_url or "passport" in current_url:
            print("=" * 60)
            print("请在打开的 Edge 浏览器中登录 Boss 直聘")
            print("登录后将自动进入单聊页面，脚本会自动检测")
            print("=" * 60)
        elif "chat" in current_url or "geek" in current_url:
            # 已登录且已进入目标页面
            body = await page.evaluate("() => document.body.innerText.substring(0, 2000)")
            if "沟通" in body:
                print("已进入单聊页面，开始处理...\n")
                found = True

        # 4. 如果还没就绪，开始等待
        if not found:
            print("脚本每 2 秒自动检测，检测到单聊页面后立即开始...\n")
            for wait_round in range(150):  # 5 分钟
                await asyncio.sleep(2)
                try:
                    url = page.url
                    body = await page.evaluate("() => document.body.innerText.substring(0, 5000)")
                    url_ok = any(kw in url for kw in ["web/chat", "geek", "manage"])
                    text_ok = "沟通" in body
                    if url_ok and text_ok:
                        found = True
                        print("已检测到单聊页面，开始处理...\n")
                        break
                    if wait_round % 15 == 0:
                        short_url = url[:60] if len(url) > 60 else url
                        print(f"等待中（{wait_round * 2}s）... {short_url}")
                except Exception:
                    if wait_round % 15 == 0:
                        print("页面加载中...")

        if not found:
            print("等待超时，请重启脚本")
            return

        # 5. 主循环
        current_page_num = 1
        has_more = True

        while has_more:
            print(f"\n{'='*50}")
            print(f"第 {current_page_num} 页")
            print(f"{'='*50}")

            await asyncio.sleep(2)

            chat_buttons = await find_chat_buttons(page)

            if not chat_buttons:
                print("当前页没有「沟通」按钮")
                try:
                    await page.screenshot(path=str(BASE_DIR / f"page_{current_page_num}.png"))
                except Exception:
                    pass
                has_more = await go_to_next_page(page, current_page_num)
                current_page_num += 1
                continue

            total_candidates = len(chat_buttons)
            stats["total"] += total_candidates
            print(f"找到 {total_candidates} 个候选人")

            for i in range(total_candidates):
                await process_candidate(page, i + 1, total_candidates)

            has_more = await go_to_next_page(page, current_page_num)
            current_page_num += 1

        print(f"\n{'='*50}")
        print("全部完成！")
        print(f"{'='*50}")
        print(f"共处理：{stats['total']}")
        print(f"成功：{stats['success']}")
        print(f"跳过：{stats['skipped']}")
        print(f"出错：{stats['errors']}")


if __name__ == "__main__":
    asyncio.run(main())