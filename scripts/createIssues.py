#!/usr/bin/env python3
"""
create-issues.py — create one GitHub issue per backlog item from vantage-backlog.md.

Parses each `## <ID> — <Title>` block, reads its metadata line
(`**Priority:** … · **Effort:** … · **Type:** …`), and calls `gh issue create`
with matching labels. The full block (Goal / Current state / What's needed /
Sketch / Open questions) becomes the issue body.

SAFETY: dry-run by default. Nothing is created until you pass --create.

Usage
-----
  python3 create-issues.py                      # dry run: print what would happen
  python3 create-issues.py --create             # create labels + all 59 issues (current repo)
  python3 create-issues.py --create -R owner/repo
  python3 create-issues.py --create --only T6,T7,T8
  python3 create-issues.py --create --sleep 2   # pause between creates (default 2s)
  python3 create-issues.py --file docs/vantage-backlog.md --create

Requirements
------------
  * gh CLI installed and authenticated:  gh auth status
  * Run from inside the target repo, or pass -R owner/repo.

Notes
-----
  * The file is already sorted by priority then effort, so issues are created
    in that order — GitHub issue numbers will follow the same order.
  * "Depends on" stays in the body as text (e.g. "Depends on: T7"); once issues
    exist you can convert those to tracked "blocked by" links in the GitHub UI.
  * Re-running creates duplicates — GitHub has no natural dedup key. Use --only
    to (re)create a subset, or delete/close dupes manually.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

# Known issue-ID prefixes in the backlog (letters followed by a number).
HEADING_RE = re.compile(r"^##\s+([A-Z]{1,4}\d+)\s+[—–-]\s+(.+?)\s*$")
META_RE = re.compile(
    r"\*\*Priority:\*\*\s*(P\d).*?\*\*Effort:\*\*\s*([^·]+?)\s*·"
    r".*?\*\*Type:\*\*\s*([^\n]+)",
    re.IGNORECASE,
)

# Labels this script OWNS: created/updated with --force (safe to overwrite).
OWNED_LABELS = {
    "priority:P0": ("b60205", "Correctness spine — do first"),
    "priority:P1": ("d93f0b", "High value, next"),
    "priority:P2": ("fbca04", "Important"),
    "priority:P3": ("c5def5", "Later / own track"),
    "effort:S":    ("c2e0c6", "Small (~days)"),
    "effort:S-M":  ("bfd4c2", "Small–Medium"),
    "effort:M":    ("7fbf9e", "Medium (~1-2 wk)"),
    "effort:M-L":  ("5aa17f", "Medium–Large"),
    "effort:L":    ("2f6f4e", "Large (multi-week / own track)"),
    "gap":         ("e36209", "Existing logic (business or other) found missing or flawed"),
}
# Labels REUSED from the repo's existing set: created only if missing, never
# --force, so their existing colour/description isn't clobbered.
REUSED_LABELS = {"enhancement", "tech debt"}
# Recognised Type values. An issue may carry more than one (comma-separated in the
# doc), e.g. "gap, tech debt" -> both labels applied.
KNOWN_TYPES = {"gap", "enhancement", "tech debt"}


def norm_effort(raw: str) -> str:
    """'M–L' / 'S–M' / 'M' -> label-safe 'M-L' / 'S-M' / 'M'."""
    return raw.strip().replace("–", "-").replace("—", "-").replace(" ", "")


def parse_issues(md_path: Path) -> list[dict]:
    lines = md_path.read_text(encoding="utf-8").split("\n")
    issues: list[dict] = []
    i = 0
    n = len(lines)
    while i < n:
        m = HEADING_RE.match(lines[i])
        if not m:
            i += 1
            continue
        issue_id, title_rest = m.group(1), m.group(2)
        # Body = lines after the heading until the next '---' terminator.
        body_lines: list[str] = []
        j = i + 1
        while j < n and lines[j].strip() != "---":
            body_lines.append(lines[j])
            j += 1
        body = "\n".join(body_lines).strip()

        meta = META_RE.search(body)
        if not meta:
            print(f"  ! {issue_id}: no metadata line found — skipping", file=sys.stderr)
            i = j + 1
            continue
        pri = meta.group(1).upper()
        effort = norm_effort(meta.group(2))
        types = [t.strip().lower() for t in meta.group(3).split(",")]
        types = [t for t in types if t in KNOWN_TYPES]
        if not types:
            print(f"  ! {issue_id}: no recognised Type value — skipping", file=sys.stderr)
            i = j + 1
            continue

        issues.append({
            "id": issue_id,
            "title": f"{issue_id} — {title_rest}",
            "body": body,
            "labels": [f"priority:{pri}", f"effort:{effort}"] + types,
        })
        i = j + 1
    return issues


def run(cmd: list[str], dry: bool) -> int:
    if dry:
        # Show a readable version; the body is passed via file so it's not inlined.
        print("    $ " + " ".join(_shquote(c) for c in cmd))
        return 0
    return subprocess.run(cmd).returncode


def _shquote(s: str) -> str:
    return s if re.fullmatch(r"[A-Za-z0-9_@%+=:,./-]+", s) else "'" + s.replace("'", "'\\''") + "'"


def ensure_labels(labels: set[str], repo_args: list[str], dry: bool) -> None:
    print(f"\n== Ensuring {len(labels)} labels exist ==")
    for name in sorted(labels):
        if name in OWNED_LABELS:
            color, desc = OWNED_LABELS[name]
            # We own these — safe to create or update.
            cmd = ["gh", "label", "create", name, "--color", color,
                   "--description", desc, "--force"] + repo_args
            run(cmd, dry)
        else:
            # Reused from the repo's existing labels (e.g. `enhancement`, `tech debt`).
            # Create only if missing; DO NOT pass --force, so an existing colour/
            # description is left untouched. Tolerate the "already exists" error.
            cmd = ["gh", "label", "create", name] + repo_args
            if dry:
                print("    $ " + " ".join(_shquote(c) for c in cmd)
                      + "    # (skipped if it already exists; existing label untouched)")
            else:
                r = subprocess.run(cmd, capture_output=True, text=True)
                if r.returncode != 0 and "already exists" not in (r.stderr or "").lower():
                    print(f"    ! could not ensure label '{name}': {r.stderr.strip()}",
                          file=sys.stderr)


def main() -> int:
    ap = argparse.ArgumentParser(description="Create GitHub issues from the Vantage backlog.")
    ap.add_argument("--file", default="vantage-backlog.md", help="Path to the backlog markdown.")
    ap.add_argument("--create", action="store_true", help="Actually create issues (default: dry run).")
    ap.add_argument("-R", "--repo", default=None, help="Target repo as owner/name (default: current dir's repo).")
    ap.add_argument("--only", default=None, help="Comma-separated issue IDs to create (e.g. T6,T7).")
    ap.add_argument("--sleep", type=float, default=2.0, help="Seconds to pause between creates (default 2).")
    ap.add_argument("--no-labels", action="store_true", help="Skip label creation.")
    args = ap.parse_args()

    md_path = Path(args.file)
    if not md_path.exists():
        print(f"error: {md_path} not found", file=sys.stderr)
        return 1

    dry = not args.create
    repo_args = ["-R", args.repo] if args.repo else []

    issues = parse_issues(md_path)
    if args.only:
        wanted = {s.strip() for s in args.only.split(",") if s.strip()}
        issues = [it for it in issues if it["id"] in wanted]
        missing = wanted - {it["id"] for it in issues}
        if missing:
            print(f"warning: IDs not found: {', '.join(sorted(missing))}", file=sys.stderr)

    if not issues:
        print("No issues parsed. Check --file / --only.", file=sys.stderr)
        return 1

    mode = "DRY RUN (nothing will be created)" if dry else "CREATE MODE"
    print(f"== {mode} ==")
    print(f"Parsed {len(issues)} issues from {md_path}"
          + (f"  ->  {args.repo}" if args.repo else "  ->  current repo"))

    if args.create and not args.no_labels:
        all_labels = {lbl for it in issues for lbl in it["labels"]}
        ensure_labels(all_labels, repo_args, dry=False)
    elif dry and not args.no_labels:
        all_labels = {lbl for it in issues for lbl in it["labels"]}
        ensure_labels(all_labels, repo_args, dry=True)

    print(f"\n== {'Would create' if dry else 'Creating'} {len(issues)} issues ==")
    created = 0
    for idx, it in enumerate(issues, 1):
        label_args: list[str] = []
        for lbl in it["labels"]:
            label_args += ["--label", lbl]
        print(f"\n[{idx}/{len(issues)}] {it['title']}   ({', '.join(it['labels'])})")

        if dry:
            print("    $ gh issue create --title " + _shquote(it["title"])
                  + " --body-file <tmp> " + " ".join(_shquote(a) for a in label_args + repo_args))
            continue

        with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8") as tf:
            tf.write(it["body"])
            body_path = tf.name
        cmd = ["gh", "issue", "create", "--title", it["title"],
               "--body-file", body_path] + label_args + repo_args
        rc = subprocess.run(cmd).returncode
        Path(body_path).unlink(missing_ok=True)
        if rc != 0:
            print(f"    ! gh returned {rc} for {it['id']} — stopping so you can inspect.",
                  file=sys.stderr)
            return rc
        created += 1
        if idx < len(issues) and args.sleep:
            time.sleep(args.sleep)

    if dry:
        print("\nDry run complete. Re-run with --create to create the issues.")
        print("Tip: start with a subset, e.g.  python3 create-issues.py --create --only T6")
    else:
        print(f"\nDone. Created {created} issues.")
    return 0


if __name__ == "__main__":
    sys.exit(main())