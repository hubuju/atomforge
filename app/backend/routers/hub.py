"""Simple name + password accounts and multi-file workspace storage.

The product owner explicitly asked for a minimal in-app account system (a
display name plus two password fields), so this router owns its own credential
and session handling rather than delegating to a hosted identity page. Sessions
are opaque tokens persisted on the account row; every data route resolves the
caller from that token, so no request can read another account's workspaces.

Generated apps are stored as a real multi-file project (index.html + styles.css
+ app.js ...) serialized into ``files_json``.
"""
import hashlib
import json
import logging
import secrets
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.accounts import AccountsService
from services.user_templates import User_templatesService
from services.workspace_messages import Workspace_messagesService
from services.workspace_versions import Workspace_versionsService
from services.workspaces import WorkspacesService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/hub", tags=["hub"])

PBKDF2_ROUNDS = 120000
SLUG_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"
MAX_FILES = 50
MAX_TEMPLATES = 30
DEFAULT_VERSION_KEEP = 20


# --------------------------------------------------------------- credentials


def hash_password(password: str, salt: Optional[str] = None) -> str:
    """Salted PBKDF2-SHA256 hash, stored as a single self-describing string."""
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), PBKDF2_ROUNDS
    )
    return f"pbkdf2${PBKDF2_ROUNDS}${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """Constant-time comparison against a stored PBKDF2 hash."""
    try:
        scheme, rounds, salt, digest = (stored or "").split("$")
    except (ValueError, AttributeError):
        return False
    if scheme != "pbkdf2":
        return False
    try:
        candidate = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt.encode("utf-8"), int(rounds)
        )
    except ValueError:
        return False
    return secrets.compare_digest(candidate.hex(), digest)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def new_slug(length: int = 8) -> str:
    return "".join(secrets.choice(SLUG_ALPHABET) for _ in range(length))


# ------------------------------------------------------------------- schemas


class ProjectFile(BaseModel):
    """One source file of a generated project."""

    path: str
    content: str = ""


class AccountInfo(BaseModel):
    id: int
    name: str


class AuthRequest(BaseModel):
    name: str
    password: str


class TokenRequest(BaseModel):
    token: str


class AuthResponse(BaseModel):
    token: str
    account: AccountInfo


class WorkspaceInfo(BaseModel):
    id: int
    name: str
    description: str = ""
    files: List[ProjectFile] = []
    is_published: bool = False
    share_slug: str = ""
    version_count: int = 0
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class WorkspaceListResponse(BaseModel):
    items: List[WorkspaceInfo] = []


class WorkspaceIdRequest(TokenRequest):
    id: int


class WorkspaceCreateRequest(TokenRequest):
    name: str
    description: str = ""
    files: List[ProjectFile] = []


class WorkspaceUpdateRequest(TokenRequest):
    id: int
    name: Optional[str] = None
    description: Optional[str] = None
    files: Optional[List[ProjectFile]] = None
    version_count: Optional[int] = None


class PublishResponse(BaseModel):
    share_slug: str


class MessageInfo(BaseModel):
    id: int
    workspace_id: int
    role: str
    content: str
    kind: str = "text"
    created_at: Optional[str] = None


class MessageListResponse(BaseModel):
    items: List[MessageInfo] = []


class MessageCreateRequest(TokenRequest):
    workspace_id: int
    role: str
    content: str
    kind: str = "text"


class VersionInfo(BaseModel):
    id: int
    workspace_id: int
    version_no: int
    files: List[ProjectFile] = []
    summary: str = ""
    note: str = ""
    audit: str = ""
    created_at: Optional[str] = None


class VersionListResponse(BaseModel):
    items: List[VersionInfo] = []


class VersionCreateRequest(TokenRequest):
    workspace_id: int
    version_no: int
    files: List[ProjectFile] = []
    summary: str = ""
    note: str = ""
    audit: str = ""
    keep_limit: int = DEFAULT_VERSION_KEEP


class VersionNoteRequest(TokenRequest):
    id: int
    note: str = ""


class TemplateInfo(BaseModel):
    id: int
    name: str
    description: str = ""
    keywords: str = ""
    files: List[ProjectFile] = []
    source_workspace_id: int = 0
    use_count: int = 0
    created_at: Optional[str] = None


class TemplateListResponse(BaseModel):
    items: List[TemplateInfo] = []


class TemplateSaveRequest(TokenRequest):
    name: str
    description: str = ""
    keywords: str = ""
    files: List[ProjectFile] = []
    source_workspace_id: int = 0


class TemplateIdRequest(TokenRequest):
    id: int


class OkResponse(BaseModel):
    ok: bool = True


# ------------------------------------------------------------------- helpers


def iso(value: Any) -> Optional[str]:
    return value.isoformat() if value else None


def dump_files(files: Optional[List[ProjectFile]]) -> str:
    """Serialize a file list, dropping empty paths and capping the count."""
    cleaned: List[Dict[str, str]] = []
    for item in files or []:
        path = (item.path or "").strip().lstrip("/")
        if not path:
            continue
        cleaned.append({"path": path, "content": item.content or ""})
        if len(cleaned) >= MAX_FILES:
            break
    return json.dumps(cleaned, ensure_ascii=False)


def load_files(raw: Any) -> List[ProjectFile]:
    """Tolerant reader: bad or legacy payloads degrade to an empty file list."""
    if not raw:
        return []
    if isinstance(raw, list):
        parsed = raw
    else:
        try:
            parsed = json.loads(raw)
        except (TypeError, ValueError):
            return []
    if not isinstance(parsed, list):
        return []
    files: List[ProjectFile] = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        path = str(item.get("path") or "").strip().lstrip("/")
        if not path:
            continue
        files.append(ProjectFile(path=path, content=str(item.get("content") or "")))
    return files


def to_workspace_info(row: Any) -> WorkspaceInfo:
    return WorkspaceInfo(
        id=row.id,
        name=row.name or "未命名应用",
        description=row.description or "",
        files=load_files(getattr(row, "files_json", None)),
        is_published=bool(getattr(row, "is_published", False)),
        share_slug=getattr(row, "share_slug", None) or "",
        version_count=int(getattr(row, "version_count", 0) or 0),
        created_at=iso(getattr(row, "created_at", None)),
        updated_at=iso(getattr(row, "updated_at", None)),
    )


async def resolve_account(db: AsyncSession, token: str) -> Any:
    """Map an opaque session token back to its account row."""
    token = (token or "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="请先登录")
    try:
        account = await AccountsService(db).get_by_field("session_token", token)
    except Exception as exc:  # pragma: no cover - defensive
        logger.error("Session lookup failed: %s", exc)
        raise HTTPException(status_code=500, detail="读取登录状态失败") from exc
    if account is None:
        raise HTTPException(status_code=401, detail="登录状态已失效，请重新登录")
    return account


async def owned_workspace(db: AsyncSession, account_id: int, workspace_id: int) -> Any:
    """Fetch a workspace and reject cross-account access."""
    row = await WorkspacesService(db).get_by_id(int(workspace_id))
    if row is None or int(getattr(row, "account_id", 0) or 0) != int(account_id):
        raise HTTPException(status_code=404, detail="项目不存在")
    return row


def to_template_info(row: Any) -> TemplateInfo:
    return TemplateInfo(
        id=row.id,
        name=row.name or "未命名模板",
        description=getattr(row, "description", None) or "",
        keywords=getattr(row, "keywords", None) or "",
        files=load_files(getattr(row, "files_json", None)),
        source_workspace_id=int(getattr(row, "source_workspace_id", 0) or 0),
        use_count=int(getattr(row, "use_count", 0) or 0),
        created_at=iso(getattr(row, "created_at", None)),
    )


async def prune_versions(db: AsyncSession, workspace_id: int, keep: int) -> None:
    """Trim a workspace's history to the newest ``keep`` snapshots.

    Snapshots carrying a human-written note are pinned: a user who bothered to
    label a version clearly wants to keep it, so retention never evicts those
    even when they fall outside the window.
    """
    limit = max(3, min(int(keep or DEFAULT_VERSION_KEEP), 100))
    service = Workspace_versionsService(db)
    rows = await service.list_by_field("workspace_id", int(workspace_id), 0, 500)
    if len(rows) <= limit:
        return
    ordered = sorted(rows, key=lambda row: int(getattr(row, "version_no", 0) or 0), reverse=True)
    for row in ordered[limit:]:
        if (getattr(row, "note", None) or "").strip():
            continue
        await service.delete(row.id)


# ---------------------------------------------------------------------- auth


@router.post("/register", response_model=AuthResponse)
async def register(data: AuthRequest, db: AsyncSession = Depends(get_db)) -> AuthResponse:
    """Create an account from a display name plus password."""
    name = (data.name or "").strip()
    password = data.password or ""
    if len(name) < 2 or len(name) > 24:
        raise HTTPException(status_code=400, detail="名称需为 2-24 个字符")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="密码至少 6 位")

    service = AccountsService(db)
    existing = await service.get_by_field("name", name)
    if existing is not None:
        raise HTTPException(status_code=409, detail="该名称已被注册，换一个试试")

    token = new_token()
    account = await service.create(
        {"name": name, "password_hash": hash_password(password), "session_token": token}
    )
    if account is None:
        raise HTTPException(status_code=500, detail="注册失败，请重试")

    payload = AuthResponse(token=token, account=AccountInfo(id=account.id, name=name))
    await db.commit()
    return payload


@router.post("/login", response_model=AuthResponse)
async def login(data: AuthRequest, db: AsyncSession = Depends(get_db)) -> AuthResponse:
    """Verify credentials and rotate the session token."""
    name = (data.name or "").strip()
    if not name or not (data.password or ""):
        raise HTTPException(status_code=400, detail="请输入名称和密码")

    service = AccountsService(db)
    account = await service.get_by_field("name", name)
    if account is None or not verify_password(data.password, account.password_hash or ""):
        raise HTTPException(status_code=401, detail="名称或密码不正确")

    token = new_token()
    await service.update(account.id, {"session_token": token})
    payload = AuthResponse(token=token, account=AccountInfo(id=account.id, name=account.name))
    await db.commit()
    return payload


@router.post("/me", response_model=AccountInfo)
async def me(data: TokenRequest, db: AsyncSession = Depends(get_db)) -> AccountInfo:
    """Resolve the current account from a stored token."""
    account = await resolve_account(db, data.token)
    payload = AccountInfo(id=account.id, name=account.name)
    await db.commit()
    return payload


@router.post("/guest", response_model=AuthResponse)
async def guest_entry(db: AsyncSession = Depends(get_db)) -> AuthResponse:
    """Anonymous one-tap entry: mint a throwaway account.

    Visitors can try the whole product without typing anything. The account
    lives in the same table as regular ones, so every feature (generation,
    versions, publishing) works; the token stays in localStorage and the data
    persists server-side. The random password is discarded — only the opaque
    session token can open this account again.
    """
    service = AccountsService(db)
    name = ""
    for _ in range(8):
        candidate = f"游客{secrets.randbelow(9000) + 1000}"
        if await service.get_by_field("name", candidate) is None:
            name = candidate
            break
    if not name:
        raise HTTPException(status_code=500, detail="游客账号创建失败，请重试")

    token = new_token()
    account = await service.create(
        {
            "name": name,
            "password_hash": hash_password(secrets.token_urlsafe(16)),
            "session_token": token,
        }
    )
    if account is None:
        raise HTTPException(status_code=500, detail="游客账号创建失败，请重试")

    payload = AuthResponse(token=token, account=AccountInfo(id=account.id, name=name))
    await db.commit()
    return payload


@router.post("/logout", response_model=OkResponse)
async def logout(data: TokenRequest, db: AsyncSession = Depends(get_db)) -> OkResponse:
    """Invalidate the current session token."""
    token = (data.token or "").strip()
    if token:
        service = AccountsService(db)
        account = await service.get_by_field("session_token", token)
        if account is not None:
            await service.update(account.id, {"session_token": ""})
    await db.commit()
    return OkResponse()


# ---------------------------------------------------------------- workspaces


@router.post("/workspaces/list", response_model=WorkspaceListResponse)
async def list_workspaces(
    data: TokenRequest, db: AsyncSession = Depends(get_db)
) -> WorkspaceListResponse:
    """All workspaces of the current account, newest activity first."""
    account = await resolve_account(db, data.token)
    rows = await WorkspacesService(db).list_by_field("account_id", account.id, 0, 200)
    items = [to_workspace_info(row) for row in rows]
    items.sort(key=lambda item: item.updated_at or "", reverse=True)
    await db.commit()
    return WorkspaceListResponse(items=items)


@router.post("/workspaces/get", response_model=WorkspaceInfo)
async def get_workspace(
    data: WorkspaceIdRequest, db: AsyncSession = Depends(get_db)
) -> WorkspaceInfo:
    account = await resolve_account(db, data.token)
    row = await owned_workspace(db, account.id, data.id)
    payload = to_workspace_info(row)
    await db.commit()
    return payload


@router.post("/workspaces/create", response_model=WorkspaceInfo)
async def create_workspace(
    data: WorkspaceCreateRequest, db: AsyncSession = Depends(get_db)
) -> WorkspaceInfo:
    account = await resolve_account(db, data.token)
    name = (data.name or "").strip() or "未命名应用"
    row = await WorkspacesService(db).create(
        {
            "account_id": account.id,
            "name": name,
            "description": (data.description or "").strip(),
            "files_json": dump_files(data.files),
            "is_published": False,
            "share_slug": "",
            "version_count": 0,
        }
    )
    if row is None:
        raise HTTPException(status_code=500, detail="创建项目失败")
    payload = to_workspace_info(row)
    await db.commit()
    return payload


@router.post("/workspaces/update", response_model=WorkspaceInfo)
async def update_workspace(
    data: WorkspaceUpdateRequest, db: AsyncSession = Depends(get_db)
) -> WorkspaceInfo:
    account = await resolve_account(db, data.token)
    await owned_workspace(db, account.id, data.id)

    patch: Dict[str, Any] = {}
    if data.name is not None:
        cleaned = data.name.strip()
        if not cleaned:
            raise HTTPException(status_code=400, detail="项目名称不能为空")
        patch["name"] = cleaned
    if data.description is not None:
        patch["description"] = data.description.strip()
    if data.files is not None:
        patch["files_json"] = dump_files(data.files)
    if data.version_count is not None:
        patch["version_count"] = int(data.version_count)

    service = WorkspacesService(db)
    row = await service.update(data.id, patch) if patch else await service.get_by_id(data.id)
    if row is None:
        raise HTTPException(status_code=404, detail="项目不存在")
    payload = to_workspace_info(row)
    await db.commit()
    return payload


@router.post("/workspaces/delete", response_model=OkResponse)
async def delete_workspace(
    data: WorkspaceIdRequest, db: AsyncSession = Depends(get_db)
) -> OkResponse:
    account = await resolve_account(db, data.token)
    await owned_workspace(db, account.id, data.id)

    message_service = Workspace_messagesService(db)
    for row in await message_service.list_by_field("workspace_id", data.id, 0, 500):
        await message_service.delete(row.id)

    version_service = Workspace_versionsService(db)
    for row in await version_service.list_by_field("workspace_id", data.id, 0, 500):
        await version_service.delete(row.id)

    await WorkspacesService(db).delete(data.id)
    await db.commit()
    return OkResponse()


@router.post("/workspaces/publish", response_model=PublishResponse)
async def publish_workspace(
    data: WorkspaceIdRequest, db: AsyncSession = Depends(get_db)
) -> PublishResponse:
    """Assign a unique public slug and mark the workspace published."""
    account = await resolve_account(db, data.token)
    row = await owned_workspace(db, account.id, data.id)
    if not load_files(getattr(row, "files_json", None)):
        raise HTTPException(status_code=400, detail="项目还没有任何文件，无法发布")

    service = WorkspacesService(db)
    slug = getattr(row, "share_slug", None) or ""
    if not slug:
        for _ in range(6):
            candidate = new_slug()
            if await service.get_by_field("share_slug", candidate) is None:
                slug = candidate
                break
        if not slug:
            raise HTTPException(status_code=500, detail="生成分享链接失败，请重试")

    await service.update(data.id, {"is_published": True, "share_slug": slug})
    await db.commit()
    return PublishResponse(share_slug=slug)


# ------------------------------------------------------------------ messages


@router.post("/messages/list", response_model=MessageListResponse)
async def list_messages(
    data: WorkspaceIdRequest, db: AsyncSession = Depends(get_db)
) -> MessageListResponse:
    account = await resolve_account(db, data.token)
    await owned_workspace(db, account.id, data.id)
    rows = await Workspace_messagesService(db).list_by_field("workspace_id", data.id, 0, 400)
    items = [
        MessageInfo(
            id=row.id,
            workspace_id=row.workspace_id,
            role=row.role or "user",
            content=row.content or "",
            kind=getattr(row, "kind", None) or "text",
            created_at=iso(getattr(row, "created_at", None)),
        )
        for row in rows
    ]
    items.sort(key=lambda item: (item.created_at or "", item.id))
    await db.commit()
    return MessageListResponse(items=items)


@router.post("/messages/create", response_model=MessageInfo)
async def create_message(
    data: MessageCreateRequest, db: AsyncSession = Depends(get_db)
) -> MessageInfo:
    account = await resolve_account(db, data.token)
    await owned_workspace(db, account.id, data.workspace_id)
    row = await Workspace_messagesService(db).create(
        {
            "workspace_id": data.workspace_id,
            "account_id": account.id,
            "role": "assistant" if data.role == "assistant" else "user",
            "content": data.content or "",
            "kind": data.kind or "text",
        }
    )
    if row is None:
        raise HTTPException(status_code=500, detail="写入对话记录失败")
    payload = MessageInfo(
        id=row.id,
        workspace_id=row.workspace_id,
        role=row.role,
        content=row.content or "",
        kind=getattr(row, "kind", None) or "text",
        created_at=iso(getattr(row, "created_at", None)),
    )
    await db.commit()
    return payload


# ------------------------------------------------------------------ versions


@router.post("/versions/list", response_model=VersionListResponse)
async def list_versions(
    data: WorkspaceIdRequest, db: AsyncSession = Depends(get_db)
) -> VersionListResponse:
    account = await resolve_account(db, data.token)
    await owned_workspace(db, account.id, data.id)
    rows = await Workspace_versionsService(db).list_by_field("workspace_id", data.id, 0, 200)
    items = [
        VersionInfo(
            id=row.id,
            workspace_id=row.workspace_id,
            version_no=int(row.version_no or 0),
            files=load_files(getattr(row, "files_json", None)),
            summary=getattr(row, "summary", None) or "",
            note=getattr(row, "note", None) or "",
            audit=getattr(row, "audit_json", None) or "",
            created_at=iso(getattr(row, "created_at", None)),
        )
        for row in rows
    ]
    items.sort(key=lambda item: item.version_no, reverse=True)
    await db.commit()
    return VersionListResponse(items=items)


@router.post("/versions/create", response_model=VersionInfo)
async def create_version(
    data: VersionCreateRequest, db: AsyncSession = Depends(get_db)
) -> VersionInfo:
    account = await resolve_account(db, data.token)
    await owned_workspace(db, account.id, data.workspace_id)
    row = await Workspace_versionsService(db).create(
        {
            "workspace_id": data.workspace_id,
            "account_id": account.id,
            "version_no": int(data.version_no or 1),
            "files_json": dump_files(data.files),
            "summary": data.summary or "",
            "note": (data.note or "").strip()[:200],
            "audit_json": data.audit or "",
        }
    )
    if row is None:
        raise HTTPException(status_code=500, detail="保存版本快照失败")
    payload = VersionInfo(
        id=row.id,
        workspace_id=row.workspace_id,
        version_no=int(row.version_no or 1),
        files=load_files(getattr(row, "files_json", None)),
        summary=getattr(row, "summary", None) or "",
        note=getattr(row, "note", None) or "",
        audit=getattr(row, "audit_json", None) or "",
        created_at=iso(getattr(row, "created_at", None)),
    )
    await prune_versions(db, data.workspace_id, data.keep_limit)
    await db.commit()
    return payload


@router.post("/versions/note", response_model=VersionInfo)
async def update_version_note(
    data: VersionNoteRequest, db: AsyncSession = Depends(get_db)
) -> VersionInfo:
    """Let the owner attach or edit a human-written label on a snapshot."""
    account = await resolve_account(db, data.token)
    service = Workspace_versionsService(db)
    row = await service.get_by_id(int(data.id))
    if row is None or int(getattr(row, "account_id", 0) or 0) != int(account.id):
        raise HTTPException(status_code=404, detail="版本不存在")

    updated = await service.update(int(data.id), {"note": (data.note or "").strip()[:200]})
    if updated is None:
        raise HTTPException(status_code=500, detail="备注保存失败")
    payload = VersionInfo(
        id=updated.id,
        workspace_id=updated.workspace_id,
        version_no=int(updated.version_no or 1),
        files=load_files(getattr(updated, "files_json", None)),
        summary=getattr(updated, "summary", None) or "",
        note=getattr(updated, "note", None) or "",
        audit=getattr(updated, "audit_json", None) or "",
        created_at=iso(getattr(updated, "created_at", None)),
    )
    await db.commit()
    return payload


# ----------------------------------------------------------- personal templates


@router.post("/templates/list", response_model=TemplateListResponse)
async def list_templates(
    data: TokenRequest, db: AsyncSession = Depends(get_db)
) -> TemplateListResponse:
    """Personal templates of the current account, most used first."""
    account = await resolve_account(db, data.token)
    rows = await User_templatesService(db).list_by_field("account_id", account.id, 0, 200)
    items = [to_template_info(row) for row in rows]
    items.sort(key=lambda item: (item.use_count, item.created_at or ""), reverse=True)
    await db.commit()
    return TemplateListResponse(items=items)


@router.post("/templates/save", response_model=TemplateInfo)
async def save_template(
    data: TemplateSaveRequest, db: AsyncSession = Depends(get_db)
) -> TemplateInfo:
    """Store the current project files as a reusable personal template."""
    account = await resolve_account(db, data.token)
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="请给模板起个名字")
    files = dump_files(data.files)
    if files == "[]":
        raise HTTPException(status_code=400, detail="项目还没有任何文件，无法存为模板")

    service = User_templatesService(db)
    existing = await service.list_by_field("account_id", account.id, 0, 200)
    if len(existing) >= MAX_TEMPLATES:
        raise HTTPException(
            status_code=400, detail=f"个人模板最多 {MAX_TEMPLATES} 个，请先删除一些"
        )

    row = await service.create(
        {
            "account_id": account.id,
            "name": name[:60],
            "description": (data.description or "").strip()[:200],
            "keywords": (data.keywords or "").strip()[:200],
            "files_json": files,
            "source_workspace_id": int(data.source_workspace_id or 0),
            "use_count": 0,
        }
    )
    if row is None:
        raise HTTPException(status_code=500, detail="保存模板失败")
    payload = to_template_info(row)
    await db.commit()
    return payload


@router.post("/templates/use", response_model=TemplateInfo)
async def use_template(
    data: TemplateIdRequest, db: AsyncSession = Depends(get_db)
) -> TemplateInfo:
    """Return a template's files and record that it was used."""
    account = await resolve_account(db, data.token)
    service = User_templatesService(db)
    row = await service.get_by_id(int(data.id))
    if row is None or int(getattr(row, "account_id", 0) or 0) != int(account.id):
        raise HTTPException(status_code=404, detail="模板不存在")

    updated = await service.update(
        int(data.id), {"use_count": int(getattr(row, "use_count", 0) or 0) + 1}
    )
    payload = to_template_info(updated or row)
    await db.commit()
    return payload


@router.post("/templates/delete", response_model=OkResponse)
async def delete_template(
    data: TemplateIdRequest, db: AsyncSession = Depends(get_db)
) -> OkResponse:
    account = await resolve_account(db, data.token)
    service = User_templatesService(db)
    row = await service.get_by_id(int(data.id))
    if row is None or int(getattr(row, "account_id", 0) or 0) != int(account.id):
        raise HTTPException(status_code=404, detail="模板不存在")
    await service.delete(int(data.id))
    await db.commit()
    return OkResponse()