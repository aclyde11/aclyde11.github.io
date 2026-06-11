import fs from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const checkOnly = process.argv.includes("--check");

const configPath = path.join(root, "data", "publication-overrides.json");
const dataPath = path.join(root, "data", "publications.json");
const auditPath = path.join(root, "data", "publication-audit.json");
const publicationsPagePath = path.join(root, "publications", "index.html");

const categoryLabels = {
  articles: "Peer-reviewed articles",
  conference: "Conference proceedings",
  "book-chapters": "Book chapters",
  workshops: "Workshops",
  preprints: "Preprints",
  datasets: "Datasets",
  essays: "Essays and public writing",
  "public-comments": "Public comments",
  patents: "Patents",
  dissertation: "Dissertation"
};

const featuredTypeLabels = {
  articles: "Article",
  conference: "Conference paper",
  "book-chapters": "Book chapter",
  workshops: "Workshop paper",
  preprints: "Preprint",
  datasets: "Dataset",
  essays: "Essay",
  "public-comments": "Public comment",
  patents: "Patent",
  dissertation: "Dissertation"
};

const categoryOrder = [
  "articles",
  "conference",
  "book-chapters",
  "workshops",
  "preprints",
  "datasets",
  "essays",
  "public-comments",
  "patents",
  "dissertation"
];

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "austinclyde.com-publication-sync" } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`GET ${url} returned ${res.statusCode}: ${body.slice(0, 240)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`Could not parse JSON from ${url}: ${error.message}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(20000, () => {
      req.destroy(new Error(`Timed out fetching ${url}`));
    });
  });
}

function decodeText(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function cleanDisplayText(value = "") {
  return decodeText(value)
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeDoi(value = "") {
  if (value === null || value === undefined) return "";
  const normalized = String(value)
    .trim()
    .toLowerCase();
  if (!normalized || normalized === "null" || normalized === "undefined") return "";
  return normalized
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
    .replace(/^doi:/, "")
    .replace(/\/$/, "");
}

function featuredKey(value = "") {
  return normalizeDoi(value) || String(value || "").trim().toLowerCase();
}

function featuredRankFor(record, featuredRankMap) {
  const keys = [record.id, record.doi].map(featuredKey).filter(Boolean);
  for (const key of keys) {
    if (featuredRankMap.has(key)) return featuredRankMap.get(key);
  }
  return null;
}

function normalizeTitle(value = "") {
  return decodeText(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\\n/g, " ")
    .replace(/non[\s-]*covalent/g, "noncovalent")
    .replace(/[#]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceFor(work) {
  const primary = work.primary_location?.source?.display_name;
  if (primary) return cleanDisplayText(primary);
  const fallback = work.locations?.find((location) => location.source?.display_name)?.source?.display_name;
  return fallback ? cleanDisplayText(fallback) : "";
}

function categoryFor(work, override = {}) {
  if (override.category) return override.category;
  const source = sourceFor(work).toLowerCase();
  const doi = normalizeDoi(work.doi);
  if (work.type === "dataset") return "datasets";
  if (work.type === "dissertation") return "dissertation";
  if (work.type === "book-chapter") return "book-chapters";
  if (work.type === "preprint") {
    if (source.includes("arxiv") || source.includes("biorxiv")) return "preprints";
    return "conference";
  }
  if (doi.startsWith("10.1145/") || doi.startsWith("10.1109/") || doi.startsWith("10.1158/1538-7445.am")) {
    return "conference";
  }
  if (work.type === "review" || work.type === "article") return "articles";
  return "articles";
}

function workUrl(work) {
  const doi = normalizeDoi(work.doi);
  if (doi) return `https://doi.org/${doi}`;
  return work.id;
}

function recordFromWork(work, override = {}, sourceAuthorId) {
  const doi = normalizeDoi(work.doi);
  const title = cleanDisplayText(override.title || work.display_name || "Untitled");
  const authors = (work.authorships || []).map((entry) => cleanDisplayText(entry.author?.display_name)).filter(Boolean);
  const source = override.source || sourceFor(work);
  const category = categoryFor(work, override);
  const year = override.year || work.publication_year || null;
  return {
    id: doi || String(work.id).replace("https://openalex.org/", "").toLowerCase(),
    title,
    authors,
    year,
    category,
    source,
    doi: doi || null,
    url: override.url || workUrl(work),
    openAlexId: work.id,
    openAlexAuthorId: sourceAuthorId,
    citedBy: Number.isFinite(work.cited_by_count) ? work.cited_by_count : null,
    openAccessUrl: work.open_access?.oa_url || null,
    award: override.award || null,
    summary: override.summary || null,
    sourceType: "openalex"
  };
}

function recordScore(record) {
  let score = 0;
  if (record.doi) score += 20;
  if (record.category === "articles") score += 30;
  if (record.category === "conference") score += 26;
  if (record.category === "book-chapters") score += 24;
  if (record.category === "dissertation") score += 22;
  if (record.category === "workshops") score += 14;
  if (record.category === "preprints") score += 8;
  if (record.category === "datasets") score += 6;
  if ((record.source || "").match(/arxiv|biorxiv/i)) score -= 6;
  if ((record.source || "").match(/university of chicago|open mind/i) && record.category !== "dissertation") score -= 20;
  score += Math.min(record.citedBy || 0, 100) / 100;
  return score;
}

function authorsShort(authors = []) {
  if (authors.length <= 7) return authors.join(", ");
  return `${authors.slice(0, 6).join(", ")}, et al.`;
}

async function fetchWorksForAuthor(authorId) {
  const fields = [
    "id",
    "doi",
    "display_name",
    "publication_year",
    "type",
    "primary_location",
    "locations",
    "authorships",
    "cited_by_count",
    "open_access"
  ].join(",");
  const url = `https://api.openalex.org/works?filter=author.id:${authorId}&per-page=200&sort=publication_year:desc&select=${fields}`;
  const response = await fetchJson(url);
  return response.results || [];
}

function applyManualRecord(record, featuredRankMap) {
  const featuredRank = featuredRankFor(record, featuredRankMap);
  return {
    id: record.id,
    title: cleanDisplayText(record.title),
    authors: record.authors || ["Austin Clyde"],
    year: record.year,
    category: record.category,
    source: record.source,
    doi: record.doi || null,
    url: record.url,
    openAlexId: null,
    openAlexAuthorId: null,
    citedBy: null,
    openAccessUrl: null,
    award: record.award || null,
    summary: record.summary || null,
    sourceType: "manual",
    featured: featuredRank !== null,
    featuredRank
  };
}

function sortRecords(a, b) {
  if ((b.year || 0) !== (a.year || 0)) return (b.year || 0) - (a.year || 0);
  const categoryDelta = categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category);
  if (categoryDelta !== 0) return categoryDelta;
  return a.title.localeCompare(b.title);
}

function renderPublicationItem(record) {
  const classes = ["publication-item", record.category, `year-${record.year}`].join(" ");
  const award = record.award ? `<span class="pub-award">${escapeHtml(record.award)}</span>` : "";
  const summary = record.summary ? `\n              <p class="pub-summary">${escapeHtml(record.summary)}</p>` : "";
  const linkTargets = new Set();
  const linkParts = [];
  const pushLink = (label, url) => {
    if (!url) return;
    const normalized = String(url).replace(/\/$/, "");
    if (linkTargets.has(normalized)) return;
    linkTargets.add(normalized);
    linkParts.push(`<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`);
  };
  const doiUrl = record.doi ? `https://doi.org/${record.doi}` : "";
  pushLink(record.doi && record.url === doiUrl ? "DOI" : "Open", record.url);
  pushLink("DOI", doiUrl);
  pushLink("Open copy", record.openAccessUrl);
  const links = linkParts.join("");
  return `
          <article class="${classes}" data-category="${escapeHtml(record.category)}" data-year="${escapeHtml(record.year)}" data-title="${escapeHtml(record.title.toLowerCase())}">
            <div class="pub-year">${escapeHtml(record.year || "")}</div>
            <div class="pub-body">
              <h2><a href="${escapeHtml(record.url)}">${escapeHtml(record.title)}</a></h2>
              <p class="pub-meta">${escapeHtml(authorsShort(record.authors))}</p>
              <p class="pub-source">${escapeHtml(categoryLabels[record.category] || record.category)} · ${escapeHtml(record.source || "Source pending")}</p>${summary}
              <div class="pub-actions">${links}${award}</div>
            </div>
          </article>`;
}

function renderFeaturedPublication(record) {
  const meta = [
    `<span>${escapeHtml(record.year || "")}</span>`,
    `<span>${escapeHtml(record.source || "Source pending")}</span>`,
    record.award ? `<span>${escapeHtml(record.award)}</span>` : "",
    Number.isFinite(record.citedBy) ? `<span>${record.citedBy.toLocaleString()} citations</span>` : ""
  ].filter(Boolean).join("\n            ");
  const type = featuredTypeLabels[record.category] || "Work";
  const summary = record.summary || `${type} in ${record.source || "source pending"}.`;
  return `
        <article class="archive-featured-card">
          <h3><a href="${escapeHtml(record.url)}">${escapeHtml(record.title)}</a></h3>
          <p>${escapeHtml(summary)}</p>
          <div class="featured-meta">
            ${meta}
          </div>
        </article>`;
}

function renderPublicationsPage(records, meta) {
  const filterButtons = [
    ["all", "All"],
    ...categoryOrder
      .filter((category) => records.some((record) => record.category === category))
      .map((category) => [category, categoryLabels[category]])
  ]
    .map(([value, label], index) => `<button class="filter-button${index === 0 ? " active" : ""}" type="button" data-filter="${escapeHtml(value)}">${escapeHtml(label)}</button>`)
    .join("\n              ");

  const list = records.map(renderPublicationItem).join("\n");
  const featured = records
    .filter((record) => record.featured)
    .sort((a, b) => (a.featuredRank ?? 999) - (b.featuredRank ?? 999))
    .slice(0, 6)
    .map(renderFeaturedPublication)
    .join("\n");
  const updated = new Date(meta.generatedAt).toISOString().slice(0, 10);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Austin Clyde | Publications</title>
  <meta name="description" content="Austin Clyde's publications, datasets, book chapters, essays, patents, and public comments.">
  <link rel="canonical" href="https://austinclyde.com/publications/">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600;700&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../css/site.css">
</head>
<body>
  <header class="site-header">
    <a class="skip-link" href="#main">Skip to content</a>
    <div class="nav-shell">
      <a class="brand" href="../">Austin Clyde</a>
      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav">Menu</button>
      <nav id="site-nav" class="site-nav" aria-label="Primary navigation">
        <a href="../#work">Work</a>
        <a href="../#research">Research</a>
        <a href="./" aria-current="page">Publications</a>
        <a href="../cv.html">CV</a>
        <a href="../#contact">Contact</a>
      </nav>
    </div>
  </header>

  <main id="main">
    <section class="page-hero compact">
      <div class="copy-stack">
        <p class="section-label">Publication archive</p>
        <h1>Publications, datasets, and public writing.</h1>
        <p class="lead">Generated from structured site data and checked against OpenAlex author records for Austin Clyde.</p>
      </div>
      <div class="metric-strip" aria-label="Publication summary">
        <div><strong>${records.length}</strong><span>curated records</span></div>
        <div><strong>${meta.openAlex.worksCount}</strong><span>OpenAlex works</span></div>
        <div><strong>${meta.openAlex.hIndex}</strong><span>OpenAlex h-index</span></div>
      </div>
    </section>

    <section class="content-band archive-featured">
      <div class="archive-featured-head">
        <div>
          <p class="section-label">Featured work</p>
          <h2>Representative research and public writing.</h2>
        </div>
        <p>Curated from the same structured records used for the full archive below.</p>
      </div>
      <div class="archive-featured-grid">
${featured}
      </div>
    </section>

    <section class="content-band">
      <div class="tool-row">
        <div class="filters" aria-label="Publication filters">
          ${filterButtons}
        </div>
        <label class="search-field">
          <span>Search</span>
          <input type="search" id="publication-search" placeholder="Title, author, venue">
        </label>
      </div>
      <p class="data-note">Last generated ${updated}. Primary source: <a href="${escapeHtml(meta.openAlex.url)}">OpenAlex author profile</a>. Manual additions cover public essays, public comments, and patents not indexed as standard scholarly works.</p>
      <div class="publication-list" id="publication-list">
${list}
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div>
      <strong>Austin Clyde</strong>
      <span>High-performance AI systems, scientific computing, and accountable AI.</span>
    </div>
    <a href="../">Back home</a>
  </footer>
  <script src="../js/site.js"></script>
</body>
</html>
`;
}

async function main() {
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  const featuredRankMap = new Map((config.featured || []).map((value, index) => [featuredKey(value), index]));
  const excludeDoiSet = new Set((config.excludeDois || []).map(normalizeDoi));
  const overrides = config.overrides || {};
  const allWorks = [];

  for (const authorId of config.authorIds) {
    const works = await fetchWorksForAuthor(authorId);
    allWorks.push(...works.map((work) => ({ work, authorId })));
  }

  const recordsByTitle = new Map();
  const duplicates = [];
  for (const { work, authorId } of allWorks) {
    const doi = normalizeDoi(work.doi);
    if (doi && excludeDoiSet.has(doi)) continue;
    const override = overrides[doi] || {};
    const record = recordFromWork(work, override, authorId);
    const titleKey = normalizeTitle(record.title);
    record.featuredRank = featuredRankFor(record, featuredRankMap);
    record.featured = record.featuredRank !== null;
    const existing = recordsByTitle.get(titleKey);
    if (!existing || recordScore(record) > recordScore(existing)) {
      if (existing) duplicates.push({ kept: record.id, dropped: existing.id, title: record.title });
      recordsByTitle.set(titleKey, record);
    } else {
      duplicates.push({ kept: existing.id, dropped: record.id, title: record.title });
    }
  }

  const recordsById = new Map();
  for (const record of recordsByTitle.values()) {
    const idKey = record.id || normalizeTitle(record.title);
    const existing = recordsById.get(idKey);
    if (!existing || recordScore(record) > recordScore(existing)) {
      if (existing) duplicates.push({ kept: record.id, dropped: existing.id, title: record.title });
      recordsById.set(idKey, record);
    } else {
      duplicates.push({ kept: existing.id, dropped: record.id, title: record.title });
    }
  }

  const manualRecords = (config.manualWorks || []).map((record) => applyManualRecord(record, featuredRankMap));
  const records = [...recordsById.values(), ...manualRecords].sort(sortRecords);

  const authorProfile = await fetchJson("https://api.openalex.org/authors/A5088879250");
  const meta = {
    generatedAt: new Date().toISOString(),
    openAlex: {
      url: config.openAlexAuthorUrl,
      authorId: "A5088879250",
      orcid: authorProfile.orcid,
      worksCount: authorProfile.works_count,
      citedByCount: authorProfile.cited_by_count,
      hIndex: authorProfile.summary_stats?.h_index || null,
      i10Index: authorProfile.summary_stats?.i10_index || null,
      updatedDate: authorProfile.updated_date
    },
    categoryLabels,
    categoryOrder,
    sources: [
      "OpenAlex Graph API",
      "Manual public-writing and patent records listed in data/publication-overrides.json"
    ]
  };

  const data = { meta, publications: records };
  const audit = {
    generatedAt: meta.generatedAt,
    fetchedOpenAlexWorks: allWorks.length,
    curatedRecords: records.length,
    duplicatesCollapsed: duplicates,
    recordsMissingYear: records.filter((record) => !record.year).map((record) => record.id),
    recordsMissingUrl: records.filter((record) => !record.url).map((record) => record.id),
    recordsMissingSource: records.filter((record) => !record.source).map((record) => record.id)
  };

  if (checkOnly) {
    const current = JSON.parse(await fs.readFile(dataPath, "utf8"));
    const currentIds = new Set(current.publications.map((record) => record.id));
    const nextIds = new Set(records.map((record) => record.id));
    const missing = [...nextIds].filter((id) => !currentIds.has(id));
    const stale = [...currentIds].filter((id) => !nextIds.has(id));
    if (missing.length || stale.length || audit.recordsMissingYear.length || audit.recordsMissingUrl.length) {
      console.error("Publication check failed.");
      console.error(JSON.stringify({ missing, stale, recordsMissingYear: audit.recordsMissingYear, recordsMissingUrl: audit.recordsMissingUrl }, null, 2));
      process.exit(1);
    }
    console.log(`Publication check passed: ${records.length} curated records, ${duplicates.length} duplicates collapsed.`);
    return;
  }

  await fs.mkdir(path.dirname(dataPath), { recursive: true });
  await fs.writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`);
  await fs.writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`);
  await fs.writeFile(publicationsPagePath, renderPublicationsPage(records, meta));
  console.log(`Wrote ${records.length} publication records.`);
  console.log(`Collapsed ${duplicates.length} duplicate or superseded OpenAlex records.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
