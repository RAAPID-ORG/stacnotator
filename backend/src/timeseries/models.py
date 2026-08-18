from sqlalchemy import (
    ForeignKey,
    Index,
    Integer,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.database import Base


class TimeSeries(Base):
    """
    Represents a time series entry of a campaign.
    """

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
    # Canvas window this series renders in; every series has one (the default is
    # "Time series"). See src/timeseries/windows.py.
    window_name: Mapped[str] = mapped_column(
        String, nullable=False, server_default="Time series"
    )  # Should be changed to group name: window is UI concern not data model
    start_ym: Mapped[str] = mapped_column(String(6), nullable=False)  # YYYYMM
    end_ym: Mapped[str] = mapped_column(String(6), nullable=False)  # YYYYMM
    data_source: Mapped[str] = mapped_column(String, nullable=False)  # 'MODIS', 'Landsat'
    provider: Mapped[str] = mapped_column(
        String, nullable=False
    )  # 'EE', TODO expand to STAC-read in the future
    ts_type: Mapped[str] = mapped_column(String, nullable=False)  # 'NDVI'

    # Relationship to Campaign
    campaign = relationship("Campaign", back_populates="time_series")
