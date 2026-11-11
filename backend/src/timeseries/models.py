from sqlalchemy import (
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    and_,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, foreign, mapped_column, relationship

from src.database import Base
from src.timeseries import expressions
from src.timeseries.indices import SpectralIndex, index_for


class TimeseriesWindow(Base):
    """A canvas window time series are charted in. Layouts key it by id, so renaming
    it changes this row and nothing else."""

    __tablename__ = "timeseries_windows"
    __table_args__ = (
        UniqueConstraint("campaign_id", "name", name="uq_timeseries_windows_campaign_name"),
        {"schema": "data"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("data.campaigns.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String, nullable=False)

    series: Mapped[list["Timeseries"]] = relationship(back_populates="window")


class CustomIndex(Base):
    """An index a campaign admin wrote as an expression over band roles. A series
    names it through ts_type exactly as it names a built-in, which is why the name
    is unique in its campaign and never a built-in's key."""

    __tablename__ = "custom_indices"
    __table_args__ = (
        UniqueConstraint("campaign_id", "name", name="uq_custom_indices_campaign_name"),
        {"schema": "data"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("data.campaigns.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    expression: Mapped[str] = mapped_column(String, nullable=False)
    domain_min: Mapped[float] = mapped_column(Float, nullable=False)
    domain_max: Mapped[float] = mapped_column(Float, nullable=False)
    reference_lines: Mapped[list[float]] = mapped_column(
        ARRAY(Float), server_default="{}", nullable=False
    )

    campaign = relationship("Campaign", back_populates="custom_indices")

    @property
    def spectral_index(self) -> SpectralIndex:
        return expressions.custom_index(
            self.name,
            self.expression,
            (self.domain_min, self.domain_max),
            tuple(self.reference_lines),
        )


class Timeseries(Base):
    """One spectral index of one source, charted over a range of months."""

    __tablename__ = "time_series"
    __table_args__ = (
        Index("idx_time_series_campaign_id", "campaign_id"),
        Index("idx_time_series_window_id", "window_id"),
        {"schema": "data"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("data.campaigns.id", ondelete="CASCADE"),
        nullable=False,
    )
    window_id: Mapped[int] = mapped_column(
        ForeignKey("data.timeseries_windows.id", ondelete="CASCADE"),
        nullable=False,
    )

    name: Mapped[str] = mapped_column(String, nullable=False)
    start_ym: Mapped[str] = mapped_column(String(6), nullable=False)  # YYYYMM
    end_ym: Mapped[str] = mapped_column(String(6), nullable=False)  # YYYYMM
    # A key of timeseries/sources.py (fetched through Earth Engine).
    data_source: Mapped[str] = mapped_column(String, nullable=False)
    # A key of timeseries/indices.py, or the name of one of the campaign's custom indices.
    ts_type: Mapped[str] = mapped_column(String, nullable=False)

    campaign = relationship("Campaign", back_populates="time_series")
    window: Mapped[TimeseriesWindow] = relationship(back_populates="series", lazy="joined")
    custom_index: Mapped[CustomIndex | None] = relationship(
        primaryjoin=lambda: and_(
            foreign(Timeseries.campaign_id) == CustomIndex.campaign_id,
            foreign(Timeseries.ts_type) == CustomIndex.name,
        ),
        viewonly=True,
        lazy="joined",
    )

    @property
    def window_name(self) -> str:
        return self.window.name

    @property
    def spectral_index(self) -> SpectralIndex | None:
        return self.custom_index.spectral_index if self.custom_index else index_for(self.ts_type)
