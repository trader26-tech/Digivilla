"""Ensure the `bookings` table exists.

The Supabase Python client can't run DDL, so this script checks whether the
table is reachable and, if not, prints the exact SQL to paste into the Supabase
SQL editor (Dashboard → SQL Editor → New query). Safe to run repeatedly.

    python create_bookings_table.py
"""

DDL = """\
CREATE TABLE IF NOT EXISTS bookings (
    id          text PRIMARY KEY,
    name        text NOT NULL,
    phone       text NOT NULL,
    property    text NOT NULL DEFAULT 'land',
    variant     text DEFAULT '',
    plots       integer NOT NULL DEFAULT 1,
    amount      double precision NOT NULL DEFAULT 0,
    slot        text NOT NULL,
    note        text DEFAULT '',
    status      text NOT NULL DEFAULT 'requested',
    created_at  text NOT NULL
);
CREATE INDEX IF NOT EXISTS bookings_slot_idx ON bookings (slot);
"""


def main() -> None:
    try:
        from app.supabase_client import get_supabase

        sb = get_supabase()
    except Exception:
        print("Supabase not configured — nothing to do. The app will use the")
        print("local JSON file (app/data/bookings.json) automatically.")
        return

    try:
        sb.table("bookings").select("id").limit(1).execute()
        print("✓ `bookings` table already exists and is reachable.")
        return
    except Exception:
        pass

    print("The `bookings` table does not exist yet.")
    print("Paste this into the Supabase SQL editor and run it:\n")
    print(DDL)


if __name__ == "__main__":
    main()
