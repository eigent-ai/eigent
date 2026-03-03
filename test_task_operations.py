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
            return
        
        # 截图看当前状态
        await page.screenshot(path="screenshot_current.png")
        
        # 尝试多种方式找到结束按钮
        # 1. 文本匹配
        end_btn = await page.query_selector('text="End project"')
        if end_btn:
            await end_btn.click()
            print("Clicked End project (text)")
            await asyncio.sleep(1)
            
            # 确认对话框
            yes_btn = await page.query_selector('text="Yes, end project"')
            if yes_btn:
                await yes_btn.click()
                print("Confirmed")
        else:
            # 2. 按钮包含文本
            buttons = await page.query_selector_all('button')
            for btn in buttons:
                text = await btn.inner_text()
                if 'End' in text or 'end' in text:
                    print(f"Found button: {text}")
                    await btn.click()
                    await asyncio.sleep(1)
                    break
        
        await asyncio.sleep(2)
        await page.screenshot(path="screenshot_final.png")

asyncio.run(main())
