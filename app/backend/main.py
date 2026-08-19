import logging
import os
import traceback
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from core.config import settings
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from utils.logging_utils import cleanup_old_log_files

# MODULE_IMPORTS_START
from services.database import initialize_database, close_database
# MODULE_IMPORTS_END


def setup_logging():
    """Configure the logging system."""
    if os.environ.get("IS_LAMBDA") == "true":
        return

    # Create the logs directory
    log_dir = "logs"
    os.makedirs(log_dir, exist_ok=True)

    # Aggregate local app logs by calendar day.
    log_date = datetime.now().strftime("%Y%m%d")
    log_file = os.path.join(log_dir, f"app_{log_date}.log")

    # Configure log format
    log_format = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"

    # Configure the root logger
    logging.basicConfig(
        level=logging.DEBUG,
        format=log_format,
        handlers=[
            # File handler
            logging.FileHandler(log_file, mode="a", encoding="utf-8"),
            # Console handler
            logging.StreamHandler(),
        ],
    )
    cleanup_old_log_files(log_dir, current_log_file=log_file)

    # Set log levels for specific modules
    logging.getLogger("uvicorn").setLevel(logging.DEBUG)
    logging.getLogger("fastapi").setLevel(logging.DEBUG)
    logging.getLogger("watchfiles").setLevel(logging.WARNING)

    # Log configuration details
    logger = logging.getLogger(__name__)
    logger.info("=== Logging system initialized ===")
    logger.info(f"Log file: {log_file}")
    logger.info("Log level: DEBUG")
    logger.info(f"Log date: {log_date}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger = logging.getLogger(__name__)
    logger.info("=== Application startup initiated ===")

    # MODULE_STARTUP_START
    await initialize_database()
    # MODULE_STARTUP_END

    logger.info("=== Application startup completed successfully ===")
    yield
    # MODULE_SHUTDOWN_START
    await close_database()
    # MODULE_SHUTDOWN_END


app = FastAPI(
    title="FastAPI Modular Template",
    description="A best-practice FastAPI template with modular architecture",
    version="1.0.0",
    lifespan=lifespan,
)


# MODULE_MIDDLEWARE_START
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)
# MODULE_MIDDLEWARE_END


# Setup logging before the routers are imported.
setup_logging()

# Routers are registered explicitly — never by package auto-discovery.
#
# The backend started from the "FastAPI Modular Template", whose router
# auto-discovery scans the whole `routers` package and registers EVERY module
# found there. That mechanism silently exposed the template's entity CRUD
# routes (/api/v1/entities/accounts, workspaces, workspace_messages, ...),
# which have no authentication and whose response models include
# `password_hash` and `session_token`. Only the three product routers below
# belong to this application; keeping the list explicit prevents template
# leftovers from going live again.
from routers import aihub, hub, share

app.include_router(hub.router)
app.include_router(share.router)
app.include_router(aihub.router)


# Add exception handler for all exceptions except HTTPException
@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Handle all exceptions except HTTPException

    - Dev environment: Return full stack trace and exception details
    - Prod environment: Return only "Internal server error"
    """
    # Re-raise HTTPException to let FastAPI handle it normally
    if isinstance(exc, HTTPException):
        raise exc

    logger = logging.getLogger(__name__)
    error_message = str(exc)
    error_type = type(exc).__name__

    # Log full error details regardless of environment
    logger.error(f"Exception: {error_type}: {error_message}\n{traceback.format_exc()}")

    # Determine if we're in dev environment
    is_dev = os.getenv("ENVIRONMENT", "prod").lower() == "dev"

    if is_dev:
        # Dev environment: return full stack trace and exception details
        error_detail = f"{error_type}: {error_message}\n{traceback.format_exc()}"
        return JSONResponse(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, content={"detail": error_detail})
    else:
        # Prod environment: return only generic error message
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, content={"detail": "Internal Server Error"}
        )


@app.get("/")
def root():
    # When a built frontend exists, the product UI is the app — not the
    # template welcome message. `_frontend_root` is assigned later at module
    # level; it is resolved at request time, after the module has loaded.
    if _frontend_root.is_dir() and (_frontend_root / "index.html").is_file():
        from fastapi.responses import FileResponse

        return FileResponse(_frontend_root / "index.html")
    return {"message": "FastAPI Modular Template is running"}


@app.get("/health")
def health_check():
    return {"status": "healthy"}


# Serve the built frontend (single-process deployment).
# Registered *after* every API route (root/health included) so the catch-all
# never shadows them. Path traversal is blocked: a request path is only served
# when it resolves inside the dist directory.
FRONTEND_DIST = os.environ.get("FRONTEND_DIST", "../frontend/dist")
_frontend_root = Path(os.path.abspath(FRONTEND_DIST))

if _frontend_root.is_dir():
    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles

    _assets_dir = _frontend_root / "assets"
    if _assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(_assets_dir)), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_frontend(full_path: str):
        """SPA fallback: real files are served as-is, anything else gets index.html."""
        if full_path:
            # API paths must never fall back to the SPA shell. An unmatched
            # /api/* request is a client error (or a removed legacy route),
            # and answering it with the HTML shell would mask 404s in security
            # checks that only look at the status code.
            if full_path == "api" or full_path.startswith("api/"):
                return JSONResponse(status_code=404, content={"detail": "Not Found"})
            candidate = (_frontend_root / full_path).resolve()
            if candidate.is_file() and candidate.is_relative_to(_frontend_root):
                return FileResponse(candidate)
        return FileResponse(_frontend_root / "index.html")


def run_in_debug_mode(app: FastAPI):
    """Run the FastAPI app in debug mode with proper asyncio handling.

    This function handles the special case of running in a debugger (PyCharm, VS Code, etc.)
    where asyncio is patched, causing conflicts with uvicorn's asyncio_run.

    It loads environment variables from ../.env and uses asyncio.run() directly
    to avoid uvicorn's asyncio_run conflicts.

    Args:
        app: The FastAPI application instance
    """
    import asyncio
    from pathlib import Path

    import uvicorn
    from dotenv import load_dotenv

    # Load environment variables from ../.env in debug mode
    # If `LOCAL_DEBUG=true` is set, then MetaGPT's `ProjectBuilder.build()` will generate the `.env` file
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        load_dotenv(env_path, override=True)
        logger = logging.getLogger(__name__)
        logger.info(f"Loaded environment variables from {env_path}")

    # In debug mode, use asyncio.run() directly to avoid uvicorn's asyncio_run conflicts
    config = uvicorn.Config(
        app,
        host="0.0.0.0",
        port=int(settings.port),
        log_level="info",
    )
    server = uvicorn.Server(config)
    asyncio.run(server.serve())


if __name__ == "__main__":
    import sys

    import uvicorn

    # Detect if running in debugger (PyCharm, VS Code, etc.)
    # Debuggers patch asyncio which conflicts with uvicorn's asyncio_run
    is_debugging = "pydevd" in sys.modules or (hasattr(sys, "gettrace") and sys.gettrace() is not None)

    if is_debugging:
        run_in_debug_mode(app)
    else:
        # Enable reload in normal mode
        uvicorn.run(
            app,
            host="0.0.0.0",
            port=int(settings.port),
            reload_excludes=["**/*.py"],
        )
