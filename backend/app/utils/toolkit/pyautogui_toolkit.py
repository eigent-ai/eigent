import os
from typing import List, Literal
from camel.toolkits import PyAutoGUIToolkit as BasePyAutoGUIToolkit

from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


class PyAutoGUIToolkit(BasePyAutoGUIToolkit, AbstractToolkit):
    agent_name: str = Agents.search_agent

    def __init__(
        self,
        api_task_id: str,
        timeout: float | None = None,
        screenshots_dir: str | None = None,
    ):
        if screenshots_dir is None:
            screenshots_dir = env("file_save_path", os.path.expanduser("~/Downloads"))
        super().__init__(timeout, screenshots_dir)
        self.api_task_id = api_task_id

    @listen_toolkit(BasePyAutoGUIToolkit.mouse_move, lambda _, x, y: f"mouse move to {x}, {y}")
    def mouse_move(self, x: int, y: int) -> str:
        return super().mouse_move(x, y)

    @listen_toolkit(
        BasePyAutoGUIToolkit.mouse_click,
        lambda _, button="left", clicks=1, x=None, y=None: f"mouse click {button} {clicks} times at {x}, {y}",
    )
    def mouse_click(
        self,
        button: Literal["left", "middle", "right"] = "left",
        clicks: int = 1,
        x: int | None = None,
        y: int | None = None,
    ) -> str:
        return super().mouse_click(button, clicks, x, y)

    @listen_toolkit(
        BasePyAutoGUIToolkit.keyboard_type,
        lambda _, text, interval=0: f"keyboard type {text}, interval {interval}",
    )
    def keyboard_type(self, text: str, interval: float = 0) -> str:
        return super().keyboard_type(text, interval)

    @listen_toolkit(BasePyAutoGUIToolkit.take_screenshot)
    def take_screenshot(self) -> str:
        return super().take_screenshot()

    @listen_toolkit(BasePyAutoGUIToolkit.get_mouse_position)
    def get_mouse_position(self) -> str:
        return super().get_mouse_position()

    @listen_toolkit(BasePyAutoGUIToolkit.press_key, lambda _, key: f"press key {key}")
    def press_key(self, key: str | list[str]) -> str:
        return super().press_key(key)

    @listen_toolkit(BasePyAutoGUIToolkit.hotkey, lambda _, keys: f"hotkey {keys}")
    def hotkey(self, keys: List[str]) -> str:
        return super().hotkey(keys)

    @listen_toolkit(
        BasePyAutoGUIToolkit.mouse_drag,
        lambda _,
        start_x,
        start_y,
        end_x,
        end_y,
        button="left": f"mouse drag from {start_x}, {start_y} to {end_x}, {end_y} with {button} button",
    )
    def mouse_drag(
        self,
        start_x: int,
        start_y: int,
        end_x: int,
        end_y: int,
        button: Literal["left", "middle", "right"] = "left",
    ) -> str:
        return super().mouse_drag(start_x, start_y, end_x, end_y, button)

    @listen_toolkit(
        BasePyAutoGUIToolkit.scroll,
        lambda _, scroll_amount, x=None, y=None: f"scroll {scroll_amount} at {x}, {y}",
    )
    def scroll(self, scroll_amount: int, x: int | None = None, y: int | None = None) -> str:
        return super().scroll(scroll_amount, x, y)
