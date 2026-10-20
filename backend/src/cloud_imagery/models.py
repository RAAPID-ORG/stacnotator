from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    TIMESTAMP,
    Boolean,
    CheckConstraint,
    ForeignKey,
    Identity,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.database import Base


class CloudImageryCollection(Base):
    """An Azure Blob container (and prefix) registered as one managed tiler catalog."""

    __tablename__ = "cloud_imagery_collections"
    __table_args__ = (
        CheckConstraint(
            "(organization_id IS NULL) <> (project_id IS NULL)", name="cloud_imagery_one_owner"
        ),
        {"schema": "data"},
    )

    id: Mapped[int] = mapped_column(Integer, Identity(always=True), primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    organization_id: Mapped[int | None] = mapped_column(
        ForeignKey("data.organizations.id", ondelete="CASCADE"), nullable=True, index=True
    )
    project_id: Mapped[int | None] = mapped_column(
        ForeignKey("data.projects.id", ondelete="CASCADE"), nullable=True, index=True
    )
    created_by_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), nullable=True)
    tiler: Mapped[str] = mapped_column(String(64), nullable=False)
    stac_collection_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    container_url: Mapped[str] = mapped_column(Text, nullable=False)
    prefix: Mapped[str] = mapped_column(Text, nullable=False, default="")
    storage_auth: Mapped[str | None] = mapped_column(String(32), nullable=True)
    encrypted_storage_secret: Mapped[str | None] = mapped_column(Text, nullable=True)
    storage_secret_expires_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    data_region: Mapped[str | None] = mapped_column(String(64), nullable=True)
    bbox: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    interval: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    item_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    visualizations: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )

    run: Mapped["CloudImageryImport | None"] = relationship(
        back_populates="collection", uselist=False, cascade="all, delete-orphan"
    )


class CloudImageryImport(Base):
    """The one import of a collection; a failed one is retried or replaced in place."""

    __tablename__ = "cloud_imagery_imports"
    __table_args__ = ({"schema": "data"},)

    id: Mapped[int] = mapped_column(Integer, Identity(always=True), primary_key=True)
    collection_id: Mapped[int] = mapped_column(
        ForeignKey("data.cloud_imagery_collections.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    errors: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    reset_pending: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )

    collection: Mapped[CloudImageryCollection] = relationship(back_populates="run")
    files: Mapped[list["CloudImageryFile"]] = relationship(
        back_populates="run", cascade="all, delete-orphan", order_by="CloudImageryFile.id"
    )


class CloudImageryFile(Base):
    """One selected object; ``item_id`` is its checkpoint once the tiler holds it."""

    __tablename__ = "cloud_imagery_files"
    __table_args__ = (
        UniqueConstraint("import_id", "path", name="cloud_imagery_files_path_uq"),
        {"schema": "data"},
    )

    id: Mapped[int] = mapped_column(Integer, Identity(always=True), primary_key=True)
    import_id: Mapped[int] = mapped_column(
        ForeignKey("data.cloud_imagery_imports.id", ondelete="CASCADE"), nullable=False
    )
    path: Mapped[str] = mapped_column(Text, nullable=False)
    etag: Mapped[str] = mapped_column(Text, nullable=False)
    instant: Mapped[bool] = mapped_column(Boolean, nullable=False)
    start_datetime: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    end_datetime: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    item_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    run: Mapped[CloudImageryImport] = relationship(back_populates="files")
