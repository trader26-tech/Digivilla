"""Goal presets that drive the decision-tree chatbot's preselect options.

Each goal carries a `category` used to group the picker UI:
  - "protect": the safety net that comes before everything (emergency fund).
  - "short":   near-term goals (<= ~5 yrs). Parked in LIQUID funds so the money
               stays stable and accessible and isn't accidentally spent.
  - "long":    long-horizon wealth goals that can ride out market swings.

These eight are the most universally essential financial goals for an
individual — a safety net, the near-term big purchases, and the long-term
pillars (home, education, retirement, wealth).
"""

from app.schemas import GoalPreset

GOAL_PRESETS: list[GoalPreset] = [
    # ---------------- Protect: the safety net, first priority ---------------
    GoalPreset(
        key="emergency",
        label="Emergency Fund",
        icon="🛟",
        default_amount=600_000,
        suggested_amounts=[300_000, 600_000, 1_000_000, 1_500_000],
        default_years=2,
        default_risk="conservative",
        blurb="A safety net of 6-12 months of expenses for the unexpected.",
        category="protect",
        liquid=True,
    ),
    GoalPreset(
        key="health",
        label="Health Cushion",
        icon="🩺",
        default_amount=1_000_000,
        suggested_amounts=[500_000, 1_000_000, 2_000_000, 3_000_000],
        default_years=3,
        default_risk="conservative",
        blurb="Money set aside for medical needs so a health surprise never derails you.",
        category="protect",
        liquid=True,
    ),

    # ---------------- Short-term: near-term goals --------------------------
    GoalPreset(
        key="car",
        label="Buy a Car",
        icon="🚗",
        default_amount=1_500_000,
        suggested_amounts=[800_000, 1_500_000, 2_500_000, 4_000_000],
        default_years=4,
        default_risk="conservative",
        blurb="Plan a big-ticket purchase over the next few years.",
        category="short",
        liquid=True,
    ),
    GoalPreset(
        key="wedding",
        label="Wedding",
        icon="💍",
        default_amount=3_000_000,
        suggested_amounts=[1_500_000, 3_000_000, 5_000_000, 8_000_000],
        default_years=5,
        default_risk="balanced",
        blurb="Plan for wedding expenses without derailing other goals.",
        category="short",
        liquid=True,
    ),
    GoalPreset(
        key="vacation",
        label="Dream Vacation",
        icon="✈️",
        default_amount=800_000,
        suggested_amounts=[400_000, 800_000, 1_500_000, 2_500_000],
        default_years=3,
        default_risk="conservative",
        blurb="Save up for a once-in-a-lifetime trip.",
        category="short",
        liquid=True,
    ),
    GoalPreset(
        key="gadget",
        label="Big Purchase",
        icon="💻",
        default_amount=200_000,
        suggested_amounts=[80_000, 150_000, 300_000, 600_000],
        default_years=2,
        default_risk="conservative",
        blurb="A phone, laptop, or appliance you want to buy soon — planned, not on EMI.",
        category="short",
        liquid=True,
    ),

    # ---------------- Long-term: the pillars that compound over years -------
    GoalPreset(
        key="house",
        label="Buy a House",
        icon="🏠",
        default_amount=8_000_000,
        suggested_amounts=[3_000_000, 5_000_000, 8_000_000, 15_000_000],
        default_years=8,
        default_risk="balanced",
        blurb="Save for a down payment or the full value of a home.",
        category="long",
    ),
    GoalPreset(
        key="child_education",
        label="Child's Education",
        icon="🎓",
        default_amount=5_000_000,
        suggested_amounts=[2_500_000, 5_000_000, 8_000_000, 15_000_000],
        default_years=15,
        default_risk="balanced",
        blurb="Fund school, college or higher education without last-minute loans.",
        category="long",
    ),
    GoalPreset(
        key="retirement",
        label="Retirement",
        icon="🏖️",
        default_amount=20_000_000,
        suggested_amounts=[10_000_000, 20_000_000, 50_000_000, 100_000_000],
        default_years=25,
        default_risk="aggressive",
        blurb="Build a corpus that funds your lifestyle after you stop working.",
        category="long",
    ),
    GoalPreset(
        key="wealth",
        label="Grow Wealth",
        icon="📈",
        default_amount=10_000_000,
        suggested_amounts=[5_000_000, 10_000_000, 25_000_000, 50_000_000],
        default_years=15,
        default_risk="aggressive",
        blurb="Long-term wealth creation with no single fixed target date.",
        category="long",
    ),
]

PRESET_BY_KEY = {p.key: p for p in GOAL_PRESETS}
