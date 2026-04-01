#!/usr/bin/env python3
import csv
import json
import os
import random
import re
from collections import Counter, defaultdict
from pathlib import Path

os.environ.setdefault("MPLCONFIGDIR", "/tmp/matplotlib")

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import colors as mcolors
from matplotlib.patches import FancyBboxPatch

ROOT = Path(__file__).resolve().parent.parent
INPUT_CSV = ROOT / "cleaned" / "accepted_papers.csv"
OUT_DIR = ROOT / "paper_visualizations"
PLOTS_DIR = OUT_DIR / "plots"
STATS_DIR = OUT_DIR / "stats"
RANDOM = random.Random(42)

STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "into",
    "is", "it", "its", "of", "on", "or", "that", "the", "their", "to", "toward",
    "towards", "use", "using", "via", "with", "without", "within", "through", "we",
    "our", "can", "new", "based", "using", "towards", "over", "under", "than",
}

AUTHOR_BLACKLIST_HINTS = {
    "university", "institute", "college", "laboratory", "lab", "school", "department",
    "academy", "research", "centre", "center", "inc", "corp", "corporation", "microsoft",
    "google", "meta", "amazon", "apple", "samsung", "huawei", "china", "korea", "usa",
    "uk", "france", "germany", "canada",
}

PALETTE = [
    "#0f172a", "#0ea5e9", "#14b8a6", "#f59e0b", "#ef4444", "#8b5cf6",
    "#22c55e", "#e11d48", "#0284c7", "#7c3aed", "#ea580c", "#334155",
]

CONFERENCE_COLORS = {
    "INFOCOM": "#0ea5e9",
    "UbiComp": "#14b8a6",
    "MobiCom": "#f59e0b",
    "MobiHoc": "#f97316",
    "NSDI": "#ef4444",
    "SIGCOMM": "#8b5cf6",
    "MMSys": "#22c55e",
    "SIGSPATIAL": "#e11d48",
    "SenSys": "#0284c7",
    "MobiSys": "#7c3aed",
    "SIGCHI": "#ec4899",
    "SSRR": "#ea580c",
    "PerCom": "#334155",
    "CoNEXT": "#06b6d4",
}


def ensure_dirs():
    for path in [OUT_DIR, PLOTS_DIR, STATS_DIR]:
        path.mkdir(parents=True, exist_ok=True)
    for category in ["tags", "titles", "universities", "authors", "overlap"]:
        (PLOTS_DIR / category).mkdir(parents=True, exist_ok=True)
        (STATS_DIR / category).mkdir(parents=True, exist_ok=True)


def load_rows():
    with INPUT_CSV.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


def split_tags(text):
    return [part.strip() for part in (text or "").split(";") if part.strip()]


def tokenize_title(title):
    tokens = re.findall(r"[A-Za-z0-9][A-Za-z0-9\-+']*", (title or "").lower())
    return [t.strip("-+'") for t in tokens if len(t.strip("-+'")) >= 3 and t.strip("-+'") not in STOPWORDS and not t.isdigit()]


def normalize_affiliation(name):
    cleaned = re.sub(r"\s+", " ", name).strip(" ,;")
    replacements = {
        "Univ.": "University",
        "Inst.": "Institute",
        "Tech.": "Technology",
        "CMU": "Carnegie Mellon University",
        "MIT": "Massachusetts Institute of Technology",
        "UC Berkeley": "University of California, Berkeley",
        "UCLA": "University of California, Los Angeles",
    }
    for old, new in replacements.items():
        cleaned = cleaned.replace(old, new)
    return cleaned


def split_top_level(text):
    parts = []
    current = []
    depth = 0
    for ch in text:
        if ch == "(":
            depth += 1
        elif ch == ")" and depth > 0:
            depth -= 1
        if depth == 0 and ch in ",;":
            part = "".join(current).strip()
            if part:
                parts.append(part)
            current = []
            continue
        current.append(ch)
    tail = "".join(current).strip()
    if tail:
        parts.append(tail)
    return parts


def parse_authors_and_affiliations(authors_field):
    authors = []
    universities = []
    for part in split_top_level(authors_field or ""):
        author = part
        aff = ""
        if "(" in part and ")" in part:
            left = part.find("(")
            right = part.rfind(")")
            author = part[:left].strip()
            aff = part[left + 1:right].strip()
        author = " ".join(author.split()).strip()
        if author:
            authors.append(author)
        aff = normalize_affiliation(aff) if aff else ""
        if aff:
            universities.append(aff)
    return authors, universities


def looks_like_affiliation(text):
    lowered = text.lower()
    return any(hint in lowered for hint in AUTHOR_BLACKLIST_HINTS)


def save_counter_csv(counter, path, label):
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([label, "count"])
        for key, value in counter.most_common():
            writer.writerow([key, value])


def save_counter_json(counter, path):
    with path.open("w", encoding="utf-8") as f:
        json.dump(counter.most_common(), f, indent=2)


def lighten(color, amount=0.25):
    rgb = mcolors.to_rgb(color)
    return tuple(1 - (1 - c) * (1 - amount) for c in rgb)


def add_header(ax, title, subtitle):
    ax.text(0.02, 0.96, title, transform=ax.transAxes, ha="left", va="top", fontsize=24, fontweight="bold", color="#0f172a")
    ax.text(0.02, 0.90, subtitle, transform=ax.transAxes, ha="left", va="top", fontsize=11, color="#475569")


def draw_word_cloud(counter, title, subtitle, out_path, accent="#0ea5e9", max_words=90):
    items = counter.most_common(max_words)
    fig, ax = plt.subplots(figsize=(16, 10), dpi=180)
    fig.patch.set_facecolor("#f8fafc")
    ax.set_facecolor("#f8fafc")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")
    ax.add_patch(FancyBboxPatch((0.02, 0.06), 0.96, 0.84, boxstyle="round,pad=0.02,rounding_size=0.03", linewidth=0, facecolor="#dbeafe", alpha=0.35, transform=ax.transAxes))
    add_header(ax, title, subtitle)

    if not items:
        ax.text(0.5, 0.5, "No data", ha="center", va="center", fontsize=24, color="#64748b")
        fig.savefig(out_path, bbox_inches="tight", facecolor=fig.get_facecolor())
        plt.close(fig)
        return

    max_count = items[0][1]
    min_count = items[-1][1]
    placed = []
    for idx, (word, count) in enumerate(items):
        size = 28 if max_count == min_count else 14 + 34 * ((count - min_count) / (max_count - min_count))
        angle = 90 if idx % 7 == 0 else 0
        color = accent if idx == 0 else PALETTE[idx % len(PALETTE)]
        success = False
        for step in range(216):
            band = step // 18
            pos = step % 18
            y = 0.80 - band * 0.07 + RANDOM.uniform(-0.01, 0.01)
            x = 0.10 + pos * 0.045 + ((band % 2) * 0.02) + RANDOM.uniform(-0.01, 0.01)
            if not (0.08 <= x <= 0.92 and 0.12 <= y <= 0.84):
                continue
            width = max(0.03, len(word) * size * (0.00075 if angle == 0 else 0.00042))
            height = max(0.024, size * (0.0016 if angle == 0 else 0.0035))
            bbox = (x - width / 2, y - height / 2, x + width / 2, y + height / 2)
            if any(not (bbox[2] < old[0] or bbox[0] > old[2] or bbox[3] < old[1] or bbox[1] > old[3]) for old in placed):
                continue
            ax.text(x, y, word, fontsize=size, rotation=angle, ha="center", va="center", color=color, alpha=0.95, fontweight="bold" if idx < 12 else "semibold", transform=ax.transAxes)
            placed.append(bbox)
            success = True
            break
        if not success:
            ax.text(0.5, 0.48, word, fontsize=max(10, size * 0.75), ha="center", va="center", color=lighten(accent, 0.45), alpha=0.12, fontweight="bold", transform=ax.transAxes)

    fig.savefig(out_path, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)


def draw_top_bar(counter, title, subtitle, out_path, accent="#0ea5e9", top_n=15):
    items = counter.most_common(top_n)
    labels = [k for k, _ in items][::-1]
    values = [v for _, v in items][::-1]
    fig, ax = plt.subplots(figsize=(12, 8), dpi=180)
    fig.patch.set_facecolor("#ffffff")
    ax.set_facecolor("#ffffff")
    bars = ax.barh(labels, values, color=accent, alpha=0.9)
    ax.spines[["top", "right"]].set_visible(False)
    ax.spines["left"].set_color("#cbd5e1")
    ax.spines["bottom"].set_color("#cbd5e1")
    ax.grid(axis="x", color="#e2e8f0", linewidth=0.8)
    ax.set_axisbelow(True)
    ax.set_title(title, loc="left", fontsize=20, fontweight="bold", color="#0f172a", pad=16)
    ax.text(0, 1.01, subtitle, transform=ax.transAxes, ha="left", va="bottom", color="#475569")
    max_value = max(values) if values else 0
    for bar, value in zip(bars, values):
        ax.text(value + max_value * 0.01, bar.get_y() + bar.get_height() / 2, str(value), va="center", fontsize=10, color="#334155")
    fig.tight_layout()
    fig.savefig(out_path, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)


def draw_matrix_heatmap(matrix, row_labels, col_labels, title, subtitle, out_path, cmap="YlGnBu", fmt="{:.2f}"):
    fig, ax = plt.subplots(figsize=(max(10, len(col_labels) * 0.9), max(6, len(row_labels) * 0.7)), dpi=180)
    fig.patch.set_facecolor("#ffffff")
    im = ax.imshow(matrix, cmap=cmap, aspect="auto")
    ax.set_xticks(range(len(col_labels)))
    ax.set_yticks(range(len(row_labels)))
    ax.set_xticklabels(col_labels, rotation=35, ha="right")
    ax.set_yticklabels(row_labels)
    ax.set_title(title, loc="left", fontsize=20, fontweight="bold", color="#0f172a", pad=16)
    ax.text(0, 1.02, subtitle, transform=ax.transAxes, ha="left", va="bottom", color="#475569")
    for i in range(len(row_labels)):
        for j in range(len(col_labels)):
            ax.text(j, i, fmt.format(matrix[i][j]), ha="center", va="center", fontsize=8, color="#0f172a")
    cbar = fig.colorbar(im, ax=ax, fraction=0.03, pad=0.02)
    cbar.outline.set_visible(False)
    fig.tight_layout()
    fig.savefig(out_path, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)


def write_matrix_csv(row_labels, col_labels, matrix, out_path, label_name):
    with out_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([label_name] + list(col_labels))
        for label, row in zip(row_labels, matrix):
            writer.writerow([label] + list(row))


def build_counters(rows):
    overall = {"tags": Counter(), "titles": Counter(), "universities": Counter(), "authors": Counter()}
    per_conf = defaultdict(lambda: {"tags": Counter(), "titles": Counter(), "universities": Counter(), "authors": Counter()})
    for row in rows:
        conf = row["conference"].strip()
        for tag in split_tags(row.get("tags", "")):
            overall["tags"][tag] += 1
            per_conf[conf]["tags"][tag] += 1
        for token in tokenize_title(row.get("title", "")):
            overall["titles"][token] += 1
            per_conf[conf]["titles"][token] += 1
        authors, universities = parse_authors_and_affiliations(row.get("authors", ""))
        for author in authors:
            if looks_like_affiliation(author):
                overall["universities"][normalize_affiliation(author)] += 1
                per_conf[conf]["universities"][normalize_affiliation(author)] += 1
                continue
            overall["authors"][author] += 1
            per_conf[conf]["authors"][author] += 1
        for university in universities:
            overall["universities"][university] += 1
            per_conf[conf]["universities"][university] += 1
    return overall, per_conf


def save_counter_outputs(category, name, counter, accent):
    labels = {
        "tags": "tag",
        "titles": "title_word",
        "universities": "university",
        "authors": "author",
    }
    slug = slugify(name)
    save_counter_csv(counter, STATS_DIR / category / f"{slug}.csv", labels[category])
    save_counter_json(counter, STATS_DIR / category / f"{slug}.json")
    draw_word_cloud(counter, f"{name} {category.capitalize()} Word Cloud", f"Top {min(90, len(counter))} terms sized by frequency", PLOTS_DIR / category / f"{slug}_wordcloud.png", accent=accent)
    draw_top_bar(counter, f"{name} {category.capitalize()} Top Counts", f"Top {min(15, len(counter))} terms with exact counts", PLOTS_DIR / category / f"{slug}_top15.png", accent=accent)


def build_overlap_outputs(per_conf):
    conferences = sorted(per_conf)
    all_tags = Counter()
    for conf in conferences:
        all_tags.update(per_conf[conf]["tags"])
    top_tags = [tag for tag, _ in all_tags.most_common(18)]

    count_matrix = []
    share_matrix = []
    for tag in top_tags:
        counts = [per_conf[conf]["tags"].get(tag, 0) for conf in conferences]
        total = sum(counts) or 1
        count_matrix.append(counts)
        share_matrix.append([round(value / total, 2) for value in counts])

    draw_matrix_heatmap(count_matrix, top_tags, conferences, "Tag Counts by Conference", "Raw counts for the most common tags across venues", PLOTS_DIR / "overlap" / "conference_tag_counts_heatmap.png", cmap="YlOrRd", fmt="{:.0f}")
    write_matrix_csv(top_tags, conferences, count_matrix, STATS_DIR / "overlap" / "conference_tag_counts.csv", "tag")

    draw_matrix_heatmap(share_matrix, top_tags, conferences, "Where Each Tag Concentrates", "Rows sum to about 1.00, showing which venue dominates a tag", PLOTS_DIR / "overlap" / "conference_tag_share_heatmap.png", cmap="PuBuGn", fmt="{:.2f}")
    write_matrix_csv(top_tags, conferences, share_matrix, STATS_DIR / "overlap" / "conference_tag_share.csv", "tag")

    similarity = []
    for conf_a in conferences:
        tags_a = set(per_conf[conf_a]["tags"])
        row = []
        for conf_b in conferences:
            tags_b = set(per_conf[conf_b]["tags"])
            union = tags_a | tags_b
            row.append(0.0 if not union else round(len(tags_a & tags_b) / len(union), 2))
        similarity.append(row)
    draw_matrix_heatmap(similarity, conferences, conferences, "Conference Similarity by Tag Vocabulary", "Jaccard overlap on which tags appear at each venue", PLOTS_DIR / "overlap" / "conference_tag_similarity_heatmap.png", cmap="Blues", fmt="{:.2f}")
    write_matrix_csv(conferences, conferences, similarity, STATS_DIR / "overlap" / "conference_tag_similarity.csv", "conference")


def write_summary(rows, per_conf):
    summary = {
        "input_csv": str(INPUT_CSV),
        "paper_count": len(rows),
        "conference_count": len(per_conf),
        "conferences": sorted(per_conf),
    }
    with (OUT_DIR / "README.json").open("w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)


def main():
    ensure_dirs()
    rows = load_rows()
    overall, per_conf = build_counters(rows)
    for category in ["tags", "titles", "universities", "authors"]:
        save_counter_outputs(category, "overall", overall[category], accent="#0ea5e9")
        for conf in sorted(per_conf):
            save_counter_outputs(category, conf, per_conf[conf][category], accent=CONFERENCE_COLORS.get(conf, "#0ea5e9"))
    build_overlap_outputs(per_conf)
    write_summary(rows, per_conf)
    print(f"Generated outputs in {OUT_DIR}")


if __name__ == "__main__":
    main()
