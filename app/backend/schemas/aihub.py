"""
Request and response models for the AI Hub text-generation relay.
"""

from typing import List, Optional, Union

from pydantic import BaseModel, Field

# ==================== Generate Text ====================


class ImageUrl(BaseModel):
    """Image URL configuration."""

    url: str = Field(..., description="Image URL or base64 data URI.")


class ContentPartText(BaseModel):
    """Text content part."""

    type: str = Field(default="text", description="Content type.")
    text: str = Field(..., description="Text content.")


class ContentPartImage(BaseModel):
    """Image content part."""

    type: str = Field(default="image_url", description="Content type.")
    image_url: ImageUrl = Field(..., description="Image URL configuration.")


class ChatMessage(BaseModel):
    """
    Chat message format.

    Supports two `content` formats:
    1. Plain text: content = "Hello"
    2. Multimodal: content = [{"type": "text", "text": "..."}, {"type": "image_url", "image_url": {"url": "..."}}]
    """

    role: str = Field(..., description="Message role: system/user/assistant.")
    content: Union[str, List[Union[ContentPartText, ContentPartImage]]] = Field(
        ..., description="Message content: a string or a list of content parts (multimodal)."
    )


class GenTxtRequest(BaseModel):
    """Generate Text request parameters."""

    messages: List[ChatMessage] = Field(..., description="Conversation messages list.")
    model: str = Field(default="deepseek-v4-pro", description="Model name")
    stream: bool = Field(default=False, description="Whether to enable streaming output.")
    temperature: Optional[float] = Field(default=0.7, description="Sampling temperature (0-2).")
    max_tokens: Optional[int] = Field(default=65536, description="Maximum number of generated tokens.")
    token: str = Field(
        default="",
        description="Opaque session token of the signed-in caller. The relay is "
        "authenticated like /api/v1/hub/*; anonymous requests are rejected.",
    )


class GenTxtResponse(BaseModel):
    """Generate Text response (non-streaming)."""

    content: str = Field(..., description="Generated text content.")
    model: str = Field(..., description="Name of the model used.")
    usage: Optional[dict] = Field(default=None, description="Token usage statistics.")
