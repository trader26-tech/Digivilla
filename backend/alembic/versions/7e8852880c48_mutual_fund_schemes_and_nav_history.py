"""mutual fund schemes and nav history

Revision ID: 7e8852880c48
Revises: 24853c9f71c9
Create Date: 2026-08-17 17:38:42.898192

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7e8852880c48'
down_revision: Union[str, None] = '24853c9f71c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "schemes",
        sa.Column("scheme_code", sa.Integer(), nullable=False),
        sa.Column("scheme_name", sa.String(length=500), nullable=False),
        sa.Column("fund_house", sa.String(length=255), nullable=True),
        sa.Column("scheme_type", sa.String(length=255), nullable=True),
        sa.Column("scheme_category", sa.String(length=255), nullable=True),
        sa.Column("isin_growth", sa.String(length=20), nullable=True),
        sa.Column("isin_div_reinvestment", sa.String(length=20), nullable=True),
        sa.Column("plan", sa.String(length=20), nullable=True),
        sa.Column("option", sa.String(length=40), nullable=True),
        sa.Column("latest_nav", sa.Float(), nullable=True),
        sa.Column("latest_nav_date", sa.Date(), nullable=True),
        sa.Column("history_synced_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("scheme_code"),
    )
    op.create_index("ix_schemes_scheme_name", "schemes", ["scheme_name"])
    op.create_index("ix_schemes_fund_house", "schemes", ["fund_house"])
    op.create_index("ix_schemes_scheme_category", "schemes", ["scheme_category"])

    op.create_table(
        "nav_history",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("scheme_code", sa.Integer(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("nav", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(
            ["scheme_code"], ["schemes.scheme_code"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_nav_history_scheme_date",
        "nav_history",
        ["scheme_code", "date"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_nav_history_scheme_date", table_name="nav_history")
    op.drop_table("nav_history")
    op.drop_index("ix_schemes_scheme_category", table_name="schemes")
    op.drop_index("ix_schemes_fund_house", table_name="schemes")
    op.drop_index("ix_schemes_scheme_name", table_name="schemes")
    op.drop_table("schemes")
