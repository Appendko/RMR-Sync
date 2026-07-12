// RMR Sync -- Check Name Audit (diagnostic tool, not part of the shipped
// player-facing UI). Renders one row per CHECK_ID_MAP entry: id, the raw
// ported short code, and each language's current name (or a highlighted
// "fallback" state -- the raw code again -- when no name has been authored
// yet). Mirrors tracker/icon_audit.js's pattern; no icon columns, since
// checks have no sprite-sheet equivalent.

const AUDIT_LANGS = ["en", "ja", "zh-TW"];

function buildRow(id, code) {
  const tr = document.createElement("tr");
  tr.dataset.code = code;

  const idTd = document.createElement("td");
  idTd.className = "id-cell";
  idTd.textContent = String(id);
  tr.appendChild(idTd);

  const codeTd = document.createElement("td");
  codeTd.className = "code-cell";
  codeTd.textContent = code;
  tr.appendChild(codeTd);

  let hasNameFallback = false;
  for (const lang of AUDIT_LANGS) {
    const nameTd = document.createElement("td");
    nameTd.className = "name-cell";
    const info = getCheckNameInfo(id, lang);
    nameTd.textContent = info.name;
    if (info.isFallback) {
      hasNameFallback = true;
      nameTd.classList.add("name-fallback");
      nameTd.title = "no name authored yet -- showing the raw ported short code";
    }
    tr.appendChild(nameTd);
  }
  if (hasNameFallback) {
    tr.classList.add("has-name-fallback");
  }

  return tr;
}

function render() {
  const rowsEl = document.getElementById("rows");
  const statsEl = document.getElementById("stats");
  rowsEl.innerHTML = "";

  const entries = Object.keys(CHECK_ID_MAP)
    .map((idStr) => Number(idStr))
    .sort((a, b) => a - b)
    .map((id) => ({ id, code: CHECK_ID_MAP[id] }));

  const nameFallbackCounts = Object.fromEntries(AUDIT_LANGS.map((lang) => [lang, 0]));
  for (const entry of entries) {
    for (const lang of AUDIT_LANGS) {
      if (getCheckNameInfo(entry.id, lang).isFallback) {
        nameFallbackCounts[lang]++;
      }
    }
  }

  const fallbackSummary = AUDIT_LANGS.map((lang) => `${lang}: ${nameFallbackCounts[lang]}/${entries.length}`).join(", ");
  statsEl.textContent = `${entries.length} entries total. Names not yet authored -- ${fallbackSummary}.`;

  const frag = document.createDocumentFragment();
  for (const entry of entries) {
    frag.appendChild(buildRow(entry.id, entry.code));
  }
  rowsEl.appendChild(frag);
}

function applyFilter() {
  const filterText = document.getElementById("filterInput").value.trim().toLowerCase();
  const rowsEl = document.getElementById("rows");
  for (const row of Array.from(rowsEl.children)) {
    const code = row.dataset.code.toLowerCase();
    row.classList.toggle("hidden", !(!filterText || code.includes(filterText)));
  }
}

function init() {
  render();
  document.getElementById("filterInput").addEventListener("input", applyFilter);
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", init);
}
