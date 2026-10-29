from sqlalchemy import (
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.database import Base


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
    # A key of timeseries/indices.py.
    ts_type: Mapped[str] = mapped_column(String, nullable=False)

    campaign = relationship("Campaign", back_populates="time_series")
    window: Mapped[TimeseriesWindow] = relationship(back_populates="series", lazy="joined")

    @property
    def window_name(self) -> str:
        return self.window.name
