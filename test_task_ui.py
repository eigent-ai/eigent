"""
任务拆分页面 UI 测试工具

用于测试任务的添加、编辑、删除功能，以及验证提交后任务是否正确更新。

使用方法:
    python test_task_ui.py

或者在代码中导入使用:
    from test_task_ui import TaskUITester

    async def test():
        async with TaskUITester(auto_start=True) as tester:
            await tester.input_query("搜索新闻")
            await tester.wait_for_task_split()
            await tester.edit_task_by_index(0, "say Hi")
            await tester.add_task("say yes")
            await tester.delete_task_by_index(-1)  # 删除最后一个
            result = await tester.submit_and_verify()
            print(result)
"""

import asyncio
import subprocess
import signal
import os
import sys
from datetime import datetime
from pathlib import Path
from playwright.async_api import async_playwright, Page, Browser
from typing import List, Dict, Optional, Any
from dataclasses import dataclass


@dataclass
class TaskInfo:
    """任务信息"""
    index: int
    content: str


@dataclass
class VerifyResult:
    """验证结果"""
    success: bool
    expected_tasks: List[str]
    actual_tasks: List[str]
    missing_tasks: List[str]
    extra_tasks: List[str]
    message: str


class ElectronProcessManager:
    """Electron 进程管理器，负责启动、日志记录和关闭"""

    def __init__(self, project_dir: str = None, log_dir: str = "logs"):
        self.project_dir = project_dir or os.path.dirname(os.path.abspath(__file__))
        self.log_dir = os.path.join(self.project_dir, log_dir)
        self.process: Optional[subprocess.Popen] = None
        self.log_file: Optional[Any] = None
        self.log_path: Optional[str] = None

    def _create_log_file(self) -> str:
        """创建带时间戳的日志文件"""
        os.makedirs(self.log_dir, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        log_filename = f"npm_dev_{timestamp}.log"
        self.log_path = os.path.join(self.log_dir, log_filename)
        self.log_file = open(self.log_path, "w", encoding="utf-8")
        return self.log_path

    def _write_log(self, message: str):
        """写入带时间戳的日志"""
        if self.log_file:
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
            self.log_file.write(f"[{timestamp}] {message}")
            self.log_file.flush()

    async def start(self, wait_for_ready: bool = True, timeout: int = 120, cdp_port: int = 9222) -> bool:
        """
        启动 npm run dev

        Args:
            wait_for_ready: 是否等待服务就绪
            timeout: 等待超时时间（秒）
            cdp_port: CDP 端口，用于轮询检测服务是否就绪

        Returns:
            bool: 是否启动成功
        """
        log_path = self._create_log_file()
        print(f"📝 Log file: {log_path}")

        self._write_log("Starting npm run dev...\n")
        print("🚀 Starting npm run dev...")

        # 启动 npm run dev 进程
        self.process = subprocess.Popen(
            ["npm", "run", "dev"],
            cwd=self.project_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            # 在 Unix 上创建新的进程组，方便整体关闭
            preexec_fn=os.setsid if sys.platform != "win32" else None,
        )

        # 立即启动后台日志读取（非阻塞）
        asyncio.create_task(self._read_logs_async())

        if not wait_for_ready:
            return True

        # 轮询检测 CDP 端口是否可连接
        print(f"⏳ Polling CDP port {cdp_port} for readiness...")
        start_time = asyncio.get_event_loop().time()

        while asyncio.get_event_loop().time() - start_time < timeout:
            if self.process.poll() is not None:
                # 进程已退出
                print("❌ Process exited unexpectedly")
                return False

            # 尝试连接 CDP 端口
            if await self._check_cdp_ready(cdp_port):
                elapsed = asyncio.get_event_loop().time() - start_time
                print(f"✅ Dev server ready! (took {elapsed:.1f}s)")
                return True

            # 每 2 秒打印一次状态
            elapsed = asyncio.get_event_loop().time() - start_time
            if int(elapsed) % 5 == 0 and int(elapsed) > 0:
                print(f"  ⏳ Still waiting... ({int(elapsed)}s)")

            await asyncio.sleep(2)

        print(f"⚠️ Timeout waiting for dev server (>{timeout}s)")
        return False

    async def _check_cdp_ready(self, port: int) -> bool:
        """检测 CDP 端口是否可连接"""
        import socket
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(1)
            result = sock.connect_ex(('127.0.0.1', port))
            sock.close()
            return result == 0
        except Exception:
            return False

    async def _read_logs_async(self):
        """异步读取并保存日志（使用线程避免阻塞）"""
        if not self.process or not self.process.stdout:
            return

        import threading

        def read_output():
            try:
                for line in iter(self.process.stdout.readline, ''):
                    if line:
                        self._write_log(line)
                    if self.process.poll() is not None:
                        break
            except Exception as e:
                self._write_log(f"Log reader error: {e}\n")

        # 在后台线程中读取日志
        thread = threading.Thread(target=read_output, daemon=True)
        thread.start()

    def stop(self):
        """停止 npm run dev 并关闭整个 Electron 进程树"""
        if not self.process:
            return

        print("🛑 Stopping Electron and npm dev server...")
        self._write_log("Stopping process...\n")

        try:
            if sys.platform == "win32":
                # Windows: 使用 taskkill 杀死进程树
                subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(self.process.pid)],
                    capture_output=True
                )
            else:
                # Unix: 发送 SIGTERM 到整个进程组
                os.killpg(os.getpgid(self.process.pid), signal.SIGTERM)
                # 等待进程退出
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    # 如果 SIGTERM 没有效果，使用 SIGKILL
                    os.killpg(os.getpgid(self.process.pid), signal.SIGKILL)

            print("✅ Process stopped")
            self._write_log("Process stopped\n")

        except Exception as e:
            print(f"⚠️ Error stopping process: {e}")
            self._write_log(f"Error stopping process: {e}\n")

        finally:
            # 关闭日志文件
            if self.log_file:
                self.log_file.close()
                self.log_file = None


class TaskUITester:
    """任务 UI 测试器"""

    def __init__(
        self,
        cdp_url: str = "http://localhost:9222",
        auto_start: bool = False,
        project_dir: str = None,
        log_dir: str = "logs"
    ):
        """
        初始化测试器

        Args:
            cdp_url: Chrome DevTools Protocol 地址
            auto_start: 是否自动启动 npm run dev
            project_dir: 项目目录（默认为当前文件所在目录）
            log_dir: 日志保存目录
        """
        self.cdp_url = cdp_url
        self.auto_start = auto_start
        self.playwright = None
        self.browser: Optional[Browser] = None
        self.page: Optional[Page] = None
        self._expected_tasks: List[str] = []  # 记录期望的任务列表
        self._process_manager: Optional[ElectronProcessManager] = None

        if auto_start:
            self._process_manager = ElectronProcessManager(project_dir, log_dir)

    async def __aenter__(self):
        # 如果需要自动启动，先启动 npm run dev
        if self.auto_start and self._process_manager:
            success = await self._process_manager.start(wait_for_ready=True, timeout=120)
            if not success:
                raise RuntimeError("Failed to start npm run dev")

            # 固定等待 20 秒让 Electron 完全加载
            print("⏳ Waiting 20s for Electron to fully load...")
            for i in range(11, 0, -1):
                print(f"  {i}s remaining...", end='\r')
                await asyncio.sleep(1)
            print("✅ Wait complete!          ")

        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.disconnect()

    async def connect(self) -> bool:
        """连接到 Electron 应用"""
        self.playwright = await async_playwright().start()
        self.browser = await self.playwright.chromium.connect_over_cdp(self.cdp_url)

        contexts = self.browser.contexts
        if not contexts:
            print("Error: No contexts found")
            return False

        pages = contexts[0].pages
        for p in pages:
            if "localhost:5173" in p.url:
                self.page = p
                break

        if not self.page:
            print("Error: Could not find main page")
            return False

        print(f"Connected to: {self.page.url}")
        return True

    async def disconnect(self):
        """断开连接"""
        if self.playwright:
            await self.playwright.stop()

    async def screenshot(self, filename: str = "screenshot.png"):
        """截图"""
        if self.page:
            await self.page.screenshot(path=filename)
            print(f"Screenshot saved: {filename}")

    # ==================== 任务获取方法 ====================

    async def _get_task_items(self) -> List[Any]:
        """获取所有任务项的父容器（只返回有内容的）"""
        items = await self.page.query_selector_all('div.group:has(textarea[placeholder="Add new task"])')
        result = []
        for item in items:
            textarea = await item.query_selector('textarea')
            if textarea:
                value = await textarea.input_value()
                if value.strip():
                    result.append(item)
        return result

    async def get_task_count(self) -> int:
        """获取当前任务数量"""
        items = await self._get_task_items()
        return len(items)

    async def get_all_tasks(self) -> List[TaskInfo]:
        """获取所有任务信息"""
        items = await self._get_task_items()
        tasks = []
        for i, item in enumerate(items):
            textarea = await item.query_selector('textarea')
            if textarea:
                content = await textarea.input_value()
                tasks.append(TaskInfo(index=i, content=content))
        return tasks

    async def print_tasks(self):
        """打印当前所有任务"""
        tasks = await self.get_all_tasks()
        print(f"\n=== Current Tasks ({len(tasks)}) ===")
        for task in tasks:
            content_preview = task.content[:60] + "..." if len(task.content) > 60 else task.content
            print(f"  [{task.index}] {content_preview}")
        return tasks

    # ==================== 任务操作方法 ====================

    async def delete_task_by_index(self, index: int) -> bool:
        """
        通过 index 删除任务

        Args:
            index: 任务索引，支持负数（-1 表示最后一个）
        """
        items = await self._get_task_items()
        count = len(items)

        # 处理负数索引
        if index < 0:
            index = count + index

        if index < 0 or index >= count:
            print(f"Error: index {index} out of range (0-{count-1})")
            return False

        task_item = items[index]

        # 获取要删除的任务内容（用于更新期望列表）
        textarea = await task_item.query_selector('textarea')
        if textarea:
            content = await textarea.input_value()
            if content in self._expected_tasks:
                self._expected_tasks.remove(content)

        # Hover 显示删除按钮
        await task_item.hover()
        await asyncio.sleep(0.5)

        # 点击删除按钮
        delete_btn = await task_item.query_selector('button:has(svg.lucide-trash-2)')
        if delete_btn:
            await delete_btn.click()
            print(f"✓ Deleted task at index {index}")
            await asyncio.sleep(0.5)
            return True

        print(f"✗ Could not find delete button for index {index}")
        return False

    async def add_task(self, content: str) -> bool:
        """
        添加新任务

        Args:
            content: 任务内容
        """
        # 找到空的任务输入框
        all_textareas = await self.page.query_selector_all('textarea[placeholder="Add new task"]')
        for ta in all_textareas:
            value = await ta.input_value()
            if not value.strip():
                # 使用 JavaScript 直接聚焦并填充（绕过透明遮罩）
                await ta.evaluate('el => { el.focus(); }')
                await asyncio.sleep(0.2)
                await ta.fill(content)
                await ta.evaluate('el => { el.blur(); }')

                # 更新期望列表
                self._expected_tasks.append(content)

                print(f"✓ Added task: '{content}'")
                await asyncio.sleep(0.5)
                return True

        print("✗ No empty task input found")
        return False

    async def edit_task_by_index(self, index: int, new_content: str) -> bool:
        """
        通过 index 编辑任务

        Args:
            index: 任务索引，支持负数
            new_content: 新的任务内容
        """
        items = await self._get_task_items()
        count = len(items)

        # 处理负数索引
        if index < 0:
            index = count + index

        if index < 0 or index >= count:
            print(f"Error: index {index} out of range (0-{count-1})")
            return False

        task_item = items[index]
        textarea = await task_item.query_selector('textarea')

        if textarea:
            # 获取旧内容（用于更新期望列表）
            old_content = await textarea.input_value()
            if old_content in self._expected_tasks:
                idx = self._expected_tasks.index(old_content)
                self._expected_tasks[idx] = new_content
            else:
                # 如果旧内容不在列表中，可能是初始任务，需要替换
                pass

            # 使用 JavaScript 直接聚焦（绕过透明遮罩）
            await textarea.evaluate('el => { el.focus(); }')
            await asyncio.sleep(0.2)
            await textarea.fill(new_content)
            await textarea.evaluate('el => { el.blur(); }')

            print(f"✓ Edited task at index {index} to: '{new_content}'")
            await asyncio.sleep(0.5)
            return True

        print(f"✗ Could not find textarea for index {index}")
        return False

    # ==================== 页面交互方法 ====================

    async def input_query(self, query: str) -> bool:
        """
        在主输入框输入查询

        Args:
            query: 查询内容
        """
        textarea = await self.page.query_selector('textarea[placeholder="Ask Eigent to automate your tasks"]')
        if textarea:
            await textarea.click()
            await asyncio.sleep(0.3)
            await textarea.fill(query)
            print(f"✓ Input query: '{query}'")
            return True

        print("✗ Could not find main input")
        return False

    async def submit_query(self) -> bool:
        """按 Enter 提交查询"""
        textarea = await self.page.query_selector('textarea[placeholder="Ask Eigent to automate your tasks"]')
        if textarea:
            await textarea.press("Enter")
            print("✓ Submitted query (Enter)")
            return True
        return False

    async def wait_for_task_split(self, timeout: int = 30) -> bool:
        """
        等待任务拆分完成

        Args:
            timeout: 超时时间（秒）
        """
        print("Waiting for task split...")

        for i in range(timeout):
            await asyncio.sleep(1)

            # 检查是否有任务出现
            count = await self.get_task_count()
            if count > 0:
                # 检查是否有 "Start Task" 按钮
                start_btn = await self.page.query_selector('button:has-text("Start Task")')
                if start_btn:
                    print(f"✓ Task split complete ({count} tasks)")

                    # 初始化期望任务列表
                    tasks = await self.get_all_tasks()
                    self._expected_tasks = [t.content for t in tasks]

                    return True

            if i % 5 == 0:
                print(f"  ... waiting ({i}s)")

        print("✗ Timeout waiting for task split")
        return False

    async def click_start_task(self) -> bool:
        """点击 Start Task 按钮"""
        start_btn = await self.page.query_selector('button:has-text("Start Task")')
        if start_btn:
            await start_btn.click()
            print("✓ Clicked 'Start Task'")
            return True

        print("✗ Could not find 'Start Task' button")
        return False

    async def end_project(self, close_electron: bool = True) -> bool:
        """
        结束项目

        Args:
            close_electron: 是否关闭整个 Electron 应用
        """
        # 点击 End project
        end_btn = await self.page.query_selector('text="End project"')
        if end_btn:
            await end_btn.click()
            await asyncio.sleep(1)

            # 确认对话框
            yes_btn = await self.page.query_selector('text="Yes, end project"')
            if yes_btn:
                await yes_btn.click()
                print("✓ Project ended")
                await asyncio.sleep(2)

                # 关闭整个 Electron 应用
                if close_electron:
                    await self.close_electron()

                return True

        print("✗ Could not end project")
        return False

    async def close_electron(self):
        """关闭整个 Electron 应用"""
        print("🛑 Closing Electron application...")

        # 先断开 Playwright 连接
        if self.playwright:
            await self.playwright.stop()
            self.playwright = None
            self.browser = None
            self.page = None

        # 如果有进程管理器，停止进程
        if self._process_manager:
            self._process_manager.stop()
        else:
            # 如果没有进程管理器但需要关闭 Electron，尝试通过 pkill 关闭
            try:
                if sys.platform == "win32":
                    subprocess.run(["taskkill", "/F", "/IM", "electron.exe"], capture_output=True)
                else:
                    # 尝试关闭 Electron 进程
                    subprocess.run(["pkill", "-f", "electron"], capture_output=True)
                    subprocess.run(["pkill", "-f", "Electron"], capture_output=True)
                print("✅ Electron closed")
            except Exception as e:
                print(f"⚠️ Could not close Electron: {e}")

    # ==================== 验证方法 ====================

    async def get_task_list_from_card(self) -> Dict[str, Any]:
        """
        使用 JavaScript 从 task card 获取任务列表
        来自 get_task_list.py 的方法
        """
        task_list = await self.page.evaluate("""
            () => {
                const tasks = [];

                // 获取 task card 容器 - 查找 bg-task-surface 类
                const taskCard = document.querySelector('.bg-task-surface');
                if (!taskCard) {
                    return { error: 'Task card not found', tasks: [], title: '' };
                }

                // 获取任务标题 (summaryTask)
                const titleEl = taskCard.querySelector('.text-sm.font-bold');
                const title = titleEl ? titleEl.textContent.trim() : '';

                // 方法1：获取 taskType === 2 时的任务项（运行中的任务列表）
                const taskContainer = taskCard.querySelector('.mt-sm.flex.flex-col.px-2.gap-2');
                if (taskContainer) {
                    const runningTaskItems = taskContainer.querySelectorAll('.rounded-lg');
                    runningTaskItems.forEach((item, index) => {
                        const contentEl = item.querySelector('.flex-1 .text-sm.font-medium');
                        const content = contentEl ? contentEl.textContent.trim() : '';

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

                // 方法2：获取 taskType === 1 的任务项（编辑模式）
                if (tasks.length === 0) {
                    const editContainer = taskCard.querySelector('.mt-sm.flex.flex-col.px-sm');
                    if (editContainer) {
                        const taskItems = editContainer.children;
                        Array.from(taskItems).forEach((item, index) => {
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

                // 方法3：通用方法
                if (tasks.length === 0) {
                    const allTextElements = taskCard.querySelectorAll('.break-words, .whitespace-pre-line');
                    allTextElements.forEach((el, index) => {
                        const content = el.textContent.trim();
                        if (content && content !== title && content.length > 10) {
                            tasks.push({
                                index: index,
                                content: content,
                                status: 'unknown'
                            });
                        }
                    });
                }

                return {
                    title: title,
                    tasks: tasks,
                    totalCount: tasks.length
                };
            }
        """)

        return task_list

    async def print_task_list_from_card(self, label: str = "Task List"):
        """打印从 task card 获取的任务列表"""
        task_list = await self.get_task_list_from_card()

        print(f"\n{'='*70}")
        print(f"{label}")
        print(f"{'='*70}")
        print(f"Title: {task_list.get('title', 'N/A')}")
        print(f"Total: {task_list.get('totalCount', 0)} tasks\n")

        status_emoji = {
            'completed': '✅',
            'failed': '❌',
            'running': '🔄',
            'blocked': '⚠️',
            'pending': '⏳',
            'editing': '✏️',
            'unknown': '❓'
        }

        for task in task_list.get('tasks', []):
            emoji = status_emoji.get(task['status'], '❓')
            content = task['content']
            preview = content[:60] + "..." if len(content) > 60 else content
            print(f"  [{task['index']}] {emoji} [{task['status']}] {preview}")

        if task_list.get('error'):
            print(f"\n⚠️ Error: {task_list['error']}")

        return task_list

    async def get_full_page_state(self) -> Dict[str, Any]:
        """
        获取完整的页面状态，包括 Task Card 和 Workflow 中所有 Worker 的任务
        """
        result = await self.page.evaluate("""
            () => {
                const data = {
                    taskCard: null,
                    workers: []
                };

                // 1. 获取 Task Card 信息
                const taskCard = document.querySelector('.bg-task-surface');
                if (taskCard) {
                    const titleEl = taskCard.querySelector('.text-sm.font-bold');
                    data.taskCard = {
                        title: titleEl ? titleEl.textContent.trim() : '',
                        tasks: []
                    };

                    // 获取任务列表
                    const taskItems = taskCard.querySelectorAll('.rounded-lg.cursor-pointer, .rounded-lg.flex.gap-2');
                    taskItems.forEach((item, idx) => {
                        const contentEl = item.querySelector('.text-sm.font-medium, .break-words');
                        if (contentEl) {
                            const content = contentEl.textContent.trim();
                            if (content && content.length > 5) {
                                let status = 'pending';
                                if (item.classList.contains('bg-green-50')) status = 'completed';
                                else if (item.className.includes('bg-task-fill-error')) status = 'failed';
                                else if (item.querySelector('.animate-spin')) status = 'running';

                                data.taskCard.tasks.push({ content, status });
                            }
                        }
                    });
                }

                // 2. 获取 Workflow 中的 Workers 信息
                const workerNodes = document.querySelectorAll('.border-worker-border-default, [class*="border-bg-fill"]');
                workerNodes.forEach(node => {
                    const nameEl = node.querySelector('.text-base.font-bold');
                    if (!nameEl) return;

                    const worker = {
                        name: nameEl.textContent.trim(),
                        tasks: []
                    };

                    // 获取 worker 的任务列表
                    const taskItems = node.querySelectorAll('.rounded-lg.flex.gap-2.py-sm');
                    taskItems.forEach((item, idx) => {
                        const noEl = item.querySelector('.text-text-body.text-xs.font-bold');
                        const contentEl = item.querySelector('.text-xs.font-medium');

                        let status = 'pending';
                        if (item.classList.contains('bg-green-50')) status = 'completed';
                        else if (item.className.includes('bg-task-fill-error')) status = 'failed';
                        else if (item.className.includes('bg-zinc-50') && item.querySelector('.animate-spin')) status = 'running';
                        else if (item.className.includes('bg-task-fill-warning')) status = 'blocked';

                        const toolkitEl = item.querySelector('.text-text-primary.text-xs.leading-17.font-bold');
                        const toolkit = toolkitEl ? toolkitEl.textContent.trim() : null;

                        const content = contentEl ? contentEl.textContent.trim() : '';
                        if (content) {
                            worker.tasks.push({
                                no: noEl ? noEl.textContent.trim() : `#${idx}`,
                                content,
                                status,
                                toolkit
                            });
                        }
                    });

                    if (worker.tasks.length > 0) {
                        data.workers.push(worker);
                    }
                });

                return data;
            }
        """)
        return result

    async def print_full_page_state(self, label: str = "PAGE STATE"):
        """打印完整的页面状态"""
        result = await self.get_full_page_state()

        print(f"\n{'='*70}")
        print(f"{label}")
        print(f"{'='*70}")

        # Task Card
        if result.get('taskCard'):
            tc = result['taskCard']
            print(f"\n📋 TASK CARD: {tc['title']}")
            print(f"   Total: {len(tc['tasks'])} tasks")
            status_emoji = {'completed': '✅', 'failed': '❌', 'running': '🔄', 'blocked': '⚠️', 'pending': '⏳'}
            for i, t in enumerate(tc['tasks']):
                emoji = status_emoji.get(t['status'], '❓')
                preview = t['content'][:55] + "..." if len(t['content']) > 55 else t['content']
                print(f"   [{i}] {emoji} {preview}")

        # Workers
        print(f"\n🏭 WORKFLOW WORKERS ({len(result.get('workers', []))} agents)")
        for worker in result.get('workers', []):
            print(f"\n   🤖 {worker['name']} ({len(worker['tasks'])} tasks)")
            status_emoji = {'completed': '✅', 'failed': '❌', 'running': '🔄', 'blocked': '⚠️', 'pending': '⏳'}
            for t in worker['tasks']:
                emoji = status_emoji.get(t['status'], '❓')
                toolkit_info = f" ⚡{t['toolkit']}" if t.get('toolkit') else ""
                preview = t['content'][:45] + "..." if len(t['content']) > 45 else t['content']
                # 去除重复的 No. 前缀
                content_clean = preview.replace(t['no'], '').strip()
                print(f"      {t['no']} {emoji} {content_clean}{toolkit_info}")

        return result

    async def submit_and_verify(self, wait_time: int = 6) -> VerifyResult:
        """
        提交任务并验证是否正确更新

        Args:
            wait_time: 提交后等待时间（秒）

        Returns:
            VerifyResult: 验证结果
        """
        # 获取提交前编辑的任务列表（从 textarea 获取）
        edited_tasks = await self.get_all_tasks()
        expected = [t.content for t in edited_tasks]

        print(f"\n{'='*70}")
        print(f"📝 EXPECTED TASKS (from editing)")
        print(f"{'='*70}")
        for i, t in enumerate(expected):
            preview = t[:60] + "..." if len(t) > 60 else t
            print(f"  [{i}] {preview}")

        # 点击 Start Task
        await self.click_start_task()

        # 等待任务开始执行
        print(f"\n⏳ Waiting {wait_time}s for task submission...")
        await asyncio.sleep(wait_time)

        # 截图
        await self.screenshot("screenshot_after_submit.png")

        # 获取提交后的完整页面状态（包含 workflow）
        after_state = await self.print_full_page_state("📸 AFTER SUBMIT (with Workflow)")
        after_state = after_state or {}

        # 从 workflow workers 中提取所有任务
        actual_tasks = []
        for worker in after_state.get('workers', []):
            for task in worker.get('tasks', []):
                # 清理任务内容（去除重复的 No. 前缀）
                content = task.get('content', '')
                no = task.get('no', '')
                if content.startswith(no):
                    content = content[len(no):].strip()
                actual_tasks.append(content)

        # 对比分析
        print(f"\n{'='*70}")
        print(f"COMPARISON ANALYSIS")
        print(f"{'='*70}")

        # 检查期望的任务是否在实际列表中
        found_tasks = []
        missing_tasks = []

        print("\n📋 Checking expected tasks:")
        for i, exp in enumerate(expected):
            exp_short = exp[:25]
            found = any(exp_short in actual for actual in actual_tasks)
            status = "✓ FOUND" if found else "✗ MISSING"
            preview = exp[:55] + "..." if len(exp) > 55 else exp
            print(f"  [{i}] {status}: {preview}")

            if found:
                found_tasks.append(exp)
            else:
                missing_tasks.append(exp)

        # 检查实际列表中是否有不期望的任务（被删除但又出现的）
        extra_tasks = []

        print("\n🔍 Checking for unexpected tasks (deleted but reappeared):")
        for actual in actual_tasks:
            actual_short = actual[:25]
            is_expected = any(actual_short in exp or exp[:25] in actual for exp in expected)
            if not is_expected:
                extra_tasks.append(actual)
                preview = actual[:55] + "..." if len(actual) > 55 else actual
                print(f"  ⚠️  UNEXPECTED: {preview}")

        if not extra_tasks:
            print("  (none)")

        # 构建结果
        success = len(missing_tasks) == 0 and len(extra_tasks) == 0

        result = VerifyResult(
            success=success,
            expected_tasks=expected,
            actual_tasks=actual_tasks,
            missing_tasks=missing_tasks,
            extra_tasks=extra_tasks,
            message=""
        )

        # 打印最终验证结果
        print(f"\n{'='*70}")
        if success:
            print(f"✅ VERIFICATION PASSED")
        else:
            print(f"❌ VERIFICATION FAILED")
        print(f"{'='*70}")
        print(f"  Expected tasks:   {len(expected)}")
        print(f"  Actual tasks:     {len(actual_tasks)}")
        print(f"  Found:            {len(found_tasks)}")
        print(f"  Missing:          {len(missing_tasks)}")
        print(f"  Unexpected/Extra: {len(extra_tasks)}")

        if missing_tasks:
            print(f"\n  ❌ Missing tasks:")
            for t in missing_tasks:
                print(f"      - {t[:50]}...")

        if extra_tasks:
            print(f"\n  ⚠️  Unexpected tasks (possibly deleted tasks that reappeared):")
            for t in extra_tasks:
                print(f"      - {t[:50]}...")

        return result


async def run_full_test(auto_start: bool = True, close_electron: bool = True):
    """
    运行完整测试流程

    Args:
        auto_start: 是否自动启动 npm run dev（默认 True）
        close_electron: 是否在结束项目时关闭 Electron（默认 True）
    """
    async with TaskUITester(auto_start=auto_start) as tester:
        # 1. 输入查询并等待任务拆分
        print("\n" + "="*50)
        print("STEP 1: Input query and wait for task split")
        print("="*50)

        await tester.input_query("搜索新闻")
        await tester.submit_query()
        await tester.wait_for_task_split(timeout=30)

        # 2. 查看当前任务
        print("\n" + "="*50)
        print("STEP 2: View current tasks")
        print("="*50)

        await tester.print_tasks()
        await tester.screenshot("step2_initial_tasks.png")

        # 3. 执行编辑、添加、删除操作
        print("\n" + "="*50)
        print("STEP 3: Edit, Add, Delete tasks")
        print("="*50)

        task_count = await tester.get_task_count()

        # 删除倒数两个任务
        if task_count > 1:
            await tester.delete_task_by_index(-1)  # 删除最后一个
            await tester.delete_task_by_index(-1)  # 再删除倒数第二个（现在变成最后一个）

        # 添加新任务
        await tester.add_task("say yes")

        # 编辑第一个任务
        await tester.edit_task_by_index(0, "say Hi")

        # 4. 查看修改后的任务
        print("\n" + "="*50)
        print("STEP 4: View modified tasks")
        print("="*50)

        await tester.print_tasks()
        await tester.screenshot("step4_modified_tasks.png")

        # 5. 提交并验证
        print("\n" + "="*50)
        print("STEP 5: Submit and verify")
        print("="*50)

        result = await tester.submit_and_verify(wait_time=10)

        # 6. 结束项目
        print("\n" + "="*50)
        print("STEP 6: End project")
        print("="*50)

        await tester.screenshot("step6_before_end.png")
        await tester.end_project(close_electron=close_electron)

        # 7. 输出最终结果
        print("\n" + "="*50)
        print("FINAL RESULT")
        print("="*50)

        if result.success:
            print("✓ All tests PASSED!")
        else:
            print("✗ Tests FAILED!")
            print(f"  Missing tasks: {result.missing_tasks}")

        return result


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Task UI Tester")
    parser.add_argument(
        "--no-auto-start",
        action="store_true",
        help="Don't auto-start npm run dev (assume it's already running)"
    )
    parser.add_argument(
        "--no-close-electron",
        action="store_true",
        help="Don't close Electron when ending project"
    )

    args = parser.parse_args()

    asyncio.run(run_full_test(
        auto_start=not args.no_auto_start,
        close_electron=not args.no_close_electron
    ))
