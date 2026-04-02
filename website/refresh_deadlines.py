from __future__ import annotations

import csv
import html
import json
import re
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


PROJECT_ROOT = Path(__file__).resolve().parent.parent
WEBSITE_ROOT = PROJECT_ROOT / "website"
DB_PATH = WEBSITE_ROOT / "db" / "conference_deadlines.json"
CSV_CANDIDATES = [
    PROJECT_ROOT / "cleaned" / "accepted_papers.csv",
    PROJECT_ROOT / "accepted_papers.csv",
]
USER_AGENT = "ConferenceDateTracker/1.0 (+local)"
REQUEST_TIMEOUT_SECONDS = 20

MONTH_LOOKUP = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}

DATE_PATTERN = re.compile(
    r"(?:(?:Mon|Monday|Tue|Tuesday|Wed|Wednesday|Thu|Thursday|Fri|Friday|Sat|Saturday|Sun|Sunday),?\s+)?"
    r"(?:(?P<month1>Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|"
    r"Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(?P<day1>\d{1,2})(?:st|nd|rd|th)?"
    r"(?:\s*,\s*|\s+)?(?P<year1>\d{4})?|"
    r"(?P<day2>\d{1,2})(?:st|nd|rd|th)?\s+"
    r"(?P<month2>Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|"
    r"Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:\s*,\s*|\s+)?(?P<year2>\d{4})?)",
    re.IGNORECASE,
)

STOP_LINE_TOKENS = [
    "camera-ready",
    "notification",
    "rebuttal",
    "conference",
    "workshop",
    "tutorial",
    "demo",
    "poster",
    "artifact",
    "banquet",
    "topics",
    "submission instructions",
    "submission guidelines",
    "contacts",
]

CONFERENCE_HINTS = {
    "CoNEXT": {
        "candidate_urls": [
            "https://conferences.sigcomm.org/co-next/{year}/#!/call-for-papers",
            "https://conferences.sigcomm.org/co-next/{year}/",
        ],
        "label_patterns": ["paper submission", "submission deadline", "abstract registration"],
    },
    "INFOCOM": {
        "candidate_urls": [
            "https://infocom{year}.ieee-infocom.org/call-papers",
            "https://infocom{year}.ieee-infocom.org/authors/call-papers-main-conference",
            "https://infocom{year}.ieee-infocom.org/",
        ],
        "label_patterns": ["paper submission", "submission deadline", "main conference paper submission", "full paper due"],
    },
    "MMSys": {
        "candidate_urls": [
            "https://{year}.acmmmsys.org/call-for-papers/",
            "https://www.acmmmsys.org/{year}/call-for-papers/",
        ],
        "label_patterns": ["paper submission", "submission deadline", "abstract registration", "submission"],
    },
    "MobiCom": {
        "candidate_urls": ["https://www.sigmobile.org/mobicom/{year}/cfp.html"],
        "label_patterns": ["paper submission", "submission deadline", "abstract registration"],
    },
    "MobiHoc": {
        "candidate_urls": [
            "https://www.sigmobile.org/mobihoc/{year}/cfp.html",
            "https://www.sigmobile.org/mobihoc/{year}/cfp/",
            "https://www.sigmobile.org/mobihoc/{year}/",
        ],
        "label_patterns": ["paper submission deadline", "paper submission", "submission deadline", "abstract registration", "paper registration"],
    },
    "MobiSys": {
        "candidate_urls": ["https://www.sigmobile.org/mobisys/{year}/call_for_papers/"],
        "label_patterns": ["paper submission", "submission deadline", "abstract registration"],
    },
    "NSDI": {
        "candidate_urls": ["https://www.usenix.org/conference/nsdi{yy}/call-for-papers"],
        "label_patterns": ["paper submissions", "paper submission", "abstract registrations", "full paper submissions"],
    },
    "PerCom": {
        "candidate_urls": [
            "https://www.percom.org/call-for-papers/",
            "https://percom.org/call-for-papers/",
            "https://percom{year}.org/call-for-papers/",
        ],
        "label_patterns": ["paper submission", "submission deadline", "abstract registration", "submission via edas"],
    },
    "SenSys": {
        "candidate_urls": ["https://sensys.acm.org/{year}/cfp.html", "https://sensys.acm.org/{year}/index.html"],
        "label_patterns": ["full paper submission", "paper submission", "abstract registration"],
    },
    "SIGCOMM": {
        "candidate_urls": ["https://conferences.sigcomm.org/sigcomm/{year}/cfp/"],
        "label_patterns": ["paper submission deadline", "paper submission", "abstract registration deadline"],
    },
    "SIGSPATIAL": {
        "candidate_urls": [
            "https://sigspatial{year}.sigspatial.org/research-submission.html",
            "https://sigspatial{year}.sigspatial.org/cfp/",
            "https://sigspatial{year}.sigspatial.org/",
        ],
        "label_patterns": ["paper submission", "submission deadline", "abstract registration"],
    },
    "SSRR": {
        "candidate_urls": [
            "https://www.ssrr{year}.org/contribute",
            "https://ssrr{year}.org/contribute",
        ],
        "label_patterns": ["full papers", "submission deadline", "paper submission", "extended abstracts"],
    },
    "UbiComp": {
        "candidate_urls": [
            "https://www.ubicomp.org/ubicomp-iswc-{year}/cfp/",
            "https://www.ubicomp.org/ubicomp-iswc-{year}/",
        ],
        "label_patterns": ["paper submission", "submission deadline", "abstract registration"],
    },
}


class RefreshError(RuntimeError):
    pass


@dataclass(frozen=True)
class DeadlineCandidate:
    conference: str
    deadline_iso: str
    label: str
    source_url: str
    edition_year: int
    source_kind: str = "official"


def discover_csv_path() -> Path:
    for candidate in CSV_CANDIDATES:
        if candidate.exists():
            return candidate
    raise RefreshError("Could not find accepted_papers.csv.")


def read_database() -> dict:
    if not DB_PATH.exists():
        return {
            "generated_at": "",
            "source_csv": str(discover_csv_path().relative_to(PROJECT_ROOT)),
            "conference_count": 0,
            "conferences": [],
            "failures": [],
        }
    return json.loads(DB_PATH.read_text())


def load_conference_inputs() -> list[dict]:
    csv_path = discover_csv_path()
    conferences: dict[str, set[int]] = {name: set() for name in CONFERENCE_HINTS}
    with csv_path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            conference = (row.get("conference") or "").strip()
            if conference not in conferences:
                continue
            try:
                year = int((row.get("year") or "").strip())
            except ValueError:
                continue
            conferences[conference].add(year)

    return [
        {
            "conference": conference,
            "years_in_csv": sorted(years),
        }
        for conference, years in sorted(conferences.items())
    ]


def fetch_text(url: str) -> str:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            charset = response.headers.get_content_charset() or "utf-8"
            return response.read().decode(charset, errors="replace")
    except HTTPError as exc:
        raise RefreshError(f"Request failed for {url} with HTTP {exc.code}.") from exc
    except URLError as exc:
        raise RefreshError(f"Request failed for {url}: {exc.reason}.") from exc


def strip_html(raw_html: str) -> str:
    text = re.sub(r"<(?:s|strike|del)\b[^>]*>[\s\S]*?</(?:s|strike|del)>", " ", raw_html, flags=re.IGNORECASE)
    text = re.sub(r"~~[\s\S]*?~~", " ", text)
    text = re.sub(r"<script[\s\S]*?</script>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</(p|div|section|article|tr|td|th|li|ul|ol|table|h1|h2|h3|h4|h5|h6)>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    text = re.sub(r"~~[\s\S]*?~~", " ", text)
    return "\n".join(
        line for line in (normalize_whitespace(part) for part in text.splitlines()) if line
    )


def normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def month_number(value: str) -> int:
    return MONTH_LOOKUP[value.lower().rstrip(".")]


def infer_year(source_url: str) -> int | None:
    match = re.search(r"(20\d{2})", source_url)
    return int(match.group(1)) if match else None


def parse_dates_from_text(text: str, fallback_year: int | None = None) -> list[str]:
    results: list[str] = []
    for match in DATE_PATTERN.finditer(text):
        month = match.group("month1") or match.group("month2")
        day = match.group("day1") or match.group("day2")
        year = match.group("year1") or match.group("year2")
        resolved_year = int(year) if year else fallback_year
        if not month or not day or not resolved_year:
            continue
        try:
            parsed = date(resolved_year, month_number(month), int(day))
        except ValueError:
            continue
        results.append(parsed.isoformat())
    return results


def title_case_words(value: str) -> str:
    return normalize_whitespace(value).lower().title()


def label_priority(label: str) -> int:
    priorities = [
        ("paper submission deadline", 6),
        ("paper submission", 5),
        ("full paper submission", 5),
        ("full papers", 4),
        ("submission deadline", 4),
        ("submission via edas", 4),
        ("extended abstracts", 3),
        ("paper registration", 2),
        ("abstract registration", 1),
    ]
    lowered = label.lower()
    for token, score in priorities:
        if token in lowered:
            return score
    return 0


def has_cycle_context(value: str) -> bool:
    normalized = normalize_whitespace(value)
    return bool(
        re.search(r"\bcycle\s+[a-z0-9ivx]+\b", normalized, re.IGNORECASE)
        or re.search(r"\bround\s+[a-z0-9ivx]+\b", normalized, re.IGNORECASE)
        or re.search(r"\b(?:spring|summer|fall|winter)\b", normalized, re.IGNORECASE)
        or re.search(r"\b(?:first|second|third|fourth|1st|2nd|3rd|4th|\d+(?:st|nd|rd|th))\s+(?:call|deadline|round|cycle)\b", normalized, re.IGNORECASE)
    )


def clean_context_line(value: str) -> str:
    trimmed = re.sub(r"[:|\-]\s*$", "", value)
    trimmed = re.sub(r"\s*\((?:expired|open|closed)\)\s*$", "", trimmed, flags=re.IGNORECASE)
    return normalize_whitespace(trimmed)


def find_cycle_context(lines: list[str], index: int) -> str:
    for pointer in range(index, max(-1, index - 9), -1):
        line = clean_context_line(lines[pointer])
        if line and has_cycle_context(line):
            return line
    return ""


def trim_to_stop_token(value: str) -> str:
    lowered = value.lower()
    cutoffs = [lowered.find(token) for token in STOP_LINE_TOKENS if lowered.find(token) > 0]
    return value[: min(cutoffs)] if cutoffs else value


def dedupe_dates(dates: Iterable[str]) -> list[str]:
    unique: list[str] = []
    for deadline_iso in dates:
        if deadline_iso not in unique:
            unique.append(deadline_iso)
    return unique


def collapse_inline_dates(dates: Iterable[str], context_value: str = "") -> list[str]:
    unique = dedupe_dates(dates)
    if len(unique) <= 1 or has_cycle_context(context_value):
        return unique
    return unique[-1:]


def extract_inline_dates(line: str, matched_label: str, fallback_year: int | None) -> list[str]:
    start_index = line.lower().find(matched_label.lower())
    if start_index < 0:
        return collapse_inline_dates(parse_dates_from_text(trim_to_stop_token(line), fallback_year), line)

    suffix_dates = parse_dates_from_text(trim_to_stop_token(line[start_index:]), fallback_year)
    if suffix_dates:
        return collapse_inline_dates(suffix_dates, line)

    prefix_dates = parse_dates_from_text(line[:start_index], fallback_year)
    return prefix_dates[-1:]


def collect_recent_cycle_headers(
    lines: list[str],
    index: int,
    compiled_patterns: list[re.Pattern],
    fallback_year: int | None,
) -> list[str]:
    headers: list[str] = []
    for pointer in range(max(0, index - 12), index):
        line = clean_context_line(lines[pointer])
        if not line:
            continue
        lowered = line.lower()
        if any(compiled.search(line) for compiled in compiled_patterns):
            continue
        if any(token in lowered for token in STOP_LINE_TOKENS):
            continue
        if parse_dates_from_text(line, fallback_year):
            continue
        if has_cycle_context(line) and line not in headers:
            headers.append(line)
    return headers[-4:]


def collect_lookahead_date_groups(
    lines: list[str],
    index: int,
    compiled_patterns: list[re.Pattern],
    fallback_year: int | None,
) -> list[tuple[str, list[str]]]:
    groups: list[tuple[str, list[str]]] = []
    for lookahead in lines[index + 1 : index + 6]:
        lowered = lookahead.lower()
        if any(compiled.search(lookahead) for compiled in compiled_patterns):
            break
        if any(token in lowered for token in STOP_LINE_TOKENS):
            break
        dates = collapse_inline_dates(parse_dates_from_text(trim_to_stop_token(lookahead), fallback_year), lookahead)
        if dates:
            groups.append((lookahead, dates))
    return groups


def choose_better_cycle(existing: dict | None, nxt: dict) -> dict:
    if existing is None:
        return nxt

    existing_has_context = has_cycle_context(existing["deadline_label"])
    next_has_context = has_cycle_context(nxt["deadline_label"])
    if existing_has_context != next_has_context:
        return nxt if next_has_context else existing

    existing_priority = label_priority(existing["deadline_label"])
    next_priority = label_priority(nxt["deadline_label"])
    if existing_priority != next_priority:
        return nxt if next_priority > existing_priority else existing

    return nxt if len(nxt["deadline_label"]) > len(existing["deadline_label"]) else existing


def normalize_submission_cycles(cycles: list[dict]) -> list[dict]:
    by_date: dict[str, dict] = {}
    for cycle in cycles:
        deadline_iso = cycle.get("deadline_iso")
        if not deadline_iso:
            continue
        normalized = {
            "deadline_iso": deadline_iso,
            "deadline_display": cycle.get("deadline_display") or format_display_date(deadline_iso),
            "deadline_label": cycle.get("deadline_label") or "Submission Deadline",
            "source_kind": cycle.get("source_kind") or "official",
            "source_url": cycle.get("source_url") or "",
            "edition_year": cycle.get("edition_year") or int(deadline_iso[:4]),
        }
        by_date[deadline_iso] = choose_better_cycle(by_date.get(deadline_iso), normalized)
    return sorted(by_date.values(), key=lambda cycle: (cycle["deadline_iso"], -label_priority(cycle["deadline_label"])))


def format_display_date(deadline_iso: str) -> str:
    parsed = datetime.strptime(deadline_iso, "%Y-%m-%d").date()
    return parsed.strftime("%B %d, %Y")


def normalize_conference_record(record: dict) -> dict:
    cycles = normalize_submission_cycles(record.get("submission_cycles") or [])
    latest_cycle = cycles[-1] if cycles else None
    return {
        "conference": record["conference"],
        "years_in_csv": record.get("years_in_csv") or [],
        "latest_tracked_edition": record.get("latest_tracked_edition") or (latest_cycle["edition_year"] if latest_cycle else None),
        "deadline_iso": latest_cycle["deadline_iso"] if latest_cycle else record.get("deadline_iso", ""),
        "deadline_display": latest_cycle["deadline_display"] if latest_cycle else record.get("deadline_display", ""),
        "deadline_label": latest_cycle["deadline_label"] if latest_cycle else record.get("deadline_label", ""),
        "source_kind": latest_cycle["source_kind"] if latest_cycle else record.get("source_kind", ""),
        "source_url": latest_cycle["source_url"] if latest_cycle else record.get("source_url", ""),
        "submission_cycles": cycles,
    }


def extract_from_official_page(conference: str, source_url: str, page_text: str, label_patterns: Iterable[str]) -> list[DeadlineCandidate]:
    candidates: dict[tuple[str, str], DeadlineCandidate] = {}
    fallback_year = infer_year(source_url)
    lines = [line.strip() for line in page_text.splitlines() if line.strip()]
    compiled_patterns = [re.compile(pattern, re.IGNORECASE) for pattern in label_patterns]

    for index, line in enumerate(lines):
        for pattern in compiled_patterns:
            match = pattern.search(line)
            if not match:
                continue

            cycle_context = find_cycle_context(lines, index)
            base_label = title_case_words(match.group(0))
            label = f"{cycle_context} - {base_label}" if cycle_context else base_label
            labeled_dates: list[tuple[str, list[str]]] = []
            inline_dates = extract_inline_dates(line, match.group(0), fallback_year)
            if inline_dates:
                labeled_dates.append((label, inline_dates))
            else:
                date_groups = collect_lookahead_date_groups(lines, index, compiled_patterns, fallback_year)
                cycle_headers = collect_recent_cycle_headers(lines, index, compiled_patterns, fallback_year)
                if date_groups and cycle_headers and len(cycle_headers) >= len(date_groups):
                    active_headers = cycle_headers[-len(date_groups) :]
                    labeled_dates.extend(
                        (f"{header} - {base_label}", dates) for header, (_, dates) in zip(active_headers, date_groups)
                    )
                if not labeled_dates:
                    collected_dates = [deadline_iso for _, dates in date_groups for deadline_iso in dates]
                    if collected_dates:
                        labeled_dates.append((label, collapse_inline_dates(collected_dates, line)))

            for candidate_label, deadline_dates in labeled_dates:
                for deadline_iso in deadline_dates:
                    candidate = DeadlineCandidate(
                        conference=conference,
                        deadline_iso=deadline_iso,
                        label=candidate_label,
                        source_url=source_url,
                        edition_year=fallback_year or int(deadline_iso[:4]),
                    )
                    candidates[(deadline_iso, candidate_label)] = candidate

    if conference == "MobiHoc":
        candidates = {
            key: candidate
            for key, candidate in candidates.items()
            if "registration" not in candidate.label.lower()
        }

    return sorted(candidates.values(), key=lambda candidate: (candidate.deadline_iso, label_priority(candidate.label)))


def build_years_to_try(years_in_csv: list[int]) -> list[int]:
    current_year = datetime.now().year
    latest_csv_year = max(years_in_csv) if years_in_csv else current_year
    return sorted(
        {current_year + 1, current_year, latest_csv_year + 1, latest_csv_year, latest_csv_year - 1},
        reverse=True,
    )


def apply_url_template(template: str, year: int) -> str:
    return template.replace("{year}", str(year)).replace("{yy}", str(year)[-2:])


def infer_target_edition_year(conference_info: dict) -> int:
    current_year = datetime.now().year
    years = conference_info.get("years_in_csv") or []
    latest_csv_year = max(years) if years else current_year
    return max(current_year, latest_csv_year)


def build_ubicomp_recurring_candidates(conference_info: dict, edition_year: int) -> list[DeadlineCandidate]:
    source_url = f"https://www.ubicomp.org/ubicomp-iswc-{edition_year}/"
    return [
        DeadlineCandidate(conference_info["conference"], f"{edition_year - 1}-11-01", "IMWUT November Cycle - Paper Submission", source_url, edition_year, "official-pattern"),
        DeadlineCandidate(conference_info["conference"], f"{edition_year}-02-01", "IMWUT February Cycle - Paper Submission", source_url, edition_year, "official-pattern"),
        DeadlineCandidate(conference_info["conference"], f"{edition_year}-05-01", "IMWUT May Cycle - Paper Submission", source_url, edition_year, "official-pattern"),
    ]


def build_conference_record(conference_info: dict, candidates: list[DeadlineCandidate]) -> dict:
    target_edition_year = max(candidate.edition_year for candidate in candidates)
    edition_candidates = [candidate for candidate in candidates if candidate.edition_year == target_edition_year]
    substantive = [candidate for candidate in edition_candidates if "abstract registration" not in candidate.label.lower()]
    if substantive:
        edition_candidates = substantive

    record = {
        "conference": conference_info["conference"],
        "years_in_csv": conference_info.get("years_in_csv") or [],
        "latest_tracked_edition": target_edition_year,
        "submission_cycles": [
            {
                "deadline_iso": candidate.deadline_iso,
                "deadline_display": format_display_date(candidate.deadline_iso),
                "deadline_label": candidate.label,
                "source_kind": candidate.source_kind,
                "source_url": candidate.source_url,
                "edition_year": candidate.edition_year,
            }
            for candidate in edition_candidates
        ],
    }
    return normalize_conference_record(record)


def official_candidates_for(conference_info: dict) -> list[DeadlineCandidate]:
    conference = conference_info["conference"]
    hints = CONFERENCE_HINTS.get(conference)
    if not hints:
        raise RefreshError(f"No refresh rules configured for {conference}.")

    candidates: list[DeadlineCandidate] = []
    years_to_try = build_years_to_try(conference_info.get("years_in_csv") or [])
    for template in hints["candidate_urls"]:
        for year in years_to_try:
            source_url = apply_url_template(template, year)
            try:
                raw_page = fetch_text(source_url)
                page_text = strip_html(raw_page)
                candidates.extend(
                    extract_from_official_page(conference, source_url, page_text, hints["label_patterns"])
                )
            except RefreshError:
                continue

    if conference == "UbiComp":
        target_edition_year = infer_target_edition_year(conference_info)
        current_candidates = [candidate for candidate in candidates if candidate.edition_year == target_edition_year]
        if len(current_candidates) < 2:
            return build_ubicomp_recurring_candidates(conference_info, target_edition_year)

    if not candidates:
        raise RefreshError(f"No deadline candidate found from official CFP pages for {conference}.")

    return candidates


def refresh_database(conference: str | None = None) -> dict:
    current = read_database()
    inputs = load_conference_inputs()
    by_conference = {record["conference"]: record for record in current.get("conferences") or []}
    failures = {
        failure["conference"]: failure["error"]
        for failure in (current.get("failures") or [])
        if failure.get("conference")
    }

    selected_inputs = [item for item in inputs if item["conference"] == conference] if conference else inputs
    if conference and not selected_inputs:
        raise RefreshError(f"Conference {conference} is not configured.")

    for conference_info in selected_inputs:
        try:
            by_conference[conference_info["conference"]] = build_conference_record(
                conference_info,
                official_candidates_for(conference_info),
            )
            failures.pop(conference_info["conference"], None)
        except RefreshError as exc:
            failures[conference_info["conference"]] = str(exc)

    conferences = [
        normalize_conference_record(
            by_conference.get(
                item["conference"],
                {
                    "conference": item["conference"],
                    "years_in_csv": item.get("years_in_csv") or [],
                    "latest_tracked_edition": None,
                    "deadline_iso": "",
                    "deadline_display": "",
                    "deadline_label": "",
                    "source_kind": "",
                    "source_url": "",
                    "submission_cycles": [],
                },
            )
        )
        for item in inputs
    ]

    payload = {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source_csv": str(discover_csv_path().relative_to(PROJECT_ROOT)),
        "conference_count": len(conferences),
        "conferences": sorted(conferences, key=lambda record: record["conference"]),
        "failures": [
            {"conference": name, "error": error}
            for name, error in sorted(failures.items())
        ],
    }
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    DB_PATH.write_text(json.dumps(payload, indent=2) + "\n")
    return payload


def main() -> int:
    refresh_database()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
