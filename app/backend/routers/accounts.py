import json
import logging
from typing import List, Optional

from datetime import datetime, date

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.accounts import AccountsService

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/accounts", tags=["accounts"])


# ---------- Pydantic Schemas ----------
class AccountsData(BaseModel):
    """Entity data schema (for create/update)"""
    name: str
    password_hash: str
    session_token: str = None


class AccountsUpdateData(BaseModel):
    """Update entity data (partial updates allowed)"""
    name: Optional[str] = None
    password_hash: Optional[str] = None
    session_token: Optional[str] = None


class AccountsResponse(BaseModel):
    """Entity response schema"""
    id: int
    name: str
    password_hash: str
    session_token: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class AccountsListResponse(BaseModel):
    """List response schema"""
    items: List[AccountsResponse]
    total: int
    skip: int
    limit: int


class AccountsBatchCreateRequest(BaseModel):
    """Batch create request"""
    items: List[AccountsData]


class AccountsBatchUpdateItem(BaseModel):
    """Batch update item"""
    id: int
    updates: AccountsUpdateData


class AccountsBatchUpdateRequest(BaseModel):
    """Batch update request"""
    items: List[AccountsBatchUpdateItem]


class AccountsBatchDeleteRequest(BaseModel):
    """Batch delete request"""
    ids: List[int]


# ---------- Routes ----------
@router.get("", response_model=AccountsListResponse)
async def query_accountss(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Query accountss with filtering, sorting, and pagination"""
    logger.debug(f"Querying accountss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")
    
    service = AccountsService(db)
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
        logger.debug(f"Found {result['total']} accountss")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid accounts query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying accountss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/all", response_model=AccountsListResponse)
async def query_accountss_all(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    # Query accountss with filtering, sorting, and pagination without user limitation
    logger.debug(f"Querying accountss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")

    service = AccountsService(db)
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
        logger.debug(f"Found {result['total']} accountss")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid accounts query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying accountss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{id}", response_model=AccountsResponse)
async def get_accounts(
    id: int,
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Get a single accounts by ID"""
    logger.debug(f"Fetching accounts with id: {id}, fields={fields}")
    
    service = AccountsService(db)
    try:
        result = await service.get_by_id(id)
        if not result:
            logger.warning(f"Accounts with id {id} not found")
            raise HTTPException(status_code=404, detail="Accounts not found")
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching accounts {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("", response_model=AccountsResponse, status_code=201)
async def create_accounts(
    data: AccountsData,
    db: AsyncSession = Depends(get_db),
):
    """Create a new accounts"""
    logger.debug(f"Creating new accounts with data: {data}")
    
    service = AccountsService(db)
    try:
        result = await service.create(data.model_dump())
        if not result:
            raise HTTPException(status_code=400, detail="Failed to create accounts")
        
        logger.info(f"Accounts created successfully with id: {result.id}")
        return result
    except ValueError as e:
        logger.error(f"Validation error creating accounts: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating accounts: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/batch", response_model=List[AccountsResponse], status_code=201)
async def create_accountss_batch(
    request: AccountsBatchCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Create multiple accountss in a single request"""
    logger.debug(f"Batch creating {len(request.items)} accountss")
    
    service = AccountsService(db)
    results = []
    
    try:
        for item_data in request.items:
            result = await service.create(item_data.model_dump())
            if result:
                results.append(result)
        
        logger.info(f"Batch created {len(results)} accountss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch create: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch create failed: {str(e)}")


@router.put("/batch", response_model=List[AccountsResponse])
async def update_accountss_batch(
    request: AccountsBatchUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Update multiple accountss in a single request"""
    logger.debug(f"Batch updating {len(request.items)} accountss")
    
    service = AccountsService(db)
    results = []
    
    try:
        for item in request.items:
            # Only include non-None values for partial updates
            update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
            result = await service.update(item.id, update_dict)
            if result:
                results.append(result)
        
        logger.info(f"Batch updated {len(results)} accountss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch update: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")


@router.put("/{id}", response_model=AccountsResponse)
async def update_accounts(
    id: int,
    data: AccountsUpdateData,
    db: AsyncSession = Depends(get_db),
):
    """Update an existing accounts"""
    logger.debug(f"Updating accounts {id} with data: {data}")

    service = AccountsService(db)
    try:
        # Only include non-None values for partial updates
        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        result = await service.update(id, update_dict)
        if not result:
            logger.warning(f"Accounts with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Accounts not found")
        
        logger.info(f"Accounts {id} updated successfully")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error updating accounts {id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating accounts {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/batch")
async def delete_accountss_batch(
    request: AccountsBatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple accountss by their IDs"""
    logger.debug(f"Batch deleting {len(request.ids)} accountss")
    
    service = AccountsService(db)
    deleted_count = 0
    
    try:
        for item_id in request.ids:
            success = await service.delete(item_id)
            if success:
                deleted_count += 1
        
        logger.info(f"Batch deleted {deleted_count} accountss successfully")
        return {"message": f"Successfully deleted {deleted_count} accountss", "deleted_count": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch delete: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {str(e)}")


@router.delete("/{id}")
async def delete_accounts(
    id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a single accounts by ID"""
    logger.debug(f"Deleting accounts with id: {id}")
    
    service = AccountsService(db)
    try:
        success = await service.delete(id)
        if not success:
            logger.warning(f"Accounts with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Accounts not found")
        
        logger.info(f"Accounts {id} deleted successfully")
        return {"message": "Accounts deleted successfully", "id": id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting accounts {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")