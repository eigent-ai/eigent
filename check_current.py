import asyncio
import re
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

        print("=" * 60)
        print("Analyzing current page for task list...")
        print("=" * 60)

        # 方法1: 查找包含 "No." 的元素
        print("\n[Method 1] Looking for 'No.' elements...")
        no_elements = await page.query_selector_all('*:text-matches("No\\.\\s*\\d+")')
        print(f"Found {len(no_elements)} elements with 'No. X' pattern")

        for i, el in enumerate(no_elements[:10]):
            try:
                text = await el.inner_text()
                parent = await el.evaluate_handle('el => el.parentElement')
                parent_text = await parent.evaluate('el => el.innerText')
                print(f"\n  [{i}] Element text: {text[:50]}")
                print(f"      Parent text: {parent_text[:100]}...")
            except Exception as e:
                print(f"  [{i}] Error: {e}")

        # 方法2: 查找任务卡片区域
        print("\n\n[Method 2] Looking for task cards in Agent area...")
        # Agent 卡片通常有特定的结构
        agent_cards = await page.query_selector_all('div:has-text("Ongoing"), div:has-text("Pending")')
        print(f"Found {len(agent_cards)} agent card areas")

        # 方法3: 直接从 HTML 分析
        print("\n\n[Method 3] Analyzing HTML for task patterns...")
        page_html = await page.content()
        
        # 查找所有 No. X 后面的内容
        pattern = r'No\.\s*(\d+)</span>.*?<div[^>]*>([^<]{10,300})</div>'
        matches = re.findall(pattern, page_html, re.DOTALL)
        print(f"Found {len(matches)} task patterns")
        for num, content in matches[:5]:
            print(f"  No. {num}: {content[:80]}...")

        # 方法4: 寻找特定的任务内容格式
        print("\n\n[Method 4] Looking for Chinese task content...")
        # 中文任务内容通常包含特定词汇
        chinese_pattern = r'>([^<]*(?:搜索|新闻|网页|收集|整理|简报)[^<]{20,200})</(?:div|span)>'
        chinese_matches = re.findall(chinese_pattern, page_html)
        print(f"Found {len(chinese_matches)} Chinese task patterns")
        for i, m in enumerate(chinese_matches[:5]):
            print(f"  [{i}] {m[:80]}...")

asyncio.run(main())
