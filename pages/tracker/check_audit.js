// RMR Sync -- Check Name Audit (diagnostic + authoring tool, not part of the
// shipped player-facing UI). Renders one row per CHECK_ID_MAP entry: id, the
// raw ported short code, an EVENT badge (see EVENT_CHECK_IDS in
// check_id_map.js) for stage-clear/boss-defeat ids, and an editable text
// input per language. Empty inputs show the raw fallback code as a greyed
// placeholder (CSS :placeholder-shown) so it's obvious at a glance which
// rows still need a name. "Export" downloads a ready-to-commit
// check_names_XX.js for that language, built from whatever's currently
// typed into its column -- no server, no build step, just edit and export.

const AUDIT_LANGS = [
  { lang: "en", varName: "CHECK_NAMES_EN", fileName: "check_names_en.js", label: "EN" },
  { lang: "ja", varName: "CHECK_NAMES_JA", fileName: "check_names_ja.js", label: "JA" },
  { lang: "zh-TW", varName: "CHECK_NAMES_ZHTW", fileName: "check_names_zhtw.js", label: "zh-TW" },
];

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

  const eventTd = document.createElement("td");
  eventTd.className = "event-cell";
  if (EVENT_CHECK_IDS.has(id)) {
    const badge = document.createElement("span");
    badge.className = "event-badge";
    badge.textContent = "EVENT";
    badge.title = "Reported to the event feed (stage clear / boss defeat) -- never synced as a location";
    eventTd.appendChild(badge);
  }
  tr.appendChild(eventTd);

  for (const { lang, label } of AUDIT_LANGS) {
    const nameTd = document.createElement("td");
    nameTd.className = "name-cell";
    const info = getCheckNameInfo(id, lang);
    const input = document.createElement("input");
    input.type = "text";
    input.className = "name-input";
    input.dataset.id = String(id);
    input.dataset.lang = lang;
    input.setAttribute("aria-label", `${label} name for check ${id}`);
    if (info.isFallback) {
      input.value = "";
      input.placeholder = info.name;
    } else {
      input.value = info.name;
      input.placeholder = "";
    }
    nameTd.appendChild(input);
    tr.appendChild(nameTd);
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

  const nameFallbackCounts = Object.fromEntries(AUDIT_LANGS.map(({ lang }) => [lang, 0]));
  for (const entry of entries) {
    for (const { lang } of AUDIT_LANGS) {
      if (getCheckNameInfo(entry.id, lang).isFallback) {
        nameFallbackCounts[lang]++;
      }
    }
  }

  const fallbackSummary = AUDIT_LANGS.map(({ lang }) => `${lang}: ${nameFallbackCounts[lang]}/${entries.length}`).join(", ");
  statsEl.textContent = `${entries.length} entries total (${EVENT_CHECK_IDS.size} events, ${entries.length - EVENT_CHECK_IDS.size} locations). Names not yet authored -- ${fallbackSummary}.`;

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

// Builds the check_names_XX.js source text for one language from whatever's
// currently typed into that column's inputs -- blank inputs (still showing
// their fallback placeholder) are simply omitted, same as an un-authored id
// in the file today. Ids are emitted in ascending order for a clean diff.
function buildExportSource({ lang, varName, fileName }) {
  const inputs = document.querySelectorAll(`input.name-input[data-lang="${lang}"]`);
  const entries = [];
  for (const input of inputs) {
    const value = input.value.trim();
    if (value) {
      entries.push([Number(input.dataset.id), value]);
    }
  }
  entries.sort((a, b) => a[0] - b[0]);

  let out = `// Check-completion names (${lang}), keyed by the same global id\n`;
  out += `// CHECK_ID_MAP uses. Exported from pages/tracker/check_audit.html.\n`;
  out += `const ${varName} = {\n`;
  for (const [id, name] of entries) {
    out += `  ${id}: ${JSON.stringify(name)},\n`;
  }
  out += `};\n`;
  return { fileName, source: out };
}

function downloadText(fileName, text) {
  const blob = new Blob([text], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function setupExportButtons() {
  const container = document.getElementById("exportButtons");
  for (const langConfig of AUDIT_LANGS) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `Export ${langConfig.label} (${langConfig.fileName})`;
    button.addEventListener("click", () => {
      const { fileName, source } = buildExportSource(langConfig);
      downloadText(fileName, source);
    });
    container.appendChild(button);
  }
}

function init() {
  render();
  setupExportButtons();
  document.getElementById("filterInput").addEventListener("input", applyFilter);
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", init);
}
