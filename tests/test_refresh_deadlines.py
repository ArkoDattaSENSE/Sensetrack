import unittest

from website.refresh_deadlines import (
    CONFERENCE_HINTS,
    build_conference_record,
    extract_from_official_page,
    strip_html,
)


def build_record(conference: str, source_url: str, page_text: str) -> dict:
    candidates = extract_from_official_page(
        conference,
        source_url,
        page_text,
        CONFERENCE_HINTS[conference]["label_patterns"],
    )
    return build_conference_record(
        {
            "conference": conference,
            "years_in_csv": [2023, 2024, 2025],
        },
        candidates,
    )


class RefreshDeadlineParserTests(unittest.TestCase):
    def test_mobihoc_uses_submission_date_instead_of_rebuttal(self) -> None:
        page_text = "\n".join(
            [
                "Important Dates",
                "March 30, 2026 Paper Registration Deadline (11:59pm AoE)",
                "April 6, 2026 Paper Submission Deadline (11:59pm AoE)",
                "July 20, 2026 Rebuttal Start",
                "July 26, 2026 Rebuttal Deadline",
            ]
        )

        record = build_record("MobiHoc", "https://www.sigmobile.org/mobihoc/2026/cfp.html", page_text)

        self.assertEqual(record["deadline_iso"], "2026-04-06")
        self.assertEqual(record["submission_cycles"], [
            {
                "deadline_iso": "2026-04-06",
                "deadline_display": "April 06, 2026",
                "deadline_label": "Paper Submission Deadline",
                "source_kind": "official",
                "source_url": "https://www.sigmobile.org/mobihoc/2026/cfp.html",
                "edition_year": 2026,
            }
        ])

    def test_mobicom_pairs_cycle_headers_with_following_date_rows(self) -> None:
        page_text = "\n".join(
            [
                "Important Dates",
                "Summer",
                "Winter",
                "Abstract Registration",
                "August 22, 2025",
                "February 27, 2026",
                "Paper Submission",
                "September 3, 2025",
                "March 13, 2026",
            ]
        )

        candidates = extract_from_official_page(
            "MobiCom",
            "https://www.sigmobile.org/mobicom/2026/cfp.html",
            page_text,
            CONFERENCE_HINTS["MobiCom"]["label_patterns"],
        )
        record = build_record("MobiCom", "https://www.sigmobile.org/mobicom/2026/cfp.html", page_text)
        extracted = {(candidate.deadline_iso, candidate.label) for candidate in candidates}
        cycles = {(cycle["deadline_iso"], cycle["deadline_label"]) for cycle in record["submission_cycles"]}

        self.assertEqual(
            extracted,
            {
                ("2025-08-22", "Summer - Abstract Registration"),
                ("2025-09-03", "Summer - Paper Submission"),
                ("2026-02-27", "Winter - Abstract Registration"),
                ("2026-03-13", "Winter - Paper Submission"),
            },
        )
        self.assertEqual(
            cycles,
            {
                ("2025-09-03", "Summer - Paper Submission"),
                ("2026-03-13", "Winter - Paper Submission"),
            },
        )
        self.assertEqual(record["deadline_iso"], "2026-03-13")

    def test_struck_through_deadlines_are_ignored(self) -> None:
        raw_html = "Submission Via EDAS: <s>September 19, 2025</s> October 3, 2025"

        stripped = strip_html(raw_html)
        record = build_record("PerCom", "https://www.percom.org/call-for-papers/", stripped)

        self.assertNotIn("September 19, 2025", stripped)
        self.assertEqual(record["submission_cycles"], [
            {
                "deadline_iso": "2025-10-03",
                "deadline_display": "October 03, 2025",
                "deadline_label": "Submission Via Edas",
                "source_kind": "official",
                "source_url": "https://www.percom.org/call-for-papers/",
                "edition_year": 2025,
            }
        ])

    def test_notification_dates_do_not_leak_into_submission_cycles(self) -> None:
        page_text = "\n".join(
            [
                "Extended abstracts (1-2 pages) due July 16, July 30 with acceptance notifications on 5 September.",
                "Full papers (6-8 pages) due 30 September October 15.",
            ]
        )

        record = build_record("SSRR", "https://www.ssrr2025.org/contribute", page_text)

        self.assertEqual(
            [(cycle["deadline_iso"], cycle["deadline_label"]) for cycle in record["submission_cycles"]],
            [
                ("2025-07-30", "Extended Abstracts"),
                ("2025-10-15", "Full Papers"),
            ],
        )


if __name__ == "__main__":
    unittest.main()
