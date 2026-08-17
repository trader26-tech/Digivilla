from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class Scheme(Base, TimestampMixin):
    """A mutual fund scheme (one AMFI scheme code).

    Metadata comes from AMFI's NAVAll feed and mfapi.in. `latest_nav` /
    `latest_nav_date` are denormalized for fast list rendering; full history
    lives in NavHistory.
    """

    __tablename__ = "schemes"

    # AMFI scheme code is the natural, stable primary key.
    scheme_code: Mapped[int] = mapped_column(Integer, primary_key=True)
    scheme_name: Mapped[str] = mapped_column(String(500), nullable=False, index=True)
    fund_house: Mapped[str | None] = mapped_column(String(255), index=True)
    scheme_type: Mapped[str | None] = mapped_column(String(255))
    scheme_category: Mapped[str | None] = mapped_column(String(255), index=True)

    isin_growth: Mapped[str | None] = mapped_column(String(20))
    isin_div_reinvestment: Mapped[str | None] = mapped_column(String(20))

    plan: Mapped[str | None] = mapped_column(String(20))  # DIRECT | REGULAR
    option: Mapped[str | None] = mapped_column(String(40))  # GROWTH | IDCW | ...

    latest_nav: Mapped[float | None] = mapped_column(Float)
    latest_nav_date: Mapped[date | None] = mapped_column(Date)

    # When we last pulled full history for this scheme (for cache freshness).
    history_synced_at: Mapped[datetime | None] = mapped_column(DateTime)

    navs: Mapped[list["NavHistory"]] = relationship(
        back_populates="scheme",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class NavHistory(Base):
    """A single (scheme, date) NAV point."""

    __tablename__ = "nav_history"
    __table_args__ = (
        Index("ix_nav_history_scheme_date", "scheme_code", "date", unique=True),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    scheme_code: Mapped[int] = mapped_column(
        ForeignKey("schemes.scheme_code", ondelete="CASCADE"), nullable=False
    )
    date: Mapped[date] = mapped_column(Date, nullable=False)
    nav: Mapped[float] = mapped_column(Float, nullable=False)

    scheme: Mapped[Scheme] = relationship(back_populates="navs")
