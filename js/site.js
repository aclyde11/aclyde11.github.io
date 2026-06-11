(function () {
  const navToggle = document.querySelector(".nav-toggle");
  const nav = document.getElementById("site-nav");

  if (navToggle && nav) {
    navToggle.addEventListener("click", () => {
      const isOpen = document.body.classList.toggle("nav-open");
      navToggle.setAttribute("aria-expanded", String(isOpen));
    });

    nav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        document.body.classList.remove("nav-open");
        navToggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  const publicationList = document.getElementById("publication-list");
  const searchInput = document.getElementById("publication-search");
  const filterButtons = Array.from(document.querySelectorAll("[data-filter]"));

  function applyPublicationFilters() {
    if (!publicationList) return;
    const activeFilter = document.querySelector(".filter-button.active")?.dataset.filter || "all";
    const query = (searchInput?.value || "").trim().toLowerCase();

    publicationList.querySelectorAll(".publication-item").forEach((item) => {
      const categoryMatch = activeFilter === "all" || item.dataset.category === activeFilter;
      const text = item.textContent.toLowerCase();
      const queryMatch = !query || text.includes(query);
      item.classList.toggle("hidden", !(categoryMatch && queryMatch));
    });
  }

  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      filterButtons.forEach((candidate) => candidate.classList.remove("active"));
      button.classList.add("active");
      applyPublicationFilters();
    });
  });

  if (searchInput) {
    searchInput.addEventListener("input", applyPublicationFilters);
  }

  function authorsShort(authors) {
    if (!Array.isArray(authors)) return "";
    if (authors.length <= 6) return authors.join(", ");
    return `${authors.slice(0, 5).join(", ")}, et al.`;
  }

  function renderFeatured(publications) {
    const target = document.getElementById("featured-publications");
    if (!target) return;
    const featured = publications.filter((publication) => publication.featured).slice(0, 5);
    if (!featured.length) return;
    target.innerHTML = featured.map((publication) => `
      <article class="mini-publication">
        <span>${publication.year}</span>
        <h3><a href="${publication.url}">${publication.title}</a></h3>
        <p>${publication.source || authorsShort(publication.authors)}</p>
      </article>
    `).join("");
  }

  function setMetric(id, value) {
    const element = document.getElementById(id);
    if (element && value !== undefined && value !== null) {
      element.textContent = typeof value === "number" ? value.toLocaleString() : value;
    }
  }

  const isNestedPage = location.pathname.includes("/publications/");
  const dataUrl = isNestedPage ? "../data/publications.json" : "data/publications.json";

  fetch(dataUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`Publication data returned ${response.status}`);
      return response.json();
    })
    .then((data) => {
      setMetric("metric-records", data.publications?.length);
      setMetric("metric-works", data.meta?.openAlex?.worksCount);
      setMetric("metric-citations", data.meta?.openAlex?.citedByCount);
      setMetric("metric-hindex", data.meta?.openAlex?.hIndex);
      setMetric("metric-updated", data.meta?.openAlex?.updatedDate?.slice(0, 10));
      renderFeatured(data.publications || []);
    })
    .catch(() => {
      const status = document.getElementById("sync-status");
      if (status) status.textContent = "Static fallback";
    });
}());
