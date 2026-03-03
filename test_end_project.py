"""结束当前项目"""
import asyncio
from playwright.async_api import async_playwright

async def end_project():
    playwright = await async_playwright().start()
    browser = await playwright.chromium.connect_over_cdp("http://localhost:9222")
    
    contexts = browser.contexts
    if not contexts:
        print("Error: No contexts found")
        return
    
    page = None
    for p in contexts[0].pages:
        if "localhost:5173" in p.url:
            page = p
            break
    
    if not page:
        print("Error: Could not find main page")
        return
    
    print(f"Connected to: {page.url}")
    
    # 点击 End project
    end_btn = await page.query_selector('text="End project"')
    if end_btn:
        await end_btn.click()
        await asyncio.sleep(1)
        
        # 确认对话框
        yes_btn = await page.query_selector('text="Yes, end project"')
        if yes_btn:
            await yes_btn.click()
            print("✓ Project ended")
            await asyncio.sleep(2)
    else:
        print("No 'End project' button found")
    
    await playwright.stop()

if __name__ == "__main__":
    asyncio.run(end_project())
