# austinclyde.com

Static personal site for Austin Clyde, served from GitHub Pages.

## Publication data

Publication records are generated from OpenAlex plus a small set of manual public-writing, patent, and public-comment entries in `data/publication-overrides.json`.

Run:

```sh
npm run sync:publications
```

That command:

- fetches OpenAlex works for the Austin Clyde author profiles listed in `data/publication-overrides.json`
- collapses duplicate preprint/final-paper records
- applies curated category/source/award overrides
- writes `data/publications.json`
- writes `data/publication-audit.json`
- rebuilds `publications/index.html`

For CI or local verification:

```sh
npm run check:publications
```

That validation is static and deterministic: it checks the committed JSON and generated HTML without calling external APIs. To compare the committed data against live OpenAlex results, run:

```sh
npm run check:publications:live
```

The site itself is static HTML/CSS/JS. There is no runtime build step beyond keeping the generated publication archive current.
