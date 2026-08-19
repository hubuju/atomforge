"""
AI Hub service layer — text generation relay.

Only text generation is part of the product. The template's image / video /
audio / PDF capabilities were removed along with their routes: several of them
accepted server-side file paths or arbitrary URLs (local file read / SSRF) and
none required authentication. The two methods below are the whole contract.
"""

import logging
import time
from typing import AsyncGenerator, Optional, TYPE_CHECKING

from core.config import settings
from schemas.aihub import GenTxtRequest, GenTxtResponse

if TYPE_CHECKING:
    from openai import AsyncOpenAI

logger = logging.getLogger(__name__)


class AIHubService:
    """AI Hub service class that wraps AI SDK calls."""

    def __init__(self):
        self.client: Optional["AsyncOpenAI"] = None
        if settings.app_ai_base_url and settings.app_ai_key:
            from openai import AsyncOpenAI

            self.client = AsyncOpenAI(
                api_key=settings.app_ai_key,
                base_url=settings.app_ai_base_url.rstrip("/"),
            )

    def _require_ai_client(self) -> "AsyncOpenAI":
        """Return the configured AI client or raise a configuration error."""
        if not self.client:
            raise ValueError("AI service not configured. Set APP_AI_BASE_URL and APP_AI_KEY.")
        return self.client

    def _convert_message(self, msg) -> dict:
        """Convert message format and support multimodal content."""
        content = msg.content
        # If content is a list (multimodal), convert it to plain dicts
        if isinstance(content, list):
            content = [item.model_dump() if hasattr(item, "model_dump") else item for item in content]
        return {"role": msg.role, "content": content}

    async def gentxt(self, request: GenTxtRequest) -> GenTxtResponse:
        """
        Generate Text API (non-streaming), supports text and image input.

        Args:
            request: Generate text request parameters.

        Returns:
            GenTxtResponse: generated text response.
        """
        try:
            client = self._require_ai_client()
            messages = [self._convert_message(msg) for msg in request.messages]

            create_kwargs: dict = {
                "model": request.model,
                "messages": messages,
                "temperature": request.temperature,
                "max_tokens": request.max_tokens,
                "stream": False,
            }
            # Thinking is disabled by default for every model that supports the
            # switch: code generation wants the full output budget on the files
            # themselves, and non-thinking is dramatically faster. (It also
            # restores temperature sampling, ignored while thinking.)
            if str(request.model).startswith("deepseek-v4"):
                create_kwargs["extra_body"] = {"thinking": {"type": "disabled"}}

            response = await client.chat.completions.create(**create_kwargs)

            content = response.choices[0].message.content or ""
            usage = None
            if response.usage:
                usage = {
                    "prompt_tokens": response.usage.prompt_tokens,
                    "completion_tokens": response.usage.completion_tokens,
                    "total_tokens": response.usage.total_tokens,
                }

            return GenTxtResponse(
                content=content,
                model=request.model,
                usage=usage,
            )

        except Exception as e:
            logger.error(f"gentxt error: {e}")
            raise

    async def gentxt_stream(self, request: GenTxtRequest) -> AsyncGenerator[str, None]:
        """
        Generate Text API (streaming), supports text and image input.

        Args:
            request: Generate text request parameters.

        Yields:
            str: Generated text content chunk (plain text, not JSON).
        """
        start_time = time.time()
        first_content_at: Optional[float] = None
        content_chars = 0
        reason_chars = 0
        try:
            client = self._require_ai_client()
            messages = [self._convert_message(msg) for msg in request.messages]

            create_kwargs: dict = {
                "model": request.model,
                "messages": messages,
                "temperature": request.temperature,
                "max_tokens": request.max_tokens,
                "stream": True,
            }
            if str(request.model).startswith("deepseek-v4"):
                create_kwargs["extra_body"] = {"thinking": {"type": "disabled"}}

            stream = await client.chat.completions.create(**create_kwargs)

            # Coalesce tiny upstream deltas into larger SSE frames. DeepSeek
            # emits many small chunks per second; forwarding each one costs a
            # full frame through the gateway and a JSON parse in the browser.
            # Buffering up to ~256 chars / 32ms keeps the panel visually live
            # while cutting frame count by roughly two orders of magnitude.
            buffer = ""
            last_flush = time.time()
            async for chunk in stream:
                if not chunk.choices or not chunk.choices[0].delta:
                    continue
                delta = chunk.choices[0].delta
                dump = getattr(delta, "model_dump", None)
                data = dump() if callable(dump) else {}
                if data.get("reasoning_content"):
                    reason_chars += len(data["reasoning_content"])
                content = data.get("content")
                if content:
                    if first_content_at is None:
                        first_content_at = time.time() - start_time
                    content_chars += len(content)
                    buffer += content
                    now = time.time()
                    if len(buffer) >= 256 or now - last_flush >= 0.032:
                        yield buffer
                        buffer = ""
                        last_flush = now

            if buffer:
                yield buffer

        except Exception as e:
            elapsed = time.time() - start_time
            logger.error(f"[AI] model={request.model} failed after {elapsed:.1f}s: {e}")
            raise
        finally:
            elapsed = time.time() - start_time
            ttft = f"{first_content_at:.1f}s" if first_content_at is not None else "-"
            logger.info(
                f"[AI] model={request.model} ttft={ttft} total={elapsed:.1f}s "
                f"content={content_chars}chars reasoning={reason_chars}chars"
            )
