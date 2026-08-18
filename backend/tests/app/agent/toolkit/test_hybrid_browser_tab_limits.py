from typing import Any

import pytest
from camel.toolkits.hybrid_browser_toolkit.ws_wrapper import (
    WebSocketBrowserWrapper as BaseWebSocketBrowserWrapper,
)

from app.agent.toolkit import hybrid_browser_toolkit as browser_module
from app.agent.toolkit.hybrid_browser_toolkit import WebSocketBrowserWrapper


def _tab(tab_id: str, *, current: bool = False) -> dict[str, Any]:
    return {
        "tab_id": tab_id,
        "is_current": current,
        "url": f"https://{tab_id}",
    }


@pytest.fixture(autouse=True)
def _reset_browser_globals(monkeypatch: pytest.MonkeyPatch):
    browser_module._global_tab_registry.clear()
    browser_module._navigation_locks.clear()
    monkeypatch.setenv("EIGENT_BROWSER_MAX_TABS_PER_SESSION", "4")
    monkeypatch.setenv("EIGENT_BROWSER_MAX_MANAGED_TABS", "8")


def _install_fake_browser(
    monkeypatch: pytest.MonkeyPatch,
    tabs: list[dict[str, Any]],
) -> tuple[list[str], list[str]]:
    closed: list[str] = []
    visited: list[str] = []

    async def fake_get_tab_info(self) -> list[dict[str, Any]]:
        return [dict(tab) for tab in tabs]

    async def fake_close_tab(self, tab_id: str) -> dict[str, Any]:
        closed.append(tab_id)
        tabs[:] = [tab for tab in tabs if tab["tab_id"] != tab_id]
        return {"closed": tab_id}

    async def fake_visit_page(self, url: str) -> dict[str, Any]:
        visited.append(url)
        for tab in tabs:
            tab["is_current"] = False
        tabs.append(_tab(f"tab-{len(tabs) + len(closed) + 1}", current=True))
        return {"url": url}

    monkeypatch.setattr(
        BaseWebSocketBrowserWrapper, "get_tab_info", fake_get_tab_info
    )
    monkeypatch.setattr(
        BaseWebSocketBrowserWrapper, "close_tab", fake_close_tab
    )
    monkeypatch.setattr(
        BaseWebSocketBrowserWrapper, "visit_page", fake_visit_page
    )
    return closed, visited


async def _track_current(
    wrapper: WebSocketBrowserWrapper,
    tabs: list[dict[str, Any]],
    tab_id: str,
) -> None:
    for tab in tabs:
        tab["is_current"] = tab["tab_id"] == tab_id
    await wrapper.get_tab_info()


@pytest.mark.asyncio
async def test_visit_page_recycles_lru_session_tab_before_opening(
    monkeypatch: pytest.MonkeyPatch,
):
    tabs = [_tab(f"tab-{index}") for index in range(1, 5)]
    closed, visited = _install_fake_browser(monkeypatch, tabs)
    wrapper = WebSocketBrowserWrapper({"cdpUrl": "http://localhost:9222"})

    for tab in list(tabs):
        await _track_current(wrapper, tabs, tab["tab_id"])

    await wrapper.visit_page("https://new.example")
    await wrapper.get_tab_info()

    assert closed == ["tab-1"]
    assert visited == ["https://new.example"]
    assert len(wrapper._session_tab_ids) == 4
    assert len(tabs) == 4


@pytest.mark.asyncio
async def test_global_limit_rejects_when_only_other_sessions_can_be_recycled(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("EIGENT_BROWSER_MAX_MANAGED_TABS", "2")
    tabs = [_tab("tab-a", current=True), _tab("tab-b")]
    closed, visited = _install_fake_browser(monkeypatch, tabs)
    wrapper_a = WebSocketBrowserWrapper({"cdpUrl": "http://localhost:9222"})
    wrapper_b = WebSocketBrowserWrapper({"cdpUrl": "http://localhost:9222"})

    await _track_current(wrapper_a, tabs, "tab-a")
    await _track_current(wrapper_b, tabs, "tab-b")

    with pytest.raises(RuntimeError, match="Browser tab limit reached"):
        await wrapper_b.visit_page("https://blocked.example")

    assert closed == []
    assert visited == []


@pytest.mark.asyncio
async def test_unmanaged_user_tabs_are_never_counted_or_closed(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("EIGENT_BROWSER_MAX_MANAGED_TABS", "2")
    tabs = [
        _tab("user-1"),
        _tab("user-2"),
        _tab("eigent-1", current=True),
    ]
    closed, visited = _install_fake_browser(monkeypatch, tabs)
    wrapper = WebSocketBrowserWrapper({"cdpUrl": "http://localhost:9222"})

    await wrapper.get_tab_info()
    await wrapper.visit_page("https://allowed.example")

    assert closed == []
    assert visited == ["https://allowed.example"]
    assert {tab["tab_id"] for tab in tabs}.issuperset({"user-1", "user-2"})


def test_invalid_tab_limit_environment_uses_safe_defaults(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("EIGENT_BROWSER_MAX_TABS_PER_SESSION", "unlimited")
    monkeypatch.setenv("EIGENT_BROWSER_MAX_MANAGED_TABS", "0")
    wrapper = WebSocketBrowserWrapper({"cdpUrl": "http://localhost:9222"})

    assert wrapper._max_session_tabs() == 4
    assert wrapper._max_managed_tabs_per_endpoint() == 8
