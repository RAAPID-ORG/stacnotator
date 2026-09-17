"""Headless Chromium pages that draw agents' map views, driven by the MCP server.

Each agent gets its own browser context and page, so its tiles do not queue behind another
agent's connections. The server calls the page's `window.stacnotatorAgent` and gets the
images straight back.
"""

import asyncio
import subprocess
import sys
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from playwright.async_api import Browser, Page, Playwright, async_playwright

INSTALL_NOTE = (
    "The headless browser that draws the views is not installed. Ask the user once whether "
    "to install it (a one-time Chromium download of about 150 MB). If they agree, call "
    "install_render_browsers."
)

_PAGE_READY_MS = 60_000
_WATCH_HTML = """<!doctype html><title>STACNotator agents</title>
<style>
  body { margin: 0; padding: 12px; font: 13px sans-serif; background: #1b1b1b; color: #eee; }
  header { border-bottom: 1px solid #383838; padding-bottom: 10px; margin-bottom: 14px;
           max-width: 70ch; }
  h1 { font-size: 15px; margin: 0 0 6px; }
  header p { margin: 0 0 6px; color: #b4b4b4; line-height: 1.5; }
  code { color: #eee; }
  section { margin-bottom: 16px; }
  h2 { font-size: 14px; margin: 0 0 6px; }
  img { max-width: 100%; max-height: 80vh; margin: 0 8px 8px 0; vertical-align: top; }
</style>
<header>
  <h1>Labelling agents at work</h1>
  <p>One block per agent, showing the views it is looking at for the task named above them:
  a few dates of the imagery around the point, the time series, a basemap. The agent reads
  these, asks for closer views when the point is unclear, and submits a label to the
  campaign like any other annotator.</p>
  <p>This window only watches. Closing it does not stop the agents, and the images keep
  coming while it is open.</p>
  <p id="progress">Progress, take-over and freeing unfinished tasks live on the campaign's
  Agents page.</p>
</header>
<p id="empty">Waiting for the agents' first views.</p>
<script>
  window.show = ({ agent, task_id, images }) => {
    document.getElementById('empty')?.remove();
    let section = document.getElementById(agent);
    if (!section) {
      section = document.body.appendChild(document.createElement('section'));
      section.id = agent;
    }
    section.replaceChildren(
      Object.assign(document.createElement('h2'), { textContent: `${agent} - task ${task_id}` }),
      ...images.map((data) => Object.assign(new Image(), { src: `data:image/jpeg;base64,${data}` }))
    );
  };
</script>"""


class ChromiumMissingError(RuntimeError):
    def __init__(self) -> None:
        super().__init__(INSTALL_NOTE)


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
    return "Chromium is installed."


class RenderBrowsers:
    def __init__(self, app_url: str, token: Callable[[], Awaitable[str | None]]):
        self._app_url = app_url.rstrip("/")
        self._token = token
        self._playwright: Playwright | None = None
        self._browser: Browser | None = None
        self._pages: dict[str, asyncio.Task[Page]] = {}
        self._watch: Page | None = None
        self._launch_lock = asyncio.Lock()

    async def call(self, agent_id: str, campaign_id: int, method: str, *args: Any) -> Any:
        page = await self._page(agent_id, campaign_id)
        return await page.evaluate(
            "([method, args]) => window.stacnotatorAgent[method](...args)", [method, list(args)]
        )

    async def open_watch_window(self, agents_url: str | None = None) -> None:
        if self._watch is not None and not self._watch.is_closed():
            await self._watch.bring_to_front()
            return
        async with self._launch_lock:
            playwright = await self._started()
        browser = await playwright.chromium.launch(headless=False)
        self._watch = await browser.new_page(no_viewport=True)
        await self._watch.set_content(_WATCH_HTML)
        if agents_url:
            # As text, not a link: this browser has no session, so a click would only
            # land the user on a sign-in page.
            await self._watch.evaluate(
                "url => document.getElementById('progress').append(' Open it in your own "
                "browser: ', Object.assign(document.createElement('code'), "
                "{ textContent: url }))",
                agents_url,
            )

    async def show(self, agent: str, task_id: int, images: list[str]) -> None:
        """Put an agent's latest views in the watch window, when one is open."""
        if self._watch is None or self._watch.is_closed():
            return
        await self._watch.evaluate(
            "v => window.show(v)", {"agent": agent, "task_id": task_id, "images": images}
        )

    async def _page(self, agent_id: str, campaign_id: int) -> Page:
        opening = self._pages.get(agent_id)
        # A page that failed to open or has since crashed is opened again.
        if (
            opening is None
            or (opening.done() and opening.exception() is not None)
            or (opening.done() and opening.result().is_closed())
        ):
            opening = asyncio.ensure_future(self._open(campaign_id))
            self._pages[agent_id] = opening
        return await opening

    async def _open(self, campaign_id: int) -> Page:
        browser = await self._launched()
        context = await browser.new_context()
        await context.expose_function("stacnotatorToken", self._token)
        page = await context.new_page()
        page.on("crash", lambda _: asyncio.ensure_future(context.close()))
        try:
            await page.goto(f"{self._app_url}/agent-render?campaign={campaign_id}")
            await page.wait_for_function(
                "() => window.stacnotatorAgent || window.stacnotatorAgentError",
                timeout=_PAGE_READY_MS,
            )
            error = await page.evaluate("() => window.stacnotatorAgentError ?? null")
        except Exception:
            await context.close()
            raise
        if error:
            await context.close()
            raise RuntimeError(f"The render page could not load the campaign: {error}")
        return page

    async def _started(self) -> Playwright:
        if self._playwright is None:
            self._playwright = await async_playwright().start()
        # A browser folder left by another Playwright version would not match.
        if not Path(self._playwright.chromium.executable_path).exists():
            raise ChromiumMissingError()
        return self._playwright

    async def _launched(self) -> Browser:
        async with self._launch_lock:
            if self._browser is not None and self._browser.is_connected():
                return self._browser
            playwright = await self._started()
            self._browser = await playwright.chromium.launch(headless=True)
            return self._browser
