import asyncio
from playwright.async_api import async_playwright


async def get_task_list():
    async with async_playwright() as p:
        # 连接到 Chrome DevTools Protocol 端口 9222
        browser = await p.chromium.connect_over_cdp("http://127.0.0.1:9222")

        # 获取所有上下文和页面
        contexts = browser.contexts
        if not contexts:
            print("No browser contexts found")
            return

        # 遍历所有页面找到目标页面
        target_page = None
        for context in contexts:
            for page in context.pages:
                print(f"Found page: {page.url}")
                # 可以根据 URL 或标题筛选目标页面
                if page.url and "localhost" in page.url:
                    target_page = page
                    break
            if target_page:
                break

        if not target_page:
            # 如果没找到 localhost，就用第一个页面
            target_page = contexts[0].pages[0] if contexts[0].pages else None

        if not target_page:
            print("No pages found")
            return

        print(f"\nUsing page: {target_page.url}")

        # 使用 JavaScript 获取 task card 上的任务列表
        task_list = await target_page.evaluate("""
            () => {
                const tasks = [];

                // 获取 task card 容器 - 查找 bg-task-surface 类
                const taskCard = document.querySelector('.bg-task-surface');
                if (!taskCard) {
                    return { error: 'Task card not found', tasks: [] };
                }

                // 获取任务标题 (summaryTask)
                const titleEl = taskCard.querySelector('.text-sm.font-bold');
                const title = titleEl ? titleEl.textContent.trim() : '';

                // 方法1：获取 taskType === 2 时的任务项（运行中的任务列表）
                // 这些任务项在 .mt-sm.flex.flex-col 容器内，有 rounded-lg 类
                const taskContainer = taskCard.querySelector('.mt-sm.flex.flex-col.px-2.gap-2');
                if (taskContainer) {
                    const runningTaskItems = taskContainer.querySelectorAll('.rounded-lg');
                    runningTaskItems.forEach((item, index) => {
                        // 获取任务内容文本 - 在 flex-1 容器内的 text-sm 元素
                        const contentEl = item.querySelector('.flex-1 .text-sm.font-medium');
                        const content = contentEl ? contentEl.textContent.trim() : '';

                        // 获取任务状态（通过图标类名判断）
                        let status = 'pending';
                        if (item.querySelector('.text-icon-success')) {
                            status = 'completed';
                        } else if (item.querySelector('.text-icon-cuation')) {
                            status = 'failed';
                        } else if (item.querySelector('.text-icon-warning')) {
                            status = 'blocked';
                        } else if (item.querySelector('.animate-spin')) {
                            status = 'running';
                        } else if (item.querySelector('.text-icon-information')) {
                            status = 'running';
                        } else if (item.querySelector('.text-icon-secondary')) {
                            status = 'pending';
                        }

                        // 通过背景色判断状态
                        const classList = item.className;
                        if (classList.includes('bg-green-50')) {
                            status = 'completed';
                        } else if (classList.includes('bg-task-fill-error')) {
                            status = 'failed';
                        } else if (classList.includes('bg-task-fill-warning')) {
                            status = 'blocked';
                        }

                        if (content) {
                            tasks.push({
                                index: index,
                                content: content,
                                status: status
                            });
                        }
                    });
                }

                // 方法2：如果上面没找到，尝试获取 taskType === 1 的任务项（编辑模式）
                if (tasks.length === 0) {
                    const editContainer = taskCard.querySelector('.mt-sm.flex.flex-col.px-sm');
                    if (editContainer) {
                        // TaskItem 组件中，任务内容在 textarea 或 span 中
                        const taskItems = editContainer.children;
                        Array.from(taskItems).forEach((item, index) => {
                            // 尝试获取 textarea 的值
                            const textarea = item.querySelector('textarea');
                            const span = item.querySelector('.break-words');
                            const content = textarea ? textarea.value : (span ? span.textContent.trim() : '');

                            if (content) {
                                tasks.push({
                                    index: index,
                                    content: content,
                                    status: 'editing'
                                });
                            }
                        });
                    }
                }

                // 方法3：通用方法 - 查找所有可能的任务文本
                if (tasks.length === 0) {
                    const allTextElements = taskCard.querySelectorAll('.break-words, .whitespace-pre-line');
                    allTextElements.forEach((el, index) => {
                        const content = el.textContent.trim();
                        if (content && content !== title) {
                            tasks.push({
                                index: index,
                                content: content,
                                status: 'unknown'
                            });
                        }
                    });
                }

                // 调试：输出完整的 task card HTML
                const debugHtml = taskCard.outerHTML;

                return {
                    title: title,
                    tasks: tasks,
                    totalCount: tasks.length,
                    debugHtml: debugHtml
                };
            }
        """)

        print("\n========== Task Card 任务列表 ==========")
        print(f"任务标题: {task_list.get('title', 'N/A')}")
        print(f"任务总数: {task_list.get('totalCount', 0)}")
        print("\n任务详情:")

        for task in task_list.get('tasks', []):
            status_emoji = {
                'completed': '✅',
                'failed': '❌',
                'running': '🔄',
                'blocked': '⚠️',
                'pending': '⏳'
            }.get(task['status'], '❓')

            print(f"  {task['index'] + 1}. {status_emoji} [{task['status']}] {task['content']}")

        if task_list.get('error'):
            print(f"\n错误: {task_list['error']}")

        # 如果没有任务，打印调试信息
        if task_list.get('totalCount', 0) == 0 and task_list.get('debugHtml'):
            print("\n调试信息 (Task Card HTML):")
            print(task_list['debugHtml'][:3000])

        print("\n=========================================")

        return task_list


if __name__ == "__main__":
    asyncio.run(get_task_list())
