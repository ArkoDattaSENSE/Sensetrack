#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const zlib = require("zlib");
const { promisify } = require("util");

const gunzip = promisify(zlib.gunzip);
const inflate = promisify(zlib.inflate);
const brotliDecompress = zlib.brotliDecompress ? promisify(zlib.brotliDecompress) : null;

const PROJECT_ROOT = path.resolve(__dirname, "..");
const WEBSITE_ROOT = path.join(PROJECT_ROOT, "website");
const DB_PATH = path.join(WEBSITE_ROOT, "db", "conference_deadlines.json");
const CSV_CANDIDATES = [
  path.join(PROJECT_ROOT, "cleaned", "accepted_papers.csv"),
  path.join(PROJECT_ROOT, "accepted_papers.csv"),
];
const USER_AGENT = "ConferenceDateTracker/1.0 (+github-pages)";
const REQUEST_TIMEOUT_MS = 20000;
const MAX_REDIRECTS = 5;

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

const DATE_PATTERN = new RegExp(
  "(?:(?:Mon|Monday|Tue|Tuesday|Wed|Wednesday|Thu|Thursday|Fri|Friday|Sat|Saturday|Sun|Sunday),?\\s+)?"
    + "(?:(?<month1>Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|"
    + "Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\s+(?<day1>\\d{1,2})(?:st|nd|rd|th)?"
    + "(?:\\s*,\\s*|\\s+)?(?<year1>\\d{4})?|"
    + "(?<day2>\\d{1,2})(?:st|nd|rd|th)?\\s+"
    + "(?<month2>Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|"
    + "Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:\\s*,\\s*|\\s+)?(?<year2>\\d{4})?)",
  "gi",
);

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
    labelPatterns: ["paper submission", "submission deadline", "main conference paper submission", "full paper due"],
  },
  MMSys: {
    candidateUrls: [
      "https://{year}.acmmmsys.org/call-for-papers/",
      "https://www.acmmmsys.org/{year}/call-for-papers/",
    ],
    labelPatterns: ["paper submission", "submission deadline", "abstract registration", "submission"],
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
    labelPatterns: ["paper submission deadline", "paper submission", "submission deadline", "abstract registration", "paper registration"],
  },
  MobiSys: {
    candidateUrls: ["https://www.sigmobile.org/mobisys/{year}/call_for_papers/"],
    labelPatterns: ["paper submission", "submission deadline", "abstract registration"],
  },
  NSDI: {
    candidateUrls: ["https://www.usenix.org/conference/nsdi{yy}/call-for-papers"],
    labelPatterns: ["paper submissions", "paper submission", "abstract registrations", "full paper submissions"],
  },
  PerCom: {
    candidateUrls: [
      "https://www.percom.org/call-for-papers/",
      "https://percom.org/call-for-papers/",
      "https://percom{year}.org/call-for-papers/",
    ],
    labelPatterns: ["paper submission", "submission deadline", "abstract registration", "submission via edas"],
  },
  SenSys: {
    candidateUrls: ["https://sensys.acm.org/{year}/cfp.html", "https://sensys.acm.org/{year}/index.html"],
    labelPatterns: ["full paper submission", "paper submission", "abstract registration"],
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

class RefreshError extends Error {
  constructor(message) {
    super(message);
    this.name = "RefreshError";
  }
}

function discoverCsvPath() {
  for (const candidate of CSV_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new RefreshError("Could not find accepted_papers.csv.");
}

function basePayload() {
  return {
    generated_at: "",
    source_csv: path.relative(PROJECT_ROOT, discoverCsvPath()),
    conference_count: 0,
    conferences: [],
    failures: [],
  };
}

function readDatabase() {
  if (!fs.existsSync(DB_PATH)) {
    return basePayload();
  }

  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === "\"") {
      if (inQuotes && nextChar === "\"") {
        value += "\"";
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
      if (row.some(function hasContent(cell) { return cell.length > 0; })) {
        rows.push(row);
      }
      row = [];
      value = "";
      continue;
    }

    value += char;
  }

  row.push(value);
  if (row.some(function hasContent(cell) { return cell.length > 0; })) {
    rows.push(row);
  }

  return rows;
}

function loadConferenceInputs() {
  const csvText = fs.readFileSync(discoverCsvPath(), "utf8");
  const rows = parseCsv(csvText);
  if (!rows.length) {
    return [];
  }

  const headers = rows[0].map(function cleanHeader(header) {
    return normalizeWhitespace(String(header || "").replace(/^\ufeff/, ""));
  });
  const conferenceIndex = headers.indexOf("conference");
  const yearIndex = headers.indexOf("year");
  const conferences = {};

  Object.keys(CONFERENCE_HINTS).forEach(function initConference(name) {
    conferences[name] = new Set();
  });

  if (conferenceIndex === -1 || yearIndex === -1) {
    return Object.keys(CONFERENCE_HINTS).sort().map(function toRecord(conference) {
      return {
        conference: conference,
        years_in_csv: [],
      };
    });
  }

  rows.slice(1).forEach(function parseRow(row) {
    const conference = normalizeWhitespace(row[conferenceIndex] || "");
    const year = Number(normalizeWhitespace(row[yearIndex] || ""));
    if (!conference || !Object.prototype.hasOwnProperty.call(conferences, conference) || !Number.isFinite(year)) {
      return;
    }
    conferences[conference].add(year);
  });

  return Object.keys(conferences).sort().map(function toRecord(conference) {
    return {
      conference: conference,
      years_in_csv: Array.from(conferences[conference]).sort(function sortYears(left, right) {
        return left - right;
      }),
    };
  });
}

function parseCharset(contentType) {
  const match = String(contentType || "").match(/charset=([^;]+)/i);
  if (!match) {
    return "utf8";
  }

  const charset = match[1].trim().toLowerCase();
  if (charset === "utf-8" || charset === "utf8") {
    return "utf8";
  }
  if (charset === "iso-8859-1" || charset === "latin1") {
    return "latin1";
  }
  return "utf8";
}

async function decodeBuffer(buffer, encoding) {
  const normalized = String(encoding || "").toLowerCase();
  if (normalized.includes("gzip")) {
    return gunzip(buffer);
  }
  if (normalized.includes("deflate")) {
    return inflate(buffer);
  }
  if (normalized.includes("br") && brotliDecompress) {
    return brotliDecompress(buffer);
  }
  return buffer;
}

function httpClientFor(url) {
  return url.startsWith("https:") ? https : http;
}

function fetchText(url, redirectCount) {
  const attempt = typeof redirectCount === "number" ? redirectCount : 0;
  if (attempt > MAX_REDIRECTS) {
    return Promise.reject(new RefreshError("Too many redirects while fetching " + url + "."));
  }

  return new Promise(function executor(resolve, reject) {
    const client = httpClientFor(url);
    const request = client.get(
      url,
      {
        headers: {
          "User-Agent": USER_AGENT,
          "Accept-Encoding": "gzip, deflate, br",
        },
      },
      function onResponse(response) {
        const statusCode = response.statusCode || 0;
        const location = response.headers.location;

        if (statusCode >= 300 && statusCode < 400 && location) {
          response.resume();
          const nextUrl = new URL(location, url).toString();
          fetchText(nextUrl, attempt + 1).then(resolve).catch(reject);
          return;
        }

        if (statusCode >= 400) {
          response.resume();
          reject(new RefreshError("Request failed for " + url + " with HTTP " + statusCode + "."));
          return;
        }

        const chunks = [];
        response.on("data", function onData(chunk) {
          chunks.push(chunk);
        });
        response.on("end", function onEnd() {
          decodeBuffer(Buffer.concat(chunks), response.headers["content-encoding"])
            .then(function onDecoded(buffer) {
              const charset = parseCharset(response.headers["content-type"]);
              resolve(buffer.toString(charset));
            })
            .catch(function onDecodeError(error) {
              reject(new RefreshError("Could not decode response from " + url + ": " + error.message));
            });
        });
      },
    );

    request.setTimeout(REQUEST_TIMEOUT_MS, function onTimeout() {
      request.destroy(new RefreshError("Request timed out for " + url + "."));
    });

    request.on("error", function onError(error) {
      reject(new RefreshError("Request failed for " + url + ": " + error.message));
    });
  });
}

function stripHtml(rawHtml) {
  const withLineBreaks = String(rawHtml || "")
    .replace(/<(?:s|strike|del)\b[^>]*>[\s\S]*?<\/(?:s|strike|del)>/gi, " ")
    .replace(/~~[\s\S]*?~~/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|tr|td|th|li|ul|ol|table|h1|h2|h3|h4|h5|h6)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  const decoded = withLineBreaks
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/~~[\s\S]*?~~/g, " ");

  return decoded
    .split("\n")
    .map(normalizeWhitespace)
    .filter(Boolean)
    .join("\n");
}

function monthNumber(value) {
  return MONTH_LOOKUP[String(value || "").toLowerCase().replace(/\.$/, "")];
}

function inferYearFromUrl(url) {
  const match = String(url || "").match(/(20\d{2})/);
  return match ? Number(match[1]) : null;
}

function parseDatesFromText(text, fallbackYear) {
  const results = [];
  const source = String(text || "");
  const datePattern = new RegExp(DATE_PATTERN.source, "gi");

  for (const match of source.matchAll(datePattern)) {
    const groups = match.groups || {};
    const month = groups.month1 || groups.month2;
    const day = groups.day1 || groups.day2;
    const year = groups.year1 || groups.year2;
    const resolvedYear = year ? Number(year) : fallbackYear;

    if (!month || !day || !resolvedYear) {
      continue;
    }

    const dateValue = new Date(Date.UTC(resolvedYear, monthNumber(month) - 1, Number(day)));
    if (Number.isNaN(dateValue.getTime())) {
      continue;
    }

    results.push(dateValue.toISOString().slice(0, 10));
  }

  return results;
}

function titleCaseWords(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/\b\w/g, function upper(char) {
      return char.toUpperCase();
    });
}

function labelPriority(label) {
  const priorities = [
    ["paper submission deadline", 6],
    ["paper submission", 5],
    ["full paper submission", 5],
    ["full papers", 4],
    ["submission deadline", 4],
    ["submission via edas", 4],
    ["extended abstracts", 3],
    ["paper registration", 2],
    ["abstract registration", 1],
  ];

  const lowered = String(label || "").toLowerCase();
  for (const priority of priorities) {
    if (lowered.includes(priority[0])) {
      return priority[1];
    }
  }
  return 0;
}

function hasCycleContext(value) {
  const normalized = normalizeWhitespace(value);
  return Boolean(
    normalized.match(/\bcycle\s+[a-z0-9ivx]+\b/i)
      || normalized.match(/\bround\s+[a-z0-9ivx]+\b/i)
      || normalized.match(/\b(?:spring|summer|fall|winter)\b/i)
      || normalized.match(/\b(?:first|second|third|fourth|1st|2nd|3rd|4th|\d+(?:st|nd|rd|th))\s+(?:call|deadline|round|cycle)\b/i),
  );
}

function cleanContextLine(value) {
  return normalizeWhitespace(
    String(value || "")
      .replace(/[:|\-]\s*$/, "")
      .replace(/\s*\((?:expired|open|closed)\)\s*$/i, ""),
  );
}

function findCycleContext(lines, index) {
  for (let pointer = index; pointer >= Math.max(0, index - 8); pointer -= 1) {
    const line = cleanContextLine(lines[pointer]);
    if (line && hasCycleContext(line)) {
      return line;
    }
  }
  return "";
}

function trimToStopToken(value) {
  const source = String(value || "");
  const lowered = source.toLowerCase();
  const cutoffs = STOP_LINE_TOKENS
    .map(function findToken(token) { return lowered.indexOf(token); })
    .filter(function isValid(index) { return index > 0; });
  return cutoffs.length ? source.slice(0, Math.min.apply(Math, cutoffs)) : source;
}

function dedupeDates(dates) {
  return Array.from(new Set(Array.isArray(dates) ? dates : []));
}

function collapseInlineDates(dates, contextValue) {
  const unique = dedupeDates(dates);
  if (unique.length <= 1 || hasCycleContext(contextValue || "")) {
    return unique;
  }
  return unique.slice(-1);
}

function extractInlineDates(line, matchedLabel, fallbackYear) {
  const source = String(line || "");
  const startIndex = source.toLowerCase().indexOf(String(matchedLabel || "").toLowerCase());

  if (startIndex < 0) {
    return collapseInlineDates(parseDatesFromText(trimToStopToken(source), fallbackYear), source);
  }

  const suffixDates = parseDatesFromText(trimToStopToken(source.slice(startIndex)), fallbackYear);
  if (suffixDates.length) {
    return collapseInlineDates(suffixDates, source);
  }

  const prefixDates = parseDatesFromText(source.slice(0, startIndex), fallbackYear);
  return prefixDates.slice(-1);
}

function collectRecentCycleHeaders(lines, index, compiledPatterns, fallbackYear) {
  const headers = [];
  for (let pointer = Math.max(0, index - 12); pointer < index; pointer += 1) {
    const line = cleanContextLine(lines[pointer]);
    if (!line) {
      continue;
    }
    const lowered = line.toLowerCase();
    if (compiledPatterns.some(function anyPattern(compiled) { return compiled.test(line); })) {
      continue;
    }
    if (STOP_LINE_TOKENS.some(function hasStopToken(token) { return lowered.includes(token); })) {
      continue;
    }
    if (parseDatesFromText(line, fallbackYear).length) {
      continue;
    }
    if (hasCycleContext(line) && !headers.includes(line)) {
      headers.push(line);
    }
  }
  return headers.slice(-4);
}

function collectLookaheadDateGroups(lines, index, compiledPatterns, fallbackYear) {
  const groups = [];
  for (const lookahead of lines.slice(index + 1, index + 6)) {
    const lowered = lookahead.toLowerCase();
    if (compiledPatterns.some(function anyPattern(compiled) { return compiled.test(lookahead); })) {
      break;
    }
    if (STOP_LINE_TOKENS.some(function hasStopToken(token) { return lowered.includes(token); })) {
      break;
    }
    const dates = collapseInlineDates(parseDatesFromText(trimToStopToken(lookahead), fallbackYear), lookahead);
    if (dates.length) {
      groups.push([lookahead, dates]);
    }
  }
  return groups;
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

function formatDisplayDate(deadlineIso) {
  const parts = String(deadlineIso || "").split("-").map(Number);
  const parsed = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return parsed.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "2-digit",
    timeZone: "UTC",
  });
}

function normalizeSubmissionCycles(cycles) {
  const byDate = new Map();

  (Array.isArray(cycles) ? cycles : []).forEach(function eachCycle(cycle) {
    if (!cycle || !cycle.deadline_iso) {
      return;
    }

    const normalized = {
      deadline_iso: cycle.deadline_iso,
      deadline_display: cycle.deadline_display || formatDisplayDate(cycle.deadline_iso),
      deadline_label: cycle.deadline_label || "Submission Deadline",
      source_kind: cycle.source_kind || "official",
      source_url: cycle.source_url || "",
      edition_year: cycle.edition_year || Number(String(cycle.deadline_iso).slice(0, 4)),
    };

    byDate.set(normalized.deadline_iso, chooseBetterCycle(byDate.get(normalized.deadline_iso), normalized));
  });

  return Array.from(byDate.values()).sort(function sortCycles(left, right) {
    if (left.deadline_iso !== right.deadline_iso) {
      return left.deadline_iso.localeCompare(right.deadline_iso);
    }
    return labelPriority(right.deadline_label) - labelPriority(left.deadline_label);
  });
}

function normalizeConferenceRecord(record) {
  const cycles = normalizeSubmissionCycles(record.submission_cycles || []);
  const latestCycle = cycles.length ? cycles[cycles.length - 1] : null;

  return {
    conference: record.conference,
    years_in_csv: Array.isArray(record.years_in_csv) ? record.years_in_csv : [],
    latest_tracked_edition: record.latest_tracked_edition || (latestCycle ? latestCycle.edition_year : null),
    deadline_iso: latestCycle ? latestCycle.deadline_iso : (record.deadline_iso || ""),
    deadline_display: latestCycle ? latestCycle.deadline_display : (record.deadline_display || ""),
    deadline_label: latestCycle ? latestCycle.deadline_label : (record.deadline_label || ""),
    source_kind: latestCycle ? latestCycle.source_kind : (record.source_kind || ""),
    source_url: latestCycle ? latestCycle.source_url : (record.source_url || ""),
    submission_cycles: cycles,
  };
}

function extractFromOfficialPage(conference, sourceUrl, pageText, labelPatterns) {
  const candidates = new Map();
  const fallbackYear = inferYearFromUrl(sourceUrl);
  const lines = String(pageText || "")
    .split("\n")
    .map(function trimLine(line) { return line.trim(); })
    .filter(Boolean);
  const compiledPatterns = labelPatterns.map(function compile(pattern) {
    return new RegExp(pattern, "i");
  });

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    for (const pattern of compiledPatterns) {
      const match = line.match(pattern);
      if (!match) {
        continue;
      }

      const cycleContext = findCycleContext(lines, index);
      const baseLabel = titleCaseWords(match[0]);
      const label = cycleContext ? cycleContext + " - " + baseLabel : baseLabel;
      const labeledDates = [];
      const inlineDates = extractInlineDates(line, match[0], fallbackYear);
      if (inlineDates.length) {
        labeledDates.push([label, inlineDates]);
      } else {
        const dateGroups = collectLookaheadDateGroups(lines, index, compiledPatterns, fallbackYear);
        const cycleHeaders = collectRecentCycleHeaders(lines, index, compiledPatterns, fallbackYear);
        if (dateGroups.length && cycleHeaders.length >= dateGroups.length) {
          const activeHeaders = cycleHeaders.slice(-dateGroups.length);
          activeHeaders.forEach(function pairHeader(header, headerIndex) {
            labeledDates.push([header + " - " + baseLabel, dateGroups[headerIndex][1]]);
          });
        }
        if (!labeledDates.length) {
          const collectedDates = [];
          dateGroups.forEach(function appendDates(group) {
            collectedDates.push.apply(collectedDates, group[1]);
          });
          if (collectedDates.length) {
            labeledDates.push([label, collapseInlineDates(collectedDates, line)]);
          }
        }
      }

      for (const labeledDate of labeledDates) {
        const candidateLabel = labeledDate[0];
        for (const deadlineIso of labeledDate[1]) {
          const key = deadlineIso + "::" + candidateLabel;
          candidates.set(key, {
            conference: conference,
            deadline_iso: deadlineIso,
            label: candidateLabel,
            source_url: sourceUrl,
            edition_year: fallbackYear || Number(deadlineIso.slice(0, 4)),
            source_kind: "official",
          });
        }
      }
    }
  }

  if (conference === "MobiHoc") {
    for (const entry of Array.from(candidates.entries())) {
      if (entry[1].label.toLowerCase().includes("registration")) {
        candidates.delete(entry[0]);
      }
    }
  }

  return Array.from(candidates.values()).sort(function sortCandidates(left, right) {
    if (left.deadline_iso !== right.deadline_iso) {
      return left.deadline_iso.localeCompare(right.deadline_iso);
    }
    return labelPriority(left.label) - labelPriority(right.label);
  });
}

function buildYearsToTry(yearsInCsv) {
  const currentYear = new Date().getUTCFullYear();
  const latestCsvYear = yearsInCsv.length ? Math.max.apply(Math, yearsInCsv) : currentYear;
  const years = [
    currentYear + 1,
    currentYear,
    latestCsvYear + 1,
    latestCsvYear,
    latestCsvYear - 1,
  ];

  return Array.from(new Set(years)).sort(function sortYears(left, right) {
    return right - left;
  });
}

function applyUrlTemplate(template, year) {
  return String(template)
    .split("{year}")
    .join(String(year))
    .split("{yy}")
    .join(String(year).slice(-2));
}

function inferTargetEditionYear(conferenceInfo) {
  const currentYear = new Date().getUTCFullYear();
  const years = Array.isArray(conferenceInfo.years_in_csv) ? conferenceInfo.years_in_csv : [];
  const latestCsvYear = years.length ? Math.max.apply(Math, years) : currentYear;
  return Math.max(currentYear, latestCsvYear);
}

function buildUbiCompRecurringCandidates(conferenceInfo, editionYear) {
  const targetYear = editionYear || inferTargetEditionYear(conferenceInfo);
  const sourceUrl = "https://www.ubicomp.org/ubicomp-iswc-" + targetYear + "/";
  return [
    {
      conference: conferenceInfo.conference,
      deadline_iso: String(targetYear - 1) + "-11-01",
      label: "IMWUT November Cycle - Paper Submission",
      source_kind: "official-pattern",
      source_url: sourceUrl,
      edition_year: targetYear,
    },
    {
      conference: conferenceInfo.conference,
      deadline_iso: String(targetYear) + "-02-01",
      label: "IMWUT February Cycle - Paper Submission",
      source_kind: "official-pattern",
      source_url: sourceUrl,
      edition_year: targetYear,
    },
    {
      conference: conferenceInfo.conference,
      deadline_iso: String(targetYear) + "-05-01",
      label: "IMWUT May Cycle - Paper Submission",
      source_kind: "official-pattern",
      source_url: sourceUrl,
      edition_year: targetYear,
    },
  ];
}

function buildConferenceRecord(conferenceInfo, candidates) {
  const targetEditionYear = Math.max.apply(
    Math,
    candidates.map(function editionYear(candidate) { return candidate.edition_year; }),
  );
  let editionCandidates = candidates.filter(function filterEdition(candidate) {
    return candidate.edition_year === targetEditionYear;
  });
  const substantive = editionCandidates.filter(function filterSubstantive(candidate) {
    return !candidate.label.toLowerCase().includes("abstract registration");
  });
  if (substantive.length) {
    editionCandidates = substantive;
  }

  return normalizeConferenceRecord({
    conference: conferenceInfo.conference,
    years_in_csv: conferenceInfo.years_in_csv || [],
    latest_tracked_edition: targetEditionYear,
    submission_cycles: editionCandidates.map(function toCycle(candidate) {
      return {
        deadline_iso: candidate.deadline_iso,
        deadline_display: formatDisplayDate(candidate.deadline_iso),
        deadline_label: candidate.label,
        source_kind: candidate.source_kind || "official",
        source_url: candidate.source_url,
        edition_year: candidate.edition_year,
      };
    }),
  });
}

function formatYears(years) {
  const cleaned = Array.from(new Set((Array.isArray(years) ? years : []).filter(Number.isFinite)))
    .sort(function sortYears(left, right) {
      return left - right;
    });
  return cleaned.length ? cleaned.join(", ") : "none";
}

function pluralize(count, singular, plural) {
  return String(count) + " " + (count === 1 ? singular : plural);
}

function formatAttemptLine(attempt) {
  if (attempt.status === "ok") {
    return "    ok   " + attempt.url + " (" + pluralize(attempt.candidate_count, "candidate", "candidates") + ")";
  }

  if (attempt.status === "fallback") {
    return "    fallback " + attempt.url + " (" + pluralize(attempt.candidate_count, "candidate", "candidates") + ")";
  }

  return "    fail " + attempt.url + " (" + attempt.error + ")";
}

function logAttemptDetails(diagnostics, options) {
  const attempts = diagnostics && Array.isArray(diagnostics.attempts) ? diagnostics.attempts : [];
  if (!attempts.length) {
    console.log("  url attempts: none");
    return;
  }

  const verbose = Boolean(options && options.verbose);
  const forceAll = Boolean(options && options.forceAll);
  const showAll = verbose || forceAll;
  const visibleAttempts = showAll
    ? attempts
    : attempts.filter(function onlyVisible(attempt) {
      return attempt.status === "ok" || attempt.status === "fallback";
    }).slice(0, 3);

  console.log("  url attempts:");
  visibleAttempts.forEach(function printAttempt(attempt) {
    console.log(formatAttemptLine(attempt));
  });

  if (visibleAttempts.length < attempts.length) {
    console.log("    ... " + (attempts.length - visibleAttempts.length) + " more attempts");
  }
}

function logRecordSummary(record) {
  console.log("  selected edition: " + (record.latest_tracked_edition || "none"));
  console.log("  selected submission windows:");
  if (!record.submission_cycles.length) {
    console.log("    none");
    return;
  }

  record.submission_cycles.forEach(function printCycle(cycle) {
    console.log("    - " + cycle.deadline_iso + " | " + cycle.deadline_label + " | " + cycle.source_url);
  });
}

async function officialCandidatesFor(conferenceInfo) {
  const conference = conferenceInfo.conference;
  const hints = CONFERENCE_HINTS[conference];
  if (!hints) {
    throw new RefreshError("No refresh rules configured for " + conference + ".");
  }

  const candidates = [];
  const yearsToTry = buildYearsToTry(conferenceInfo.years_in_csv || []);
  const diagnostics = {
    conference: conference,
    years_to_try: yearsToTry,
    attempts: [],
  };

  for (const template of hints.candidateUrls) {
    for (const year of yearsToTry) {
      const sourceUrl = applyUrlTemplate(template, year);
      try {
        const rawPage = await fetchText(sourceUrl);
        const pageText = stripHtml(rawPage);
        const extractedCandidates = extractFromOfficialPage(conference, sourceUrl, pageText, hints.labelPatterns);
        diagnostics.attempts.push({
          status: "ok",
          url: sourceUrl,
          candidate_count: extractedCandidates.length,
        });
        candidates.push.apply(candidates, extractedCandidates);
      } catch (error) {
        diagnostics.attempts.push({
          status: "fail",
          url: sourceUrl,
          error: error.message,
        });
        continue;
      }
    }
  }

  if (conference === "UbiComp") {
    const targetEditionYear = inferTargetEditionYear(conferenceInfo);
    const currentEditionCandidates = candidates.filter(function filterCurrent(candidate) {
      return candidate.edition_year === targetEditionYear;
    });
    if (currentEditionCandidates.length < 2) {
      const fallbackCandidates = buildUbiCompRecurringCandidates(conferenceInfo, targetEditionYear);
      diagnostics.attempts.push({
        status: "fallback",
        url: "https://www.ubicomp.org/ubicomp-iswc-" + targetEditionYear + "/",
        candidate_count: fallbackCandidates.length,
      });
      return {
        candidates: fallbackCandidates,
        diagnostics: diagnostics,
      };
    }
  }

  if (!candidates.length) {
    const error = new RefreshError("No deadline candidate found from official CFP pages for " + conference + ".");
    error.diagnostics = diagnostics;
    throw error;
  }

  return {
    candidates: candidates,
    diagnostics: diagnostics,
  };
}

function emptyConferenceRecord(conferenceInfo) {
  return {
    conference: conferenceInfo.conference,
    years_in_csv: conferenceInfo.years_in_csv || [],
    latest_tracked_edition: null,
    deadline_iso: "",
    deadline_display: "",
    deadline_label: "",
    source_kind: "",
    source_url: "",
    submission_cycles: [],
  };
}

function isoTimestamp(dateValue) {
  return new Date(dateValue.getTime()).toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

async function refreshDatabase(selectedConference, options) {
  const verbose = Boolean(options && options.verbose);
  const current = readDatabase();
  const inputs = loadConferenceInputs();
  const byConference = {};
  const failures = {};

  (current.conferences || []).forEach(function indexExisting(record) {
    if (record && record.conference) {
      byConference[record.conference] = record;
    }
  });

  (current.failures || []).forEach(function indexFailure(failure) {
    if (failure && failure.conference) {
      failures[failure.conference] = failure.error;
    }
  });

  const selectedInputs = selectedConference
    ? inputs.filter(function filterConference(item) { return item.conference === selectedConference; })
    : inputs;

  if (selectedConference && !selectedInputs.length) {
    throw new RefreshError("Conference " + selectedConference + " is not configured.");
  }

  console.log("Refreshing deadline snapshot");
  console.log("  source csv: " + path.relative(PROJECT_ROOT, discoverCsvPath()));
  console.log("  output json: " + path.relative(PROJECT_ROOT, DB_PATH));
  console.log("  conference filter: " + (selectedConference || "all conferences"));
  console.log("  queued: " + pluralize(selectedInputs.length, "conference", "conferences"));

  for (let index = 0; index < selectedInputs.length; index += 1) {
    const conferenceInfo = selectedInputs[index];
    console.log("");
    console.log("[" + (index + 1) + "/" + selectedInputs.length + "] " + conferenceInfo.conference);
    console.log("  years in csv: " + formatYears(conferenceInfo.years_in_csv));
    console.log("  years to try: " + buildYearsToTry(conferenceInfo.years_in_csv || []).join(", "));

    try {
      const result = await officialCandidatesFor(conferenceInfo);
      const record = buildConferenceRecord(conferenceInfo, result.candidates);
      byConference[conferenceInfo.conference] = record;
      delete failures[conferenceInfo.conference];
      logAttemptDetails(result.diagnostics, { verbose: verbose, forceAll: false });
      logRecordSummary(record);
      console.log("  status: updated");
    } catch (error) {
      failures[conferenceInfo.conference] = error.message;
      logAttemptDetails(error.diagnostics, { verbose: true, forceAll: true });
      console.log("  status: failed");
      console.log("  reason: " + error.message);
    }
  }

  const conferences = inputs.map(function mergeConference(conferenceInfo) {
    return normalizeConferenceRecord(
      byConference[conferenceInfo.conference] || emptyConferenceRecord(conferenceInfo),
    );
  }).sort(function sortConference(left, right) {
    return left.conference.localeCompare(right.conference);
  });

  const payload = {
    generated_at: isoTimestamp(new Date()),
    source_csv: path.relative(PROJECT_ROOT, discoverCsvPath()),
    conference_count: conferences.length,
    conferences: conferences,
    failures: Object.keys(failures).sort().map(function toFailure(name) {
      return {
        conference: name,
        error: failures[name],
      };
    }),
  };

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log("");
  console.log("Snapshot summary");
  console.log("  generated_at: " + payload.generated_at);
  console.log("  conferences in snapshot: " + payload.conference_count);
  console.log("  failures: " + payload.failures.length);
  if (payload.failures.length) {
    console.log("  failing conferences: " + payload.failures.map(function failureName(item) {
      return item.conference;
    }).join(", "));
  }
  return payload;
}

function parseArgs(argv) {
  const args = {
    conference: null,
    verbose: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--conference" && argv[index + 1]) {
      args.conference = argv[index + 1];
      index += 1;
      continue;
    }

    if (argv[index] === "--verbose") {
      args.verbose = true;
      continue;
    }

    if (argv[index] === "--quiet") {
      args.verbose = false;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const verbose = args.verbose === null ? Boolean(args.conference) : args.verbose;
  const payload = await refreshDatabase(args.conference, { verbose: verbose });
  console.log(
    "Wrote " + path.relative(PROJECT_ROOT, DB_PATH)
      + " (" + payload.conference_count + " conferences, " + payload.failures.length + " failures)",
  );
}

main().catch(function onError(error) {
  console.error(error && error.message ? error.message : String(error));
  process.exitCode = 1;
});
