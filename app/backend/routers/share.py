"""Public read-only access to published workspaces.

This router is intentionally unauthenticated: a published app must be runnable
by visitors who are not logged in, so the project files are fetched server-side
by their public share slug instead of through an authenticated data route.
"""
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from routers.hub import ProjectFile, load_files
from services.workspaces import WorkspacesService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/share", tags=["share"])


class SharedWorkspaceResponse(BaseModel):
    """Read-only payload exposed to anonymous visitors."""

    id: int
    name: str
    description: str = ""
    files: List[ProjectFile] = []
    updated_at: Optional[str] = None


@router.get("/{slug}", response_model=SharedWorkspaceResponse)
async def get_shared_workspace(
    slug: str,
    db: AsyncSession = Depends(get_db),
) -> SharedWorkspaceResponse:
    """Return a published workspace and its files by public share slug."""
    slug = (slug or "").strip()
    if not slug:
        raise HTTPException(status_code=400, detail="缺少分享标识")

    try:
        workspace = await WorkspacesService(db).get_by_field("share_slug", slug)
    except Exception as exc:  # pragma: no cover - defensive
        logger.error("Failed to load shared workspace %s: %s", slug, exc)
        raise HTTPException(status_code=500, detail="读取分享内容失败") from exc

    if workspace is None or not getattr(workspace, "is_published", False):
        raise HTTPException(status_code=404, detail="该应用不存在或尚未公开发布")

    files = load_files(getattr(workspace, "files_json", None))
    if not files:
        raise HTTPException(status_code=404, detail="该应用还没有生成任何内容")

    updated_at = getattr(workspace, "updated_at", None)
    payload = SharedWorkspaceResponse(
        id=workspace.id,
        name=workspace.name or "未命名应用",
        description=workspace.description or "",
        files=files,
        updated_at=updated_at.isoformat() if updated_at else None,
    )
    await db.commit()
    return payload