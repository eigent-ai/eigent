import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp("http://localhost:9222")
        
        contexts = browser.contexts
        if not contexts:
            return
            
        pages = contexts[0].pages
        page = None
        for p_item in pages:
            if "localhost:5173" in p_item.url:
                page = p_item
                break
        
        if not page:
            print("Page not found")
            return
        
        # 截图
        await page.screenshot(path="screenshot_running.png")
        print("Screenshot saved: screenshot_running.png")
        
        # 使用 JavaScript 从 React store 中获取任务数据
        tasks_data = await page.evaluate('''() => {
            // 尝试从 window 或 React DevTools 获取 store
            // 方法1: 查找 task card 区域的文本
            const taskCards = document.querySelectorAll('[class*="task"]');
            const results = [];
            
            // 方法2: 查找左侧任务列表
            // 提交后任务显示在 taskType=2 的列表中
            const allText = [];
            
            // 查找所有包含任务内容的元素
            const taskArea = document.querySelector('div.flex.flex-col.px-2.gap-2');
            if (taskArea) {
                const items = taskArea.querySelectorAll('div.flex.items-start');
                items.forEach((item, i) => {
                    const text = item.innerText.trim();
                    if (text && text.length > 10) {
                        allText.push({index: i, text: text.substring(0, 100)});
                    }
                });
            }
            
            // 方法3: 查找带序号的任务 (No. 1, No. 2 等)
            const noElements = document.querySelectorAll('div');
            noElements.forEach(el => {
                const text = el.innerText;
                if (text && text.includes('No.') && text.length < 500) {
                    const match = text.match(/No\.\s*(\d+)/);
                    if (match) {
                        allText.push({type: 'numbered', text: text.substring(0, 150)});
                    }
                }
            });
            
            return allText;
        }''')
        
        print(f"\n=== Tasks found via JS (method 1) ===")
        for t in tasks_data[:10]:
            print(f"  {t}")
        
        # 方法2: 直接获取 textarea 的值（如果还有的话）
        textareas = await page.query_selector_all('textarea')
        print(f"\n=== Textareas on page ===")
        for i, ta in enumerate(textareas):
            value = await ta.input_value()
            placeholder = await ta.get_attribute('placeholder')
            if value:
                print(f"  [{i}] value: {value[:60]}...")
            else:
                print(f"  [{i}] placeholder: {placeholder}")
        
        # 方法3: 查找 task card 内的具体任务项
        task_items = await page.evaluate('''() => {
            const items = [];
            // 查找左侧面板中的任务列表
            const leftPanel = document.querySelector('div.h-full.flex.flex-col');
            if (leftPanel) {
                // 查找所有包含任务文本的 div
                const divs = leftPanel.querySelectorAll('div.text-xs, span.text-xs');
                divs.forEach((div, i) => {
                    const text = div.innerText.trim();
                    if (text && text.length > 20 && !text.includes('Token') && !text.includes('Replay')) {
                        items.push({index: i, content: text.substring(0, 100)});
                    }
                });
            }
            return items;
        }''')
        
        print(f"\n=== Task items from left panel ===")
        for t in task_items[:10]:
            print(f"  [{t['index']}] {t['content']}...")

asyncio.run(main())
