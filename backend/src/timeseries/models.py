from sqlalchemy import (
    ForeignKey,
    Index,
    Integer,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.database import Base


class Timeseries(Base):
    """One spectral index of one source, charted over a range of months."""

    __tablename__ = "time_series"
    __table_args__ = (
        Index("idx_time_series_campaign_id", "campaign_id"),
        {"schema": "data"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("data.campaigns.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Time series metadata
    name: Mapped[str] = mapped_column(String, nullable=False)
    # The canvas window this series is charted in, shared by every series with
    # the same name. See src/timeseries/windows.py.
    window_name: Mapped[str] = mapped_column(String, nullable=False, server_default="Time series")
    start_ym: Mapped[str] = mapped_column(String(6), nullable=False)  # YYYYMM
    end_ym: Mapped[str] = mapped_column(String(6), nullable=False)  # YYYYMM
    # A key of timeseries/sources.py (fetched through Earth Engine).
    data_source: Mapped[str] = mapped_column(String, nullable=False)
    # A key of timeseries/indices.py.
    ts_type: Mapped[str] = mapped_column(String, nullable=False)

    # Relationship to Campaign
    campaign = relationship("Campaign", back_populates="time_series")
