from core.database import Base
from datetime import datetime
from sqlalchemy import Column, DateTime, Integer, String


class Accounts(Base):
    __tablename__ = "accounts"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    name = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)
    session_token = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.now)
    updated_at = Column(DateTime(timezone=True), default=datetime.now, onupdate=datetime.now)