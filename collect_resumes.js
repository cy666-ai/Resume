const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// 浏览器配置 — 使用 Edge
const BROWSER_CHANNEL = 'msedge'; // 可选: 'msedge', 'chrome', 或 null 使用 Chromium

// Cookie数据
const COOKIES = [
    { "domain": ".zhipin.com", "name": "__a", "value": "33417319.1780468874.1780473776.1780542412.24.3.2.2" },
    { "domain": ".zhipin.com", "name": "__c", "value": "1780542412" },
    { "domain": ".zhipin.com", "name": "Hm_lvt_194df3105ad7148dcf2b98a91b5e727a", "value": "1780471580,1780475352,1780542412" },
    { "domain": ".zhipin.com", "name": "wbg", "value": "1", "httpOnly": true },
    { "domain": ".zhipin.com", "name": "__g", "value": "sem_bingpc" },
    { "domain": ".zhipin.com", "name": "zp_at", "value": "SMtdvto0gRqyaujaCoXh6RD7z7Qo-G2yWdqiHta7pzE~", "httpOnly": true },
    { "domain": ".zhipin.com", "name": "lastCity", "value": "101020100" },
    { "domain": ".zhipin.com", "name": "wt2", "value": "Dch7w6ktB3-qwWJQUQVFYF1K5GD3dIzARReaW3pcTGCEQzlvNJlXrWUWpPL3cUJCDYy6Qt64jrmsFjJ08MKz0gw~~", "httpOnly": true },
    { "domain": ".zhipin.com", "name": "__l", "value": "r=https%3A%2F%2Fcn.bing.com%2F&l=%2Fwww.zhipin.com%2Fsem%2F10.html%3F_ts%3D1780542409389%26sid%3Dsem_bingpc%26qudao%3Dbing_pc_H120003UY5%26plan%3DTCPA-%25E5%25BF%2585%25E5%25BA%2594-%25E5%2593%2581%25E7%2589%258C%26unit%3D%25E4%25BD%258E%25E6%2588%2590%25E6%259C%25AC%25E9%25AB%2598%25E6%25B6%2588%25E8%25B4%25B9%25E8%25AF%258D-1215%26keyword%3Dboss%26msclkid%3D4c0374a34ee3133dd0e41e83a5241f8f&s=1&g=%2Fwww.zhipin.com%2Fsem%2F10.html%3F_ts%3D1780542409389%26sid%3Dsem_bingpc%26qudao%3Dbing_pc_H120003UY5%26plan%3DTCPA-%25E5%25BF%2585%25E5%25BA%2594-%25E5%2593%2581%25E7%2589%258C%26unit%3D%25E4%25BD%258E%25E6%2588%2590%25E6%259C%25AC%25E9%25AB%2598%25E6%25B6%2588%25E8%25B4%25B9%25E8%25AF%258D-1215%26keyword%3Dboss%26msclkid%3D4c0374a34ee3133dd0e41e83a5241f8f&s=3&friend_source=0" },
    { "domain": ".zhipin.com", "name": "__zp_seo_uuid__", "value": "8e906530-e1fd-44c0-b9f6-a9811e974db6" },
    { "domain": "www.zhipin.com", "name": "ab_guid", "value": "b7e18443-5aae-4c4e-a420-bed560a8fd06" },
    { "domain": ".zhipin.com", "name": "bst", "value": "V2Sd4nFuT63FpgXdJhzh4fLimw7D3QwQ~~|Sd4nFuT63FpgXdJhzh4fLimw7DnXzQ~~" },
    { "domain": ".zhipin.com", "name": "Hm_lpvt_194df3105ad7148dcf2b98a91b5e727a", "value": "1780542412" },
    { "domain": ".zhipin.com", "name": "HMACCOUNT", "value": "B1187F5BC925506E" }
];

const TARGET_URL = 'https://www.zhipin.com/web/chat/geek/manage_v2';

// 延迟函数
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 随机延迟（模拟人类操作）
const randomDelay = async (min = 800, max = 2000) => {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    await sleep(ms);
};

async function main() {
    console.log('🚀 启动 Boss 直聘收简历机器人（Edge 浏览器）...\n');

    // 检查 Edge 是否可用
    try {
        const { execSync } = require('child_process');
        const edgePath = execSync('where msedge 2>nul || which msedge 2>/dev/null || echo ""').toString().trim();
        if (edgePath) {
            console.log(`✅ Edge 路径: ${edgePath}`);
        } else {
            console.log('⚠️  Edge 未在 PATH 中找到，尝试直接启动...');
        }
    } catch (e) {
        console.log('📌 继续启动 Edge...');
    }

    // 启动 Edge 浏览器（有头模式，便于观察）
    const browser = await chromium.launch({
        headless: false,
        channel: BROWSER_CHANNEL,
        args: ['--disable-blink-features=AutomationControlled']
    });

    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    // 设置 Cookie
    await context.addCookies(COOKIES);
    const page = await context.newPage();

    let totalRequested = 0;
    let currentPage = 1;
    let hasMorePages = true;

    try {
        console.log('📄 打开页面...');
        await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });
        await randomDelay(2000, 3000);

        // 循环处理每一页
        while (hasMorePages) {
            console.log(`\n📋 --- 第 ${currentPage} 页 ---`);

            // 等待候选人列表加载
            try {
                await page.waitForSelector('a.btn-startchat, .geek-item, [class*="chat-btn"], button:has-text("沟通")', {
                    timeout: 10000
                });
            } catch (e) {
                console.log('⚠️  未找到候选人列表，可能页面结构已变化');
                await page.screenshot({ path: path.join(__dirname, 'error_screenshot.png') });
                console.log('📸 已保存错误截图: error_screenshot.png');
                break;
            }

            // 收集当前页所有"沟通"按钮
            const chatButtons = await page.$$('a.btn-startchat, button:has-text("沟通"), [class*="chat-btn"]');

            if (chatButtons.length === 0) {
                console.log('⚠️  未找到"沟通"按钮，尝试使用通用选择器...');
                // 尝试更通用的选择器
                const allButtons = await page.$$('button, a');
                const filteredButtons = [];
                for (const btn of allButtons) {
                    const text = await btn.textContent();
                    if (text && text.includes('沟通')) {
                        filteredButtons.push(btn);
                    }
                }
                if (filteredButtons.length === 0) {
                    console.log('⚠️  当前页没有可沟通的候选人');
                    // 检查是否没有更多候选人
                    hasMorePages = await goToNextPage(page, currentPage);
                    currentPage++;
                    continue;
                }
                console.log(`🔍 找到 ${filteredButtons.length} 个"沟通"按钮（通用选择器）`);
                for (let i = 0; i < filteredButtons.length; i++) {
                    await processCandidate(page, i + 1, filteredButtons.length);
                    totalRequested++;
                }
            } else {
                console.log(`🔍 当前页找到 ${chatButtons.length} 个候选人`);

                for (let i = 0; i < chatButtons.length; i++) {
                    await processCandidate(page, i + 1, chatButtons.length);
                    totalRequested++;
                }
            }

            // 切换到下一页
            hasMorePages = await goToNextPage(page, currentPage);
            currentPage++;
            await randomDelay(2000, 3000);
        }

        console.log(`\n✅ 全部完成！共处理 ${totalRequested} 位候选人`);
        console.log('💡 浏览器窗口将保持打开，请手动关闭。');

    } catch (err) {
        console.error('❌ 执行出错：', err.message);
        try {
            await page.screenshot({ path: path.join(__dirname, 'error_screenshot.png') });
            console.log('📸 已保存错误截图: error_screenshot.png');
        } catch (e) { }
    }
}

/**
 * 处理单个候选人：点击沟通 → 求简历 → 确定
 */
async function processCandidate(page, index, total) {
    console.log(`\n👤 处理第 ${index}/${total} 个候选人...`);

    try {
        // 重新获取最新的沟通按钮（避免 stale element）
        await randomDelay(500, 1000);
        const buttons = await page.$$('a.btn-startchat, button:has-text("沟通"), [class*="chat-btn"]');
        if (index - 1 >= buttons.length) {
            console.log('⚠️  按钮已失效，跳过');
            return;
        }

        // 点击"沟通"按钮
        console.log('  点击"沟通"...');
        try {
            await buttons[index - 1].click({ timeout: 5000 });
        } catch (e) {
            // 尝试用 JS 点击
            await page.evaluate((idx) => {
                const btns = document.querySelectorAll('a.btn-startchat, button:has-text("沟通"), [class*="chat-btn"]');
                if (btns[idx]) btns[idx].click();
            }, index - 1);
        }
        await randomDelay(2000, 3000);

        // 等待聊天面板打开，然后点击"求简历"
        console.log('  点击"求简历"...');
        let clickedResume = false;
        try {
            // 尝试多个可能的选择器
            const resumeSelectors = [
                'button:has-text("求简历")',
                'a:has-text("求简历")',
                '[class*="resume"]',
                '[class*="request"]'
            ];
            for (const sel of resumeSelectors) {
                const resumeBtn = await page.$(sel);
                if (resumeBtn) {
                    const text = await resumeBtn.textContent();
                    if (text && text.includes('求简历')) {
                        await resumeBtn.click();
                        clickedResume = true;
                        console.log('  ✅ 已点击"求简历"');
                        break;
                    }
                }
            }
            if (!clickedResume) {
                // 全页面搜索"求简历"
                const allElements = await page.$$('button, a, span, div');
                for (const el of allElements) {
                    try {
                        const text = await el.textContent();
                        if (text && text.trim() === '求简历') {
                            await el.click();
                            clickedResume = true;
                            console.log('  ✅ 已点击"求简历"（通用扫描）');
                            break;
                        }
                    } catch (e) { }
                }
            }
        } catch (e) {
            console.log('  ⚠️  点击"求简历"失败：', e.message);
        }

        if (clickedResume) {
            await randomDelay(1000, 2000);

            // 点击确认对话框的"确定"
            console.log('  确认索取...');
            try {
                const confirmSelectors = [
                    'button:has-text("确定")',
                    'a:has-text("确定")',
                    'button:has-text("确认")',
                    '[class*="confirm"] button:has-text("确定")',
                    '[class*="dialog"] button:has-text("确定")',
                    'button:has-text("好的")'
                ];
                let confirmed = false;
                for (const sel of confirmSelectors) {
                    const confirmBtn = await page.$(sel);
                    if (confirmBtn) {
                        const text = await confirmBtn.textContent();
                        if (text && (text.includes('确定') || text.includes('确认') || text.includes('好的'))) {
                            await confirmBtn.click();
                            confirmed = true;
                            console.log('  ✅ 已点击"确定"');
                            break;
                        }
                    }
                }
                if (!confirmed) {
                    // 在全页面搜索"确定"
                    const allElements = await page.$$('button, a, span, div');
                    for (const el of allElements) {
                        try {
                            const text = await el.textContent();
                            if (text && text.trim() === '确定') {
                                await el.click();
                                confirmed = true;
                                console.log('  ✅ 已点击"确定"（通用扫描）');
                                break;
                            }
                        } catch (e) { }
                    }
                }
                if (!confirmed) {
                    console.log('  ⚠️  未找到"确定"按钮，可能已自动确认');
                }
            } catch (e) {
                console.log('  ⚠️  点击"确定"失败：', e.message);
            }

            await randomDelay(1500, 2500);
        }

        // 关闭聊天面板（点击空白区域或关闭按钮）
        console.log('  关闭聊天面板...');
        try {
            // 尝试点击聊天面板的关闭按钮或背景
            const closeBtn = await page.$('i.icon-close, [class*="close"], button[class*="close"], [class*="dialog"] i');
            if (closeBtn) {
                await closeBtn.click();
            } else {
                // 按 Escape 键关闭
                await page.keyboard.press('Escape');
            }
        } catch (e) {
            await page.keyboard.press('Escape');
        }
        await randomDelay(1000, 1500);

        console.log(`  ✅ 候选人 ${index} 处理完成`);

    } catch (err) {
        console.log(`  ⚠️  处理候选人 ${index} 时出错：`, err.message);
        // 按 Escape 恢复状态
        await page.keyboard.press('Escape').catch(() => { });
        await randomDelay(1000, 2000);
    }
}

/**
 * 切换到下一页
 */
async function goToNextPage(page, currentPageNum) {
    try {
        // 查找分页按钮
        const nextBtn = await page.$('a.next, button.next, [class*="next"], a:has-text("下一页"), button:has-text("下一页")');
        if (!nextBtn) {
            console.log('📄 未找到"下一页"按钮，已在最后一页');
            return false;
        }

        const isDisabled = await nextBtn.evaluate(el => el.classList.contains('disabled') || el.disabled);
        if (isDisabled) {
            console.log('📄 "下一页"按钮已禁用，已到最后一页');
            return false;
        }

        console.log(`📄 切换到第 ${currentPageNum + 1} 页...`);
        await nextBtn.click();
        await randomDelay(2000, 3000);
        await page.waitForLoadState('networkidle');
        return true;

    } catch (e) {
        console.log('📄 切换分页失败：', e.message);
        return false;
    }
}

// 启动主流程
main().catch(console.error);