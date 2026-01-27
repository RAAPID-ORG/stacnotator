from sqlalchemy import (
    ForeignKey,
    Integer,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.database import Base


class TimeSeries(Base):
    """
    Represents time series data configuration for a campaign.
    """

    __tablename__ = "time_series"
    __table_args__ = {"schema": "data"}

    # Primary key
    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # Foreign keys
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("data.campaigns.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Time series metadata
    name: Mapped[str] = mapped_column(String, nullable=False)
    start_ym: Mapped[str] = mapped_column(String(6), nullable=False)  # YYYYMM
    end_ym: Mapped[str] = mapped_column(String(6), nullable=False)  # YYYYMM
    data_source: Mapped[str] = mapped_column(String, nullable=False)  # 'MODIS', 'Landsat'
    provider: Mapped[str] = mapped_column(String, nullable=False)  # 'EE'
    ts_type: Mapped[str] = mapped_column(String, nullable=False)  # 'NDVI'

    # Relationship to Campaign
    campaign = relationship("Campaign", back_populates="time_series")
