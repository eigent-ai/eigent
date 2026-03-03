"""完整测试并捕获控制台日志"""
import asyncio
from playwright.async_api import async_playwright

async def run_test():
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
    
    # 收集所有相关控制台日志
    console_logs = []
    def handle_console(msg):
        text = msg.text
        if any(tag in text for tag in ['[addTaskInfo]', '[updateTaskInfo]', '[deleteTaskInfo]', '[handleConfirmTask]']):
            console_logs.append(text)
            print(f"CONSOLE: {text}")
    
    page.on("console", handle_console)
    
    # 获取当前任务
    async def get_tasks():
        items = await page.query_selector_all('div.group:has(textarea[placeholder="Add new task"])')
        tasks = []
        for item in items:
            textarea = await item.query_selector('textarea')
            if textarea:
                value = await textarea.input_value()
                if value.strip():
                    tasks.append(value[:50])
        return tasks
    
    # 输入查询
    print("\n=== INPUT QUERY ===")
    textarea = await page.query_selector('textarea[placeholder="Ask Eigent to automate your tasks"]')
    if textarea:
        await textarea.click()
        await asyncio.sleep(0.3)
        await textarea.fill("搜索新闻")
        await textarea.press("Enter")
        print("✓ Query submitted")
    
    # 等待任务拆分
    print("\n=== WAITING FOR TASK SPLIT ===")
    for i in range(30):
        await asyncio.sleep(1)
        tasks = await get_tasks()
        if len(tasks) > 0:
            start_btn = await page.query_selector('button:has-text("Start Task")')
            if start_btn:
                print(f"✓ Task split complete ({len(tasks)} tasks)")
                break
        if i % 5 == 0:
            print(f"  ... waiting ({i}s)")
    
    print("\n=== BEFORE MODIFICATIONS ===")
    tasks = await get_tasks()
    print(f"Tasks ({len(tasks)}):")
    for i, t in enumerate(tasks):
        print(f"  [{i}] {t}...")
    
    # 删除最后一个任务
    print("\n=== DELETING LAST TASK ===")
    items = await page.query_selector_all('div.group:has(textarea[placeholder="Add new task"])')
    valid_items = []
    for item in items:
        textarea = await item.query_selector('textarea')
        if textarea:
            value = await textarea.input_value()
            if value.strip():
                valid_items.append(item)
    
    if valid_items:
        last_item = valid_items[-1]
        await last_item.hover()
        await asyncio.sleep(0.5)
        delete_btn = await last_item.query_selector('button:has(svg.lucide-trash-2)')
        if delete_btn:
            await delete_btn.click()
            print("✓ Clicked delete button")
            await asyncio.sleep(1)
    
    # 编辑第一个任务
    print("\n=== EDITING FIRST TASK ===")
    items = await page.query_selector_all('div.group:has(textarea[placeholder="Add new task"])')
    valid_items = []
    for item in items:
        textarea = await item.query_selector('textarea')
        if textarea:
            value = await textarea.input_value()
            if value.strip():
                valid_items.append(item)
    
    if valid_items:
        first_item = valid_items[0]
        textarea = await first_item.query_selector('textarea')
        if textarea:
            await textarea.evaluate('el => { el.focus(); }')
            await asyncio.sleep(0.2)
            await textarea.fill("say Hi")
            await textarea.evaluate('el => { el.blur(); }')
            print("✓ Edited first task to 'say Hi'")
            await asyncio.sleep(0.5)
    
    print("\n=== AFTER MODIFICATIONS ===")
    tasks = await get_tasks()
    print(f"Tasks ({len(tasks)}):")
    for i, t in enumerate(tasks):
        print(f"  [{i}] {t}...")
    
    # 点击 Start Task
    print("\n=== CLICKING START TASK ===")
    start_btn = await page.query_selector('button:has-text("Start Task")')
    if start_btn:
        await start_btn.click()
        print("✓ Clicked 'Start Task'")
        await asyncio.sleep(3)
    
    print("\n=== ALL CONSOLE LOGS ===")
    for log in console_logs:
        print(log)
    
    # 结束项目
    print("\n=== ENDING PROJECT ===")
    await asyncio.sleep(5)
    end_btn = await page.query_selector('text="End project"')
    if end_btn:
        await end_btn.click()
        await asyncio.sleep(1)
        yes_btn = await page.query_selector('text="Yes, end project"')
        if yes_btn:
            await yes_btn.click()
            print("✓ Project ended")
    
    await playwright.stop()

if __name__ == "__main__":
    asyncio.run(run_test())
