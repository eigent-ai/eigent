from app.agent.factory.toolkit_assembler import _tag_tools
from app.agent.toolkit.hybrid_browser_toolkit import HybridBrowserToolkit
from app.agent.toolkit.screenshot_toolkit import ScreenshotToolkit
from app.agent.toolkit.search_toolkit import SearchToolkit
from app.run_policy import ToolSafetyClass
from app.run_runtime.tool_checkpoint import declared_tool_safety


class NamedTool:
    def __init__(self, name: str):
        self.name = name

    def get_function_name(self) -> str:
        return self.name


def test_titleized_toolkit_names_apply_trusted_read_declarations():
    screenshot = NamedTool("read_image")
    search = NamedTool("vendor_search")
    browser_read = NamedTool("browser_get_page_snapshot")
    browser_write = NamedTool("browser_click")

    _tag_tools([screenshot], ScreenshotToolkit.toolkit_name())
    _tag_tools([search], SearchToolkit.toolkit_name())
    _tag_tools(
        [browser_read, browser_write], HybridBrowserToolkit.toolkit_name()
    )

    assert declared_tool_safety(screenshot, "read_image", {}) == (
        ToolSafetyClass.SAFE_READ,
        None,
    )
    assert declared_tool_safety(search, "vendor_search", {}) == (
        ToolSafetyClass.SAFE_READ,
        None,
    )
    assert declared_tool_safety(
        browser_read, "browser_get_page_snapshot", {}
    ) == (ToolSafetyClass.SAFE_READ, None)
    assert declared_tool_safety(browser_write, "browser_click", {}) == (
        ToolSafetyClass.UNSAFE_WRITE,
        None,
    )


def test_immutable_wrapper_declaration_falls_back_to_wrapped_function():
    def read_image():
        return None

    class ImmutableWrapper:
        __slots__ = ("func",)

        def __init__(self):
            self.func = read_image

        def get_function_name(self) -> str:
            return "read_image"

    tool = ImmutableWrapper()
    _tag_tools([tool], ScreenshotToolkit.toolkit_name())

    assert declared_tool_safety(tool, "read_image", {}) == (
        ToolSafetyClass.SAFE_READ,
        None,
    )
