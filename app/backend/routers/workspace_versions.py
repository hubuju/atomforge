import json
import logging
from typing import List, Optional

from datetime import datetime, date

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.workspace_versions import Workspace_versionsService

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/workspace_versions", tags=["workspace_versions"])


# ---------- Pydantic Schemas ----------
class Workspace_versionsData(BaseModel):
    """Entity data schema (for create/update)"""
    workspace_id: int
    account_id: int
    version_no: int
    files_json: str
    summary: str = None
    note: str = None
    audit_json: str = None


class Workspace_versionsUpdateData(BaseModel):
    """Update entity data (partial updates allowed)"""
    workspace_id: Optional[int] = None
    account_id: Optional[int] = None
    version_no: Optional[int] = None
    files_json: Optional[str] = None
    summary: Optional[str] = None
    note: Optional[str] = None
    audit_json: Optional[str] = None


class Workspace_versionsResponse(BaseModel):
    """Entity response schema"""
    id: int
    workspace_id: int
    account_id: int
    version_no: int
    files_json: str
    summary: Optional[str] = None
    note: Optional[str] = None
    audit_json: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class Workspace_versionsListResponse(BaseModel):
    """List response schema"""
    items: List[Workspace_versionsResponse]
    total: int
    skip: int
    limit: int


class Workspace_versionsBatchCreateRequest(BaseModel):
    """Batch create request"""
    items: List[Workspace_versionsData]


class Workspace_versionsBatchUpdateItem(BaseModel):
    """Batch update item"""
    id: int
    updates: Workspace_versionsUpdateData


class Workspace_versionsBatchUpdateRequest(BaseModel):
    """Batch update request"""
    items: List[Workspace_versionsBatchUpdateItem]


class Workspace_versionsBatchDeleteRequest(BaseModel):
    """Batch delete request"""
    ids: List[int]


# ---------- Routes ----------
@router.get("", response_model=Workspace_versionsListResponse)
async def query_workspace_versionss(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Query workspace_versionss with filtering, sorting, and pagination"""
    logger.debug(f"Querying workspace_versionss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")
    
    service = Workspace_versionsService(db)
    try:
        # Parse query JSON if provided
        query_dict = None
        if query:
            try:
                query_dict = json.loads(query)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid query JSON format")
        
        result = await service.get_list(
            skip=skip, 
            limit=limit,
            query_dict=query_dict,
            sort=sort,
        )
        logger.debug(f"Found {result['total']} workspace_versionss")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid workspace_versions query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying workspace_versionss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/all", response_model=Workspace_versionsListResponse)
async def query_workspace_versionss_all(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    # Query workspace_versionss with filtering, sorting, and pagination without user limitation
    logger.debug(f"Querying workspace_versionss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")

    service = Workspace_versionsService(db)
    try:
        # Parse query JSON if provided
        query_dict = None
        if query:
            try:
                query_dict = json.loads(query)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid query JSON format")

        result = await service.get_list(
            skip=skip,
            limit=limit,
            query_dict=query_dict,
            sort=sort
        )
        logger.debug(f"Found {result['total']} workspace_versionss")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid workspace_versions query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying workspace_versionss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{id}", response_model=Workspace_versionsResponse)
async def get_workspace_versions(
    id: int,
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Get a single workspace_versions by ID"""
    logger.debug(f"Fetching workspace_versions with id: {id}, fields={fields}")
    
    service = Workspace_versionsService(db)
    try:
        result = await service.get_by_id(id)
        if not result:
            logger.warning(f"Workspace_versions with id {id} not found")
            raise HTTPException(status_code=404, detail="Workspace_versions not found")
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching workspace_versions {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("", response_model=Workspace_versionsResponse, status_code=201)
async def create_workspace_versions(
    data: Workspace_versionsData,
    db: AsyncSession = Depends(get_db),
):
    """Create a new workspace_versions"""
    logger.debug(f"Creating new workspace_versions with data: {data}")
    
    service = Workspace_versionsService(db)
    try:
        result = await service.create(data.model_dump())
        if not result:
            raise HTTPException(status_code=400, detail="Failed to create workspace_versions")
        
        logger.info(f"Workspace_versions created successfully with id: {result.id}")
        return result
    except ValueError as e:
        logger.error(f"Validation error creating workspace_versions: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating workspace_versions: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/batch", response_model=List[Workspace_versionsResponse], status_code=201)
async def create_workspace_versionss_batch(
    request: Workspace_versionsBatchCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Create multiple workspace_versionss in a single request"""
    logger.debug(f"Batch creating {len(request.items)} workspace_versionss")
    
    service = Workspace_versionsService(db)
    results = []
    
    try:
        for item_data in request.items:
            result = await service.create(item_data.model_dump())
            if result:
                results.append(result)
        
        logger.info(f"Batch created {len(results)} workspace_versionss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch create: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch create failed: {str(e)}")


@router.put("/batch", response_model=List[Workspace_versionsResponse])
async def update_workspace_versionss_batch(
    request: Workspace_versionsBatchUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Update multiple workspace_versionss in a single request"""
    logger.debug(f"Batch updating {len(request.items)} workspace_versionss")
    
    service = Workspace_versionsService(db)
    results = []
    
    try:
        for item in request.items:
            # Only include non-None values for partial updates
            update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
            result = await service.update(item.id, update_dict)
            if result:
                results.append(result)
        
        logger.info(f"Batch updated {len(results)} workspace_versionss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch update: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")


@router.put("/{id}", response_model=Workspace_versionsResponse)
async def update_workspace_versions(
    id: int,
    data: Workspace_versionsUpdateData,
    db: AsyncSession = Depends(get_db),
):
    """Update an existing workspace_versions"""
    logger.debug(f"Updating workspace_versions {id} with data: {data}")

    service = Workspace_versionsService(db)
    try:
        # Only include non-None values for partial updates
        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        result = await service.update(id, update_dict)
        if not result:
            logger.warning(f"Workspace_versions with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Workspace_versions not found")
        
        logger.info(f"Workspace_versions {id} updated successfully")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error updating workspace_versions {id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating workspace_versions {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/batch")
async def delete_workspace_versionss_batch(
    request: Workspace_versionsBatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple workspace_versionss by their IDs"""
    logger.debug(f"Batch deleting {len(request.ids)} workspace_versionss")
    
    service = Workspace_versionsService(db)
    deleted_count = 0
    
    try:
        for item_id in request.ids:
            success = await service.delete(item_id)
            if success:
                deleted_count += 1
        
        logger.info(f"Batch deleted {deleted_count} workspace_versionss successfully")
        return {"message": f"Successfully deleted {deleted_count} workspace_versionss", "deleted_count": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch delete: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {str(e)}")


@router.delete("/{id}")
async def delete_workspace_versions(
    id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a single workspace_versions by ID"""
    logger.debug(f"Deleting workspace_versions with id: {id}")
    
    service = Workspace_versionsService(db)
    try:
        success = await service.delete(id)
        if not success:
            logger.warning(f"Workspace_versions with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Workspace_versions not found")
        
        logger.info(f"Workspace_versions {id} deleted successfully")
        return {"message": "Workspace_versions deleted successfully", "id": id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting workspace_versions {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")