const DAY_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEYS = ["sensetrack.deadlines.v2", "sensetrack.deadlines.v1", "conference-date-tracker.deadlines.v1"];
const PRIMARY_STORAGE_KEY = STORAGE_KEYS[0];
const CSV_PATH = "cleaned/accepted_papers.csv";
const STATIC_DB_PATH = "website/db/conference_deadlines.json";
const API_DEADLINES_PATH = "/api/deadlines";
const API_REFRESH_PATH = "/api/refresh";

const state = {
  dataset: null,
  papers: [],
  analytics: null,
  activeTab: "tab-submissions",
  searchTerm: "",
  dataMode: "unknown",
  analyticsStatus: "loading",
  analyticsError: "",
  dashboards: {
    tags: {
      search: "",
      conference: "",
      overallSort: { key: "count", direction: "desc" },
      conferenceSort: { key: "count", direction: "desc" },
      fitSort: { key: "count", direction: "desc" },
      selectedKey: "",
      selectedTerm: null,
    },
    titles: {
      search: "",
      conference: "",
      overallSort: { key: "count", direction: "desc" },
      conferenceSort: { key: "count", direction: "desc" },
      selectedTerm: null,
    },
    universities: {
      search: "",
      conference: "",
      overallSort: { key: "count", direction: "desc" },
      conferenceSort: { key: "count", direction: "desc" },
      selectedTerm: null,
    },
    authors: {
      search: "",
      conference: "",
      overallSort: { key: "count", direction: "desc" },
      conferenceSort: { key: "count", direction: "desc" },
      selectedTerm: null,
    },
  },
  refreshingConferences: {},
  pendingRefreshes: {},
  conferenceRefreshState: {},
  batchRefresh: null,
};

const ANALYTICS_DIMENSIONS = {
  tags: {
    title: "Topic Fit",
    singular: "tag",
    plural: "tags",
    tabId: "tagsDashboard",
    searchPlaceholder: "Search tags",
    overallHeading: "Cross-Conference Tag Cloud",
    conferenceHeading: "Tag Profile",
    cloudEmpty: "No tags matched this filter.",
  },
  titles: {
    title: "Title Signals",
    singular: "title term",
    plural: "title terms",
    tabId: "titlesDashboard",
    searchPlaceholder: "Search title terms",
    overallHeading: "Cross-Conference Title Cloud",
    conferenceHeading: "Title Profile",
    cloudEmpty: "No title terms matched this filter.",
  },
  universities: {
    title: "Institutions",
    singular: "institution",
    plural: "institutions",
    tabId: "universitiesDashboard",
    searchPlaceholder: "Search universities or labs",
    overallHeading: "Institution Landscape",
    conferenceHeading: "Institution Profile",
    cloudEmpty: "No institutions matched this filter.",
  },
  authors: {
    title: "Authors",
    singular: "author",
    plural: "authors",
    tabId: "authorsDashboard",
    searchPlaceholder: "Search authors",
    overallHeading: "Overall Author Landscape",
    conferenceHeading: "Authors By Conference",
    cloudEmpty: "No authors matched this filter.",
  },
};

const TITLE_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "beyond",
  "by",
  "case",
  "design",
  "enabling",
  "enhancing",
  "experience",
  "for",
  "from",
  "framework",
  "in",
  "into",
  "learning",
  "made",
  "new",
  "of",
  "on",
  "paper",
  "practical",
  "rethinking",
  "robust",
  "scalable",
  "smart",
  "study",
  "system",
  "systems",
  "the",
  "through",
  "toward",
  "towards",
  "under",
  "using",
  "via",
  "with",
]);

const TITLE_KEEPERS = new Set([
  "3d",
  "4g",
  "5g",
  "6g",
  "ai",
  "ar",
  "ble",
  "dns",
  "dnn",
  "gnss",
  "gpu",
  "iot",
  "llm",
  "lpwan",
  "mmwave",
  "nlp",
  "rf",
  "rfid",
  "slam",
  "tcp",
  "udp",
  "uwb",
  "vr",
  "wan",
  "wifi",
  "xr",
]);

const AUTHOR_NAME_PARTICLES = new Set([
  "al",
  "ap",
  "ben",
  "bin",
  "da",
  "de",
  "del",
  "della",
  "der",
  "di",
  "dos",
  "du",
  "el",
  "ibn",
  "la",
  "le",
  "mac",
  "mc",
  "san",
  "st",
  "van",
  "von",
  "zu",
  "zur",
]);

const AUTHOR_NON_NAME_TOKENS = new Set([
  "college",
  "department",
  "institute",
  "laboratory",
  "laboratories",
  "lab",
  "labs",
  "model",
  "models",
  "network",
  "networks",
  "research",
  "school",
  "system",
  "systems",
  "technology",
  "technologies",
  "testbed",
  "university",
]);

const INSTITUTION_KEYWORD_PATTERN =
  /(academy|college|center|centre|company|corporation|corp|department|foundation|gmbh|hospital|inc|institute|laborator|lab\b|labs\b|ltd|llc|research|school|technologies|technology|university|meta|google|microsoft|amazon|apple|huawei|tencent|alibaba|telefonica|nokia|samsung|anthropic|mistral|vmware|bytedance|icrea|cnrs|inria|ucl|ucla|kaist|mit|cmu|imdea|inesc|nova|bt|verizon|jd logistics)/i;

const MONTH_LOOKUP = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const STOP_LINE_TOKENS = [
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
];

const SUPPORTED_CONFERENCES = [
  "CoNEXT",
  "INFOCOM",
  "MMSys",
  "MobiCom",
  "MobiHoc",
  "MobiSys",
  "NSDI",
  "PerCom",
  "SenSys",
  "SIGCOMM",
  "SIGSPATIAL",
  "SSRR",
  "UbiComp",
];

const CONFERENCE_HINTS = {
  CoNEXT: {
    candidateUrls: [
      "https://conferences.sigcomm.org/co-next/{year}/#!/call-for-papers",
      "https://conferences.sigcomm.org/co-next/{year}/",
    ],
    labelPatterns: ["paper submission", "submission deadline", "abstract registration"],
  },
  INFOCOM: {
    candidateUrls: [
      "https://infocom{year}.ieee-infocom.org/call-papers",
      "https://infocom{year}.ieee-infocom.org/authors/call-papers-main-conference",
      "https://infocom{year}.ieee-infocom.org/",
    ],
    labelPatterns: ["paper submission", "submission deadline", "main conference paper submission"],
  },
  MMSys: {
    candidateUrls: [
      "https://{year}.acmmmsys.org/call-for-papers/",
      "https://www.acmmmsys.org/{year}/call-for-papers/",
    ],
    labelPatterns: ["paper submission", "submission deadline", "abstract registration"],
  },
  MobiCom: {
    candidateUrls: ["https://www.sigmobile.org/mobicom/{year}/cfp.html"],
    labelPatterns: ["paper submission", "submission deadline", "abstract registration"],
  },
  MobiHoc: {
    candidateUrls: [
      "https://www.sigmobile.org/mobihoc/{year}/cfp.html",
      "https://www.sigmobile.org/mobihoc/{year}/cfp/",
      "https://www.sigmobile.org/mobihoc/{year}/",
    ],
    labelPatterns: ["paper submission", "submission deadline", "abstract registration"],
  },
  MobiSys: {
    candidateUrls: ["https://www.sigmobile.org/mobisys/{year}/call_for_papers/"],
    labelPatterns: ["paper submission", "submission deadline", "abstract registration"],
  },
  NSDI: {
    candidateUrls: ["https://www.usenix.org/conference/nsdi{yy}/call-for-papers"],
    labelPatterns: ["paper submissions", "paper submission", "abstract registrations"],
  },
  PerCom: {
    candidateUrls: [
      "https://www.percom.org/call-for-papers/",
      "https://percom.org/call-for-papers/",
      "https://percom{year}.org/call-for-papers/",
    ],
    labelPatterns: ["paper submission", "submission deadline", "abstract registration"],
  },
  SIGCHI: {
    candidateUrls: [
      "https://chi{year}.acm.org/for-authors/papers/",
      "https://chi{year}.acm.org/",
    ],
    labelPatterns: ["paper submission", "submission deadline", "abstract registration"],
  },
  SIGCOMM: {
    candidateUrls: ["https://conferences.sigcomm.org/sigcomm/{year}/cfp/"],
    labelPatterns: ["paper submission deadline", "paper submission", "abstract registration deadline"],
  },
  SIGSPATIAL: {
    candidateUrls: [
      "https://sigspatial{year}.sigspatial.org/research-submission.html",
      "https://sigspatial{year}.sigspatial.org/cfp/",
      "https://sigspatial{year}.sigspatial.org/",
    ],
    labelPatterns: ["paper submission", "submission deadline", "abstract registration"],
  },
  SenSys: {
    candidateUrls: ["https://sensys.acm.org/{year}/cfp.html"],
    labelPatterns: ["full paper submission", "paper submission", "abstract registration"],
  },
  SSRR: {
    candidateUrls: [
      "https://www.ssrr{year}.org/contribute",
      "https://ssrr{year}.org/contribute",
    ],
    labelPatterns: ["full papers", "submission deadline", "paper submission", "extended abstracts"],
  },
  UbiComp: {
    candidateUrls: [
      "https://www.ubicomp.org/ubicomp-iswc-{year}/cfp/",
      "https://www.ubicomp.org/ubicomp-iswc-{year}/",
    ],
    labelPatterns: ["paper submission", "submission deadline", "abstract registration"],
  },
};

const DATE_PATTERN_SOURCE =
  "(?:(?:Mon|Monday|Tue|Tuesday|Wed|Wednesday|Thu|Thursday|Fri|Friday|Sat|Saturday|Sun|Sunday),?\\s+)?(?:(?<month1>Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\s+(?<day1>\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,\\s*|\\s+)?(?<year1>\\d{4})?|(?<day2>\\d{1,2})(?:st|nd|rd|th)?\\s+(?<month2>Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:\\s*,\\s*|\\s+)?(?<year2>\\d{4})?)";

function parseDateOnly(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function todayDateOnly() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function daysUntil(deadlineIso) {
  return Math.round((parseDateOnly(deadlineIso) - todayDateOnly()) / DAY_MS);
}

function deadlineStatus(deadlineIso) {
  const delta = daysUntil(deadlineIso);
  if (delta > 0) {
    return { tone: "upcoming", badge: "Open Window", detail: `${delta} days left` };
  }
  if (delta === 0) {
    return { tone: "today", badge: "Due Today", detail: "Submit today" };
  }
  return {
    tone: "closed",
    badge: "Closed",
    detail: `Closed ${Math.abs(delta)} days ago`,
  };
}

function formattedGeneratedAt(value) {
  if (!value) {
    return "Not refreshed yet";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function monthNumber(value) {
  return MONTH_LOOKUP[value.toLowerCase().replace(/\.$/, "")];
}

function inferYearFromUrl(url) {
  const match = url.match(/(20\d{2})/);
  return match ? Number(match[1]) : null;
}

function parseDatesFromText(text, fallbackYear = null) {
  const results = [];
  const datePattern = new RegExp(DATE_PATTERN_SOURCE, "gi");

  for (const match of text.matchAll(datePattern)) {
    const month = match.groups.month1 || match.groups.month2;
    const day = match.groups.day1 || match.groups.day2;
    const year = match.groups.year1 || match.groups.year2;
    const resolvedYear = year ? Number(year) : fallbackYear;

    if (!month || !day || !resolvedYear) {
      continue;
    }

    const monthValue = monthNumber(month);
    const dateValue = new Date(Date.UTC(resolvedYear, monthValue - 1, Number(day)));
    if (Number.isNaN(dateValue.getTime())) {
      continue;
    }
    results.push(dateValue.toISOString().slice(0, 10));
  }

  return results;
}

function stripHtml(rawHtml) {
  let text = rawHtml
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|tr|td|th|li|ul|ol|table|h1|h2|h3|h4|h5|h6)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  const textarea = document.createElement("textarea");
  textarea.innerHTML = text;
  text = textarea.value;

  return text
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .join("\n");
}

function labelPriority(label) {
  const priorities = [
    ["paper submission deadline", 6],
    ["paper submission", 5],
    ["full paper submission", 5],
    ["full papers", 4],
    ["submission deadline", 4],
    ["extended abstracts", 3],
    ["abstract registration", 1],
  ];

  const lowered = label.toLowerCase();
  for (const [token, score] of priorities) {
    if (lowered.includes(token)) {
      return score;
    }
  }
  return 0;
}

function titleCaseWords(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function hasCycleContext(value) {
  const normalized = normalizeWhitespace(String(value || ""));
  if (!normalized) {
    return false;
  }

  return (
    /\bcycle\s+[a-z0-9ivx]+\b/i.test(normalized) ||
    /\bround\s+[a-z0-9ivx]+\b/i.test(normalized) ||
    /\b(?:spring|summer|fall|winter)\b/i.test(normalized) ||
    /\b(?:first|second|third|fourth|1st|2nd|3rd|4th|\d+(?:st|nd|rd|th))\s+(?:call|deadline|round|cycle)\b/i.test(normalized)
  );
}

function findCycleContext(lines, index) {
  for (let pointer = index; pointer >= Math.max(0, index - 8); pointer -= 1) {
    const line = normalizeWhitespace(
      lines[pointer]
        .replace(/[:|\-]\s*$/, "")
        .replace(/\s*\((?:expired|open|closed)\)\s*$/i, ""),
    );
    if (!line) {
      continue;
    }

    if (hasCycleContext(line)) {
      return line;
    }
  }
  return "";
}

function extractFromOfficialPage(conference, sourceUrl, pageText, labelPatterns) {
  const candidates = new Map();
  const fallbackYear = inferYearFromUrl(sourceUrl);
  const lines = pageText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const compiledPatterns = labelPatterns.map((pattern) => new RegExp(pattern, "i"));

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    for (const regex of compiledPatterns) {
      const match = line.match(regex);
      if (!match) {
        continue;
      }

      const cycleContext = findCycleContext(lines, index);
      const baseLabel = titleCaseWords(match[0]);
      const label = cycleContext ? `${cycleContext} · ${baseLabel}` : baseLabel;
      const startIndex = line.toLowerCase().indexOf(match[0].toLowerCase());
      const trailingSlice = startIndex >= 0 ? line.slice(startIndex) : line;
      const collectedDates = [...parseDatesFromText(trailingSlice, fallbackYear)];

      for (const lookahead of lines.slice(index + 1, index + 5)) {
        const lowered = lookahead.toLowerCase();
        if (compiledPatterns.some((pattern) => pattern.test(lookahead))) {
          break;
        }
        if (collectedDates.length && STOP_LINE_TOKENS.some((token) => lowered.includes(token))) {
          break;
        }
        const extractedDates = parseDatesFromText(lookahead, fallbackYear);
        if (extractedDates.length) {
          collectedDates.push(...extractedDates);
        }
      }

      for (const deadlineIso of collectedDates) {
        const key = `${deadlineIso}::${label}`;
        candidates.set(key, {
          conference,
          deadlineIso,
          label,
          sourceUrl,
          editionYear: fallbackYear || Number(deadlineIso.slice(0, 4)),
        });
      }
    }
  }

  if (candidates.size) {
    return [...candidates.values()];
  }

  const genericMatches = new Map();
  for (const line of lines) {
    const lowered = line.toLowerCase();
    if (!["submission", "deadline", "due", "abstract"].some((token) => lowered.includes(token))) {
      continue;
    }
    if (STOP_LINE_TOKENS.some((token) => lowered.includes(token))) {
      continue;
    }
    for (const deadlineIso of parseDatesFromText(line, fallbackYear)) {
      const cycleContext = findCycleContext(lines, lines.indexOf(line));
      const label = cycleContext ? `${cycleContext} · Submission Deadline` : "Submission Deadline";
      genericMatches.set(deadlineIso, {
        conference,
        deadlineIso,
        label,
        sourceUrl,
        editionYear: fallbackYear || Number(deadlineIso.slice(0, 4)),
      });
    }
  }
  return [...genericMatches.values()];
}

function formatDisplayDate(deadlineIso) {
  return parseDateOnly(deadlineIso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "2-digit",
    timeZone: "UTC",
  });
}

function chooseBetterCycle(existingCycle, nextCycle) {
  if (!existingCycle) {
    return nextCycle;
  }

  const existingHasContext = hasCycleContext(existingCycle.deadline_label);
  const nextHasContext = hasCycleContext(nextCycle.deadline_label);
  if (existingHasContext !== nextHasContext) {
    return nextHasContext ? nextCycle : existingCycle;
  }

  const existingPriority = labelPriority(existingCycle.deadline_label);
  const nextPriority = labelPriority(nextCycle.deadline_label);
  if (existingPriority !== nextPriority) {
    return nextPriority > existingPriority ? nextCycle : existingCycle;
  }

  return nextCycle.deadline_label.length > existingCycle.deadline_label.length ? nextCycle : existingCycle;
}

function normalizeSubmissionCycles(cycles, fallbackRecord = null) {
  const byDate = new Map();
  const inputCycles =
    Array.isArray(cycles) && cycles.length
      ? cycles
      : fallbackRecord && fallbackRecord.deadline_iso
        ? [
            {
              deadline_iso: fallbackRecord.deadline_iso,
              deadline_display: fallbackRecord.deadline_display,
              deadline_label: fallbackRecord.deadline_label || "Submission Deadline",
              source_kind: fallbackRecord.source_kind || "official",
              source_url: fallbackRecord.source_url || "",
              edition_year: fallbackRecord.latest_tracked_edition || Number(fallbackRecord.deadline_iso.slice(0, 4)),
            },
          ]
        : [];

  inputCycles.forEach((cycle) => {
    const deadlineIso = cycle.deadline_iso || cycle.deadlineIso;
    if (!deadlineIso) {
      return;
    }

    const normalizedCycle = {
      deadline_iso: deadlineIso,
      deadline_display: cycle.deadline_display || cycle.deadlineDisplay || formatDisplayDate(deadlineIso),
      deadline_label: cycle.deadline_label || cycle.deadlineLabel || cycle.label || "Submission Deadline",
      source_kind: cycle.source_kind || cycle.sourceKind || "official",
      source_url: cycle.source_url || cycle.sourceUrl || "",
      edition_year: cycle.edition_year || cycle.editionYear || Number(deadlineIso.slice(0, 4)),
    };

    byDate.set(deadlineIso, chooseBetterCycle(byDate.get(deadlineIso), normalizedCycle));
  });

  return [...byDate.values()].sort((left, right) => {
    if (left.deadline_iso !== right.deadline_iso) {
      return left.deadline_iso.localeCompare(right.deadline_iso);
    }
    return labelPriority(right.deadline_label) - labelPriority(left.deadline_label);
  });
}

function getRecordCycles(record) {
  return normalizeSubmissionCycles(record.submission_cycles, record);
}

function getLatestCycle(record) {
  const cycles = getRecordCycles(record);
  return cycles.length ? cycles[cycles.length - 1] : null;
}

function getNextUpcomingCycle(record) {
  const cycles = getRecordCycles(record);
  for (const cycle of cycles) {
    if (daysUntil(cycle.deadline_iso) >= 0) {
      return cycle;
    }
  }
  return cycles.length ? cycles[cycles.length - 1] : null;
}

function normalizeConferenceRecord(record) {
  const cycles = getRecordCycles(record);
  const latestCycle = cycles.length ? cycles[cycles.length - 1] : null;

  return {
    conference: record.conference,
    years_in_csv: Array.isArray(record.years_in_csv) ? record.years_in_csv : [],
    latest_tracked_edition:
      record.latest_tracked_edition ||
      (latestCycle ? latestCycle.edition_year : null),
    deadline_iso: latestCycle ? latestCycle.deadline_iso : record.deadline_iso,
    deadline_display: latestCycle ? latestCycle.deadline_display : record.deadline_display,
    deadline_label: latestCycle ? latestCycle.deadline_label : record.deadline_label,
    source_kind: latestCycle ? latestCycle.source_kind : record.source_kind,
    source_url: latestCycle ? latestCycle.source_url : record.source_url,
    submission_cycles: cycles,
  };
}

function buildSupportedConferenceStubs() {
  return SUPPORTED_CONFERENCES.map((conference) => ({
    conference,
    years_in_csv: [],
    latest_tracked_edition: null,
    submission_cycles: [],
    deadline_iso: "",
    deadline_display: "",
    deadline_label: "",
    source_kind: "",
    source_url: "",
  }));
}

function normalizeDataset(payload) {
  const inputConferences = Array.isArray(payload && payload.conferences) ? payload.conferences : [];
  const mergedConferences = new Map();

  buildSupportedConferenceStubs().forEach((record) => {
    mergedConferences.set(record.conference, record);
  });

  inputConferences.forEach((record) => {
    const previous = mergedConferences.get(record.conference);
    mergedConferences.set(record.conference, {
      ...previous,
      ...record,
      years_in_csv: Array.isArray(record.years_in_csv)
        ? record.years_in_csv
        : previous && Array.isArray(previous.years_in_csv)
          ? previous.years_in_csv
          : [],
    });
  });

  const normalizedConferences = [...mergedConferences.values()]
    .map((record) => normalizeConferenceRecord(record))
    .sort((left, right) => left.conference.localeCompare(right.conference));

  return {
    generated_at: payload && payload.generated_at ? payload.generated_at : new Date().toISOString(),
    source_csv: payload && payload.source_csv ? payload.source_csv : CSV_PATH,
    conference_count: normalizedConferences.length,
    conferences: normalizedConferences,
    failures: Array.isArray(payload && payload.failures) ? payload.failures : [],
  };
}

function datasetGeneratedAtMs(payload) {
  if (!payload || !payload.generated_at) {
    return 0;
  }

  const parsed = Date.parse(payload.generated_at);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function datasetWindowCount(payload) {
  try {
    return normalizeDataset(payload).conferences.reduce((sum, record) => sum + getRecordCycles(record).length, 0);
  } catch (error) {
    return 0;
  }
}

function choosePreferredInitialDataset(sources) {
  const viable = sources.filter(
    (source) =>
      source &&
      source.payload &&
      Array.isArray(source.payload.conferences) &&
      source.payload.conferences.length,
  );

  viable.sort((left, right) => {
    if (left.priority !== right.priority) {
      return right.priority - left.priority;
    }

    const timeDelta = datasetGeneratedAtMs(right.payload) - datasetGeneratedAtMs(left.payload);
    if (timeDelta) {
      return timeDelta;
    }

    return datasetWindowCount(right.payload) - datasetWindowCount(left.payload);
  });

  return viable[0] || null;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createEmptyMapByConference(conferences) {
  const result = {};
  conferences.forEach((conference) => {
    result[conference] = new Map();
  });
  return result;
}

function parsePaperRecords(csvText) {
  const rows = parseCsv(csvText);
  if (!rows.length) {
    return [];
  }

  const headers = rows[0].map((header) => normalizeWhitespace((header || "").replace(/^\ufeff/, "")));
  const rowsAsObjects = rows.slice(1).map((row) => {
    const entry = {};
    headers.forEach((header, index) => {
      entry[header] = normalizeWhitespace(String(row[index] || ""));
    });
    return normalizePaperRecord(entry);
  });

  return rowsAsObjects.filter((row) => row.conference && row.title);
}

function cleanDelimitedValue(value) {
  return normalizeWhitespace(String(value || "").replace(/^[,;|\s]+/, "").replace(/[,;|\s]+$/, ""));
}

function cleanAuthorGroupName(value) {
  return cleanDelimitedValue(value)
    .replace(/^"+|"+$/g, "")
    .replace(/^(?:and|with)\s+/i, "")
    .replace(/\s+(?:and|with)$/i, "")
    .replace(/^[-:]+|[-:]+$/g, "")
    .trim();
}

function authorNameTokens(value) {
  return cleanAuthorGroupName(value)
    .replace(/,/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^[^\p{L}]+|[^\p{L}.'’-]+$/gu, ""))
    .filter(Boolean);
}

function looksLikeAuthorToken(token) {
  const normalized = token.replace(/[.'’\-]+$/g, "");
  if (!normalized) {
    return false;
  }

  const lowered = normalized.toLowerCase();
  if (AUTHOR_NAME_PARTICLES.has(lowered)) {
    return true;
  }

  return /^[\p{Lu}][\p{L}'’.-]*$/u.test(normalized);
}

function looksLikeAuthorName(name) {
  const cleaned = cleanAuthorGroupName(name);
  if (!cleaned || /[:!?]/.test(cleaned) || INSTITUTION_KEYWORD_PATTERN.test(cleaned)) {
    return false;
  }

  const tokens = authorNameTokens(cleaned);
  if (tokens.length < 2 || tokens.length > 8) {
    return false;
  }
  if (tokens.some((token) => AUTHOR_NON_NAME_TOKENS.has(token.toLowerCase()))) {
    return false;
  }

  return tokens.every((token) => looksLikeAuthorToken(token));
}

function isLikelySurnameFirstName(left, right) {
  const leftTokens = authorNameTokens(left);
  const rightTokens = authorNameTokens(right);
  if (!leftTokens.length || !rightTokens.length) {
    return false;
  }
  if (leftTokens.length > 3 || rightTokens.length > 4) {
    return false;
  }
  if (!leftTokens.every((token) => looksLikeAuthorToken(token))) {
    return false;
  }
  if (!rightTokens.every((token) => looksLikeAuthorToken(token))) {
    return false;
  }

  return leftTokens.length === 1 || AUTHOR_NAME_PARTICLES.has(leftTokens[0].toLowerCase());
}

function normalizeAuthorName(name) {
  const cleaned = cleanAuthorGroupName(name);
  return looksLikeAuthorName(cleaned) ? cleaned : "";
}

function splitCommaSeparatedAuthorChunk(chunk) {
  const parts = chunk.split(/\s*,\s*/).map(cleanAuthorGroupName).filter(Boolean);
  if (!parts.length) {
    return [];
  }
  if (parts.length === 1) {
    return parts;
  }
  if (parts.length === 2 && isLikelySurnameFirstName(parts[0], parts[1])) {
    return [`${parts[1]} ${parts[0]}`];
  }
  if (parts.length % 2 === 0) {
    const pairedAuthors = [];
    let allPairsLookSurnameFirst = true;
    for (let index = 0; index < parts.length; index += 2) {
      if (!isLikelySurnameFirstName(parts[index], parts[index + 1])) {
        allPairsLookSurnameFirst = false;
        break;
      }
      pairedAuthors.push(`${parts[index + 1]} ${parts[index]}`);
    }
    if (allPairsLookSurnameFirst) {
      return pairedAuthors;
    }
  }

  const standaloneAuthors = [];
  for (const part of parts) {
    const normalizedName = normalizeAuthorName(part);
    if (normalizedName) {
      standaloneAuthors.push(normalizedName);
      continue;
    }
    if (looksLikeInstitutionPiece(part) || standaloneAuthors.length) {
      break;
    }
  }

  return standaloneAuthors.length ? standaloneAuthors : parts;
}

function extractAuthorNamesFromField(authorsField) {
  const names = [];
  parseAuthorGroups(authorsField).forEach((group) => {
    splitAuthorNames(group.namesPart).forEach((name) => {
      names.push(name);
    });
  });
  return [...new Set(names)];
}

function looksLikeAuthorField(value) {
  return extractAuthorNamesFromField(value).length > 0;
}

function normalizePaperRecord(entry) {
  const normalized = { ...entry };
  const titleLooksLikeAuthors = looksLikeAuthorField(normalized.title);
  const authorsLooksLikeAuthors = looksLikeAuthorField(normalized.authors);

  if (titleLooksLikeAuthors && !authorsLooksLikeAuthors && normalized.authors) {
    const originalTitle = normalized.title;
    normalized.title = normalizeWhitespace(normalized.authors);
    normalized.authors = originalTitle;
  }

  return normalized;
}

function uniqueTermObjects(termObjects) {
  const unique = new Map();
  termObjects.forEach((term) => {
    if (!term || !term.key || unique.has(term.key)) {
      return;
    }
    unique.set(term.key, term);
  });
  return [...unique.values()];
}

function humanizeTagLabel(tag) {
  return tag
    .split("-")
    .map((part) => (part.length <= 3 ? part.toUpperCase() : part))
    .join(" ");
}

function normalizeTitleToken(token) {
  return token
    .toLowerCase()
    .replace(/^[^a-z0-9+#/.-]+|[^a-z0-9+#/.-]+$/g, "")
    .replace(/['’]s$/g, "")
    .replace(/^[.-]+|[.-]+$/g, "");
}

function formatTitleToken(token) {
  if (TITLE_KEEPERS.has(token)) {
    return token.toUpperCase();
  }
  if (/^\d/.test(token)) {
    return token.toUpperCase();
  }
  return token;
}

function looksLikeInstitutionPiece(text) {
  const trimmed = cleanDelimitedValue(text);
  if (!trimmed) {
    return false;
  }
  return (
    INSTITUTION_KEYWORD_PATTERN.test(trimmed) ||
    /^[A-Z0-9&.\- ]{3,}$/.test(trimmed) ||
    /university|institute|college|laboratory|laboratories|school/i.test(trimmed)
  );
}

function normalizeInstitutionName(name) {
  const aliases = {
    ucla: "University of California, Los Angeles",
    ucl: "University College London",
    hkust: "Hong Kong University of Science and Technology",
    uiuc: "University of Illinois Urbana-Champaign",
    cmu: "Carnegie Mellon University",
    mit: "Massachusetts Institute of Technology",
  };

  let value = cleanDelimitedValue(name)
    .replace(/^The\s+/i, "")
    .replace(/\bUniversifty\b/gi, "University")
    .replace(/\bCo\.,?\s*Ltd\b/gi, "Co. Ltd.")
    .replace(/\s+&\s+/g, " and ");

  const aliasKey = value.toLowerCase();
  if (aliases[aliasKey]) {
    value = aliases[aliasKey];
  }

  return value;
}

function splitInstitutionChunk(chunk) {
  const commaParts = chunk.split(/\s*,\s*/).map(cleanDelimitedValue).filter(Boolean);
  if (!commaParts.length) {
    return [];
  }

  const institutions = [];
  let buffer = commaParts[0];

  for (let index = 1; index < commaParts.length; index += 1) {
    const part = commaParts[index];
    if (looksLikeInstitutionPiece(buffer) && looksLikeInstitutionPiece(part)) {
      institutions.push(buffer);
      buffer = part;
    } else {
      buffer = `${buffer}, ${part}`;
    }
  }

  institutions.push(buffer);
  return institutions.map(normalizeInstitutionName).filter(Boolean);
}

function splitInstitutions(affiliation) {
  const normalized = cleanDelimitedValue(affiliation)
    .replace(/\s*\/\s*/g, "|")
    .replace(/\s*&\s*/g, "|")
    .replace(/,\s+and\s+/gi, "|")
    .replace(/\s+\+\s+/g, "|")
    .replace(/;\s*/g, "|");

  const rawChunks = normalized.split("|").map(cleanDelimitedValue).filter(Boolean);
  const results = [];

  rawChunks.forEach((chunk) => {
    splitInstitutionChunk(chunk).forEach((institution) => {
      if (institution) {
        results.push(institution);
      }
    });
  });

  if (!results.length && normalized) {
    results.push(normalizeInstitutionName(normalized));
  }

  return [...new Set(results)];
}

function splitAuthorNames(namesPart) {
  const normalized = cleanAuthorGroupName(namesPart)
    .replace(/\s*;\s*/g, "|")
    .replace(/\s+\band\b\s+/gi, "|")
    .replace(/\s*&\s*/g, "|");
  if (!normalized) {
    return [];
  }

  const authorNames = [];
  normalized
    .split("|")
    .map(cleanAuthorGroupName)
    .filter(Boolean)
    .forEach((chunk) => {
      splitCommaSeparatedAuthorChunk(chunk).forEach((name) => {
        const normalizedName = looksLikeAuthorName(name) ? name : normalizeAuthorName(name);
        if (normalizedName) {
          authorNames.push(normalizedName);
        }
      });
    });

  return [...new Set(authorNames)];
}

function parseAuthorGroups(authorsField) {
  const groups = [];
  const input = String(authorsField || "");
  let namesBuffer = "";

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char !== "(") {
      namesBuffer += char;
      continue;
    }

    let pointer = index + 1;
    let depth = 1;
    while (pointer < input.length && depth > 0) {
      if (input[pointer] === "(") {
        depth += 1;
      } else if (input[pointer] === ")") {
        depth -= 1;
      }
      pointer += 1;
    }

    if (depth !== 0) {
      namesBuffer += char;
      continue;
    }

    const namesPart = cleanAuthorGroupName(namesBuffer);
    const affiliation = cleanDelimitedValue(input.slice(index + 1, pointer - 1));
    if (namesPart) {
      groups.push({ namesPart, affiliation });
    }

    namesBuffer = "";
    index = pointer - 1;
  }

  const trailingNames = cleanAuthorGroupName(namesBuffer);
  if (trailingNames) {
    groups.push({ namesPart: trailingNames, affiliation: "" });
  }

  return groups;
}

function extractTagsFromPaper(paper) {
  return uniqueTermObjects(
    String(paper.tags || "")
      .split(";")
      .map((tag) => cleanDelimitedValue(tag).toLowerCase())
      .filter(Boolean)
      .map((tag) => ({
        key: tag,
        label: humanizeTagLabel(tag),
      })),
  );
}

function extractTitleTermsFromPaper(paper) {
  const title = String(paper.title || "")
    .replace(/['’]s\b/g, "")
    .replace(/[^A-Za-z0-9+#/.-]+/g, " ");

  const tokens = title
    .split(/\s+/)
    .map(normalizeTitleToken)
    .filter((token) => {
      if (!token) {
        return false;
      }
      if (TITLE_KEEPERS.has(token)) {
        return true;
      }
      if (token.length < 3) {
        return false;
      }
      return !TITLE_STOP_WORDS.has(token);
    })
    .map((token) => ({
      key: token,
      label: formatTitleToken(token),
    }));

  return uniqueTermObjects(tokens);
}

function extractAuthorsFromPaper(paper) {
  const authorTerms = extractAuthorNamesFromField(paper.authors || "").map((name) => ({
    key: name.toLowerCase(),
    label: name,
  }));
  return uniqueTermObjects(authorTerms);
}

function extractUniversitiesFromPaper(paper) {
  const institutions = [];
  parseAuthorGroups(paper.authors || "").forEach((group) => {
    splitInstitutions(group.affiliation).forEach((institution) => {
      institutions.push({
        key: institution.toLowerCase(),
        label: institution,
      });
    });
  });
  return uniqueTermObjects(institutions);
}

function updateDisplayLabel(existingLabel, nextLabel) {
  if (!existingLabel) {
    return nextLabel;
  }
  if (existingLabel.toUpperCase() === existingLabel && nextLabel.toUpperCase() !== nextLabel) {
    return nextLabel;
  }
  return nextLabel.length > existingLabel.length ? nextLabel : existingLabel;
}

function buildDimensionAnalytics(papers, conferences, conferencePaperCounts, extractor) {
  const overall = new Map();
  const byConference = createEmptyMapByConference(conferences);

  papers.forEach((paper) => {
    const conference = paper.conference;
    const terms = uniqueTermObjects(extractor(paper));

    terms.forEach((term) => {
      if (!overall.has(term.key)) {
        overall.set(term.key, {
          key: term.key,
          label: term.label,
          count: 0,
          conferences: new Set(),
          byConference: {},
        });
      }

      const overallEntry = overall.get(term.key);
      overallEntry.label = updateDisplayLabel(overallEntry.label, term.label);
      overallEntry.count += 1;
      overallEntry.conferences.add(conference);
      overallEntry.byConference[conference] = (overallEntry.byConference[conference] || 0) + 1;

      if (!byConference[conference].has(term.key)) {
        byConference[conference].set(term.key, {
          key: term.key,
          label: term.label,
          count: 0,
        });
      }

      const conferenceEntry = byConference[conference].get(term.key);
      conferenceEntry.label = updateDisplayLabel(conferenceEntry.label, term.label);
      conferenceEntry.count += 1;
    });
  });

  const overallRows = [...overall.values()]
    .map((entry) => {
      const breakdown = Object.entries(entry.byConference)
        .map(([conference, count]) => ({
          conference,
          count,
          share: conferencePaperCounts[conference] ? count / conferencePaperCounts[conference] : 0,
        }))
        .sort((left, right) => right.count - left.count || left.conference.localeCompare(right.conference));

      return {
        key: entry.key,
        label: entry.label,
        count: entry.count,
        share: papers.length ? entry.count / papers.length : 0,
        conferenceCount: entry.conferences.size,
        topConference: breakdown.length ? breakdown[0].conference : "",
        topConferenceCount: breakdown.length ? breakdown[0].count : 0,
        conferenceBreakdown: breakdown,
        conferenceMap: entry.byConference,
      };
    })
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

  const byConferenceRows = {};
  conferences.forEach((conference) => {
    const rows = [...byConference[conference].values()]
      .map((entry) => {
        const overallEntry = overall.get(entry.key);
        return {
          key: entry.key,
          label: entry.label,
          count: entry.count,
          share: conferencePaperCounts[conference] ? entry.count / conferencePaperCounts[conference] : 0,
          conferenceCount: overallEntry ? overallEntry.conferences.size : 1,
          overallCount: overallEntry ? overallEntry.count : entry.count,
        };
      })
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

    byConferenceRows[conference] = rows;
  });

  return {
    overall: overallRows,
    byConference: byConferenceRows,
  };
}

function buildPaperAnalytics(papers) {
  const conferencePaperCounts = {};
  papers.forEach((paper) => {
    conferencePaperCounts[paper.conference] = (conferencePaperCounts[paper.conference] || 0) + 1;
  });

  const conferences = Object.keys(conferencePaperCounts).sort((left, right) => left.localeCompare(right));

  return {
    papers,
    totalPapers: papers.length,
    conferences,
    conferencePaperCounts,
    dimensions: {
      tags: buildDimensionAnalytics(papers, conferences, conferencePaperCounts, extractTagsFromPaper),
      titles: buildDimensionAnalytics(papers, conferences, conferencePaperCounts, extractTitleTermsFromPaper),
      universities: buildDimensionAnalytics(papers, conferences, conferencePaperCounts, extractUniversitiesFromPaper),
      authors: buildDimensionAnalytics(papers, conferences, conferencePaperCounts, extractAuthorsFromPaper),
    },
  };
}

const DIMENSION_EXTRACTORS = {
  tags: extractTagsFromPaper,
  titles: extractTitleTermsFromPaper,
  universities: extractUniversitiesFromPaper,
  authors: extractAuthorsFromPaper,
};

function setDashboardSelection(dimension, selection) {
  if (!state.dashboards[dimension]) {
    return;
  }
  state.dashboards[dimension].selectedTerm = selection;
}

function clearDashboardSelection(dimension) {
  if (!state.dashboards[dimension]) {
    return;
  }
  state.dashboards[dimension].selectedTerm = null;
}

function paperMatchesDimensionTerm(paper, dimension, termKey) {
  const extractor = DIMENSION_EXTRACTORS[dimension];
  if (!extractor) {
    return false;
  }

  return extractor(paper).some((term) => term.key === termKey);
}

function matchingPapersForSelection(dimension, selection) {
  if (!state.analytics || !selection || !selection.key) {
    return [];
  }

  return state.analytics.papers
    .filter((paper) => {
      if (selection.conference && paper.conference !== selection.conference) {
        return false;
      }
      return paperMatchesDimensionTerm(paper, dimension, selection.key);
    })
    .slice()
    .sort((left, right) => {
      const yearDelta = Number(right.year || 0) - Number(left.year || 0);
      if (yearDelta) {
        return yearDelta;
      }
      const conferenceDelta = String(left.conference || "").localeCompare(String(right.conference || ""));
      if (conferenceDelta) {
        return conferenceDelta;
      }
      return String(left.title || "").localeCompare(String(right.title || ""));
    });
}

function getDefaultDashboardConference(analytics) {
  return analytics.conferences
    .slice()
    .sort((left, right) => {
      const leftCount = analytics.conferencePaperCounts[left] || 0;
      const rightCount = analytics.conferencePaperCounts[right] || 0;
      return rightCount - leftCount || left.localeCompare(right);
    })[0];
}

function ensureDashboardDefaults() {
  if (!state.analytics) {
    return;
  }

  const defaultConference = getDefaultDashboardConference(state.analytics);
  Object.keys(state.dashboards).forEach((dimension) => {
    if (!state.dashboards[dimension].conference) {
      state.dashboards[dimension].conference = defaultConference;
    }
  });

  const tagRows = state.analytics.dimensions.tags.overall;
  if (!state.dashboards.tags.selectedKey && tagRows.length) {
    state.dashboards.tags.selectedKey = tagRows[0].key;
  }
}

function getFilteredRows(rows, search) {
  const needle = search.trim().toLowerCase();
  if (!needle) {
    return rows;
  }
  return rows.filter((row) => row.label.toLowerCase().includes(needle));
}

function sortRows(rows, sortState) {
  const direction = sortState.direction === "asc" ? 1 : -1;
  const key = sortState.key;

  return rows.slice().sort((left, right) => {
    const leftValue = left[key];
    const rightValue = right[key];

    if (typeof leftValue === "number" && typeof rightValue === "number") {
      if (leftValue !== rightValue) {
        return direction * (leftValue - rightValue);
      }
    } else {
      const leftText = String(leftValue || "").toLowerCase();
      const rightText = String(rightValue || "").toLowerCase();
      if (leftText !== rightText) {
        return direction * leftText.localeCompare(rightText);
      }
    }

    return String(left.label || "").localeCompare(String(right.label || ""));
  });
}

function toggleSort(sortState, key) {
  if (sortState.key === key) {
    sortState.direction = sortState.direction === "desc" ? "asc" : "desc";
    return;
  }

  sortState.key = key;
  sortState.direction = key === "label" || key === "topConference" ? "asc" : "desc";
}

function formatPercent(value) {
  return `${(value * 100).toFixed(value >= 0.1 ? 1 : 2)}%`;
}

function renderSortButton(dimension, scope, key, label, currentSort) {
  const isActive = currentSort.key === key;
  const arrow = !isActive ? "" : currentSort.direction === "desc" ? " ↓" : " ↑";
  return `
    <button
      class="sort-button ${isActive ? "is-active" : ""}"
      type="button"
      data-sort-dimension="${dimension}"
      data-sort-scope="${scope}"
      data-sort-key="${key}"
    >
      ${escapeHtml(label + arrow)}
    </button>
  `;
}

function renderMetric(primary, secondary, ratio = 0) {
  const width = ratio > 0 ? Math.max(6, Math.round(ratio * 100)) : 0;
  return `
    <div class="metric-cell">
      <span class="metric-cell__primary">${escapeHtml(primary)}</span>
      <span class="metric-cell__secondary">${escapeHtml(secondary)}</span>
      <span class="metric-cell__bar"><span style="width:${width}%"></span></span>
    </div>
  `;
}

function renderStatsTable(dimension, scope, heading, rows, columns, sortState, emptyMessage, rowSelection = null) {
  if (!rows.length) {
    return `
      <section class="viz-card">
        <div class="viz-card__header">
          <h3>${escapeHtml(heading)}</h3>
        </div>
        <div class="empty-state">
          <h3>No rows to show.</h3>
          <p>${escapeHtml(emptyMessage)}</p>
        </div>
      </section>
    `;
  }

  const headerMarkup = columns
    .map((column) => `<th>${renderSortButton(dimension, scope, column.key, column.label, sortState)}</th>`)
    .join("");

  const rowMarkup = rows
    .slice(0, 30)
    .map((row) => {
      const cells = columns.map((column) => `<td>${column.render(row)}</td>`).join("");
      const selection = rowSelection ? rowSelection(row) : null;
      const activeSelection = state.dashboards[dimension] ? state.dashboards[dimension].selectedTerm : null;
      const isSelected =
        selection &&
        activeSelection &&
        selection.key === activeSelection.key &&
        (selection.conference || "") === (activeSelection.conference || "");
      const attributes =
        selection && selection.key
          ? ` class="stats-table__row is-selectable ${isSelected ? "is-selected" : ""}"
              data-select-dimension="${escapeHtml(dimension)}"
              data-select-term-key="${escapeHtml(selection.key)}"
              data-select-term-label="${escapeHtml(selection.label || row.label || selection.key)}"
              data-select-scope="${escapeHtml(selection.scope || scope)}"
              ${selection.conference ? `data-select-conference="${escapeHtml(selection.conference)}"` : ""}`
          : "";
      return `<tr${attributes}>${cells}</tr>`;
    })
    .join("");

  return `
    <section class="viz-card">
      <div class="viz-card__header">
        <h3>${escapeHtml(heading)}</h3>
        <p>Sort any column to change the ranking.</p>
      </div>
      <div class="stats-table-wrap">
        <table class="stats-table">
          <thead>
            <tr>${headerMarkup}</tr>
          </thead>
          <tbody>${rowMarkup}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderTermCloud(dimension, rows, emptyMessage) {
  if (!rows.length) {
    return `
      <div class="empty-state">
        <h3>No terms yet.</h3>
        <p>${escapeHtml(emptyMessage)}</p>
      </div>
    `;
  }

  const items = rows.slice(0, 60);
  const maxCount = items[0].count;
  const minCount = items[items.length - 1].count;
  const spread = Math.max(1, maxCount - minCount);

  return `
    <div class="term-cloud">
      ${items
        .map((row, index) => {
          const scale = 0.9 + ((row.count - minCount) / spread) * 1.9;
          const tone = index % 6;
          const isSelected =
            state.dashboards[dimension] &&
            state.dashboards[dimension].selectedTerm &&
            state.dashboards[dimension].selectedTerm.key === row.key &&
            !state.dashboards[dimension].selectedTerm.conference;
          return `
            <button
              class="term-chip term-chip--${tone} ${isSelected ? "is-selected" : ""}"
              type="button"
              data-cloud-dimension="${dimension}"
              data-cloud-key="${escapeHtml(row.key)}"
              data-cloud-term="${escapeHtml(row.label)}"
              title="${escapeHtml(`${row.label}: ${row.count} papers`)}"
              style="font-size:${scale.toFixed(2)}rem"
            >
              ${escapeHtml(row.label)}
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderLoadingDashboard(title) {
  return `
    <div class="dashboard-stack">
      <section class="insight-banner">
        <div>
          <p class="insight-banner__eyebrow">Preparing</p>
          <h2>${escapeHtml(title)}</h2>
          <p>Building this dashboard from the paper dataset.</p>
        </div>
      </section>
    </div>
  `;
}

function renderAnalyticsError(title, message) {
  return `
    <div class="dashboard-stack">
      <section class="insight-banner">
        <div>
          <p class="insight-banner__eyebrow">Unavailable</p>
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(message)}</p>
        </div>
      </section>
    </div>
  `;
}

function renderPaperRecord(paper) {
  const fields = [
    ["Conference", paper.conference || "—"],
    ["Year", paper.year || "—"],
    ["Source File", paper.source_file || "—"],
    ["Section", paper.section || "—"],
    ["Paper Type", paper.paper_type || "—"],
    ["Authors", paper.authors || "—"],
    ["Award", paper.award || "—"],
    ["Tags", paper.tags || "—"],
  ];

  return `
    <article class="paper-record">
      <h4 class="paper-record__title">${escapeHtml(paper.title || "Untitled")}</h4>
      <div class="paper-record__grid">
        ${fields
          .map(
            ([label, value]) => `
              <div class="paper-record__field">
                <span class="paper-record__label">${escapeHtml(label)}</span>
                <span class="paper-record__value">${escapeHtml(value)}</span>
              </div>
            `,
          )
          .join("")}
      </div>
    </article>
  `;
}

function renderSelectionSummary(dimension, selection, papers) {
  const scopeLabel = selection.conference
    ? `${selection.label} in ${selection.conference}`
    : selection.label;
  const noun = papers.length === 1 ? "paper" : "papers";

  return `
    <div class="viz-card__header">
      <div>
        <h3>${escapeHtml(scopeLabel)}</h3>
        <p>${escapeHtml(`${papers.length} matching ${noun} from accepted_papers.csv`)}</p>
      </div>
      <button
        class="secondary-button"
        type="button"
        data-clear-selection="${escapeHtml(dimension)}"
      >
        Clear
      </button>
    </div>
  `;
}

function renderPaperDrilldown(dimension) {
  const selection = state.dashboards[dimension] && state.dashboards[dimension].selectedTerm;
  if (!selection) {
    return "";
  }

  const papers = matchingPapersForSelection(dimension, selection);
  const bodyMarkup = papers.length
    ? `
      <div class="paper-records">
        ${papers.slice(0, 80).map((paper) => renderPaperRecord(paper)).join("")}
      </div>
      ${papers.length > 80 ? `<p class="paper-records__note">Showing 80 of ${papers.length} matching papers.</p>` : ""}
    `
    : `
      <div class="empty-state">
        <h3>No papers matched.</h3>
        <p>The current selection did not match any accepted-paper rows.</p>
      </div>
    `;

  return `
    <section class="explorer-panel">
      <section class="viz-card">
        ${renderSelectionSummary(dimension, selection, papers)}
        ${bodyMarkup}
      </section>
    </section>
  `;
}

function renderDimensionDashboard(dimension) {
  const config = ANALYTICS_DIMENSIONS[dimension];
  const container = document.getElementById(config.tabId);
  if (!container) {
    return;
  }

  if (state.analyticsStatus === "loading") {
    container.innerHTML = renderLoadingDashboard(config.title);
    return;
  }

  if (state.analyticsStatus === "error" || !state.analytics) {
    container.innerHTML = renderAnalyticsError(config.title, state.analyticsError || "Could not load accepted-paper analytics.");
    return;
  }

  const view = state.dashboards[dimension];
  const analytics = state.analytics.dimensions[dimension];
  const overallRows = getFilteredRows(analytics.overall, view.search);
  const conferenceRows = getFilteredRows(analytics.byConference[view.conference] || [], view.search);

  const overallColumns = [
    {
      key: "label",
      label: config.singular.charAt(0).toUpperCase() + config.singular.slice(1),
      render: (row) => `<span class="entity-name">${escapeHtml(row.label)}</span>`,
    },
    {
      key: "count",
      label: "Papers",
      render: (row) => renderMetric(String(row.count), formatPercent(row.share), row.share),
    },
    {
      key: "conferenceCount",
      label: "Conferences",
      render: (row) => `<span class="entity-meta">${escapeHtml(`${row.conferenceCount}`)}</span>`,
    },
    {
      key: "topConference",
      label: "Top Conference",
      render: (row) =>
        `<span class="entity-meta">${escapeHtml(row.topConference ? `${row.topConference} (${row.topConferenceCount})` : "—")}</span>`,
    },
  ];

  const conferenceColumns = [
    {
      key: "label",
      label: config.singular.charAt(0).toUpperCase() + config.singular.slice(1),
      render: (row) => `<span class="entity-name">${escapeHtml(row.label)}</span>`,
    },
    {
      key: "count",
      label: "Papers",
      render: (row) => renderMetric(String(row.count), formatPercent(row.share), row.share),
    },
    {
      key: "share",
      label: "Conference Share",
      render: (row) => `<span class="entity-meta">${escapeHtml(formatPercent(row.share))}</span>`,
    },
    {
      key: "overallCount",
      label: "Overall Count",
      render: (row) => `<span class="entity-meta">${escapeHtml(String(row.overallCount))}</span>`,
    },
  ];

  container.innerHTML = `
    <div class="dashboard-stack">
      <section class="insight-banner">
        <div>
          <p class="insight-banner__eyebrow">Dashboard</p>
          <h2>${escapeHtml(config.title)}</h2>
          <p>Search, pivot, and sort the live view to scan the signal quickly.</p>
        </div>
        <div class="insight-banner__stats">
          <span>${escapeHtml(`${analytics.overall.length} unique ${config.plural}`)}</span>
          <span>${escapeHtml(`${state.analytics.totalPapers} papers loaded`)}</span>
        </div>
      </section>

      <section class="explorer-panel">
        <div class="control-strip">
          <label class="filter-control">
            Search
            <input
              type="search"
              value="${escapeHtml(view.search)}"
              placeholder="${escapeHtml(config.searchPlaceholder)}"
              data-dashboard-dimension="${dimension}"
              data-dashboard-control="search"
            />
          </label>
          <p class="control-strip__hint">Scan the full conference set, then narrow in.</p>
        </div>

        <div class="viz-grid viz-grid--split">
          <section class="viz-card">
            <div class="viz-card__header">
              <h3>${escapeHtml(config.overallHeading)}</h3>
              <p>Top ${escapeHtml(config.plural)} across every tracked venue.</p>
            </div>
            ${renderTermCloud(dimension, overallRows, config.cloudEmpty)}
          </section>
          ${renderStatsTable(
            dimension,
            "overall",
            `${config.title} Stats`,
            sortRows(overallRows, view.overallSort),
            overallColumns,
            view.overallSort,
            config.cloudEmpty,
            (row) => ({
              key: row.key,
              label: row.label,
              scope: "overall",
            }),
          )}
        </div>
      </section>

      <section class="explorer-panel">
        <div class="control-strip">
          <label class="filter-control">
            Conference
            <select data-dashboard-dimension="${dimension}" data-dashboard-control="conference">
              ${state.analytics.conferences
                .map(
                  (conference) => `
                    <option value="${escapeHtml(conference)}" ${conference === view.conference ? "selected" : ""}>
                      ${escapeHtml(conference)}
                    </option>
                  `,
                )
                .join("")}
            </select>
          </label>
          <p class="control-strip__hint">Switch venues to compare how each one skews.</p>
        </div>

        <div class="viz-grid viz-grid--split">
          <section class="viz-card">
            <div class="viz-card__header">
              <h3>${escapeHtml(`${view.conference} · ${config.conferenceHeading}`)}</h3>
              <p>${escapeHtml(`${state.analytics.conferencePaperCounts[view.conference] || 0} papers in this venue`)}</p>
            </div>
            ${renderTermCloud(dimension, conferenceRows, config.cloudEmpty)}
          </section>
          ${renderStatsTable(
            dimension,
            "conference",
            `${view.conference} Stats`,
            sortRows(conferenceRows, view.conferenceSort),
            conferenceColumns,
            view.conferenceSort,
            config.cloudEmpty,
            (row) => ({
              key: row.key,
              label: row.label,
              scope: "conference",
              conference: view.conference,
            }),
          )}
        </div>
      </section>

      ${renderPaperDrilldown(dimension)}
    </div>
  `;
}

function getHeatmapTagRows() {
  if (!state.analytics) {
    return [];
  }

  const genericSkip = new Set(["networking"]);
  const filtered = state.analytics.dimensions.tags.overall.filter((row) => !genericSkip.has(row.key) && row.share < 0.55);
  return (filtered.length ? filtered : state.analytics.dimensions.tags.overall).slice(0, 14);
}

function renderTagFitExplorer() {
  const container = document.getElementById("tagsDashboard");
  if (!container || !state.analytics || state.analyticsStatus !== "ready") {
    return;
  }

  const view = state.dashboards.tags;
  const heatmapTags = getHeatmapTagRows();
  const selectedKey = heatmapTags.some((row) => row.key === view.selectedKey)
    ? view.selectedKey
    : heatmapTags.length
      ? heatmapTags[0].key
      : "";
  view.selectedKey = selectedKey;

  const selectedTag = state.analytics.dimensions.tags.overall.find((row) => row.key === selectedKey);
  const maxCellCount = heatmapTags.reduce((maxValue, tagRow) => {
    return Math.max(
      maxValue,
      ...state.analytics.conferences.map((conference) => (tagRow.conferenceMap[conference] || 0)),
    );
  }, 1);

  const heatmapMarkup = heatmapTags.length
    ? `
      <div class="heatmap-card">
        <div class="heatmap-grid" style="grid-template-columns: 180px repeat(${heatmapTags.length}, minmax(88px, 1fr));">
          <div class="heatmap-corner">Conference</div>
          ${heatmapTags
            .map(
              (tagRow) => `
                <button
                  class="heatmap-axis ${tagRow.key === selectedKey ? "is-selected" : ""}"
                  type="button"
                  data-heatmap-term="${escapeHtml(tagRow.key)}"
                >
                  ${escapeHtml(tagRow.label)}
                </button>
              `,
            )
            .join("")}
          ${state.analytics.conferences
            .map((conference) => {
              const conferenceCount = state.analytics.conferencePaperCounts[conference] || 1;
              return `
                <div class="heatmap-row-label">${escapeHtml(conference)}</div>
                ${heatmapTags
                  .map((tagRow) => {
                    const count = tagRow.conferenceMap[conference] || 0;
                    const share = count / conferenceCount;
                    const alpha = count ? 0.12 + (count / maxCellCount) * 0.78 : 0.04;
                    return `
                      <button
                        class="heatmap-cell ${tagRow.key === selectedKey ? "is-selected" : ""}"
                        type="button"
                        data-heatmap-term="${escapeHtml(tagRow.key)}"
                        data-heatmap-conference="${escapeHtml(conference)}"
                        style="background-color: rgba(15, 139, 114, ${alpha.toFixed(3)});"
                        title="${escapeHtml(`${conference} · ${tagRow.label}: ${count} papers (${formatPercent(share)})`)}"
                      >
                        <span>${escapeHtml(String(count))}</span>
                      </button>
                    `;
                  })
                  .join("")}
              `;
            })
            .join("")}
        </div>
      </div>
    `
    : `
      <div class="empty-state">
        <h3>No tag heatmap available.</h3>
        <p>The tag analytics were not available for this dataset slice.</p>
      </div>
    `;

  const breakdownRows = sortRows(
    state.analytics.conferences.map((conference) => {
      const count = selectedTag && selectedTag.conferenceMap[conference] ? selectedTag.conferenceMap[conference] : 0;
      const share = (state.analytics.conferencePaperCounts[conference] || 0)
        ? count / state.analytics.conferencePaperCounts[conference]
        : 0;
      return {
        key: conference.toLowerCase(),
        label: conference,
        count,
        share,
        conferenceCount: 1,
        topConference: conference,
      };
    }),
    view.fitSort,
  );

  const breakdownColumns = [
    {
      key: "label",
      label: "Conference",
      render: (row) => `<span class="entity-name">${escapeHtml(row.label)}</span>`,
    },
    {
      key: "count",
      label: "Tagged Papers",
      render: (row) => renderMetric(String(row.count), formatPercent(row.share), row.share),
    },
    {
      key: "share",
      label: "Conference Share",
      render: (row) => `<span class="entity-meta">${escapeHtml(formatPercent(row.share))}</span>`,
    },
  ];

  const fitMarkup = `
    <section class="explorer-panel explorer-panel--accent">
      <div class="control-strip">
        <div>
          <h3 class="control-strip__title">Conference x Tag Map</h3>
          <p class="control-strip__hint">Pick a tag or cell to compare where a topic concentrates.</p>
        </div>
      </div>
      <div class="viz-grid viz-grid--heatmap">
        <section class="viz-card">
          <div class="viz-card__header">
            <h3>Conference-Tag Heatmap</h3>
            <p>Highlights the tags that separate venues most clearly.</p>
          </div>
          ${heatmapMarkup}
        </section>
        ${renderStatsTable(
          "tags",
          "fit",
          selectedTag ? `${selectedTag.label} Across Conferences` : "Tag Breakdown",
          breakdownRows,
          breakdownColumns,
          view.fitSort,
          "No tag selected.",
          (row) =>
            selectedTag
              ? {
                  key: selectedTag.key,
                  label: selectedTag.label,
                  scope: "fit",
                  conference: row.label,
                }
              : null,
        )}
      </div>
    </section>
  `;

  container.insertAdjacentHTML("beforeend", fitMarkup);
}

function renderAnalyticsDashboards() {
  ["tags", "titles", "universities", "authors"].forEach((dimension) => {
    renderDimensionDashboard(dimension);
  });

  if (state.analyticsStatus === "ready") {
    renderTagFitExplorer();
  }
}

async function loadPaperAnalytics() {
  state.analyticsStatus = "loading";
  state.analyticsError = "";
  renderAnalyticsDashboards();
  renderCoverage();

  try {
    const csvText = await fetchText(CSV_PATH, { cache: "no-store" });
    state.papers = parsePaperRecords(csvText);
    state.analytics = buildPaperAnalytics(state.papers);
    state.analyticsStatus = "ready";
    ensureDashboardDefaults();
  } catch (error) {
    state.analyticsStatus = "error";
    state.analyticsError = error.message || "Could not load accepted-paper analytics.";
  }

  renderCoverage();
  renderAnalyticsDashboards();
}

function buildConferenceRecord(conferenceInfo, candidates) {
  const targetEditionYear = Math.max(...candidates.map((candidate) => candidate.editionYear || Number(candidate.deadlineIso.slice(0, 4))));
  let editionCandidates = candidates.filter(
    (candidate) => (candidate.editionYear || Number(candidate.deadlineIso.slice(0, 4))) === targetEditionYear,
  );

  const substantiveCandidates = editionCandidates.filter(
    (candidate) => !/abstract registration/i.test(candidate.label),
  );
  if (substantiveCandidates.length) {
    editionCandidates = substantiveCandidates;
  }

  return normalizeConferenceRecord({
    conference: conferenceInfo.conference,
    years_in_csv: conferenceInfo.years_in_csv,
    latest_tracked_edition: targetEditionYear,
    submission_cycles: editionCandidates.map((candidate) => ({
      deadline_iso: candidate.deadlineIso,
      deadline_label: candidate.label,
      source_kind: candidate.sourceKind || "official",
      source_url: candidate.sourceUrl,
      edition_year: candidate.editionYear || targetEditionYear,
    })),
  });
}

function readEmbeddedDataset() {
  const seedNode = document.getElementById("seedDeadlineData");
  if (!seedNode || !seedNode.textContent.trim()) {
    return null;
  }

  try {
    return JSON.parse(seedNode.textContent);
  } catch (error) {
    return null;
  }
}

function loadStoredDatasets() {
  const datasets = [];

  try {
    for (const key of STORAGE_KEYS) {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        continue;
      }
      datasets.push({
        key,
        payload: JSON.parse(raw),
      });
    }
  } catch (error) {
    return [];
  }

  return datasets;
}

function persistDataset(payload) {
  try {
    window.localStorage.setItem(PRIMARY_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    setRefreshMessage("Sync succeeded, but this browser blocked local saving.", "error");
  }
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();

  if (!response.ok) {
    throw new Error(`Request failed for ${url}.`);
  }
  if (!rawText.trim()) {
    throw new Error(`Empty response from ${url}.`);
  }

  return rawText;
}

async function fetchJson(url, options = {}) {
  const rawText = await fetchText(url, options);
  try {
    return JSON.parse(rawText);
  } catch (error) {
    throw new Error(`Response from ${url} was not valid JSON.`);
  }
}

async function postJson(url, payload = {}) {
  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const rawText = await response.text();
  let parsed = null;

  try {
    parsed = rawText.trim() ? JSON.parse(rawText) : {};
  } catch (error) {
    throw new Error(`Response from ${url} was not valid JSON.`);
  }

  if (!response.ok) {
    throw new Error((parsed && parsed.error) || `Request failed for ${url}.`);
  }

  return parsed;
}

async function fetchServerDataset() {
  return fetchJson(API_DEADLINES_PATH, { cache: "no-store" });
}

async function refreshConferenceViaApi(conference) {
  return postJson(API_REFRESH_PATH, conference ? { conference } : {});
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      row.push(value);
      if (row.some((cell) => cell.length > 0)) {
        rows.push(row);
      }
      row = [];
      value = "";
      continue;
    }

    value += char;
  }

  row.push(value);
  if (row.some((cell) => cell.length > 0)) {
    rows.push(row);
  }

  return rows;
}

function parseConferenceInputsFromCsv(csvText) {
  const rows = parseCsv(csvText);
  if (!rows.length) {
    return [];
  }

  const headers = rows[0].map((header) => normalizeWhitespace((header || "").replace(/^\ufeff/, "")));
  const conferenceIndex = headers.indexOf("conference");
  const yearIndex = headers.indexOf("year");
  if (conferenceIndex === -1 || yearIndex === -1) {
    return [];
  }

  const conferences = new Map();
  for (const row of rows.slice(1)) {
    const conference = normalizeWhitespace(row[conferenceIndex] || "");
    const year = Number(row[yearIndex]);
    if (!conference || !Number.isFinite(year)) {
      continue;
    }
    if (!conferences.has(conference)) {
      conferences.set(conference, new Set());
    }
    conferences.get(conference).add(year);
  }

  return [...conferences.entries()]
    .map(([conference, years]) => ({
      conference,
      years_in_csv: [...years].sort((left, right) => left - right),
    }))
    .sort((left, right) => left.conference.localeCompare(right.conference));
}

function mergeConferenceInputs(inputs) {
  const byConference = new Map();

  inputs.forEach((record) => {
    if (!record || !record.conference) {
      return;
    }
    const years = Array.isArray(record.years_in_csv) ? record.years_in_csv : [];
    byConference.set(record.conference, {
      conference: record.conference,
      years_in_csv: [...new Set(years)].sort((left, right) => left - right),
    });
  });

  SUPPORTED_CONFERENCES.forEach((conference) => {
    if (!byConference.has(conference)) {
      byConference.set(conference, {
        conference,
        years_in_csv: [],
      });
    }
  });

  return [...byConference.values()].sort((left, right) => left.conference.localeCompare(right.conference));
}

async function fetchConferenceInputs() {
  try {
    const csvText = await fetchText(CSV_PATH, { cache: "no-store" });
    return mergeConferenceInputs(parseConferenceInputsFromCsv(csvText));
  } catch (error) {
    if (state.dataset && state.dataset.conferences && state.dataset.conferences.length) {
      return mergeConferenceInputs(state.dataset.conferences.map((record) => ({
        conference: record.conference,
        years_in_csv: record.years_in_csv,
      })));
    }

    const embedded = readEmbeddedDataset();
    if (embedded && embedded.conferences && embedded.conferences.length) {
      return mergeConferenceInputs(embedded.conferences.map((record) => ({
        conference: record.conference,
        years_in_csv: record.years_in_csv,
      })));
    }

    return mergeConferenceInputs([]);
  }
}

function recordForConference(conference) {
  if (!state.dataset || !Array.isArray(state.dataset.conferences)) {
    return null;
  }
  return state.dataset.conferences.find((record) => record.conference === conference) || null;
}

function failureForConference(conference) {
  if (!state.dataset || !Array.isArray(state.dataset.failures)) {
    return null;
  }
  return state.dataset.failures.find((failure) => failure.conference === conference) || null;
}

function updateDatasetForConference(conferenceInfo, nextRecord = null, errorMessage = "") {
  const currentDataset = state.dataset || normalizeDataset({ conferences: [] });
  const existingRecord =
    currentDataset.conferences.find((record) => record.conference === conferenceInfo.conference) ||
    {
      conference: conferenceInfo.conference,
      years_in_csv: Array.isArray(conferenceInfo.years_in_csv) ? conferenceInfo.years_in_csv : [],
      latest_tracked_edition: null,
      deadline_iso: "",
      deadline_display: "",
      deadline_label: "",
      source_kind: "",
      source_url: "",
      submission_cycles: [],
    };

  const mergedRecord = nextRecord
    ? {
        ...existingRecord,
        ...nextRecord,
        years_in_csv:
          Array.isArray(nextRecord.years_in_csv) && nextRecord.years_in_csv.length
            ? nextRecord.years_in_csv
            : Array.isArray(conferenceInfo.years_in_csv) && conferenceInfo.years_in_csv.length
              ? conferenceInfo.years_in_csv
              : existingRecord.years_in_csv,
      }
    : {
        ...existingRecord,
        years_in_csv:
          Array.isArray(conferenceInfo.years_in_csv) && conferenceInfo.years_in_csv.length
            ? conferenceInfo.years_in_csv
            : existingRecord.years_in_csv,
      };

  const conferences = currentDataset.conferences
    .filter((record) => record.conference !== conferenceInfo.conference)
    .concat(mergedRecord)
    .sort((left, right) => left.conference.localeCompare(right.conference));

  const failures = (currentDataset.failures || []).filter(
    (failure) => failure.conference !== conferenceInfo.conference,
  );
  if (errorMessage) {
    failures.push({
      conference: conferenceInfo.conference,
      error: errorMessage,
    });
  }

  state.dataset = normalizeDataset({
    ...currentDataset,
    generated_at: new Date().toISOString(),
    source_csv: currentDataset.source_csv || CSV_PATH,
    conferences,
    failures,
  });
  persistDataset(state.dataset);
}

function buildYearsToTry(yearsInCsv) {
  const currentYear = new Date().getFullYear();
  const latestCsvYear = yearsInCsv.length ? Math.max(...yearsInCsv) : currentYear;
  return [...new Set([currentYear + 1, currentYear, latestCsvYear + 1, latestCsvYear, latestCsvYear - 1])]
    .filter((year) => year >= 2023)
    .sort((left, right) => right - left);
}

function inferTargetEditionYear(conferenceInfo) {
  const currentYear = new Date().getFullYear();
  const latestCsvYear =
    Array.isArray(conferenceInfo.years_in_csv) && conferenceInfo.years_in_csv.length
      ? Math.max(...conferenceInfo.years_in_csv)
      : currentYear;
  return Math.max(currentYear, latestCsvYear);
}

function buildUbiCompRecurringCandidates(conferenceInfo, editionYear = inferTargetEditionYear(conferenceInfo)) {
  const sourceUrl = `https://www.ubicomp.org/ubicomp-iswc-${editionYear}/`;
  return [
    {
      conference: conferenceInfo.conference,
      deadlineIso: `${editionYear - 1}-11-01`,
      label: "IMWUT November Cycle - Paper Submission",
      sourceKind: "official-pattern",
      sourceUrl,
      editionYear,
    },
    {
      conference: conferenceInfo.conference,
      deadlineIso: `${editionYear}-02-01`,
      label: "IMWUT February Cycle - Paper Submission",
      sourceKind: "official-pattern",
      sourceUrl,
      editionYear,
    },
    {
      conference: conferenceInfo.conference,
      deadlineIso: `${editionYear}-05-01`,
      label: "IMWUT May Cycle - Paper Submission",
      sourceKind: "official-pattern",
      sourceUrl,
      editionYear,
    },
  ];
}

function applyUrlTemplate(template, year) {
  const twoDigitYear = String(year).slice(-2);
  return template.replaceAll("{year}", String(year)).replaceAll("{yy}", twoDigitYear);
}

async function refreshConference(conferenceInfo) {
  const hints = CONFERENCE_HINTS[conferenceInfo.conference];
  if (!hints) {
    throw new Error("No refresh rules configured for this conference series yet.");
  }

  const candidates = [];
  const yearsToTry = buildYearsToTry(conferenceInfo.years_in_csv);
  const targetEditionYear = inferTargetEditionYear(conferenceInfo);

  for (const template of hints.candidateUrls) {
    for (const year of yearsToTry) {
      const sourceUrl = applyUrlTemplate(template, year);
      try {
        const rawPage = await fetchRemotePage(sourceUrl);
        const pageText = stripHtml(rawPage);
        candidates.push(...extractFromOfficialPage(conferenceInfo.conference, sourceUrl, pageText, hints.labelPatterns));
      } catch (error) {
        continue;
      }
    }
  }

  if (conferenceInfo.conference === "UbiComp") {
    const currentEditionCandidates = candidates.filter(
      (candidate) => (candidate.editionYear || Number(candidate.deadlineIso.slice(0, 4))) === targetEditionYear,
    );
    if (currentEditionCandidates.length < 2) {
      return buildConferenceRecord(conferenceInfo, buildUbiCompRecurringCandidates(conferenceInfo, targetEditionYear));
    }
  }

  if (!candidates.length) {
    throw new Error("No deadline candidate found from the configured official CFP pages.");
  }

  candidates.sort((left, right) => {
    if (left.deadlineIso !== right.deadlineIso) {
      return left.deadlineIso.localeCompare(right.deadlineIso);
    }
    return labelPriority(left.label) - labelPriority(right.label);
  });

  return buildConferenceRecord(conferenceInfo, candidates);
}

function updateBatchRefreshMessage() {
  if (!state.batchRefresh) {
    return;
  }

  const { completed, total, failed } = state.batchRefresh;
  setRefreshMessage(`Syncing ${completed} of ${total} conferences...`, failed ? "error" : "neutral");
}

async function refreshSingleConference(conferenceInfo, options = {}) {
  const conference = conferenceInfo.conference;
  if (state.pendingRefreshes[conference]) {
    return state.pendingRefreshes[conference];
  }

  state.refreshingConferences[conference] = true;
  state.conferenceRefreshState[conference] = {
    tone: "neutral",
    message: options.batch ? "Queued for sync..." : "Syncing official CFP...",
  };
  render();

  const request = (async () => {
    let errorMessage = "";

    try {
      state.conferenceRefreshState[conference] = {
        tone: "neutral",
        message: "Syncing via local server...",
      };
      render();

      const result = await refreshConferenceViaApi(conference);
      if (!result || (!result.record && !result.failure)) {
        throw new Error("Local refresh API returned no conference record.");
      }

      if (result.failure) {
        errorMessage = result.failure.error || "Refresh failed.";
        updateDatasetForConference(conferenceInfo, null, errorMessage);
        state.conferenceRefreshState[conference] = {
          tone: "error",
          message: errorMessage,
        };
        if (!options.batch) {
          setRefreshMessage(`${conference} sync failed: ${errorMessage}`, "error");
        }
        throw new Error(errorMessage);
      }

      const record = result.record;
      updateDatasetForConference(conferenceInfo, record, "");
      if (result.generated_at && state.dataset) {
        state.dataset.generated_at = result.generated_at;
        persistDataset(state.dataset);
      }
      const cycleCount = getRecordCycles(record).length;
      state.conferenceRefreshState[conference] = {
        tone: "success",
        message: `Updated ${cycleCount} submission window${cycleCount === 1 ? "" : "s"}.`,
      };

      if (!options.batch) {
        setRefreshMessage(`${conference} synced successfully.`, "success");
      }
      return record;
    } catch (error) {
      if (!errorMessage) {
        errorMessage = error instanceof Error ? error.message : String(error);
        updateDatasetForConference(conferenceInfo, null, errorMessage);
        state.conferenceRefreshState[conference] = {
          tone: "error",
          message: errorMessage,
        };

        if (!options.batch) {
          setRefreshMessage(`${conference} sync failed: ${errorMessage}`, "error");
        }
      }
      throw error;
    } finally {
      delete state.pendingRefreshes[conference];
      delete state.refreshingConferences[conference];

      if (state.batchRefresh) {
        state.batchRefresh.completed += 1;
        if (errorMessage) {
          state.batchRefresh.failed += 1;
        }

        if (state.batchRefresh.completed >= state.batchRefresh.total) {
          const failed = state.batchRefresh.failed;
          state.batchRefresh = null;
          setRefreshMessage(
            failed
              ? `Sync complete with ${failed} conference issue${failed === 1 ? "" : "s"}.`
              : "Sync complete. Latest deadlines are ready.",
            failed ? "error" : "success",
          );
        } else {
          updateBatchRefreshMessage();
        }
      }

      render();
    }
  })();

  state.pendingRefreshes[conference] = request;
  return request;
}

async function refreshConferenceByName(conference) {
  const conferenceInputs = await fetchConferenceInputs();
  const conferenceInfo = conferenceInputs.find((item) => item.conference === conference);
  if (!conferenceInfo) {
    setRefreshMessage(`No refresh rules found for ${conference}.`, "error");
    return;
  }

  return refreshSingleConference(conferenceInfo, { batch: false });
}

async function loadInitialData() {
  setRefreshMessage("Loading latest deadline snapshot...");

  const candidates = [];
  try {
    candidates.push({
      payload: await fetchServerDataset(),
      mode: "api",
      priority: 5,
      message: "Local server snapshot loaded.",
    });
  } catch (error) {
    // API is optional for read-only loads.
  }

  loadStoredDatasets().forEach(({ key, payload }) => {
    candidates.push({
      payload,
      mode: "localStorage",
      priority: key === PRIMARY_STORAGE_KEY ? 4 : 1,
      message: key === PRIMARY_STORAGE_KEY ? "Latest local snapshot loaded." : "Older local snapshot loaded.",
    });
  });

  try {
    candidates.push({
      payload: await fetchJson(STATIC_DB_PATH, { cache: "no-store" }),
      mode: "file",
      priority: 3,
      message: "Built-in snapshot loaded.",
    });
  } catch (error) {
    // Fall through to embedded or local snapshots.
  }

  const embedded = readEmbeddedDataset();
  if (embedded && embedded.conferences && embedded.conferences.length) {
    candidates.push({
      payload: embedded,
      mode: "embedded",
      priority: 2,
      message: "Embedded snapshot loaded.",
    });
  }

  const preferred = choosePreferredInitialDataset(candidates);
  if (!preferred) {
    setRefreshMessage("Deadline data could not be loaded.", "error");
    return;
  }

  state.dataset = normalizeDataset(preferred.payload);
  state.dataMode = preferred.mode;
  render();
  setRefreshMessage(preferred.message, "success");
}

async function refreshDataset() {
  if (state.batchRefresh) {
    return;
  }

  try {
    await fetchServerDataset();
    const conferenceInputs = await fetchConferenceInputs();
    state.batchRefresh = {
      total: conferenceInputs.length,
      completed: 0,
      failed: 0,
    };

    conferenceInputs.forEach((conferenceInfo) => {
      if (!state.refreshingConferences[conferenceInfo.conference]) {
        state.conferenceRefreshState[conferenceInfo.conference] = {
          tone: "neutral",
          message: "Queued for sync...",
        };
      }
    });

    render();
    updateBatchRefreshMessage();

    await Promise.allSettled(
      conferenceInputs.map((conferenceInfo) => refreshSingleConference(conferenceInfo, { batch: true })),
    );
  } catch (error) {
    setRefreshMessage(
      (error && error.message) || "Sync failed. Start the local server with python3 website/server.py.",
      "error",
    );
  }
}

function filteredConferences() {
  if (!state.dataset) {
    return [];
  }

  const needle = state.searchTerm.trim().toLowerCase();
  const records = [...state.dataset.conferences].sort((left, right) => {
    const leftCycle = getNextUpcomingCycle(left) || getLatestCycle(left);
    const rightCycle = getNextUpcomingCycle(right) || getLatestCycle(right);
    const leftDays = leftCycle ? daysUntil(leftCycle.deadline_iso) : Number.POSITIVE_INFINITY;
    const rightDays = rightCycle ? daysUntil(rightCycle.deadline_iso) : Number.POSITIVE_INFINITY;

    if (leftDays >= 0 && rightDays >= 0) {
      return leftDays - rightDays;
    }
    if (leftDays >= 0) {
      return -1;
    }
    if (rightDays >= 0) {
      return 1;
    }
    return Math.abs(leftDays) - Math.abs(rightDays);
  });

  if (!needle) {
    return records;
  }

  return records.filter((record) => {
    const years = record.years_in_csv.join(" ");
    const cycleLabels = getRecordCycles(record)
      .map((cycle) => `${cycle.deadline_label} ${cycle.deadline_display}`)
      .join(" ");
    return `${record.conference} ${record.deadline_label} ${years} ${cycleLabels}`.toLowerCase().includes(needle);
  });
}

function formatPaperHistory(years) {
  const cleanYears = [...new Set((years || []).filter(Number.isFinite))].sort((left, right) => left - right);
  if (!cleanYears.length) {
    return "Paper history pending";
  }
  if (cleanYears.length === 1) {
    return `Paper history ${cleanYears[0]}`;
  }
  return `Paper history ${cleanYears[0]}-${cleanYears[cleanYears.length - 1]}`;
}

function renderSummary() {
  const totalEl = document.querySelector("[data-summary='total']");
  const openEl = document.querySelector("[data-summary='open']");
  const urgentEl = document.querySelector("[data-summary='urgent']");
  const refreshedEl = document.querySelector("[data-summary='refreshed']");

  if (!state.dataset) {
    totalEl.textContent = "0";
    openEl.textContent = "0";
    urgentEl.textContent = "No data";
    refreshedEl.textContent = "Waiting";
    return;
  }

  const upcomingCycles = [];
  state.dataset.conferences.forEach((record) => {
    getRecordCycles(record).forEach((cycle) => {
      if (daysUntil(cycle.deadline_iso) >= 0) {
        upcomingCycles.push({
          conference: record.conference,
          cycle,
        });
      }
    });
  });
  upcomingCycles.sort((left, right) => daysUntil(left.cycle.deadline_iso) - daysUntil(right.cycle.deadline_iso));
  const urgent = upcomingCycles[0];

  totalEl.textContent = `${state.dataset.conference_count}`;
  openEl.textContent = `${upcomingCycles.length}`;
  urgentEl.textContent = urgent ? `${urgent.conference} · ${urgent.cycle.deadline_label} · ${deadlineStatus(urgent.cycle.deadline_iso).detail}` : "No future deadlines";
  refreshedEl.textContent = formattedGeneratedAt(state.dataset.generated_at);
}

function renderTracker() {
  const list = document.getElementById("trackerList");
  const records = filteredConferences();

  if (!records.length) {
    list.innerHTML = `
      <div class="empty-state">
        <h3>No conferences match this filter.</h3>
        <p>Try a broader search or run another sync.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = records
    .map((record) => {
      const cycles = getRecordCycles(record);
      const displayCycle = getNextUpcomingCycle(record) || getLatestCycle(record);
      const latestCycle = getLatestCycle(record);
      const refreshState = state.conferenceRefreshState[record.conference];
      const failure = failureForConference(record.conference);
      const isRefreshing = Boolean(state.refreshingConferences[record.conference]);
      const status = displayCycle ? deadlineStatus(displayCycle.deadline_iso) : { tone: "closed", badge: "No Date", detail: "No current submission window found" };
      const cycleMarkup = cycles
        .map((cycle) => {
          const cycleStatus = deadlineStatus(cycle.deadline_iso);
          return `
            <div class="conference-cycle conference-cycle--${cycleStatus.tone}">
              <div class="conference-cycle__row">
                <span class="conference-cycle__label">${cycle.deadline_label}</span>
                <span class="conference-cycle__status">${cycleStatus.detail}</span>
              </div>
              <div class="conference-cycle__date">${cycle.deadline_display}</div>
            </div>
          `;
        })
        .join("");
      const sourceUrl = (displayCycle && displayCycle.source_url) || record.source_url;
      const sourceMarkup = sourceUrl
        ? `<a href="${sourceUrl}" target="_blank" rel="noreferrer">CFP</a>`
        : `<span>Awaiting CFP</span>`;
      const latestLine =
        latestCycle && displayCycle && latestCycle.deadline_iso !== displayCycle.deadline_iso
          ? `<p class="conference-card__latest">Latest window tracked: ${latestCycle.deadline_label} · ${latestCycle.deadline_display}</p>`
          : "";
      const yearText = formatPaperHistory(record.years_in_csv);
      const note = refreshState || failure;
      const noteMarkup = note
        ? `<p class="conference-card__note conference-card__note--${escapeHtml(note.tone || "error")}">${escapeHtml(note.message || note.error)}</p>`
        : "";
      return `
        <article class="conference-card conference-card--${status.tone} ${isRefreshing ? "conference-card--refreshing" : ""}">
          <div class="conference-card__header">
            <div>
              <p class="conference-card__name">${record.conference}</p>
              <p class="conference-card__meta">${yearText} · ${cycles.length} submission window${cycles.length === 1 ? "" : "s"}</p>
            </div>
            <span class="status-pill status-pill--${status.tone}">${status.badge}</span>
          </div>
          <div class="conference-card__date">${displayCycle ? displayCycle.deadline_display : "No tracked cycle"}</div>
          <p class="conference-card__label">${displayCycle ? displayCycle.deadline_label : "No submission deadline found yet"}</p>
          <p class="conference-card__countdown">${status.detail}</p>
          ${latestLine}
          <div class="conference-card__cycles">
            ${cycleMarkup}
          </div>
          <div class="conference-card__footer">
            <span>${record.latest_tracked_edition ? `${record.latest_tracked_edition} edition` : "Awaiting sync"}</span>
            <div class="conference-card__actions">
              ${sourceMarkup}
              <button
                class="secondary-button conference-card__refresh"
                type="button"
                data-refresh-conference="${escapeHtml(record.conference)}"
                ${isRefreshing ? "disabled" : ""}
              >
                ${isRefreshing ? "Syncing..." : "Refresh"}
              </button>
            </div>
          </div>
          ${noteMarkup}
        </article>
      `;
    })
    .join("");
}

function renderCoverage() {
  const coverageList = document.getElementById("coverageList");
  const paperCoverageList = document.getElementById("paperCoverageList");

  if (!coverageList || !paperCoverageList) {
    return;
  }

  if (!state.dataset) {
    coverageList.innerHTML = "";
    paperCoverageList.innerHTML = "";
    return;
  }

  coverageList.innerHTML = state.dataset.conferences
    .map((record) => {
      const cycleCount = getRecordCycles(record).length;
      const deadline = getNextUpcomingCycle(record) || getLatestCycle(record);
      const deadlineLabel = deadline
        ? `${daysUntil(deadline.deadline_iso) >= 0 ? "Next deadline" : "Latest deadline"}: ${deadline.deadline_display}`
        : "Next deadline pending";
      return `
        <li>
          <strong>${record.conference}</strong>
          <span>${formatPaperHistory(record.years_in_csv)}</span>
          <span>${cycleCount} submission window${cycleCount === 1 ? "" : "s"} tracked</span>
          <span>${deadlineLabel}</span>
        </li>
      `;
    })
    .join("");

  if (state.analytics && state.analyticsStatus === "ready") {
    paperCoverageList.innerHTML = state.analytics.conferences
      .map(
        (conference) => `
          <li>
            <strong>${escapeHtml(conference)}</strong>
            <span>${escapeHtml(`${state.analytics.conferencePaperCounts[conference] || 0} accepted papers`)}</span>
            <span>${escapeHtml(`${(state.analytics.dimensions.tags.byConference[conference] || []).length} unique tags`)}</span>
          </li>
        `,
      )
      .join("");
  } else if (state.analyticsStatus === "error") {
    paperCoverageList.innerHTML = `
      <li>
        <strong>Analytics unavailable</strong>
        <span>${escapeHtml(state.analyticsError || "Could not load paper footprint data.")}</span>
      </li>
    `;
  } else {
    paperCoverageList.innerHTML = "<li>Loading paper footprint...</li>";
  }
}

function render() {
  renderRefreshControls();
  renderSummary();
  renderTracker();
  renderCoverage();
  renderAnalyticsDashboards();
}

function renderRefreshControls() {
  const button = document.getElementById("refreshButton");
  if (!button) {
    return;
  }

  if (state.batchRefresh) {
    button.disabled = true;
    button.textContent = `Syncing ${state.batchRefresh.completed}/${state.batchRefresh.total}`;
    return;
  }

  button.disabled = false;
  button.textContent = "Sync All";
}

function setRefreshMessage(message, tone = "neutral") {
  const status = document.getElementById("refreshStatus");
  if (!status) {
    return;
  }
  status.dataset.tone = tone;
  status.textContent = message;
}

function setupTabs() {
  const buttons = Array.from(document.querySelectorAll(".tab-button"));
  const panels = Array.from(document.querySelectorAll(".tab-panel"));

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.tab;
      state.activeTab = target;

      buttons.forEach((candidate) => {
        const isActive = candidate.dataset.tab === target;
        candidate.classList.toggle("is-active", isActive);
        candidate.setAttribute("aria-selected", String(isActive));
      });

      panels.forEach((panel) => {
        panel.classList.toggle("is-active", panel.id === target);
      });
    });
  });
}

function setupSearch() {
  const input = document.getElementById("conferenceSearch");
  input.addEventListener("input", (event) => {
    state.searchTerm = event.target.value;
    renderTracker();
  });
}

function handleDashboardInput(event) {
  const target = event.target;
  if (!target || target.dataset.dashboardControl !== "search") {
    return;
  }

  const dimension = target.dataset.dashboardDimension;
  if (!dimension || !state.dashboards[dimension]) {
    return;
  }

  state.dashboards[dimension].search = target.value;
  renderAnalyticsDashboards();
}

function handleDashboardChange(event) {
  const target = event.target;
  if (!target || target.dataset.dashboardControl !== "conference") {
    return;
  }

  const dimension = target.dataset.dashboardDimension;
  if (!dimension || !state.dashboards[dimension]) {
    return;
  }

  state.dashboards[dimension].conference = target.value;
  renderAnalyticsDashboards();
}

function handleDashboardClick(event) {
  const clearSelection = event.target.closest("[data-clear-selection]");
  if (clearSelection) {
    clearDashboardSelection(clearSelection.dataset.clearSelection);
    renderAnalyticsDashboards();
    return;
  }

  const refreshTrigger = event.target.closest("[data-refresh-conference]");
  if (refreshTrigger) {
    refreshConferenceByName(refreshTrigger.dataset.refreshConference);
    return;
  }

  const sortButton = event.target.closest("[data-sort-dimension]");
  if (sortButton) {
    const dimension = sortButton.dataset.sortDimension;
    const scope = sortButton.dataset.sortScope;
    const key = sortButton.dataset.sortKey;
    if (state.dashboards[dimension]) {
      const sortState = state.dashboards[dimension][`${scope}Sort`];
      if (sortState) {
        toggleSort(sortState, key);
        renderAnalyticsDashboards();
      }
    }
    return;
  }

  const cloudTerm = event.target.closest("[data-cloud-dimension]");
  if (cloudTerm) {
    const dimension = cloudTerm.dataset.cloudDimension;
    const key = cloudTerm.dataset.cloudKey;
    const term = cloudTerm.dataset.cloudTerm;
    if (state.dashboards[dimension]) {
      setDashboardSelection(dimension, {
        key: key || "",
        label: term || key || "",
        scope: "overall",
        conference: "",
      });
      renderAnalyticsDashboards();
    }
    return;
  }

  const selectedRow = event.target.closest("[data-select-term-key]");
  if (selectedRow) {
    const dimension = selectedRow.dataset.selectDimension;
    if (state.dashboards[dimension]) {
      setDashboardSelection(dimension, {
        key: selectedRow.dataset.selectTermKey || "",
        label: selectedRow.dataset.selectTermLabel || selectedRow.dataset.selectTermKey || "",
        scope: selectedRow.dataset.selectScope || "overall",
        conference: selectedRow.dataset.selectConference || "",
      });
      renderAnalyticsDashboards();
    }
    return;
  }

  const heatmapHeader = event.target.closest("[data-heatmap-term]");
  if (heatmapHeader) {
    state.dashboards.tags.selectedKey = heatmapHeader.dataset.heatmapTerm || state.dashboards.tags.selectedKey;
    const selectedTag = state.analytics.dimensions.tags.overall.find(
      (row) => row.key === state.dashboards.tags.selectedKey,
    );
    if (heatmapHeader.dataset.heatmapConference) {
      state.dashboards.tags.conference = heatmapHeader.dataset.heatmapConference;
    }
    if (selectedTag) {
      setDashboardSelection("tags", {
        key: selectedTag.key,
        label: selectedTag.label,
        scope: heatmapHeader.dataset.heatmapConference ? "fit" : "overall",
        conference: heatmapHeader.dataset.heatmapConference || "",
      });
    }
    renderAnalyticsDashboards();
  }
}

function setupEvents() {
  document.getElementById("refreshButton").addEventListener("click", refreshDataset);
  setupTabs();
  setupSearch();
  document.addEventListener("input", handleDashboardInput);
  document.addEventListener("change", handleDashboardChange);
  document.addEventListener("click", handleDashboardClick);
}

document.addEventListener("DOMContentLoaded", () => {
  setupEvents();
  loadInitialData();
  loadPaperAnalytics();
});
