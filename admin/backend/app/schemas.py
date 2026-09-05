from typing import Optional

from pydantic import BaseModel


# --- Bookings / client requests -------------------------------------------
class BookingCreate(BaseModel):
    """A request a client submits from the app. `kind` distinguishes them:
      consultation — a call slot when reserving a plot (needs `slot`)
      sip          — start a recurring SIP into a Digivilla
      buy          — buy/own a Digivilla now
      withdraw     — withdraw from a Digivilla they hold
    SIP/buy/withdraw don't require a time slot; the admin actions them from the
    calendar on the day they came in (created_at)."""
    name: str
    phone: str
    kind: str = "consultation"    # consultation | sip | buy | withdraw
    property: str = "land"        # which Digivilla tier
    variant: str = ""             # conservative | balanced | aggressive
    plots: int = 1
    amount: float = 0
    slot: str = ""                # ISO-8601 of the requested slot (consultation only)
    note: str = ""


class Booking(BookingCreate):
    id: str
    status: str = "requested"     # requested | confirmed | declined
    meet_link: str = ""           # Google Meet / video link for the session
    created_at: str


class BookingStatusUpdate(BaseModel):
    status: str                   # confirmed | declined


class BookingMeetUpdate(BaseModel):
    meet_link: str = ""           # the Google Meet (or any) link to attach


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
    busy_times: Optional[list[str]] = None   # "HH:MM" busy every day


class BlockSlotBody(BaseModel):
    slot: str
    blocked: bool = True


# --- Admin client documents ----------------------------------------------
class ClientCreate(BaseModel):
    name: str
