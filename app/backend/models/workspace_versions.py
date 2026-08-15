from core.database import Base
from datetime import datetime
from sqlalchemy import Column, DateTime, Integer, String


class Workspace_versions(Base):
    __tablename__ = "workspace_versions"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    workspace_id = Column(Integer, index=True, nullable=False)
    account_id = Column(Integer, index=True, nullable=False)
    version_no = Column(Integer, nullable=False)
    files_json = Column(String, nullable=False)
    summary = Column(String, nullable=True)
    note = Column(String, nullable=True)
    audit_json = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.now)
    updated_at = Column(DateTime(timezone=True), default=datetime.now, onupdate=datetime.now)