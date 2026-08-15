from core.database import Base
from datetime import datetime
from sqlalchemy import Column, DateTime, Integer, String


class Workspace_messages(Base):
    __tablename__ = "workspace_messages"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    workspace_id = Column(Integer, index=True, nullable=False)
    account_id = Column(Integer, index=True, nullable=False)
    role = Column(String, nullable=False)
    content = Column(String, nullable=False)
    kind = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.now)
    updated_at = Column(DateTime(timezone=True), default=datetime.now, onupdate=datetime.now)