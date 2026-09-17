"""Headless Chromium pages that draw agents' map views, started by the MCP server.

Each agent gets its own render page (up to a cap sized from the machine), so no browser tab
has to stay open and drawing scales with the cores available. A page draws its own agent's
jobs first and then helps with the owner's other agents on the same campaign, which is why
running into the cap only means sharing, not stalling.
"""

from __future__ import annotations

import asyncio
import atexit
import contextlib
import json
import os
import subprocess
import sys
import threading
import time
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TypeVar

try:
    from playwright.async_api import (
        Browser,
        BrowserContext,
        Page,
        Playwright,
        async_playwright,
    )
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError

    PLAYWRIGHT_INSTALLED = True
except ImportError:
    PLAYWRIGHT_INSTALLED = False

PAGE_MEMORY_MB = 500
RESERVED_MEMORY_MB = 2048
MAX_MEMORY_SHARE = 0.6
FALLBACK_MEMORY_MB = 4096
MAX_PAGES_ENV = "STACNOTATOR_MAX_RENDER_BROWSERS"

PIP_NOTE = (
    "Headless render browsers need Playwright: ask the user to "
    '`pip install "./sdk[agent]"` from the stacnotator repo and restart the MCP server. '
    "Until then, views are "
    'only drawn while the campaign\'s Agents page is open with "Render in this tab" switched on.'
)
INSTALL_NOTE = (
    "Headless render browsers are not installed. Ask the user once whether to install them "
    "(a one-time Chromium download of about 150 MB). If they agree, call "
    "install_render_browsers. If not, they need to keep the campaign's Agents page open with "
    '"Render in this tab" switched on.'
)

_TICK_SECONDS = 30
_STARTUP_WAIT_MS = 15_000
_RETRY_FAILED_PAGE_SECONDS = 300
_ERROR_TICKS_BEFORE_CLOSING = 2
_LOADING_TICKS_BEFORE_CLOSING = 6
_CALL_TIMEOUT_SECONDS = 90.0

T = TypeVar("T")


class ChromiumMissingError(RuntimeError):
    def __init__(self) -> None:
        super().__init__(INSTALL_NOTE)


def estimate_render_capacity(cpu_count: int, available_memory_mb: int) -> int:
    """How many render pages this machine can run side by side.

    Every page is its own Chromium renderer process drawing a dense view with OpenLayers
    and several tile layers: measured at 400-550 MB each while drawing 16-cell views, on
    top of about 500 MB for Chromium's own browser, GPU and network processes. We keep
    about 2 GB for everything else on the machine and never plan on more than 60% of the
    memory that is available, so other work does not start swapping. Drawing is CPU bound,
    so each page gets a core and one core stays free for the MCP server, the model client
    and the OS.
    """
    usable_mb = min(
        available_memory_mb - RESERVED_MEMORY_MB, available_memory_mb * MAX_MEMORY_SHARE
    )
    by_memory = int(usable_mb // PAGE_MEMORY_MB)
    by_cpu = cpu_count - 1
    return max(1, min(by_memory, by_cpu))


def machine_resources() -> tuple[int, int]:
    """(cpu_count, available_memory_mb), without extra dependencies."""
    return os.cpu_count() or 1, _available_memory_mb()


def _available_memory_mb() -> int:
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) // 1024
    except (OSError, ValueError, IndexError):
        pass
    # macOS and friends have no cheap "available" figure: half of physical memory is
    # a fair guess for a machine that is also running a browser and an IDE.
    try:
        total = os.sysconf("SC_PHYS_PAGES") * os.sysconf("SC_PAGE_SIZE")
        return int(total * 0.5) // (1024 * 1024)
    except (OSError, ValueError, AttributeError):
        return FALLBACK_MEMORY_MB


def render_page_cap() -> int:
    override = os.environ.get(MAX_PAGES_ENV)
    if override and override.isdigit() and int(override) > 0:
        return int(override)
    return estimate_render_capacity(*machine_resources())


def install_chromium() -> str:
    """Download the Chromium build that the installed Playwright version drives."""
    result = subprocess.run(  # noqa: S603 (fixed argv, no user input)
        [sys.executable, "-m", "playwright", "install", "chromium"],
        capture_output=True,
        text=True,
        timeout=1800,
        check=False,
    )
    if result.returncode != 0:
        tail = "\n".join((result.stderr or result.stdout).strip().splitlines()[-15:])
        raise RuntimeError(f"Installing Chromium failed:\n{tail}")
    return "Chromium is installed; render browsers start with the next agent call."


@dataclass
class _RenderPage:
    campaign_id: int
    agent_id: str
    context: BrowserContext
    page: Page
    unhealthy_ticks: int = 0


class RenderBrowsers:
    """One Chromium process with a context and page per agent, driven from its own thread.

    Playwright's async API runs on a private event loop in a daemon thread, so the MCP
    server's worker threads can call the sync methods below concurrently.
    """

    def __init__(
        self,
        app_url: str,
        token: Callable[[], str | None],
        max_pages: int | None = None,
    ):
        self.max_pages = max_pages if max_pages is not None else render_page_cap()
        self._app_url = app_url.rstrip("/")
        self._token = token
        self._playwright: Playwright | None = None
        self._browser: Browser | None = None
        self._pages: dict[str, _RenderPage] = {}
        self._failures: dict[str, tuple[str, float]] = {}
        self._lock = asyncio.Lock()
        self._watcher: asyncio.Task[None] | None = None
        self._closed = False
        self._loop = asyncio.new_event_loop()
        threading.Thread(
            target=self._loop.run_forever, name="stacnotator-render-browsers", daemon=True
        ).start()
        atexit.register(self.close)

    def ensure(self, campaign_id: int, agent_id: str) -> str | None:
        """Start a render page for the agent when there is room for one.

        Returns a one-line status when a page was started or could not be, None when the
        agent is already covered. Raises ChromiumMissingError when Chromium is not installed.
        """
        return self._run(self._ensure(campaign_id, agent_id))

    def status(self) -> dict[str, Any]:
        return self._run(self._status())

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            self._run(self._shutdown(), timeout=15)
        finally:
            self._loop.call_soon_threadsafe(self._loop.stop)

    def _run(self, coro: Coroutine[Any, Any, T], timeout: float = _CALL_TIMEOUT_SECONDS) -> T:
        return asyncio.run_coroutine_threadsafe(coro, self._loop).result(timeout)

    async def _ensure(self, campaign_id: int, agent_id: str) -> str | None:
        async with self._lock:
            if agent_id in self._pages:
                return None
            failure = self._failures.get(agent_id)
            if failure and time.monotonic() - failure[1] < _RETRY_FAILED_PAGE_SECONDS:
                return None
            on_campaign = any(p.campaign_id == campaign_id for p in self._pages.values())
            # Past the cap, pages already on the campaign draw this agent's views too; a
            # campaign with no page at all still gets one, or its views would never be drawn.
            if len(self._pages) >= self.max_pages and on_campaign:
                return None
            browser = await self._browser_or_launch()
            render_page = await self._open_page(browser, campaign_id, agent_id)
            status = await _render_status(render_page.page)
            if status.startswith("error:"):
                await self._drop(render_page, status)
                return f"The render browser for agent {agent_id} failed to start ({status})."
            self._pages[agent_id] = render_page
            self._failures.pop(agent_id, None)
            if self._watcher is None:
                self._watcher = asyncio.create_task(self._watch())
            return (
                f"Started a headless render browser for agent {agent_id} ({status}); "
                f"{len(self._pages)} of {self.max_pages} running."
            )

    async def _browser_or_launch(self) -> Browser:
        if self._browser is not None and self._browser.is_connected():
            return self._browser
        if self._playwright is None:
            self._playwright = await async_playwright().start()
        # Ask Playwright where its own Chromium lives: a browser folder left behind by
        # another Playwright version sits in the same cache but would not match.
        if not Path(self._playwright.chromium.executable_path).exists():
            raise ChromiumMissingError()
        self._browser = await self._playwright.chromium.launch(headless=True)
        return self._browser

    async def _open_page(self, browser: Browser, campaign_id: int, agent_id: str) -> _RenderPage:
        token = await self._fresh_token()
        context = await browser.new_context()
        await context.add_init_script(script=f"window.__stacnotatorToken = {json.dumps(token)};")
        page = await context.new_page()
        render_page = _RenderPage(campaign_id, agent_id, context, page)
        url = f"{self._app_url}/agent-render?campaign={campaign_id}&agent={agent_id}"
        try:
            await page.goto(url)
        except Exception:
            await context.close()
            raise
        # A slow first load is fine: the watcher closes the page if it never gets ready.
        with contextlib.suppress(PlaywrightTimeoutError):
            await page.wait_for_function(
                "() => { const s = document.body?.getAttribute('data-render-status');"
                " return !!s && s !== 'loading'; }",
                timeout=_STARTUP_WAIT_MS,
            )
        return render_page

    async def _fresh_token(self) -> str | None:
        return await self._loop.run_in_executor(None, self._token)

    async def _watch(self) -> None:
        """Push fresh tokens and retire broken pages.

        A token provider hands out its cached token until about a minute before it expires,
        so pushing every 30 seconds means a page never holds an expired one.
        """
        while True:
            await asyncio.sleep(_TICK_SECONDS)
            try:
                token = await self._fresh_token()
            except Exception:
                token = None
            async with self._lock:
                for render_page in list(self._pages.values()):
                    await self._check(render_page, token)

    async def _check(self, render_page: _RenderPage, token: str | None) -> None:
        status = await _render_status(render_page.page)
        if status == "ready":
            render_page.unhealthy_ticks = 0
        else:
            render_page.unhealthy_ticks += 1
        loading = status == "loading"
        limit = _LOADING_TICKS_BEFORE_CLOSING if loading else _ERROR_TICKS_BEFORE_CLOSING
        if render_page.unhealthy_ticks >= limit:
            reason = "error: the render page never finished loading" if loading else status
            await self._drop(render_page, reason)
            return
        if token is not None:
            try:
                await render_page.page.evaluate("t => { window.__stacnotatorToken = t }", token)
            except Exception as exc:
                await self._drop(render_page, f"error: {exc}")

    async def _drop(self, render_page: _RenderPage, status: str) -> None:
        self._pages.pop(render_page.agent_id, None)
        self._failures[render_page.agent_id] = (status, time.monotonic())
        with contextlib.suppress(Exception):
            await render_page.context.close()

    async def _status(self) -> dict[str, Any]:
        pages = [
            {
                "agent_id": p.agent_id,
                "campaign_id": p.campaign_id,
                "render_status": await _render_status(p.page),
            }
            for p in list(self._pages.values())
        ]
        return {
            "pages_running": len(pages),
            "cap": self.max_pages,
            "pages": pages,
            "closed_after_error": {agent: msg for agent, (msg, _) in self._failures.items()},
        }

    async def _shutdown(self) -> None:
        if self._watcher is not None:
            self._watcher.cancel()
        for render_page in list(self._pages.values()):
            with contextlib.suppress(Exception):
                await render_page.context.close()
        self._pages.clear()
        if self._browser is not None:
            await self._browser.close()
        if self._playwright is not None:
            await self._playwright.stop()
        self._browser = None
        self._playwright = None


async def _render_status(page: Page) -> str:
    try:
        status = await page.evaluate(
            "() => document.body?.getAttribute('data-render-status') ?? null"
        )
    except Exception as exc:
        return f"error: {exc}"
    return str(status) if status else "loading"
