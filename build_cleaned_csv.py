#!/usr/bin/env python3

from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = ROOT / "cleaned"
OUTPUT_FILE = OUTPUT_DIR / "accepted_papers.csv"


CONFERENCE_NAMES = {
    "conext": "CoNEXT",
    "infocom": "INFOCOM",
    "mobicom": "MobiCom",
    "mobihoc": "MobiHoc",
    "mobisys": "MobiSys",
    "mmsys": "MMSys",
    "nsdi": "NSDI",
    "percom": "PerCom",
    "sigchi": "SIGCHI",
    "sigspatial": "SIGSPATIAL",
    "sensys": "SenSys",
    "sigcomm": "SIGCOMM",
    "ssrr": "SSRR",
    "ubicomp": "UbiComp",
}


KNOWN_AWARDS = sorted(
    [
        "Best Artifact Award - Honorable Mention",
        "Best Artifact Award - Runner Up",
        "Best Paper Award Runner-Up",
        "Best Community Contributions Award #2",
        "Best Community Contributions Award #1",
        "Best Artifact Award",
        "Best Paper Award #2",
        "Best Paper Award #1",
        "Best Paper Nominee",
        "Best Paper Award",
        "Best Artifact",
        "Best Paper",
    ],
    key=len,
    reverse=True,
)


@dataclass
class PaperRecord:
    conference: str
    year: int
    source_file: str
    section: str
    paper_type: str
    title: str
    authors: str
    award: str
    tags: str


def normalize_text(value: str) -> str:
    value = value.replace("\ufeff", "").replace("\u200b", "").replace("\xa0", " ")
    value = value.replace("’", "'").replace("–", "-").replace("—", "-")
    value = re.sub(r",(?=\S)", ", ", value)
    value = re.sub(r";(?=\S)", "; ", value)
    value = re.sub(r"(?<=\w)\(", " (", value)
    value = re.sub(r"\)(?=\w)", ") ", value)
    value = re.sub(r"\s+", " ", value.strip())
    return value


def load_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def titlecase_conference(source_file: str) -> tuple[str, int]:
    match = re.fullmatch(r"([a-z]+)(\d{4})\.txt", source_file)
    if not match:
        raise ValueError(f"Unexpected file name: {source_file}")
    prefix, year = match.groups()
    return CONFERENCE_NAMES[prefix], int(year)


def looks_like_author_line(line: str) -> bool:
    lower = line.lower()
    if line.startswith("Authors:"):
        return True
    if line.endswith(":"):
        return False
    if looks_like_metadata_line(line):
        return False
    if any(marker in line for marker in ("Session Chair:", "Proceedings of", "Accepted Papers", "Welcome Reception", "Opening Remarks", "Keynote")):
        return False
    if lower.startswith(("speaker:", "keynote speaker:", "video:")):
        return False
    if line.startswith("10.1145/"):
        return False

    title_stopwords = {
        "a",
        "an",
        "and",
        "as",
        "at",
        "by",
        "for",
        "from",
        "in",
        "into",
        "of",
        "on",
        "or",
        "the",
        "to",
        "under",
        "using",
        "via",
        "with",
    }
    metadata_tokens = {
        "about",
        "accepted",
        "activities",
        "artifacts",
        "attend",
        "awards",
        "ballroom",
        "banquet",
        "boardroom",
        "break",
        "centre",
        "center",
        "chair",
        "chairs",
        "closing",
        "coffee",
        "conduct",
        "continental",
        "demo",
        "demonstrations",
        "details",
        "dinner",
        "doctoral",
        "foyer",
        "grant",
        "hall",
        "hide",
        "hotel",
        "information",
        "keynote",
        "liberty",
        "lunch",
        "media",
        "opening",
        "opportunities",
        "participate",
        "poster",
        "posters",
        "presentation",
        "presentations",
        "presented",
        "program",
        "questions",
        "registration",
        "room",
        "saturday",
        "session",
        "sessions",
        "show",
        "speaker",
        "sponsor",
        "sponsors",
        "student",
        "symposium",
        "technical",
        "theatre",
        "track",
        "tracks",
        "travel",
        "venue",
        "welcome",
        "workshop",
        "workshops",
    }
    name_particles = {"al", "ben", "bin", "da", "de", "del", "der", "di", "du", "el", "la", "le", "mc", "van", "von"}

    def words(value: str) -> list[str]:
        return re.findall(r"[A-Za-zÀ-ÖØ-öø-ÿ0-9'.-]+", value)

    def is_name_token(token: str) -> bool:
        if re.fullmatch(r"[A-Z]\.", token):
            return True
        if token.lower() in name_particles:
            return True
        if token.isupper() and token.isalpha() and len(token) <= 5:
            return True
        return bool(re.fullmatch(r"[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’. -]*", token))

    def looks_like_plain_name_sequence(value: str) -> bool:
        if any(char.isdigit() for char in value) or ":" in value or "http" in value.lower():
            return False
        tokens = words(value)
        if len(tokens) < 2 or len(tokens) > 20:
            return False
        lowered = [token.lower().strip(".") for token in tokens]
        if any(token in title_stopwords or token in metadata_tokens for token in lowered):
            return False
        return all(is_name_token(token) for token in tokens)

    if "(" in line and ")" in line:
        prefix = line.split("(", 1)[0].strip(" ,;")
        if looks_like_plain_name_sequence(prefix):
            return True

    if ";" in line:
        first_chunk = line.split(";", 1)[0].strip()
        if looks_like_plain_name_sequence(first_chunk) or "(" in first_chunk:
            return True

    if "," in line:
        first_chunk = line.split(",", 1)[0].strip()
        if looks_like_plain_name_sequence(first_chunk) or "(" in first_chunk:
            return True

    return looks_like_plain_name_sequence(line)


def looks_like_metadata_line(line: str) -> bool:
    lower = line.lower()
    return bool(
        not line
        or lower in {
            "accepted papers",
            "accepted contributions",
            "presented papers",
            "research tracks",
            "full papers:",
            "short papers:",
            "full length papers",
            "short papers",
            "short-paper",
            "available media",
            "hide details ▾",
            "show details ▸",
            "attend",
            "program",
            "activities",
            "participate",
            "sponsors",
            "about",
            "registration information",
            "registration discounts",
            "grant opportunities",
            "venue, hotel, and travel",
            "technical sessions",
            "spring accepted papers",
            "fall accepted papers",
            "poster session and reception",
            "call for papers",
            "call for posters",
            "call for artifacts",
            "instructions for presenters",
            "sponsor and exhibitor information",
            "sponsor and exhibitor services",
            "symposium organizers",
            "conference policies",
            "code of conduct",
            "questions",
        }
        or line.startswith("Chair:")
        or line.startswith("Session Chair:")
        or line.startswith("Session Chairs:")
        or line.startswith("Keynote:")
        or line.startswith("Program Co-Chairs:")
        or line.startswith("DOI:")
        or line.startswith("Video:")
        or line.startswith("Tweets by ")
        or line.startswith("PerCom ")
        or line.startswith("Previous ")
        or line.startswith("ACM Artifacts Available")
        or line.startswith("ACM Artifacts Evaluated")
        or line.startswith("ACM Results Reproduced")
        or line.startswith("Awarded Outstanding Paper")
        or lower.startswith("track ")
        or lower.startswith("session ")
        or lower.startswith("accepted papers")
        or lower.startswith("list of accepted papers")
        or lower.startswith("presented papers")
        or lower.endswith("accepted papers")
        or lower.startswith("proceedings of")
        or lower.startswith("more than words:")
        or lower.startswith("if you notice any mistakes")
        or lower.startswith("each presentation will")
        or re.match(r"^\d{1,2}:\d{2}", line)
        or re.match(r"^#\d+:", line)
        or re.match(r"^#\d+$", line)
        or re.match(r"^[A-Z]\d+\b", line)
        or re.match(r"^Day \d+$", line)
        or re.match(r"^\d+\s+papers?$", lower)
        or re.match(r"^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b", line)
        or re.match(r"^[A-Za-z]+,\s+\d{1,2}\s+[A-Za-z]+\s+\d{4}$", line)
        or re.match(r"^\d{2,}$", line)
        or re.match(r"^10\.1145/\d+$", line)
        or re.match(r"^\d{4}/\d+$", line)
        or (re.search(r"\b(Ballroom|Foyer|Theatre|Center|Centre|Boardroom)\b", line) and len(line.split()) <= 6)
    )


def looks_like_title_line(line: str) -> bool:
    if looks_like_metadata_line(line):
        return False
    if line.endswith(":") and len(line.split()) <= 8:
        return False
    return not looks_like_author_line(line)


def base_record(source_file: str, section: str, title: str, authors: str, paper_type: str = "paper", award: str = "") -> dict:
    conference, year = titlecase_conference(source_file)
    return {
        "conference": conference,
        "year": year,
        "source_file": source_file,
        "section": normalize_text(section),
        "paper_type": normalize_text(paper_type),
        "title": normalize_text(title),
        "authors": normalize_text(authors),
        "award": normalize_text(award),
    }


def parse_pair_list(
    text: str,
    source_file: str,
    *,
    default_section: str = "",
    section_resolver=None,
    skip_line=None,
    stop_line=None,
) -> list[dict]:
    records: list[dict] = []
    section = default_section
    current_title: str | None = None

    for raw_line in text.splitlines():
        line = normalize_text(raw_line)
        if not line:
            continue
        if stop_line and stop_line(line):
            current_title = None
            break

        next_section = section_resolver(line) if section_resolver else None
        if next_section is not None:
            section = next_section
            current_title = None
            continue

        if skip_line and skip_line(line):
            current_title = None
            continue

        if current_title is None:
            current_title = line
            continue

        if looks_like_author_line(line):
            authors = line[len("Authors:") :].strip() if line.startswith("Authors:") else line
            records.append(base_record(source_file, section, current_title, authors))
            current_title = None
            continue

        current_title = line

    return records


def parse_title_then_author_pairs(text: str, source_file: str, *, default_section: str = "") -> list[dict]:
    records: list[dict] = []
    lines = [normalize_text(raw_line) for raw_line in text.splitlines()]
    section = default_section
    current_title: str | None = None

    for line in lines:
        if not line or looks_like_metadata_line(line):
            continue
        if line.endswith(":") and len(line.split()) <= 10 and not looks_like_author_line(line):
            section = line.rstrip(":")
            current_title = None
            continue
        if current_title is None and looks_like_title_line(line):
            current_title = line
            continue
        if current_title and looks_like_author_line(line):
            authors = line[len("Authors:") :].strip() if line.startswith("Authors:") else line
            records.append(base_record(source_file, section, current_title, authors))
            current_title = None
            continue
        if looks_like_title_line(line):
            current_title = line

    return records


def parse_adjacent_title_author_pairs(
    text: str,
    source_file: str,
    *,
    default_section: str = "",
    section_resolver=None,
    skip_line=None,
    title_transform=None,
    author_transform=None,
    paper_type_resolver=None,
) -> list[dict]:
    records: list[dict] = []
    lines = [normalize_text(raw_line) for raw_line in text.splitlines()]
    section = default_section
    index = 0

    while index < len(lines):
        line = lines[index]
        if not line:
            index += 1
            continue

        next_section = section_resolver(line) if section_resolver else None
        if next_section is not None:
            section = next_section
            index += 1
            continue

        if looks_like_metadata_line(line) or (skip_line and skip_line(line)):
            index += 1
            continue

        next_index = index + 1
        while next_index < len(lines) and not lines[next_index]:
            next_index += 1

        if next_index >= len(lines):
            break

        next_line = lines[next_index]
        next_section = section_resolver(next_line) if section_resolver else None
        if next_section is not None:
            section = next_section
            index = next_index + 1
            continue

        if looks_like_title_line(line) and looks_like_author_line(next_line):
            title = title_transform(line) if title_transform else line
            authors = author_transform(next_line) if author_transform else next_line
            paper_type = paper_type_resolver(line, next_line) if paper_type_resolver else "paper"
            if title and authors:
                records.append(base_record(source_file, section, title, authors, paper_type=paper_type))
            index = next_index + 1
            continue

        index += 1

    return records


def split_inline_title_author_pair(line: str) -> tuple[str, str] | None:
    for match in re.finditer(r"\b[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’.-]+(?: [A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’.-]+){1,4},", line):
        title = line[: match.start()].strip(" -")
        authors = line[match.start() :].strip()
        if len(title.split()) < 4:
            continue
        if looks_like_title_line(title) and looks_like_author_line(authors):
            return title, authors
    return None


def parse_author_then_title_pairs(text: str, source_file: str, *, default_section: str = "") -> list[dict]:
    records: list[dict] = []
    lines = [normalize_text(raw_line) for raw_line in text.splitlines()]
    section = default_section
    pending_authors: str | None = None

    for line in lines:
        if not line or looks_like_metadata_line(line):
            continue
        if line.endswith(":") and len(line.split()) <= 10 and not looks_like_author_line(line):
            section = line.rstrip(":")
            pending_authors = None
            continue
        if pending_authors is None and looks_like_author_line(line):
            pending_authors = line[len("Authors:") :].strip() if line.startswith("Authors:") else line
            continue
        if pending_authors and looks_like_title_line(line):
            records.append(base_record(source_file, section, line, pending_authors))
            pending_authors = None

    return records


def parse_numbered_title_author_pairs(text: str, source_file: str, *, default_section: str = "") -> list[dict]:
    records: list[dict] = []
    section = default_section
    current_title: str | None = None

    for raw_line in text.splitlines():
        line = normalize_text(raw_line)
        if line.startswith("Session ") and ":" in line and not line.startswith("Session Chair:"):
            section = line
            current_title = None
            continue
        line = re.sub(r"^\d+\.\s*", "", line)
        line = re.sub(r"^#\d+:\s*", "", line)
        line = re.sub(r"^#\d+\s*", "", line)
        if not line or looks_like_metadata_line(line):
            continue
        if current_title is None and looks_like_title_line(line):
            current_title = line
            continue
        if current_title and looks_like_author_line(line):
            records.append(base_record(source_file, section, current_title, line))
            current_title = None

    return records


def parse_mobicom2023(text: str, source_file: str) -> list[dict]:
    return parse_pair_list(
        text,
        source_file,
        section_resolver=lambda line: line if line in {"Summer Round", "Winter Round"} else None,
    )


def parse_mobicom2024(text: str, source_file: str) -> list[dict]:
    def is_session(line: str) -> str | None:
        return line if re.match(r"^Session \d+:", line) else None

    def is_skip(line: str) -> bool:
        return bool(
            re.match(r"^(Monday|Tuesday|Wednesday|Thursday|Friday),", line)
            or re.match(r"^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$", line)
            or line.startswith("Session Chair:")
            or line.startswith("Keynote")
            or line.startswith("Welcome Reception")
            or line.startswith("Opening Remarks")
            or line.startswith("Test-of-Time Award Talk")
            or line.startswith("Paper:")
            or line.startswith("Rockstar Award Talk:")
            or line == "Posters & Demos"
            or line == "N2Women Dinner Meeting"
            or line == "Social Events & Banquet"
            or line == "Closing Remarks"
            or line.startswith("Room:")
            or line == "MobiJob"
            or line == "SIGMOBILE Business Meeting"
            or line == "NSF Industry University Cooperative Research Center (IUCRC) Program:"
            or "Program Director" in line
            or line.startswith("by ")
            or (line.startswith("(") and line.endswith(")"))
        )

    return parse_pair_list(text, source_file, section_resolver=is_session, skip_line=is_skip)


def parse_mobicom2025(text: str, source_file: str) -> list[dict]:
    return parse_pair_list(
        text,
        source_file,
        section_resolver=lambda line: line.replace("Accepted Papers in ", "") if line.startswith("Accepted Papers in ") else None,
    )


def parse_mobisys2023(text: str, source_file: str) -> list[dict]:
    def is_skip(line: str) -> bool:
        return (
            line == "Accepted Papers"
            or line.startswith("DOI:")
            or "Artifacts available" in line
            or "Artifacts evaluated" in line
            or "Results replicated" in line
        )

    return parse_pair_list(text, source_file, skip_line=is_skip)


def parse_mobisys2024(text: str, source_file: str) -> list[dict]:
    return parse_pair_list(text, source_file, skip_line=lambda line: line == "Accepted Papers")


def parse_mobisys2025(text: str, source_file: str) -> list[dict]:
    return parse_pair_list(
        text,
        source_file,
        skip_line=lambda line: line == "Accepted Papers" or line == "Teaser",
    )


def parse_mobihoc(text: str, source_file: str) -> list[dict]:
    return parse_pair_list(text, source_file, skip_line=lambda line: line == "Accepted Papers")


def parse_sensys2023(text: str, source_file: str) -> list[dict]:
    return parse_sensys_proceedings(text, source_file)


def parse_sensys2024(text: str, source_file: str) -> list[dict]:
    return parse_sensys_proceedings(text, source_file)


def parse_sensys2025(text: str, source_file: str) -> list[dict]:
    return parse_sensys_proceedings(text, source_file)


def parse_sensys_proceedings(text: str, source_file: str) -> list[dict]:
    records: list[dict] = []
    section = ""
    pending_authors: str | None = None

    for raw_line in text.splitlines():
        line = normalize_text(raw_line)
        if not line:
            continue
        if line.startswith("Proceedings of"):
            pending_authors = None
            continue
        if line.startswith("since 2018, dblp has been operated and maintained by") or line.startswith("Schloss Dagstuhl - Leibniz Center for Informatics"):
            break
        if line.endswith(":") and ("," in line or " and " in line):
            pending_authors = line[:-1]
            continue
        if pending_authors is not None:
            title = re.sub(r"\.\s*\d+-\d+$", "", line).strip()
            if not (title.startswith("Poster") or title.startswith("Demo")):
                records.append(base_record(source_file, section, title, pending_authors))
            pending_authors = None
            continue
        if re.search(r"\.\s*\d+-\d+$", line):
            continue
        section = line

    return records


def parse_sigcomm2023(text: str, source_file: str) -> list[dict]:
    return parse_pair_list(
        text,
        source_file,
        stop_line=lambda line: line == "ACM SIGCOMM 2023",
    )


def parse_sigcomm2024(text: str, source_file: str) -> list[dict]:
    records = parse_pair_list(text, source_file)
    for record in records:
        if record["title"].endswith(" Research Track"):
            record["title"] = record["title"][: -len(" Research Track")]
            record["section"] = "Research Track"
        elif record["title"].endswith(" Experience Track"):
            record["title"] = record["title"][: -len(" Experience Track")]
            record["section"] = "Experience Track"
    return records


def parse_sigcomm2025(text: str, source_file: str) -> list[dict]:
    return parse_pair_list(
        text,
        source_file,
        section_resolver=lambda line: line if line in {"Full papers", "Short papers"} else None,
    )


def parse_ssrr2023(text: str, source_file: str) -> list[dict]:
    flattened = normalize_text(text)
    flattened = flattened.replace("TABLE OF CONTENTS", "", 1).strip()
    flattened = re.sub(r"\.{5,}\s*(\d+)", r"..... \1\n", flattened)
    lines = [line.strip() for line in flattened.splitlines() if line.strip()]

    if not lines:
        return []

    records: list[dict] = []
    current_title_block = lines[0]

    for line in lines[1:]:
        split_at = split_ssrr_author_title_block(line)
        if split_at is None:
            continue
        authors = line[:split_at]
        next_title_block = line[split_at:]

        title = re.sub(r"\s*\.{5,}\s*\d+\s*$", "", current_title_block).strip()
        if title and title != "Author Index":
            records.append(base_record(source_file, "", title, authors))

        current_title_block = next_title_block

    return records


def split_ssrr_author_title_block(line: str) -> int | None:
    candidates = [match.start() for match in re.finditer(r"(?<=[a-zà-öø-ÿ])(?=[A-Z])", line)]
    if not candidates:
        return None

    title_stopwords = {
        "a",
        "an",
        "and",
        "against",
        "as",
        "at",
        "by",
        "during",
        "for",
        "from",
        "in",
        "into",
        "of",
        "on",
        "report",
        "through",
        "to",
        "towards",
        "under",
        "using",
        "via",
        "what",
        "with",
        "without",
    }

    def words(value: str) -> list[str]:
        return re.findall(r"[A-Za-zÀ-ÖØ-öø-ÿ0-9°'-]+", value)

    def count_stopwords(value: str) -> int:
        return sum(token.lower() in title_stopwords for token in words(value))

    best_pos: int | None = None
    best_score: float | None = None

    for candidate in candidates:
        prefix = line[:candidate]
        suffix = line[candidate:]
        prefix_tail = prefix.split(",")[-1]
        prefix_tail_words = words(prefix_tail)
        suffix_words = words(suffix)
        first_suffix_word = suffix_words[0] if suffix_words else ""
        first_word_has_camel = bool(re.search(r"[a-zà-öø-ÿ][A-Z]", first_suffix_word))

        score = 0.0
        score += prefix.count(",") * 4.0
        score -= count_stopwords(prefix) * 3.0
        score -= max(0, len(prefix_tail_words) - 4) * 4.0
        score += count_stopwords(suffix) * 3.0
        score += min(len(suffix_words), 15) * 0.2
        score += 2.0 if ":" in suffix else 0.0
        score -= suffix.count(",") * 1.5
        score -= 6.0 if len(suffix_words) < 3 else 0.0
        score -= 6.0 if first_word_has_camel else 0.0

        if best_score is None or score > best_score:
            best_score = score
            best_pos = candidate

    return best_pos


def parse_ssrr2024(text: str, source_file: str) -> list[dict]:
    rows = combine_tabular_rows(text, r"^\d+(?:\s+\(Award\))?\t")
    records: list[dict] = []

    for row in rows:
        session, paper_no, title, authors = row.split("\t", 3)
        award = "Award session" if "Award" in session else ""
        records.append(base_record(source_file, session, title, authors, award=award))

    return records


def parse_ssrr2025(text: str, source_file: str) -> list[dict]:
    rows = combine_tabular_rows(text, r"^\d+\t")
    records: list[dict] = []

    for row in rows:
        session, number, authors, affiliation, title = row.split("\t", 4)
        award = "Award" if "🏆" in number else ""
        records.append(base_record(source_file, session, title, authors, award=award))

    return records


def parse_percom(text: str, source_file: str) -> list[dict]:
    year = titlecase_conference(source_file)[1]
    if year == 2023:
        return parse_author_then_title_pairs(text, source_file)
    if year == 2026:
        records: list[dict] = []
        for raw_line in text.splitlines():
            line = normalize_text(raw_line)
            if not line or looks_like_metadata_line(line) or "\t" not in raw_line:
                continue
            title, authors = [normalize_text(part) for part in raw_line.split("\t", 1)]
            if title == "TITLE" or not title or not authors:
                continue
            records.append(base_record(source_file, "", title, authors))
        return records
    return parse_title_then_author_pairs(text, source_file)


def parse_nsdi(text: str, source_file: str) -> list[dict]:
    def is_section(line: str) -> str | None:
        if line.startswith("Track ") or (line.endswith("Accepted Papers") and len(line.split()) <= 4):
            return line
        if any(token in line for token in ("Data ", "Verification", "Cloud", "Security", "Storage", "Networking", "Diagnosis", "Memory", "Scheduling")) and len(line.split()) <= 8 and ":" not in line:
            return line
        return None

    def is_skip(line: str) -> bool:
        return bool(
            line.startswith("Program Co-Chairs:")
            or line.startswith("Session Chair:")
            or line in {"Opening Remarks and Awards", "Continental Breakfast", "Coffee and Tea Break"}
        )

    return parse_adjacent_title_author_pairs(text, source_file, section_resolver=is_section, skip_line=is_skip)


def parse_infocom(text: str, source_file: str) -> list[dict]:
    return parse_numbered_title_author_pairs(text, source_file)


def parse_mmsys2024(text: str, source_file: str) -> list[dict]:
    records: list[dict] = []
    section = ""
    for raw_line in text.splitlines():
        line = normalize_text(raw_line)
        if not line:
            continue
        if not line.startswith("#"):
            if line.endswith("Track") or line.endswith("Challenge"):
                section = line
            continue
        match = re.match(r'^#\d+:\s+(.+?),\s+"(.+)"$', line)
        if not match:
            continue
        authors, title = match.groups()
        records.append(base_record(source_file, section, title, authors))
    return records


def parse_mmsys2025(text: str, source_file: str) -> list[dict]:
    records: list[dict] = []
    lines = [normalize_text(raw_line) for raw_line in text.splitlines()]
    section = ""
    index = 0

    def is_section(line: str) -> str | None:
        if line.startswith("MMVE Session ") or line.startswith("MMSys Research Track Session "):
            return line
        if line in {"Doctoral Symposium Posters", "Technical Demos", "Open Source and Dataset Posters"}:
            return line
        return None

    while index < len(lines):
        line = lines[index]
        if not line or looks_like_metadata_line(line) or line.startswith("Session Chair:"):
            index += 1
            continue

        next_section = is_section(line)
        if next_section is not None:
            section = next_section
            index += 1
            continue

        inline_pair = split_inline_title_author_pair(line)
        if inline_pair:
            title, authors = inline_pair
            records.append(base_record(source_file, section, title, authors))
            index += 1
            continue

        next_index = index + 1
        while next_index < len(lines) and not lines[next_index]:
            next_index += 1
        if next_index >= len(lines):
            break

        next_line = lines[next_index]
        next_section = is_section(next_line)
        if next_section is not None:
            section = next_section
            index = next_index + 1
            continue

        if looks_like_title_line(line) and looks_like_author_line(next_line):
            records.append(base_record(source_file, section, line, next_line))
            index = next_index + 1
            continue

        index += 1

    return records


def parse_mmsys(text: str, source_file: str) -> list[dict]:
    year = titlecase_conference(source_file)[1]
    if year == 2024:
        return parse_mmsys2024(text, source_file)
    if year == 2025:
        return parse_mmsys2025(text, source_file)
    return parse_numbered_title_author_pairs(text, source_file)


def parse_conext(text: str, source_file: str) -> list[dict]:
    year = titlecase_conference(source_file)[1]

    def is_section(line: str) -> str | None:
        if re.search(r"Session \d+:", line):
            return re.sub(r"^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*", "", line).strip()
        return None

    def is_skip(line: str) -> bool:
        return bool(
            line.startswith("Session chair:")
            or line.startswith("Speaker:")
            or line.startswith("Keynote Speaker:")
            or "Location:" in line
            or line.startswith("Thursday ")
            or line.startswith("Wednesday ")
            or line.startswith("Tuesday ")
            or line.startswith("Monday ")
            or line.startswith("Friday ")
            or line.startswith("Saturday ")
            or line.startswith("Sunday ")
            or line.startswith("ACM Artifacts ")
        )

    if year >= 2024:
        records = parse_adjacent_title_author_pairs(text, source_file, section_resolver=is_section, skip_line=is_skip)
    else:
        records = parse_title_then_author_pairs(text, source_file)

    for record in records:
        for field in ("title", "authors"):
            for suffix in (" Short", " Long"):
                if not record[field].endswith(suffix):
                    continue
                record["paper_type"] = suffix.strip().lower()
                record[field] = record[field][: -len(suffix)].strip()
                break
            if record["paper_type"] != "paper":
                break
        for suffix in (" Short", " Long"):
            if record["title"].endswith(suffix):
                record["paper_type"] = suffix.strip().lower()
                record["title"] = record["title"][: -len(suffix)].strip()
    return records


def parse_sigspatial(text: str, source_file: str) -> list[dict]:
    return parse_title_then_author_pairs(text, source_file)


def clean_ubicomp_author_line(line: str) -> str:
    cleaned = line.replace("Author Picture", "")
    cleaned = re.sub(r",?\s*\+\s*\d+\s*$", "", cleaned)
    return normalize_text(cleaned)


def parse_ubicomp2023(text: str, source_file: str) -> list[dict]:
    records: list[dict] = []
    lines = [normalize_text(raw_line) for raw_line in text.splitlines()]
    section = ""
    index = 0

    while index < len(lines):
        line = lines[index]
        if not line:
            index += 1
            continue
        if line.startswith("SESSION:"):
            section = line.split(":", 1)[1].strip()
            index += 1
            continue
        if line != "short-paper":
            index += 1
            continue
        if index + 2 >= len(lines):
            break
        title = lines[index + 1]
        authors = clean_ubicomp_author_line(lines[index + 2])
        if title and authors:
            records.append(base_record(source_file, section, title, authors, paper_type="short"))
        index += 3

    return records


def parse_ubicomp2024(text: str, source_file: str) -> list[dict]:
    return parse_adjacent_title_author_pairs(
        text,
        source_file,
        section_resolver=lambda line: line.split(":", 1)[1].strip() if line.startswith("SESSION:") else None,
    )


def parse_ubicomp2025(text: str, source_file: str) -> list[dict]:
    def is_section(line: str) -> str | None:
        if re.match(r"^[A-Z]\d+\s+.+\([A-Za-z]+\)$", line):
            return line
        return None

    return parse_adjacent_title_author_pairs(
        text,
        source_file,
        section_resolver=is_section,
        skip_line=lambda line: line.startswith("Chair:") or line.startswith("Video:"),
    )


def parse_ubicomp(text: str, source_file: str) -> list[dict]:
    year = titlecase_conference(source_file)[1]
    if year == 2023:
        return parse_ubicomp2023(text, source_file)
    if year == 2024:
        return parse_ubicomp2024(text, source_file)
    if year == 2025:
        return parse_ubicomp2025(text, source_file)
    return parse_title_then_author_pairs(text, source_file)


def combine_tabular_rows(text: str, row_pattern: str) -> list[str]:
    rows: list[str] = []
    current: str | None = None

    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        if not line.strip():
            continue
        if line.startswith("Session #"):
            continue
        if re.match(row_pattern, line):
            if current:
                rows.append(current)
            current = line
            continue
        if current:
            current += " " + normalize_text(line)

    if current:
        rows.append(current)

    return rows


def repair_source_specific_records(raw_records: list[dict]) -> list[dict]:
    ssrr2023_records = [record for record in raw_records if record["source_file"] == "ssrr2023.txt"]
    repair_ssrr2023_records(ssrr2023_records)
    return raw_records


def repair_ssrr2023_records(records: list[dict]) -> None:
    title_replacements = {
        "Controllerwith": "Controller with",
        "InspectionRobots": "Inspection Robots",
        "DeepReinforcement": "Deep Reinforcement",
        "FireFighting": "Fire Fighting",
        "forSearch": "for Search",
        "SetupEvaluation": "Setup Evaluation",
        "byOperation": "by Operation",
        "Designand": "Design and",
        "Search andRescue": "Search and Rescue",
        "MobileGround": "Mobile Ground",
        "SmallUAV": "Small UAV",
        "RescueRobotsin": "Rescue Robots in",
        "Rescue Robotsin": "Rescue Robots in",
        "StereoCamera": "Stereo Camera",
        "anUnderground": "an Underground",
    }
    author_replacements = {
        "ChristofRöhrig": "Christof Röhrig",
        "NizarAourik": "Nizar Aourik",
        "NiklasVoigt": "Niklas Voigt",
        "TatsueYamazaki": "Tatsue Yamazaki",
        "AlexanderAlmer": "Alexander Almer",
        "EmmanouilMaroulis": "Emmanouil Maroulis",
        "Anthony MandowHabitat": "Anthony Mandow",
    }

    for index, record in enumerate(records):
        if record["title"].startswith("R. WagnerDisaster Area Recognition"):
            if index > 0:
                previous = records[index - 1]
                if previous["authors"].endswith("Alan"):
                    previous["authors"] = previous["authors"][:-4] + "Alan R. Wagner"
                elif not previous["authors"].endswith("R. Wagner"):
                    previous["authors"] = previous["authors"].rstrip(", ") + ", R. Wagner"
            record["title"] = record["title"].replace("R. Wagner", "", 1).strip()

        if record["title"].startswith("Dyn Dataset:"):
            record["title"] = "Habitat" + record["title"]

        for old, new in title_replacements.items():
            record["title"] = record["title"].replace(old, new)
        for old, new in author_replacements.items():
            record["authors"] = record["authors"].replace(old, new)


def extract_title_metadata(record: dict) -> dict:
    title = record["title"]
    paper_type = record["paper_type"] or "paper"
    award = record["award"]

    if title.startswith("Experience Paper:"):
        title = title.split(":", 1)[1].strip()
        paper_type = "experience"
    elif title.startswith("Experience:"):
        title = title.split(":", 1)[1].strip()
        paper_type = "experience"
    elif title.endswith("(Experience Paper)"):
        title = title[: -len("(Experience Paper)")].strip()
        paper_type = "experience"

    for known_award in KNOWN_AWARDS:
        if title.startswith(f"{known_award} :"):
            award = award or known_award
            title = title[len(known_award) + 2 :].strip()
            break
        if title.startswith(f"{known_award}:"):
            award = award or known_award
            title = title[len(known_award) + 1 :].strip()
            break
        if title.startswith(f"{known_award} "):
            award = award or known_award
            title = title[len(known_award) + 1 :].strip()
            break
        if title.endswith(f" - {known_award}"):
            award = award or known_award
            title = title[: -len(f" - {known_award}")].strip()
            break
        if title.endswith(f" {known_award}"):
            award = award or known_award
            title = title[: -len(f" {known_award}")].strip()
            break

    record["title"] = normalize_text(title)
    record["paper_type"] = paper_type
    record["award"] = normalize_text(award)
    return record


def infer_tags(record: dict) -> str:
    conference = record["conference"]
    title = record["title"].lower()
    section = record["section"].lower()
    paper_type = record["paper_type"].lower()
    text = f"{title} {section} {paper_type}"
    tags: list[str] = []

    def add(tag: str) -> None:
        if tag not in tags:
            tags.append(tag)

    conference_defaults = {
        "CoNEXT": "networking",
        "INFOCOM": "networking",
        "MobiCom": "mobile-systems",
        "MobiHoc": "mobile-systems",
        "MobiSys": "mobile-systems",
        "MMSys": "multimedia-systems",
        "NSDI": "systems-networking",
        "PerCom": "pervasive-computing",
        "SenSys": "sensor-systems",
        "SIGCHI": "human-computer-interaction",
        "SIGCOMM": "networking",
        "SIGSPATIAL": "geospatial-systems",
        "SSRR": "robotics",
        "UbiComp": "pervasive-computing",
    }
    add(conference_defaults[conference])

    keyword_rules = [
        ((r"\bllm\b", r"large language model", r"foundation model", r"language transformer", r"\bgpt\b", r"\bagent\b"), "llm"),
        ((r"\bfederated\b",), "federated-learning"),
        ((r"\bneural\b", r"\bdnn\b", r"\binference\b", r"\bdiffusion\b", r"\btraining\b", r"\btransformers?\b"), "ml-systems"),
        ((r"on-device", r"mobile device", r"edge-cloud", r"edge computing", r"edge server", r"edge device", r"\bmicrocontrollers?\b"), "edge-computing"),
        ((r"\bsatellite\b", r"\bleo\b", r"\bstarlink\b", r"ground-space"), "satellite"),
        ((r"\b5g\b", r"\bcellular\b", r"\bran\b", r"\bo-ran\b", r"\bvran\b", r"fronthaul"), "cellular"),
        ((r"\bwi-?fi\b",), "wifi"),
        ((r"\bbluetooth\b", r"\bble\b", r"\bearbuds?\b", r"\bearables?\b", r"\bearphones?\b", r"\bhearables?\b"), "bluetooth-audio"),
        ((r"\blora\b", r"\blpwan\b"), "lora-lpwan"),
        ((r"\bbackscatter\b",), "backscatter"),
        ((r"\brfid\b",), "rfid"),
        ((r"\buwb\b",), "uwb"),
        ((r"\bmmwave\b", r"millimeter-wave", r"millimetre-wave", r"\bmm-wave\b"), "mmwave"),
        ((r"\bradar\b",), "radar"),
        ((r"\bmetasurfaces?\b", r"\bmetamaterials?\b"), "metasurfaces"),
        ((r"\bacoustic\b", r"\baudio\b", r"\bspeech\b", r"\bvoice\b", r"\bearphones?\b", r"\bhearables?\b", r"\bmicrophone\b"), "audio-acoustics"),
        ((r"\blidar\b",), "lidar"),
        ((r"\bcamera\b", r"\bimage\b", r"\bvision\b", r"\bvideo\b", r"\bvisual\b", r"\bimaging\b", r"\bphotography\b", r"\bspectral\b"), "vision-video"),
        ((r"\bxr\b", r"\bvr\b", r"\bmr\b", r"augmented reality", r"mixed reality", r"telepresence", r"volumetric", r"\bnerf\b"), "xr-media"),
        ((r"\bstreaming\b", r"video conferencing", r"\bconferencing\b"), "streaming"),
        ((r"\bprivacy\b", r"\bsecure\b", r"\bsecurity\b", r"\bauthentication\b", r"\battack\b", r"\badversarial\b", r"\bspoof", r"\beavesdropping\b", r"\bbackdoor\b", r"\bmalicious\b", r"\bvishing\b"), "security-privacy"),
        ((r"\blocation\b", r"\blocalization\b", r"\btracking\b", r"\bpose\b", r"\bpositioning\b", r"\bslam\b", r"\bnlos\b"), "localization-tracking"),
        ((r"\bdrones?\b", r"\buavs?\b", r"\bquadrotor\b"), "drones-uav"),
        ((r"autonomous driving", r"\bvehicles?\b", r"\bvehicular\b", r"\bdriving\b", r"roadside", r"\bv2x\b"), "autonomous-systems"),
        ((r"\brobot(?:s|ic|ics)?\b", r"search and rescue", r"\bsar\b"), "robotics"),
        ((r"\bhealth\b", r"\bmedical\b", r"\bbrain\b", r"\becg\b", r"vital sign", r"alzheimer", r"parkinson", r"diagnostic", r"blood pressure"), "health"),
        ((r"\bsoil\b", r"\bcrop\b", r"\bfruit\b", r"\bagri(?:culture)?\b", r"\borchard\b", r"\bplants?\b", r"\bcattle\b"), "agriculture"),
        ((r"battery-free", r"batteryless", r"energy harvesting", r"energy-neutral"), "battery-free"),
        ((r"\bunderwater\b", r"\bsonar\b", r"air-to-water", r"\bpool\b"), "underwater"),
        ((r"\bcloud\b", r"\bserverless\b", r"\bmicroservices?\b"), "cloud-systems"),
        ((r"\bdatacenter\b", r"\bsmartnic\b", r"\bswitch\b", r"\bnic\b", r"\brdma\b", r"\bdpu\b"), "datacenter-systems"),
        ((r"\brouting\b", r"traffic engineering", r"\bcongestion\b", r"\btransport\b", r"\btelemetry\b", r"\bbgp\b", r"\bcdn\b", r"\bwan\b", r"\bqoe\b"), "network-operations"),
        ((r"\boptical\b", r"\bphotonic\b", r"circuit switching"), "optical-networking"),
        ((r"\bmeasurement\b", r"\bmonitoring\b", r"diagnos", r"\btracing\b", r"\bverification\b"), "measurement-analysis"),
        ((r"\bdataset\b", r"\bbenchmark\b", r"\bsimulator\b", r"\btestbed\b"), "datasets-benchmarks"),
        ((r"operating system", r"\bos\b", r"\bkernel\b", r"\bi2c\b"), "systems-software"),
    ]

    for patterns, tag in keyword_rules:
        if any(re.search(pattern, text) for pattern in patterns):
            add(tag)

    if record["paper_type"] == "experience":
        add("experience-paper")
    if record["award"]:
        add("award-recognized")

    return "; ".join(tags)


def normalize_records(raw_records: list[dict]) -> list[PaperRecord]:
    seen: set[tuple[str, int, str, str]] = set()
    normalized: list[PaperRecord] = []

    for raw in raw_records:
        cleaned = extract_title_metadata(raw)
        cleaned["authors"] = normalize_text(cleaned["authors"])
        cleaned["section"] = normalize_text(cleaned["section"])
        key = (
            cleaned["conference"],
            cleaned["year"],
            cleaned["title"].lower(),
            cleaned["authors"].lower(),
        )
        if key in seen:
            continue
        seen.add(key)
        normalized.append(
            PaperRecord(
                conference=cleaned["conference"],
                year=cleaned["year"],
                source_file=cleaned["source_file"],
                section=cleaned["section"],
                paper_type=cleaned["paper_type"],
                title=cleaned["title"],
                authors=cleaned["authors"],
                award=cleaned["award"],
                tags=infer_tags(cleaned),
            )
        )

    normalized.sort(key=lambda record: (record.conference, record.year, record.source_file, record.section, record.title))
    return normalized


PREFIX_PARSERS = {
    "conext": parse_conext,
    "infocom": parse_infocom,
    "mobicom": {
        2023: parse_mobicom2023,
        2024: parse_mobicom2024,
        2025: parse_mobicom2025,
    },
    "mobihoc": parse_mobihoc,
    "mobisys": {
        2023: parse_mobisys2023,
        2024: parse_mobisys2024,
        2025: parse_mobisys2025,
    },
    "mmsys": parse_mmsys,
    "nsdi": parse_nsdi,
    "percom": parse_percom,
    "sensys": {
        2023: parse_sensys2023,
        2024: parse_sensys2024,
        2025: parse_sensys2025,
    },
    "sigchi": parse_title_then_author_pairs,
    "sigcomm": {
        2023: parse_sigcomm2023,
        2024: parse_sigcomm2024,
        2025: parse_sigcomm2025,
    },
    "sigspatial": parse_sigspatial,
    "ssrr": {
        2023: parse_ssrr2023,
        2024: parse_ssrr2024,
        2025: parse_ssrr2025,
    },
    "ubicomp": parse_ubicomp,
}


def parser_for_source(source_file: str):
    prefix, year_text = re.fullmatch(r"([a-z]+)(\d{4})\.txt", source_file).groups()
    year = int(year_text)
    parser = PREFIX_PARSERS[prefix]
    if isinstance(parser, dict):
        if year not in parser:
            raise KeyError(f"No parser configured for {source_file}")
        return parser[year]
    return parser


def source_files() -> list[str]:
    files = sorted(path.name for path in ROOT.glob("*20*.txt"))
    unsupported = []

    for source_file in files:
        match = re.fullmatch(r"([a-z]+)(\d{4})\.txt", source_file)
        if not match:
            continue
        prefix = match.group(1)
        if prefix not in CONFERENCE_NAMES or prefix not in PREFIX_PARSERS:
            unsupported.append(source_file)

    if unsupported:
        raise KeyError(f"Unsupported source files found: {', '.join(unsupported)}")

    return [source_file for source_file in files if re.fullmatch(r"([a-z]+)(\d{4})\.txt", source_file)]


def main() -> None:
    raw_records: list[dict] = []
    counts: list[tuple[str, int]] = []

    for source_file in source_files():
        parser = parser_for_source(source_file)
        path = ROOT / source_file
        parsed = parser(load_text(path), source_file)
        counts.append((source_file, len(parsed)))
        raw_records.extend(parsed)

    raw_records = repair_source_specific_records(raw_records)
    records = normalize_records(raw_records)

    OUTPUT_DIR.mkdir(exist_ok=True)
    with OUTPUT_FILE.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "conference",
                "year",
                "source_file",
                "section",
                "paper_type",
                "title",
                "authors",
                "award",
                "tags",
            ],
        )
        writer.writeheader()
        for record in records:
            writer.writerow(record.__dict__)

    for source_file, count in counts:
        print(f"{source_file}: {count}")
    print(f"total_records: {len(records)}")
    print(f"written_to: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
