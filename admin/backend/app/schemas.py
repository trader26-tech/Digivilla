from typing import Optional

from pydantic import BaseModel


# --- Bookings -------------------------------------------------------------
class BookingCreate(BaseModel):
    """A consultation request a user submits when reserving a plot."""
    name: str
    phone: str
    property: str = "land"        # which tier they're reserving
    variant: str = ""             # conservative | balanced | aggressive
    plots: int = 1
    amount: float = 0
    slot: str                     # ISO-8601 datetime of the requested slot
    note: str = ""


class Booking(BookingCreate):
    id: str
    status: str = "requested"     # requested | confirmed | declined
    created_at: str


class BookingStatusUpdate(BaseModel):
    status: str                   # confirmed | declined


# --- Admin OTP → PIN sign-in ---------------------------------------------
class AdminOtpRequest(BaseModel):
    email: str = ""               # optional — defaults to the allowlisted address


class AdminOtpVerify(BaseModel):
    email: str = ""
    code: str


class AdminPinBody(BaseModel):
    pin: str


class AdminLockBody(BaseModel):
    lock_minutes: int


# --- Admin availability --------------------------------------------------
class AvailabilityConfig(BaseModel):
    start: Optional[str] = None
    end: Optional[str] = None
    slot_minutes: Optional[int] = None
    weekdays: Optional[list[int]] = None
    tz_offset: Optional[str] = None


class BlockSlotBody(BaseModel):
    slot: str
    blocked: bool = True


# --- Admin client documents ----------------------------------------------
class ClientCreate(BaseModel):
    name: str
