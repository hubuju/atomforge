import json
import logging
from typing import List, Optional

from datetime import datetime, date

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.workspace_messages import Workspace_messagesService

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/workspace_messages", tags=["workspace_messages"])


# ---------- Pydantic Schemas ----------
class Workspace_messagesData(BaseModel):
    """Entity data schema (for create/update)"""
    workspace_id: int
    account_id: int
    role: str
    content: str
    kind: str = None


class Workspace_messagesUpdateData(BaseModel):
    """Update entity data (partial updates allowed)"""
    workspace_id: Optional[int] = None
    account_id: Optional[int] = None
    role: Optional[str] = None
    content: Optional[str] = None
    kind: Optional[str] = None


class Workspace_messagesResponse(BaseModel):
    """Entity response schema"""
    id: int
    workspace_id: int
    account_id: int
    role: str
    content: str
    kind: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class Workspace_messagesListResponse(BaseModel):
    """List response schema"""
    items: List[Workspace_messagesResponse]
    total: int
    skip: int
    limit: int


class Workspace_messagesBatchCreateRequest(BaseModel):
    """Batch create request"""
    items: List[Workspace_messagesData]


class Workspace_messagesBatchUpdateItem(BaseModel):
    """Batch update item"""
    id: int
    updates: Workspace_messagesUpdateData


class Workspace_messagesBatchUpdateRequest(BaseModel):
    """Batch update request"""
    items: List[Workspace_messagesBatchUpdateItem]


class Workspace_messagesBatchDeleteRequest(BaseModel):
    """Batch delete request"""
    ids: List[int]


# ---------- Routes ----------
@router.get("", response_model=Workspace_messagesListResponse)
async def query_workspace_messagess(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Query workspace_messagess with filtering, sorting, and pagination"""
    logger.debug(f"Querying workspace_messagess: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")
    
    service = Workspace_messagesService(db)
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
        logger.debug(f"Found {result['total']} workspace_messagess")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid workspace_messages query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying workspace_messagess: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/all", response_model=Workspace_messagesListResponse)
async def query_workspace_messagess_all(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    # Query workspace_messagess with filtering, sorting, and pagination without user limitation
    logger.debug(f"Querying workspace_messagess: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")

    service = Workspace_messagesService(db)
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
        logger.debug(f"Found {result['total']} workspace_messagess")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid workspace_messages query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying workspace_messagess: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{id}", response_model=Workspace_messagesResponse)
async def get_workspace_messages(
    id: int,
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Get a single workspace_messages by ID"""
    logger.debug(f"Fetching workspace_messages with id: {id}, fields={fields}")
    
    service = Workspace_messagesService(db)
    try:
        result = await service.get_by_id(id)
        if not result:
            logger.warning(f"Workspace_messages with id {id} not found")
            raise HTTPException(status_code=404, detail="Workspace_messages not found")
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching workspace_messages {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("", response_model=Workspace_messagesResponse, status_code=201)
async def create_workspace_messages(
    data: Workspace_messagesData,
    db: AsyncSession = Depends(get_db),
):
    """Create a new workspace_messages"""
    logger.debug(f"Creating new workspace_messages with data: {data}")
    
    service = Workspace_messagesService(db)
    try:
        result = await service.create(data.model_dump())
        if not result:
            raise HTTPException(status_code=400, detail="Failed to create workspace_messages")
        
        logger.info(f"Workspace_messages created successfully with id: {result.id}")
        return result
    except ValueError as e:
        logger.error(f"Validation error creating workspace_messages: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating workspace_messages: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/batch", response_model=List[Workspace_messagesResponse], status_code=201)
async def create_workspace_messagess_batch(
    request: Workspace_messagesBatchCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Create multiple workspace_messagess in a single request"""
    logger.debug(f"Batch creating {len(request.items)} workspace_messagess")
    
    service = Workspace_messagesService(db)
    results = []
    
    try:
        for item_data in request.items:
            result = await service.create(item_data.model_dump())
            if result:
                results.append(result)
        
        logger.info(f"Batch created {len(results)} workspace_messagess successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch create: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch create failed: {str(e)}")


@router.put("/batch", response_model=List[Workspace_messagesResponse])
async def update_workspace_messagess_batch(
    request: Workspace_messagesBatchUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Update multiple workspace_messagess in a single request"""
    logger.debug(f"Batch updating {len(request.items)} workspace_messagess")
    
    service = Workspace_messagesService(db)
    results = []
    
    try:
        for item in request.items:
            # Only include non-None values for partial updates
            update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
            result = await service.update(item.id, update_dict)
            if result:
                results.append(result)
        
        logger.info(f"Batch updated {len(results)} workspace_messagess successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch update: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")


@router.put("/{id}", response_model=Workspace_messagesResponse)
async def update_workspace_messages(
    id: int,
    data: Workspace_messagesUpdateData,
    db: AsyncSession = Depends(get_db),
):
    """Update an existing workspace_messages"""
    logger.debug(f"Updating workspace_messages {id} with data: {data}")

    service = Workspace_messagesService(db)
    try:
        # Only include non-None values for partial updates
        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        result = await service.update(id, update_dict)
        if not result:
            logger.warning(f"Workspace_messages with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Workspace_messages not found")
        
        logger.info(f"Workspace_messages {id} updated successfully")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error updating workspace_messages {id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating workspace_messages {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/batch")
async def delete_workspace_messagess_batch(
    request: Workspace_messagesBatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple workspace_messagess by their IDs"""
    logger.debug(f"Batch deleting {len(request.ids)} workspace_messagess")
    
    service = Workspace_messagesService(db)
    deleted_count = 0
    
    try:
        for item_id in request.ids:
            success = await service.delete(item_id)
            if success:
                deleted_count += 1
        
        logger.info(f"Batch deleted {deleted_count} workspace_messagess successfully")
        return {"message": f"Successfully deleted {deleted_count} workspace_messagess", "deleted_count": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch delete: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {str(e)}")


@router.delete("/{id}")
async def delete_workspace_messages(
    id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a single workspace_messages by ID"""
    logger.debug(f"Deleting workspace_messages with id: {id}")
    
    service = Workspace_messagesService(db)
    try:
        success = await service.delete(id)
        if not success:
            logger.warning(f"Workspace_messages with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Workspace_messages not found")
        
        logger.info(f"Workspace_messages {id} deleted successfully")
        return {"message": "Workspace_messages deleted successfully", "id": id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting workspace_messages {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")