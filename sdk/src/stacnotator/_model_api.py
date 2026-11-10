"""The model API a labelling run talks to: the OpenAI Responses API.

A session is one conversation: it keeps its own history and takes the next turn's user
content or tool results.
"""

import asyncio
import base64
import json
import os
import time
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]


@dataclass
class UserTurn:
    text: str
    images: list[bytes] = field(default_factory=list)


@dataclass
class ToolResult:
    call_id: str
    text: str
    images: list[bytes] = field(default_factory=list)


@dataclass
class ToolCall:
    call_id: str
    name: str
    # None when the model sent arguments that are not valid JSON.
    arguments: dict[str, Any] | None


@dataclass
class ModelReply:
    text: str
    tool_calls: list[ToolCall]
    input_tokens: int = 0
    output_tokens: int = 0


class ContentBlockedError(Exception):
    """The API refused the request or its answer on content policy grounds."""


class Session(Protocol):
    async def send(
        self, items: Sequence[UserTurn | ToolResult], only: Sequence[str] | None = None
    ) -> ModelReply:
        """only: the tools the model must choose from this turn."""


class OpenAIResponses:
    """The OpenAI Responses API: OpenAI itself, Azure OpenAI and Azure AI Foundry through
    their v1 endpoint (https://<resource>.openai.azure.com/openai/v1/), and any other
    service that implements it."""

    def __init__(
        self, client: Any, model: str, reasoning: str | None = None, image_detail: str = "high"
    ):
        self._client = client
        self._model = model
        self._reasoning = reasoning
        self._image_detail = image_detail

    def session(self, instructions: str, tools: list[ToolSpec]) -> Session:
        return _ResponsesSession(self, instructions, tools)

    async def check(self) -> None:
        """Make one tiny call, so a wrong model name or sign-in fails before any work."""
        await self._client.responses.create(
            model=self._model, input="Reply OK.", max_output_tokens=16, store=False
        )


class _ResponsesSession:
    def __init__(self, api: OpenAIResponses, instructions: str, tools: list[ToolSpec]):
        self._api = api
        self._instructions = instructions
        self._tools = [
            {
                "type": "function",
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters,
                "strict": False,
            }
            for tool in tools
        ]
        self._previous: str | None = None

    async def send(
        self, items: Sequence[UserTurn | ToolResult], only: Sequence[str] | None = None
    ) -> ModelReply:
        import openai

        params: dict[str, Any] = {
            "model": self._api._model,
            "instructions": self._instructions,
            "input": [self._item(item) for item in items],
            "tools": [tool for tool in self._tools if not only or tool["name"] in only],
            "store": True,
        }
        if self._previous:
            params["previous_response_id"] = self._previous
        if self._api._reasoning:
            params["reasoning"] = {"effort": self._api._reasoning}
        if only:
            params["tool_choice"] = "required"
        try:
            response = await self._api._client.responses.create(**params)
        except openai.BadRequestError as exc:
            if _is_content_filter(exc):
                raise ContentBlockedError(str(exc)) from exc
            raise
        incomplete = getattr(response, "incomplete_details", None)
        if incomplete is not None and incomplete.reason == "content_filter":
            raise ContentBlockedError("The answer was stopped by the content filter.")
        self._previous = response.id
        calls = [
            ToolCall(item.call_id, item.name, _arguments(item.arguments))
            for item in response.output
            if item.type == "function_call"
        ]
        usage = response.usage
        return ModelReply(
            response.output_text,
            calls,
            usage.input_tokens if usage else 0,
            usage.output_tokens if usage else 0,
        )

    def _item(self, item: UserTurn | ToolResult) -> dict[str, Any]:
        content = [{"type": "input_text", "text": item.text}] + [
            {
                "type": "input_image",
                "image_url": f"data:image/jpeg;base64,{base64.b64encode(image).decode()}",
                "detail": self._api._image_detail,
            }
            for image in item.images
        ]
        if isinstance(item, ToolResult):
            return {"type": "function_call_output", "call_id": item.call_id, "output": content}
        return {"role": "user", "content": content}


def _arguments(raw: str | None) -> dict[str, Any] | None:
    try:
        value = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def _is_content_filter(exc: Exception) -> bool:
    text = f"{getattr(exc, 'code', '')} {exc}".lower()
    return any(
        marker in text
        for marker in ("content_filter", "content management policy", "content policy")
    )


def _entra_token(scope: str, tenant: str | None) -> Callable[[], Awaitable[str]]:
    # The synchronous credential, so azure-identity does not need aiohttp.
    from azure.identity import DefaultAzureCredential

    credential = DefaultAzureCredential(additionally_allowed_tenants=["*"] if tenant else [])
    lock = asyncio.Lock()
    cached: list[Any] = []

    async def token() -> str:
        # The az CLI credential runs a subprocess per call, so reuse a token until near expiry.
        async with lock:
            if not cached or cached[0].expires_on - time.time() < 300:
                cached[:] = [await asyncio.to_thread(credential.get_token, scope, tenant_id=tenant)]
            return str(cached[0].token)

    return token


def openai_client(
    base_url: str | None,
    api_key_env: str = "OPENAI_API_KEY",
    entra_scope: str | None = None,
    entra_tenant: str | None = None,
) -> Any:
    """entra_scope: sign in with Microsoft Entra ID for this token scope instead of an API
    key; entra_tenant: the resource's tenant, when it is not your default one."""
    from openai import AsyncOpenAI

    api_key: str | Callable[[], Awaitable[str]]
    if entra_scope:
        api_key = _entra_token(entra_scope, entra_tenant)
    else:
        key = os.environ.get(api_key_env)
        if not key:
            raise ValueError(
                f"Set {api_key_env} to the API key, or sign in with Entra ID (--entra)."
            )
        api_key = key
    return AsyncOpenAI(base_url=base_url, api_key=api_key, max_retries=6, timeout=600)
