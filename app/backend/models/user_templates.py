from core.database import Base
from datetime import datetime
from sqlalchemy import Column, DateTime, Integer, String


class User_templates(Base):
    __tablename__ = "user_templates"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    account_id = Column(Integer, index=True, nullable=False)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    keywords = Column(String, nullable=True)
    files_json = Column(String, nullable=False)
    source_workspace_id = Column(Integer, index=True, nullable=True)
    use_count = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.now)
    updated_at = Column(DateTime(timezone=True), default=datetime.now, onupdate=datetime.now)