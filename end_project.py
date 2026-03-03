import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp("http://localhost:9222")
        contexts = browser.contexts
        if contexts:
            pages = contexts[0].pages
            for page in pages:
                if "localhost:5173" in page.url:
                    end_btn = await page.query_selector('text="End project"')
                    if end_btn:
                        await end_btn.click()
                        await asyncio.sleep(1)
                        yes_btn = await page.query_selector('text="Yes, end project"')
                        if yes_btn:
                            await yes_btn.click()
                            print("Project ended")
                            await asyncio.sleep(2)
                    break

asyncio.run(main())
