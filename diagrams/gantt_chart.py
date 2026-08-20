"""
Generates gantt_chart.png (in this same folder) for the dissertation.

Builds a pandas DataFrame of tasks/milestones (Task_ID, Task_Name, Phase,
Start_Date, End_Date, Duration_Days, Progress, Is_Milestone, Resource),
computes Duration_Days and Progress programmatically, then renders it as a
classic MS-Project-style Gantt chart: a dark-navy summary bar per phase,
indented Royal-Blue task bars beneath it (Sage Green once complete), and
red diamond milestones. Progress is computed against TODAY, so it reflects
real in-flight status rather than a fixed "finished" snapshot.

The project follows a pure Agile/Scrum lifecycle: backlog creation and
initial sprint planning feed straight into seven time-boxed sprints
(Sprint 1-7), each one bundling feature development with its own testing
activity and closing on a sprint milestone. From Sprint 2 onward, each
sprint's testing task also regression-tests the modules delivered in
earlier sprints -- so integration testing is continuous throughout the
project rather than deferred to the end. Sprint 7 folds in the project's
final integration, evaluation and release work -- full regression testing,
UAT, system evaluation, bug fixing, documentation and final submission --
as the last iteration in the same cadence, not a separate phase. Every
sprint is drawn inside a shaded "iteration block" so the repeating Scrum
cycle reads from the chart's shape, not just its labels.

Requires: matplotlib, pandas   ->   pip install matplotlib pandas
Run:      python3 gantt_chart.py
"""
import os
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.patches import Rectangle
from matplotlib.transforms import blended_transform_factory
import datetime as dt

plt.rcParams["font.family"] = "Liberation Serif"

TODAY = pd.Timestamp("2026-08-17")  # date this chart was generated

# ---------------------------------------------------------------------------
# 1. Data schema — one row per task or milestone. A solo developer cannot
#    work two tasks at once, so within a phase every row is scheduled
#    Finish-to-Start (sequential, non-overlapping). Milestones carry
#    Start_Date == End_Date (zero duration).
# ---------------------------------------------------------------------------
raw = [
    # Task_ID, Task_Name,                                              Phase,                                  Start_Date,   End_Date,     Is_Milestone
    ("PLN-01", "Proposal submission",                                   "Product Backlog & Initial Sprint Planning",                             "2026-06-07", "2026-06-08", False),
    ("PLN-M1", "Proposal accepted",                                     "Product Backlog & Initial Sprint Planning",                             "2026-06-08", "2026-06-08", True),
    ("PLN-02", "Literature review & background research",               "Product Backlog & Initial Sprint Planning",                             "2026-06-08", "2026-06-19", False),
    ("PLN-03", "Feasibility study (SWOT & PESTAL)",                     "Product Backlog & Initial Sprint Planning",                             "2026-06-19", "2026-06-24", False),
    ("PLN-04", "Requirements elicitation (questionnaire & interview)",  "Product Backlog & Initial Sprint Planning",                             "2026-06-24", "2026-06-30", False),
    ("PLN-M2", "Product backlog baselined",                             "Product Backlog & Initial Sprint Planning",                             "2026-06-30", "2026-06-30", True),
    ("PLN-05", "System architecture & database design",                 "Product Backlog & Initial Sprint Planning",                             "2026-06-30", "2026-07-07", False),
    ("PLN-06", "UI/UX wireframing & ER modelling",                      "Product Backlog & Initial Sprint Planning",                             "2026-07-07", "2026-07-13", False),
    ("PLN-07", "Dev environment setup & baseline risk model v1",        "Product Backlog & Initial Sprint Planning",                             "2026-07-13", "2026-07-18", False),
    ("PLN-M3", "Dev environment ready",                                 "Product Backlog & Initial Sprint Planning",                             "2026-07-18", "2026-07-18", True),

    ("S1-01", "Authentication & RBAC hardening",                        "Sprint 1: Core Loan Assessment",        "2026-07-18", "2026-07-19", False),
    ("S1-02", "Recommendation engine (EMI & affordability)",            "Sprint 1: Core Loan Assessment",        "2026-07-19", "2026-07-20", False),
    ("S1-03", "ML client integration & Gemini risk explanations",       "Sprint 1: Core Loan Assessment",        "2026-07-20", "2026-07-21", False),
    ("S1-04", "Loan application wizard, admin dashboard & sprint testing", "Sprint 1: Core Loan Assessment",      "2026-07-21", "2026-07-22", False),
    ("S1-M1", "Core loan assessment pipeline complete",                 "Sprint 1: Core Loan Assessment",        "2026-07-22", "2026-07-22", True),

    ("S2-01", "Forecasting pipeline (LSTM/XGBoost/GARCH/Isolation Forest)", "Sprint 2: Currency Forecasting",    "2026-07-22", "2026-07-24", False),
    ("S2-02", "Inference microservice & live-rate ingestion",           "Sprint 2: Currency Forecasting",        "2026-07-24", "2026-07-25", False),
    ("S2-03", "Customer & staff analytics UI, with sprint & regression testing", "Sprint 2: Currency Forecasting", "2026-07-25", "2026-07-27", False),
    ("S2-M1", "Currency forecasting module complete",                   "Sprint 2: Currency Forecasting",        "2026-07-27", "2026-07-27", True),

    ("S3-01", "FX exchange workflow (customer/staff/admin)",            "Sprint 3: FX Exchange & Platform UX",   "2026-07-27", "2026-07-29", False),
    ("S3-02", "Multi-series rate charts, support messaging & FAQ",      "Sprint 3: FX Exchange & Platform UX",   "2026-07-29", "2026-07-31", False),
    ("S3-03", "Trilingual EN/SI/TA i18n, with sprint & regression testing", "Sprint 3: FX Exchange & Platform UX", "2026-07-31", "2026-08-01", False),
    ("S3-M1", "FX exchange workflow & i18n complete",                   "Sprint 3: FX Exchange & Platform UX",   "2026-08-01", "2026-08-01", True),

    ("S4-01", "Loan status machine, offers & bank accounts",            "Sprint 4: Loan Lifecycle Management",   "2026-08-01", "2026-08-03", False),
    ("S4-02", "Stripe-based repayments",                                 "Sprint 4: Loan Lifecycle Management",   "2026-08-03", "2026-08-04", False),
    ("S4-03", "Credit-decisioning engine, with sprint & regression testing", "Sprint 4: Loan Lifecycle Management", "2026-08-04", "2026-08-06", False),
    ("S4-M1", "Full loan lifecycle complete",                            "Sprint 4: Loan Lifecycle Management",   "2026-08-06", "2026-08-06", True),

    ("S5-01", "Loan fees, effective APR & consent management",          "Sprint 5: Risk Model v2 & Hardening",   "2026-08-06", "2026-08-07", False),
    ("S5-02", "Risk model v2 rebuild on causal dataset",                 "Sprint 5: Risk Model v2 & Hardening",   "2026-08-07", "2026-08-09", False),
    ("S5-03", "Portal layout redesign, with sprint & regression testing", "Sprint 5: Risk Model v2 & Hardening",  "2026-08-09", "2026-08-10", False),
    ("S5-M1", "Risk model v2 & hardening complete",                      "Sprint 5: Risk Model v2 & Hardening",   "2026-08-10", "2026-08-10", True),

    ("S6-01", "Vehicle-leasing module & underwriting refinements",      "Sprint 6: Vehicle Leasing & OCR",       "2026-08-10", "2026-08-13", False),
    ("S6-02", "OCR document extraction & staff review UI",               "Sprint 6: Vehicle Leasing & OCR",       "2026-08-13", "2026-08-15", False),
    ("S6-03", "Upload modes, retry flow, with sprint & regression testing", "Sprint 6: Vehicle Leasing & OCR",    "2026-08-15", "2026-08-16", False),
    ("S6-M1", "Leasing & OCR modules complete",                          "Sprint 6: Vehicle Leasing & OCR",       "2026-08-16", "2026-08-16", True),

    ("S7-01", "Cross-module integration & regression testing",           "Sprint 7: Integration, Evaluation & Final Release", "2026-08-16", "2026-08-18", False),
    ("S7-02", "User acceptance testing / manual walkthrough",            "Sprint 7: Integration, Evaluation & Final Release", "2026-08-18", "2026-08-19", False),
    ("S7-03", "System evaluation & performance assessment",              "Sprint 7: Integration, Evaluation & Final Release", "2026-08-19", "2026-08-20", False),
    ("S7-04", "Bug fixing, refinement & final backlog completion",       "Sprint 7: Integration, Evaluation & Final Release", "2026-08-20", "2026-08-21", False),
    ("S7-05", "Technical documentation",                                 "Sprint 7: Integration, Evaluation & Final Release", "2026-08-21", "2026-08-22", False),
    ("S7-06", "Dissertation completion",                                 "Sprint 7: Integration, Evaluation & Final Release", "2026-08-22", "2026-08-23", False),
    ("S7-07", "Final review & proofreading",                             "Sprint 7: Integration, Evaluation & Final Release", "2026-08-23", "2026-08-24", False),
    ("S7-M1", "Final submission",                                        "Sprint 7: Integration, Evaluation & Final Release", "2026-08-24", "2026-08-24", True),
]

df = pd.DataFrame(raw, columns=["Task_ID", "Task_Name", "Phase", "Start_Date", "End_Date", "Is_Milestone"])
df["Start_Date"] = pd.to_datetime(df["Start_Date"])
df["End_Date"] = pd.to_datetime(df["End_Date"])
df["Duration_Days"] = (df["End_Date"] - df["Start_Date"]).dt.days
df["Resource"] = "Solo Developer"


def compute_progress(row):
    if row["End_Date"] <= TODAY:
        return 100.0
    if row["Start_Date"] >= TODAY:
        return 0.0
    total = max((row["End_Date"] - row["Start_Date"]).days, 1)
    done = (TODAY - row["Start_Date"]).days
    return round(100 * done / total, 1)


df["Progress"] = df.apply(compute_progress, axis=1)
df["Is_Testing"] = df["Task_Name"].str.contains("testing", case=False, na=False)

# Sprint 1-7 are the repeating Scrum iterations; Product Backlog & Initial
# Sprint Planning precedes the cadence but is not itself a sprint.
SPRINT_PHASES = [p for p in df["Phase"].unique() if p.startswith("Sprint ")]

# ---------------------------------------------------------------------------
# 2. Phase summary rows, derived (not hand-typed) from the task table.
# ---------------------------------------------------------------------------
phase_order = list(dict.fromkeys(df["Phase"]))
summary = (df.groupby("Phase", sort=False)
             .agg(Start_Date=("Start_Date", "min"), End_Date=("End_Date", "max"))
             .reindex(phase_order))
summary["Duration_Days"] = (summary["End_Date"] - summary["Start_Date"]).dt.days


def phase_progress(phase):
    sub = df[df["Phase"] == phase]
    w = sub["Duration_Days"].clip(lower=0.25)
    return float((sub["Progress"] * w).sum() / w.sum())


summary["Progress"] = [phase_progress(p) for p in summary.index]

# ---------------------------------------------------------------------------
# 3. Colour palette (the one figure in the dissertation that uses colour;
#    every other diagram is monochrome, since colour here encodes progress
#    status rather than decoration).
# ---------------------------------------------------------------------------
NAVY = "#1F3864"           # phase / summary bars
TASK_BLUE = "#4472C4"      # standard (incomplete) task bars
DONE_GREEN = "#93B572"     # sage green — completed tasks
MILESTONE_RED = "#C00000"  # bright red diamond markers
GRID_LINE = "#dcdcdc"
ITERATION_FILL = "#E9F0FB"  # pale wash marking an Agile iteration block
ITERATION_EDGE = "#8FAADC"

# ---------------------------------------------------------------------------
# 4. Build the ordered row list: [summary, task/milestone*, summary, ...],
#    tracking each phase's row span so every Sprint (1-7) can be framed as
#    a visibly repeating iteration block.
# ---------------------------------------------------------------------------
rows = []
phase_row_range = {}
for phase in phase_order:
    start_idx = len(rows)
    rows.append(("summary", phase, summary.loc[phase]))
    sub = df[df["Phase"] == phase].sort_values("Start_Date")
    for _, r in sub.iterrows():
        rows.append(("milestone" if r["Is_Milestone"] else "task", phase, r))
    phase_row_range[phase] = (start_idx, len(rows) - 1)

n = len(rows)
ROW_H = 0.62
total_h = n * ROW_H

fig, ax = plt.subplots(figsize=(16.5, 15.5), dpi=190)
label_trans = blended_transform_factory(ax.transAxes, ax.transData)
LABEL_X = -0.30

xmin = df["Start_Date"].min() - dt.timedelta(days=3)
xmax = df["End_Date"].max() + dt.timedelta(days=3)

# Shaded iteration blocks behind Sprint 1-7, so the repeating Scrum cadence
# reads from the chart's shape, not just its row labels.
for phase in SPRINT_PHASES:
    first_i, last_i = phase_row_range[phase]
    y_top = total_h - first_i * ROW_H
    y_bot = total_h - (last_i + 1) * ROW_H
    x0 = mdates.date2num(summary.loc[phase, "Start_Date"])
    x1 = mdates.date2num(summary.loc[phase, "End_Date"])
    ax.add_patch(Rectangle((x0 - 0.15, y_bot), (x1 - x0) + 0.3, y_top - y_bot,
                            facecolor=ITERATION_FILL, edgecolor=ITERATION_EDGE,
                            linewidth=1.1, zorder=0.4))

for i in range(n):
    y0 = total_h - (i + 1) * ROW_H
    ax.axhline(y0, color=GRID_LINE, linewidth=0.6, zorder=1)
ax.axhline(total_h, color=GRID_LINE, linewidth=0.6, zorder=1)

for i, (kind, phase, r) in enumerate(rows):
    yc = total_h - (i + 0.5) * ROW_H

    if kind == "summary":
        bar_h = ROW_H * 0.42
        dur = max(r["Duration_Days"], 1)
        ax.add_patch(Rectangle((mdates.date2num(r["Start_Date"]), yc - bar_h / 2), dur, bar_h,
                                facecolor=NAVY, edgecolor="black", linewidth=1.0, zorder=3))
        ax.text(LABEL_X, yc, phase, transform=label_trans, fontsize=9.6, fontweight="bold",
                ha="left", va="center", zorder=4, clip_on=False, color=NAVY)
        ax.text(mdates.date2num(r["End_Date"]) + 0.4, yc, f'{r["Progress"]:.0f}% avg', fontsize=7.4,
                fontweight="bold", color=NAVY, ha="left", va="center", zorder=4)
        if phase == "Product Backlog & Initial Sprint Planning":
            ax.text(mdates.date2num(r["End_Date"]) + 7.5, yc, "→ backlog refined continuously through Sprint 1–7",
                    fontsize=7.4, fontstyle="italic", color="#555555", ha="left", va="center", zorder=4)
        continue

    if kind == "milestone":
        md = r["End_Date"]
        ax.plot(md, yc, marker="D", markersize=9.5, color=MILESTONE_RED,
                markeredgecolor="black", markeredgewidth=0.8, zorder=6)
        status = "Done" if r["End_Date"] <= TODAY else "Due"
        label = f'    ♦ {r["Task_Name"]}'
        ax.text(LABEL_X, yc, label, transform=label_trans, fontsize=8.4, fontweight="bold",
                color=MILESTONE_RED, ha="left", va="center", zorder=4, clip_on=False)
        ax.text(mdates.date2num(md) + 0.9, yc, status, fontsize=7.6, fontweight="bold",
                color=MILESTONE_RED, ha="left", va="center", zorder=6)
        continue

    # kind == "task"
    bar_h = ROW_H * 0.58
    dur = max(r["Duration_Days"], 1)
    done = r["Progress"] >= 100.0
    face = DONE_GREEN if done else TASK_BLUE
    hatch = "///" if r["Is_Testing"] else None
    ax.add_patch(Rectangle((mdates.date2num(r["Start_Date"]), yc - bar_h / 2), dur, bar_h,
                            facecolor=face, edgecolor="black", linewidth=0.9, hatch=hatch, zorder=3))
    prefix = "[Done] " if done else ("[In Progress] " if r["Progress"] > 0 else "[Pending] ")
    ax.text(LABEL_X, yc, f'    {prefix}{r["Task_Name"]}', transform=label_trans, fontsize=8.2,
            ha="left", va="center", zorder=4, clip_on=False,
            color="#2f2f2f")
    ax.text(mdates.date2num(r["End_Date"]) + 0.4, yc, f'{r["Progress"]:.0f}%', fontsize=7.6,
            ha="left", va="center", zorder=4, color="#2f2f2f")

# "today" marker
ax.axvline(TODAY, color="black", linewidth=1.3, linestyle=(0, (5, 3)), zorder=5)
ax.text(mdates.date2num(TODAY), total_h + 0.15, "TODAY", fontsize=8.6, fontweight="bold",
        ha="center", va="bottom")

ax.set_xlim(mdates.date2num(xmin), mdates.date2num(xmax))
ax.set_ylim(0, total_h + 0.5)
ax.set_yticks([])

ax.xaxis.set_major_locator(mdates.WeekdayLocator(byweekday=mdates.MO))
ax.xaxis.set_major_formatter(mdates.DateFormatter("%d %b"))
ax.grid(axis="x", color=GRID_LINE, linewidth=0.6, zorder=0)
plt.setp(ax.get_xticklabels(), rotation=40, ha="right", fontsize=9)

for spine in ["top", "right", "left"]:
    ax.spines[spine].set_visible(False)
ax.spines["bottom"].set_color("black")

ax2 = ax.secondary_xaxis("top")
ax2.xaxis.set_major_locator(mdates.WeekdayLocator(byweekday=mdates.MO))
ax2.xaxis.set_major_formatter(mdates.DateFormatter("%d %b"))
plt.setp(ax2.get_xticklabels(), rotation=40, ha="left", fontsize=9)
for spine in ["top", "right", "left", "bottom"]:
    ax2.spines[spine].set_visible(False)

ax.set_title(
    "Project Gantt Chart — AI-Powered Loan Risk & Recommendation System\n"
    f"Proposal Accepted: 07 June 2026  |  Submission Deadline: 24 August 2026  |  "
    f"As of {TODAY.strftime('%d %b %Y')}\n"
    "Agile/Scrum Iterative Development Plan — Sprint 1–7",
    fontsize=13, fontweight="bold", pad=92,
)
ax.annotate(
    "Entire project follows an Agile/Scrum iterative development approach; work is organised into consecutive\n"
    "sprints with incremental delivery, testing, review and refinement. Each sprint delivers a tested product\n"
    "increment, re-verifying previously completed modules through regression testing, and informs subsequent\n"
    "backlog refinement.",
    xy=(0.5, 1.0), xycoords="axes fraction", xytext=(0, 32), textcoords="offset points",
    fontsize=8.6, fontstyle="italic", ha="center", va="bottom", color="#3a3a3a",
)
import matplotlib.patches as mpatches
legend_handles = [
    mpatches.Patch(facecolor=NAVY, edgecolor="black", label="Sprint / Workstream summary"),
    mpatches.Patch(facecolor=TASK_BLUE, edgecolor="black", label="Task — pending / in progress"),
    mpatches.Patch(facecolor=DONE_GREEN, edgecolor="black", label="Task — complete"),
    mpatches.Patch(facecolor=DONE_GREEN, edgecolor="black", hatch="///", label="Task — sprint / regression testing"),
    mpatches.Patch(facecolor=ITERATION_FILL, edgecolor=ITERATION_EDGE, label="Agile iteration block (Sprint)"),
    plt.Line2D([0], [0], marker="D", color=MILESTONE_RED, linestyle="None", markersize=9,
               markeredgecolor="black", label="Milestone"),
    plt.Line2D([0], [0], color="black", linestyle=(0, (5, 3)), linewidth=1.3, label=f"Today ({TODAY.strftime('%d %b')})"),
]
fig.legend(handles=legend_handles, loc="lower center", bbox_to_anchor=(0.5, -0.02),
           fontsize=9, frameon=True, edgecolor="black", ncol=4)

plt.tight_layout(rect=[0, 0.035, 1, 1])
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gantt_chart.png")
fig.savefig(out, facecolor="white", bbox_inches="tight", pad_inches=0.3)
print("saved", out)
print(df[["Task_ID", "Phase", "Start_Date", "End_Date", "Duration_Days", "Progress", "Is_Milestone", "Resource"]]
      .to_string(index=False))
