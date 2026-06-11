import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dataPath = path.join(root, "data", "publications.json");
const pagePath = path.join(root, "publications", "index.html");

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const page = fs.readFileSync(pagePath, "utf8");
const errors = [];
const publications = data.publications || [];
const ids = new Set();

if (!data.meta?.generatedAt) errors.push("data/publications.json is missing meta.generatedAt");
if (!data.meta?.openAlex?.authorId) errors.push("data/publications.json is missing meta.openAlex.authorId");
if (publications.length < 1) errors.push("data/publications.json has no publications");

for (const publication of publications) {
  const prefix = publication.id || publication.title || "unknown publication";
  for (const field of ["id", "title", "year", "category", "source", "url"]) {
    if (!publication[field]) errors.push(`${prefix} is missing ${field}`);
  }
  if (!Array.isArray(publication.authors) || publication.authors.length === 0) {
    errors.push(`${prefix} is missing authors`);
  }
  if (publication.id) {
    if (ids.has(publication.id)) errors.push(`Duplicate publication id: ${publication.id}`);
    ids.add(publication.id);
  }
  if (publication.title && !page.includes(escapeHtml(publication.title))) {
    errors.push(`Generated publication page is missing title: ${publication.title}`);
  }
}

if (!page.includes(`<strong>${publications.length}</strong><span>curated records</span>`)) {
  errors.push("Generated publication page count does not match data/publications.json");
}

if (!page.includes("id=\"publication-search\"")) {
  errors.push("Generated publication page is missing publication search input");
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Static publication validation passed: ${publications.length} records.`);
