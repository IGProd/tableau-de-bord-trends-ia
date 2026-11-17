"use strict";
/* Tableau de bord Trends IA — version statique (GitHub Pages).
 *
 * Vanilla JS, aucune dépendance, aucun build. Les données viennent en direct
 * des mêmes API publiques que la version serveur (voir DATA-PLAN.md) :
 *   - Hugging Face : modèles tendance / nouveaux / populaires + Spaces
 *   - npm : packages IA par téléchargements mensuels
 *   - GitLab : projets open source IA par étoiles
 *   - Hacker News (Algolia) : discussions récentes, titres filtrés IA
 *   - OpenAlex : papiers de recherche récents (remplace arXiv, dont l'API
 *     n'envoie pas d'en-tête CORS ; Semantic Scholar en secours)
 * Le flux presse éditorial (recherche web serveur) n'a pas d'équivalent
 * navigateur : il est omis, et la page le dit.
 * Aucune donnée inventée : en cas d'échec, la section affiche un message
 * d'erreur honnête qui nomme la source.
 * Les favoris sont stockés uniquement dans ce navigateur (localStorage).
 * Les flux sont mis en cache 60 minutes dans localStorage, comme le cache
 * serveur de la version complète.
 */

var STALE_MS = 60 * 60 * 1000;
var CACHE_KEY = "trends-ia-cache-v1";
var FAV_KEY = "trends-ia-favorites-v1";

var VIEWS = [
  { id: "apercu", label: "Aperçu" },
  { id: "modeles", label: "Modèles" },
  { id: "outils", label: "Outils" },
  { id: "actus", label: "Actualités" },
  { id: "recherche", label: "Recherche" },
  { id: "favoris", label: "Favoris" },
];

var PIPELINE_FR = {
  "text-generation": "Génération de texte",
  "image-text-to-text": "Vision + texte",
  "text-to-image": "Texte → image",
  "text-to-speech": "Synthèse vocale",
  "automatic-speech-recognition": "Reconnaissance vocale",
  "feature-extraction": "Embeddings",
  "image-classification": "Classification d'image",
  "object-detection": "Détection d'objets",
  "text-classification": "Classification de texte",
  "question-answering": "Questions-réponses",
  summarization: "Résumé",
  translation: "Traduction",
  "image-to-image": "Image → image",
  "audio-classification": "Classification audio",
  "fill-mask": "Texte masqué",
  "video-classification": "Classification vidéo",
  "text-to-video": "Texte → vidéo",
  "image-segmentation": "Segmentation",
  "depth-estimation": "Estimation de profondeur",
  "sentence-similarity": "Similarité de phrases",
};

var AI_TITLE_RE =
  /\b(ai|llm|llms|gpt|agi|openai|anthropic|claude|gemini|llama|mistral|deepseek|qwen|copilot|chatgpt|chatbot|machine learning|deep learning|neural|artificial intelligence|mcp|rag|inference|transformer|diffusion|humanoid|ai agents?)\b/i;

/* ------------------------------------------------------------------ aides */

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function str(v) {
  return typeof v === "string" ? v : "";
}
function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function numOrNull(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function strOrNull(v) {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function asRecord(v) {
  return typeof v === "object" && v !== null ? v : {};
}
function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function fmtNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + " M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + " k";
  return String(n);
}

function timeAgo(iso) {
  if (!iso) return "";
  var t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  var diff = Date.now() - t;
  var min = Math.floor(diff / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return "il y a " + min + " min";
  var h = Math.floor(min / 60);
  if (h < 24) return "il y a " + h + " h";
  var d = Math.floor(h / 24);
  if (d < 30) return "il y a " + d + " j";
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

function fmtDate(iso) {
  if (!iso) return "";
  var d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (e) {
    return url;
  }
}

function pipelineLabel(tag) {
  if (!tag) return "Modèle";
  return PIPELINE_FR[tag] || tag.replace(/-/g, " ");
}

/* -------------------------------------------------------------- mappings */

function mapModel(raw) {
  var m = asRecord(raw);
  var id = str(m.id) || str(m.modelId);
  var slash = id.indexOf("/");
  return {
    id: id,
    owner: slash > 0 ? id.slice(0, slash) : "",
    name: slash > 0 ? id.slice(slash + 1) : id,
    likes: num(m.likes),
    downloads: num(m.downloads),
    trendingScore: num(m.trendingScore),
    pipelineTag: strOrNull(m.pipeline_tag),
    createdAt: strOrNull(m.createdAt),
    url: "https://huggingface.co/" + id,
  };
}

function mapSpace(raw) {
  var s = asRecord(raw);
  var id = str(s.id);
  return {
    id: id,
    likes: num(s.likes),
    sdk: strOrNull(s.sdk),
    createdAt: strOrNull(s.createdAt),
    url: "https://huggingface.co/spaces/" + id,
  };
}

function mapNpmPackage(raw) {
  var o = asRecord(raw);
  var pkg = asRecord(o.package);
  var name = str(pkg.name);
  if (!name) return null;
  var links = asRecord(pkg.links);
  var downloads = asRecord(o.downloads);
  return {
    id: "npm:" + name,
    fullName: name,
    description: strOrNull(pkg.description),
    source: "npm",
    stars: null,
    forks: null,
    downloadsMonthly: numOrNull(downloads.monthly),
    language: null,
    createdAt: strOrNull(pkg.date),
    url: strOrNull(links.npm) || "https://www.npmjs.com/package/" + name,
  };
}

function mapGitlabProject(raw) {
  var p = asRecord(raw);
  var path = str(p.path_with_namespace);
  if (!path) return null;
  return {
    id: "gitlab:" + path,
    fullName: path,
    description: (strOrNull(p.description) || "").slice(0, 300) || null,
    source: "gitlab",
    stars: numOrNull(p.star_count),
    forks: numOrNull(p.forks_count),
    downloadsMonthly: null,
    language: null,
    createdAt: strOrNull(p.created_at),
    url: str(p.web_url) || "https://gitlab.com/" + path,
  };
}

function mapHnHit(raw) {
  var h = asRecord(raw);
  var oid = str(h.objectID);
  var title = str(h.title);
  if (!oid || !title) return null;
  var url = strOrNull(h.url) || "https://news.ycombinator.com/item?id=" + oid;
  var source = "Hacker News";
  try {
    source = new URL(url).hostname.replace(/^www\./, "");
  } catch (e) {
    source = "Hacker News";
  }
  return {
    id: oid,
    title: title,
    url: url,
    source: source,
    points: typeof h.points === "number" ? h.points : null,
    comments: typeof h.num_comments === "number" ? h.num_comments : null,
    publishedAt: strOrNull(h.created_at),
  };
}

/* OpenAlex : le résumé arrive en index inversé {mot: [positions]}. */
function openAlexAbstract(inv) {
  if (!inv || typeof inv !== "object") return "";
  var words = [];
  Object.keys(inv).forEach(function (word) {
    asArray(inv[word]).forEach(function (pos) {
      words[pos] = word;
    });
  });
  return words.filter(function (w) { return w != null; }).join(" ");
}

function mapOpenAlexWork(raw) {
  var w = asRecord(raw);
  var title = str(w.title);
  if (!title) return null;
  var authorships = asArray(w.authorships)
    .map(function (a) { return str(asRecord(asRecord(a).author).display_name); })
    .filter(function (a) { return a.length > 0; })
    .slice(0, 4);
  var doi = str(w.doi);
  var loc = asRecord(w.primary_location);
  var venue = strOrNull(asRecord(loc.source).display_name);
  var url = doi
    ? "https://doi.org/" + doi.replace(/^https?:\/\/doi\.org\//, "")
    : strOrNull(loc.landing_page_url) || str(w.id);
  return {
    id: str(w.id) || url,
    title: title,
    summary: openAlexAbstract(w.abstract_inverted_index).slice(0, 420),
    authors: authorships,
    venue: venue,
    publishedAt: strOrNull(w.publication_date),
    url: url,
  };
}

function mapS2Paper(raw) {
  var p = asRecord(raw);
  var title = str(p.title);
  if (!title) return null;
  var authors = asArray(p.authors)
    .map(function (a) { return str(asRecord(a).name); })
    .filter(function (a) { return a.length > 0; })
    .slice(0, 4);
  var arxivId = str(asRecord(p.externalIds).ArXiv);
  return {
    id: str(p.paperId) || str(p.url) || title,
    title: title,
    summary: str(p.abstract).slice(0, 420),
    authors: authors,
    venue: null,
    publishedAt: p.year ? String(p.year) + "-01-01" : null,
    url: arxivId ? "https://arxiv.org/abs/" + arxivId : str(p.url),
  };
}

/* --------------------------------------------------------------- fetchers */

async function fetchJson(url, timeoutMs) {
  var res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs || 15000),
  });
  if (!res.ok) throw new Error("HTTP " + res.status + " pour " + url);
  return res.json();
}

async function fetchModels(sort, limit) {
  var data = await fetchJson(
    "https://huggingface.co/api/models?sort=" + encodeURIComponent(sort) +
    "&direction=-1&limit=" + limit
  );
  return asArray(data).map(mapModel).filter(function (m) { return m.id.length > 0; });
}

async function fetchNewModels() {
  // Le flux brut « createdAt » est plein de dépôts de test sans tâche :
  // on ne garde que les modèles qui déclarent un pipeline, comme le serveur.
  var all = await fetchModels("createdAt", 60);
  return all.filter(function (m) { return m.pipelineTag !== null; }).slice(0, 18);
}

async function fetchSpaces() {
  var data = await fetchJson(
    "https://huggingface.co/api/spaces?sort=likes&direction=-1&limit=12"
  );
  return asArray(data).map(mapSpace).filter(function (s) { return s.id.length > 0; });
}

async function fetchNpmTools() {
  var queries = ["keywords:mcp", "keywords:llm", "keywords:openai", "keywords:ai-agent"];
  var byId = new Map();
  for (var i = 0; i < queries.length; i++) {
    try {
      var data = asRecord(await fetchJson(
        "https://registry.npmjs.org/-/v1/search?text=" + encodeURIComponent(queries[i]) + "&size=20"
      ));
      asArray(data.objects).forEach(function (raw) {
        var t = mapNpmPackage(raw);
        if (t && !byId.has(t.id)) byId.set(t.id, t);
      });
    } catch (e) {
      /* une requête peut échouer, les autres continuent */
    }
  }
  return Array.from(byId.values())
    .filter(function (t) { return (t.downloadsMonthly || 0) >= 1000; })
    .sort(function (a, b) { return (b.downloadsMonthly || 0) - (a.downloadsMonthly || 0); })
    .slice(0, 15);
}

async function fetchGitlabTools() {
  var topics = ["artificial-intelligence", "llm", "machine-learning"];
  var byId = new Map();
  for (var i = 0; i < topics.length; i++) {
    try {
      var data = await fetchJson(
        "https://gitlab.com/api/v4/projects?topic=" + encodeURIComponent(topics[i]) +
        "&order_by=star_count&sort=desc&per_page=12&simple=true"
      );
      asArray(data).forEach(function (raw) {
        var t = mapGitlabProject(raw);
        if (t && !byId.has(t.id)) byId.set(t.id, t);
      });
    } catch (e) {
      /* un sujet peut échouer, les autres continuent */
    }
  }
  return Array.from(byId.values())
    .filter(function (t) { return (t.stars || 0) >= 3; })
    .sort(function (a, b) { return (b.stars || 0) - (a.stars || 0); })
    .slice(0, 12);
}

async function fetchHnStories() {
  var queries = ["AI", "LLM", "OpenAI", "Anthropic"];
  var byId = new Map();
  for (var i = 0; i < queries.length; i++) {
    try {
      var data = asRecord(await fetchJson(
        "https://hn.algolia.com/api/v1/search_by_date?query=" + encodeURIComponent(queries[i]) +
        "&tags=story&hitsPerPage=15"
      ));
      asArray(data.hits).forEach(function (raw) {
        var s = mapHnHit(raw);
        // Algolia rapproche « ai » de mots sans rapport : on exige un vrai
        // mot-clé IA dans le titre, comme le serveur.
        if (!s || !AI_TITLE_RE.test(s.title) || byId.has(s.id)) return;
        byId.set(s.id, s);
      });
    } catch (e) {
      /* une requête peut échouer, les autres continuent */
    }
  }
  return Array.from(byId.values())
    .sort(function (a, b) { return (b.publishedAt || "").localeCompare(a.publishedAt || ""); })
    .slice(0, 20);
}

/* Source des papiers effectivement utilisée (pour l'afficher dans l'UI). */
var paperSource = "openalex";

function openAlexUrl() {
  var from = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return "https://api.openalex.org/works?search=" + encodeURIComponent("artificial intelligence") +
    "&filter=from_publication_date:" + from +
    "&sort=publication_date:desc&per-page=12";
}

async function fetchPapers() {
  try {
    var data = await fetchJson(openAlexUrl());
    var items = asArray(data.results)
      .map(mapOpenAlexWork)
      .filter(function (p) { return p !== null; });
    if (items.length > 0) {
      paperSource = "openalex";
      return items;
    }
    throw new Error("OpenAlex n'a renvoyé aucun papier");
  } catch (e) {
    /* Secours : Semantic Scholar (tri par pertinence, pas par date). */
    var s2 = await fetchJson(
      "https://api.semanticscholar.org/graph/v1/paper/search?query=" +
      encodeURIComponent("artificial intelligence") +
      "&fields=title,abstract,authors,year,externalIds,url&limit=12"
    );
    paperSource = "semanticscholar";
    return asArray(s2.data)
      .map(mapS2Paper)
      .filter(function (p) { return p !== null; });
  }
}

async function searchTrends(q) {
  var results = { models: [], tools: [], stories: [] };
  var settled = await Promise.allSettled([
    fetchJson(
      "https://huggingface.co/api/models?search=" + encodeURIComponent(q) +
      "&sort=downloads&direction=-1&limit=10"
    ).then(function (d) {
      return asArray(d).map(mapModel).filter(function (m) { return m.id.length > 0; });
    }),
    fetchJson(
      "https://registry.npmjs.org/-/v1/search?text=" + encodeURIComponent(q) + "&size=10"
    ).then(function (d) {
      return asArray(asRecord(d).objects).map(mapNpmPackage).filter(function (t) { return t !== null; });
    }),
    fetchJson(
      "https://gitlab.com/api/v4/projects?search=" + encodeURIComponent(q) +
      "&order_by=star_count&sort=desc&per_page=10&simple=true"
    ).then(function (d) {
      return asArray(d).map(mapGitlabProject).filter(function (t) { return t !== null; });
    }),
    fetchJson(
      "https://hn.algolia.com/api/v1/search_by_date?query=" + encodeURIComponent(q) +
      "&tags=story&hitsPerPage=10"
    ).then(function (d) {
      return asArray(asRecord(d).hits).map(mapHnHit).filter(function (s) { return s !== null && s.title.length > 0; });
    }),
  ]);
  if (settled[0].status === "fulfilled") results.models = settled[0].value;
  var tools = [];
  if (settled[1].status === "fulfilled") tools = tools.concat(settled[1].value);
  if (settled[2].status === "fulfilled") tools = tools.concat(settled[2].value);
  results.tools = tools.sort(function (a, b) {
    return (b.downloadsMonthly || b.stars || 0) - (a.downloadsMonthly || a.stars || 0);
  });
  if (settled[3].status === "fulfilled") results.stories = settled[3].value;
  return results;
}

/* ------------------------------------------------------------------ cache */

function storageGet(key) {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}
function storageSet(key, value) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, value);
  } catch (e) {
    /* stockage indisponible : on continue sans cache */
  }
}

function readCache() {
  try {
    return JSON.parse(storageGet(CACHE_KEY) || "{}") || {};
  } catch (e) {
    return {};
  }
}
function writeCache(feedKey, items) {
  var cache = readCache();
  cache[feedKey] = { fetchedAt: new Date().toISOString(), items: items };
  storageSet(CACHE_KEY, JSON.stringify(cache));
}

/* --------------------------------------------------------------- favoris */

function readFavs() {
  try {
    var list = JSON.parse(storageGet(FAV_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}
function writeFavs(list) {
  storageSet(FAV_KEY, JSON.stringify(list));
}
function isFav(kind, id) {
  return readFavs().some(function (f) { return f.kind === kind && f.externalId === id; });
}
function toggleFav(item) {
  var list = readFavs();
  var idx = -1;
  for (var i = 0; i < list.length; i++) {
    if (list[i].kind === item.kind && list[i].externalId === item.externalId) { idx = i; break; }
  }
  if (idx >= 0) {
    list.splice(idx, 1);
  } else {
    list.unshift({
      kind: item.kind,
      externalId: item.externalId,
      title: item.title,
      url: item.url,
      subtitle: item.subtitle || null,
      createdAt: new Date().toISOString(),
    });
  }
  writeFavs(list);
}

/* -------------------------------------------------------- état + chargement */

var state = {
  view: "apercu",
  modelTab: "trending",
  category: "all",
  searchQuery: "",
  searching: false,
  searchResults: null,
  loading: true,
  refreshing: false,
  data: {
    modelsTrending: [], modelsNew: [], modelsPopular: [],
    spaces: [], npmTools: [], gitlabTools: [], hnStories: [], papers: [],
  },
  meta: {
    models: null, spaces: null, npm: null, gitlab: null, hn: null, papers: null,
  },
};

var FEEDS = [
  { key: "modelsTrending", meta: "models", run: function () { return fetchModels("trendingScore", 18); } },
  { key: "modelsNew", meta: "models", run: fetchNewModels },
  { key: "modelsPopular", meta: "models", run: function () { return fetchModels("downloads", 18); } },
  { key: "spaces", meta: "spaces", run: fetchSpaces },
  { key: "npmTools", meta: "npm", run: fetchNpmTools },
  { key: "gitlabTools", meta: "gitlab", run: fetchGitlabTools },
  { key: "hnStories", meta: "hn", run: fetchHnStories },
  { key: "papers", meta: "papers", run: fetchPapers },
];

async function loadFeed(feed, force) {
  var cache = readCache();
  var entry = cache[feed.key];
  if (!force && entry && entry.fetchedAt &&
      Date.now() - new Date(entry.fetchedAt).getTime() < STALE_MS &&
      Array.isArray(entry.items)) {
    state.data[feed.key] = entry.items;
    state.meta[feed.meta] = { asOf: entry.fetchedAt, fromCache: true, error: false };
    return;
  }
  try {
    var items = await feed.run();
    state.data[feed.key] = items;
    state.meta[feed.meta] = { asOf: new Date().toISOString(), fromCache: false, error: false };
    writeCache(feed.key, items);
  } catch (e) {
    state.data[feed.key] = [];
    state.meta[feed.meta] = { asOf: null, fromCache: false, error: true };
  }
}

async function loadAll(force) {
  state.loading = true;
  await Promise.all(FEEDS.map(function (f) { return loadFeed(f, force); }));
  state.loading = false;
}

/* ------------------------------------------------------------------ rendu */

/* Registre des éléments « suivables » affichés : la clé "kind:id" évite
   d'injecter titres et URL dans des attributs HTML. */
var favRegistry = {};

function favButton(item) {
  var key = item.kind + ":" + item.externalId;
  favRegistry[key] = item;
  var active = isFav(item.kind, item.externalId);
  return '<button type="button" class="fav-btn" data-fav-key="' + esc(key) + '"' +
    ' aria-pressed="' + active + '"' +
    ' aria-label="' + esc((active ? "Retirer des favoris : " : "Suivre : ") + item.title) + '">' +
    (active ? "★ Suivi" : "☆ Suivre") + "</button>";
}

function modelCard(m, rank) {
  var item = { kind: "model", externalId: m.id, title: m.id, url: m.url, subtitle: pipelineLabel(m.pipelineTag) };
  return '<article class="card"><div class="card-head"><div style="min-width:0">' +
    (rank != null ? '<span class="rank">#' + (rank + 1) + "</span>" : "") +
    '<a class="card-title" href="' + esc(m.url) + '" target="_blank" rel="noreferrer">' + esc(m.name) + "</a>" +
    '<p class="card-sub">' + esc(m.owner) + " · " + esc(pipelineLabel(m.pipelineTag)) +
    (m.createdAt ? " · " + esc(fmtDate(m.createdAt)) : "") + "</p></div>" +
    favButton(item) + '</div><div class="card-stats"><span><b>' +
    esc(fmtNum(m.trendingScore)) + "</b> score tendance</span><span>♥ " +
    esc(fmtNum(m.likes)) + "</span><span>↓ " + esc(fmtNum(m.downloads)) +
    " téléchargements</span></div></article>";
}

function toolCard(t) {
  var item = { kind: "tool", externalId: t.id, title: t.fullName, url: t.url, subtitle: t.description };
  var stats = "";
  if (t.downloadsMonthly != null) {
    stats += '<span><b>↓ ' + esc(fmtNum(t.downloadsMonthly)) + "</b> téléchargements / mois</span>";
  }
  if (t.stars != null) stats += "<span><b>★ " + esc(fmtNum(t.stars)) + "</b></span>";
  if (t.forks != null) stats += "<span>⑂ " + esc(fmtNum(t.forks)) + "</span>";
  if (t.createdAt) {
    stats += "<span>" + (t.source === "npm" ? "maj " : "créé le ") + esc(fmtDate(t.createdAt)) + "</span>";
  }
  stats += '<span class="source-tag">' + (t.source === "npm" ? "npm" : "GitLab") + "</span>";
  return '<article class="card"><div class="card-head">' +
    '<a class="card-title" href="' + esc(t.url) + '" target="_blank" rel="noreferrer">' + esc(t.fullName) + "</a>" +
    favButton(item) + "</div>" +
    (t.description ? '<p class="card-desc">' + esc(t.description) + "</p>" : "") +
    '<div class="card-stats">' + stats + "</div></article>";
}

function spaceCard(s) {
  var item = { kind: "space", externalId: s.id, title: s.id, url: s.url, subtitle: "Hugging Face Spaces" };
  return '<article class="card"><div class="card-head"><div style="min-width:0">' +
    '<a class="card-title" href="' + esc(s.url) + '" target="_blank" rel="noreferrer">' + esc(s.id) + "</a>" +
    '<p class="card-sub">♥ ' + esc(fmtNum(s.likes)) +
    (s.sdk ? " · " + esc(s.sdk) : "") + " · Hugging Face Spaces</p></div>" +
    favButton(item) + "</div></article>";
}

function storyRow(s) {
  var item = { kind: "news", externalId: s.id, title: s.title, url: s.url, subtitle: s.source };
  return '<div class="story-row"><div style="min-width:0">' +
    '<a class="card-title" href="' + esc(s.url) + '" target="_blank" rel="noreferrer">' + esc(s.title) + "</a>" +
    '<p class="story-meta">' + esc(s.source || hostOf(s.url)) +
    (s.publishedAt ? " · " + esc(timeAgo(s.publishedAt)) : "") +
    (s.points != null ? " · ▲ " + esc(s.points) : "") +
    (s.comments != null ? " · " + esc(s.comments) + " comm." : "") + "</p></div>" +
    favButton(item) + "</div>";
}

function paperCard(p) {
  var item = { kind: "paper", externalId: p.id, title: p.title, url: p.url, subtitle: p.authors.join(", ") };
  return '<article class="card"><div class="card-head">' +
    '<a class="card-title" href="' + esc(p.url) + '" target="_blank" rel="noreferrer">' + esc(p.title) + "</a>" +
    favButton(item) + "</div>" +
    '<p class="card-sub">' + esc(p.authors.join(", ")) +
    (p.publishedAt ? " · " + esc(fmtDate(p.publishedAt)) : "") +
    (p.venue ? " · " + esc(p.venue) : "") + " · OpenAlex</p>" +
    (p.summary ? '<p class="card-desc">' + esc(p.summary) + "…</p>" : "") + "</article>";
}

function sectionHead(title, hint, meta) {
  var right = "";
  if (hint) right += esc(hint);
  if (meta && meta.asOf) right += (right ? " · " : "") + "maj " + esc(timeAgo(meta.asOf));
  if (meta && meta.fromCache) right += " · cache";
  return '<div class="section-head"><h2>' + esc(title) + "</h2>" +
    (right ? '<p class="section-meta">' + right + "</p>" : "") + "</div>";
}

function emptyState(text) {
  return '<div class="empty">' + esc(text) + "</div>";
}

function renderTabs() {
  var nav = document.getElementById("tabs");
  var favCount = readFavs().length;
  nav.innerHTML = VIEWS.map(function (v) {
    var active = state.view === v.id && !state.searchQuery;
    var label = v.label + (v.id === "favoris" && favCount > 0 ? " (" + favCount + ")" : "");
    return '<button type="button" data-view="' + v.id + '" aria-pressed="' + active +
      '" aria-label="Afficher la section ' + esc(v.label) + '">' + esc(label) + "</button>";
  }).join("");
}

function renderApercu() {
  var d = state.data;
  var top = d.modelsTrending[0];
  var html = "";
  if (top) {
    var item = { kind: "model", externalId: top.id, title: top.id, url: top.url, subtitle: pipelineLabel(top.pipelineTag) };
    html += '<section aria-label="Le modèle le plus tendance du moment"><div class="hero"><div class="hero-inner">' +
      '<p class="hero-kicker">Le pulse du moment · Hugging Face</p>' +
      '<div class="hero-top"><a class="hero-title" href="' + esc(top.url) + '" target="_blank" rel="noreferrer">' + esc(top.name) + "</a>" +
      favButton(item) + "</div>" +
      '<p class="hero-sub">' + esc(top.owner) + " · " + esc(pipelineLabel(top.pipelineTag)) +
      (top.createdAt ? " · sorti le " + esc(fmtDate(top.createdAt)) : "") + "</p>" +
      '<div class="hero-stats">' +
      '<div class="stat-box"><p class="num">' + esc(fmtNum(top.trendingScore)) + '</p><p class="lbl">Score tendance</p></div>' +
      '<div class="stat-box"><p class="num plain">' + esc(fmtNum(top.likes)) + '</p><p class="lbl">Likes</p></div>' +
      '<div class="stat-box"><p class="num plain">' + esc(fmtNum(top.downloads)) + '</p><p class="lbl">Téléchargements</p></div>' +
      "</div></div></div></section>";
  } else if (state.meta.models && state.meta.models.error) {
    html += '<section>' + emptyState("Hugging Face est injoignable pour le moment — réessaie avec Actualiser.") + "</section>";
  }
  var counters = [
    { n: d.modelsTrending.length, l: "Modèles en tendance", v: "modeles" },
    { n: d.modelsNew.length, l: "Nouveaux modèles suivis", v: "modeles" },
    { n: d.npmTools.length + d.gitlabTools.length, l: "Outils & projets suivis", v: "outils" },
    { n: d.hnStories.length, l: "Discussions", v: "actus" },
  ];
  html += '<section aria-label="Compteurs du jour"><div class="counters">' +
    counters.map(function (c) {
      return '<button type="button" class="counter" data-goto="' + c.v + '" aria-label="Voir le détail : ' + esc(c.l) + '">' +
        '<p class="num">' + c.n + '</p><p class="lbl">' + esc(c.l) + "</p></button>";
    }).join("") + "</div></section>";
  html += '<section aria-label="Top modèles tendance">' +
    sectionHead("Modèles en tendance", null, state.meta.models) +
    (d.modelsTrending.length === 0
      ? emptyState("Aucun modèle récupéré pour le moment.")
      : '<div class="grid">' + d.modelsTrending.slice(0, 6).map(function (m, i) { return modelCard(m, i); }).join("") + "</div>") +
    '<button type="button" class="link-more" data-goto="modeles">Tous les modèles →</button></section>';
  html += '<section aria-label="Dernières actualités IA">' +
    sectionHead("À la une de l'IA", "Hacker News", state.meta.hn) +
    (d.hnStories.length === 0
      ? emptyState("Aucune actualité récupérée pour le moment.")
      : '<div class="story-list">' + d.hnStories.slice(0, 5).map(storyRow).join("") + "</div>") +
    '<button type="button" class="link-more" data-goto="actus">Toutes les actualités →</button></section>';
  html += '<section aria-label="Outils émergents">' +
    sectionHead("Outils qui montent", "npm · téléchargements mensuels", state.meta.npm) +
    (d.npmTools.length === 0
      ? emptyState("Aucun outil récupéré pour le moment.")
      : '<div class="grid">' + d.npmTools.slice(0, 4).map(toolCard).join("") + "</div>") +
    '<button type="button" class="link-more" data-goto="outils">Tous les outils →</button></section>';
  var latestAsOf = (state.meta.models && state.meta.models.asOf) || (state.meta.hn && state.meta.hn.asOf) || null;
  html += '<p class="mono" style="text-align:center;font-size:11px;color:var(--dim)">Sources : Hugging Face · npm · GitLab · Hacker News · OpenAlex' +
    (latestAsOf ? " — données récupérées " + esc(timeAgo(latestAsOf)) : "") + "</p>";
  return html;
}

function renderModeles() {
  var d = state.data;
  var tabs = [
    { id: "trending", label: "En tendance" },
    { id: "new", label: "Nouveautés" },
    { id: "popular", label: "Les plus téléchargés" },
  ];
  var list = state.modelTab === "trending" ? d.modelsTrending
    : state.modelTab === "new" ? d.modelsNew : d.modelsPopular;
  var title = state.modelTab === "trending" ? "Modèles en tendance"
    : state.modelTab === "new" ? "Nouveaux modèles" : "Modèles les plus téléchargés";
  var html = '<section aria-label="Tous les modèles"><div class="chip-row" role="group" aria-label="Tri des modèles">' +
    tabs.map(function (t) {
      return '<button type="button" class="chip" data-model-tab="' + t.id + '" aria-pressed="' + (state.modelTab === t.id) + '">' + esc(t.label) + "</button>";
    }).join("") + "</div>";
  if (state.modelTab === "trending") {
    var counts = new Map();
    d.modelsTrending.forEach(function (m) {
      if (m.pipelineTag) counts.set(m.pipelineTag, (counts.get(m.pipelineTag) || 0) + 1);
    });
    var cats = Array.from(counts.entries()).sort(function (a, b) { return b[1] - a[1]; });
    if (cats.length > 0) {
      html += '<div class="chip-row" role="group" aria-label="Filtrer par type de modèle">' +
        '<button type="button" class="chip small" data-category="all" aria-pressed="' + (state.category === "all") + '">Tous types</button>' +
        cats.map(function (c) {
          return '<button type="button" class="chip small" data-category="' + esc(c[0]) + '" aria-pressed="' + (state.category === c[0]) + '">' +
            esc(pipelineLabel(c[0])) + " (" + c[1] + ")</button>";
        }).join("") + "</div>";
    }
  }
  var filtered = state.category === "all" || state.modelTab !== "trending"
    ? list
    : list.filter(function (m) { return m.pipelineTag === state.category; });
  html += sectionHead(title, "Hugging Face", state.meta.models) +
    (filtered.length === 0
      ? emptyState("Aucun modèle dans cette sélection pour le moment.")
      : '<div class="grid">' + filtered.map(function (m, i) {
          return modelCard(m, state.modelTab === "trending" ? i : undefined);
        }).join("") + "</div>") + "</section>";
  return html;
}

function renderOutils() {
  var d = state.data;
  var html = '<section aria-label="Packages npm IA populaires">' +
    sectionHead("Packages IA populaires", "npm · MCP, LLM, agents — triés par téléchargements mensuels", state.meta.npm) +
    (d.npmTools.length === 0
      ? emptyState("Le registre npm est injoignable pour le moment — réessaie avec Actualiser.")
      : '<div class="grid">' + d.npmTools.map(toolCard).join("") + "</div>") + "</section>";
  html += '<section aria-label="Projets open source IA GitLab">' +
    sectionHead("Projets open source IA", "GitLab · triés par étoiles", state.meta.gitlab) +
    (d.gitlabTools.length === 0
      ? emptyState("Aucun projet GitLab récupéré pour le moment.")
      : '<div class="grid">' + d.gitlabTools.map(toolCard).join("") + "</div>") + "</section>";
  html += '<section aria-label="Démos Hugging Face Spaces populaires">' +
    sectionHead("Démos & apps populaires", "Hugging Face Spaces", state.meta.spaces) +
    (d.spaces.length === 0
      ? emptyState("Aucune démo récupérée pour le moment.")
      : '<div class="grid">' + d.spaces.map(spaceCard).join("") + "</div>") + "</section>";
  return html;
}

function renderActus() {
  var d = state.data;
  var html = '<div class="note"><b>Note :</b> la version complète affiche aussi un flux « presse IA » (articles éditoriaux). Ce flux passe par une recherche web côté serveur, sans équivalent direct dans un navigateur : il est donc absent de cette version statique. Les discussions Hacker News ci-dessous couvrent l’actualité du moment.</div>';
  html += '<section aria-label="Discussions Hacker News">' +
    sectionHead("En direct de Hacker News", "Triées par date", state.meta.hn) +
    (d.hnStories.length === 0
      ? emptyState("Aucune discussion récupérée pour le moment.")
      : '<div class="story-list">' + d.hnStories.map(storyRow).join("") + "</div>") + "</section>";
  return html;
}

function renderRecherche() {
  var d = state.data;
  var hint = paperSource === "openalex"
    ? "OpenAlex · triés par date · remplace arXiv"
    : "Semantic Scholar (secours) · triés par pertinence";
  var html = '<div class="note"><b>Note :</b> l’API arXiv n’envoie pas d’en-tête CORS, donc un navigateur ne peut pas l’interroger directement. Les papiers ci-dessous viennent d’OpenAlex (mêmes domaines : IA, TAL, apprentissage automatique), avec Semantic Scholar en secours si OpenAlex est injoignable.</div>';
  html += '<section aria-label="Papiers de recherche récents">' +
    sectionHead("Derniers papiers de recherche", hint, state.meta.papers) +
    (d.papers.length === 0
      ? emptyState("Aucun papier récupéré pour le moment — réessaie avec Actualiser.")
      : '<div class="grid">' + d.papers.map(paperCard).join("") + "</div>") + "</section>";
  return html;
}

function renderFavoris() {
  var favs = readFavs();
  var html = '<section aria-label="Mes favoris">' +
    sectionHead("Mes favoris", "Modèles, outils et articles suivis · stockés dans ce navigateur") +
    (favs.length === 0
      ? emptyState("Rien ici pour l’instant. Touche « ☆ Suivre » sur un modèle, un outil ou un article pour le retrouver ici.")
      : '<div style="display:grid;gap:12px">' + favs.map(function (f) {
          var kindLabel = f.kind === "model" ? "Modèle"
            : f.kind === "tool" ? "Outil"
            : f.kind === "space" ? "Démo"
            : f.kind === "paper" ? "Papier" : "Article";
          return '<article class="card"><div class="fav-row"><div style="min-width:0">' +
            '<span class="fav-kind">' + esc(kindLabel) + "</span>" +
            '<a class="card-title" style="display:block;margin-top:2px" href="' + esc(f.url) + '" target="_blank" rel="noreferrer">' + esc(f.title) + "</a>" +
            (f.subtitle ? '<p class="card-desc">' + esc(f.subtitle) + "</p>" : "") +
            '<p class="card-sub">' + esc(hostOf(f.url)) + " · ajouté " + esc(timeAgo(f.createdAt)) + "</p></div>" +
            '<button type="button" class="remove-btn" data-fav-remove="' + esc(f.kind + ":" + f.externalId) + '" aria-label="Retirer ' + esc(f.title) + ' des favoris">Retirer</button>' +
            "</div></article>";
        }).join("") + "</div>") + "</section>";
  return html;
}

function renderSearch() {
  var q = state.searchQuery;
  var r = state.searchResults;
  var html = '<section aria-label="Résultats de recherche">' +
    sectionHead("Résultats pour « " + q + " »", null, null);
  if (!r) {
    html += '<p class="loading">Recherche sur Hugging Face, npm, GitLab et Hacker News…</p>';
  } else {
    html += "<div style=\"display:grid;gap:32px\">";
    html += "<div><h3 class=\"mono\" style=\"font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--dim);margin:0 0 8px\">Modèles — Hugging Face</h3>" +
      (r.models.length === 0 ? emptyState("Aucun modèle trouvé pour cette recherche.")
        : '<div class="grid">' + r.models.map(function (m) { return modelCard(m); }).join("") + "</div>") + "</div>";
    html += "<div><h3 class=\"mono\" style=\"font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--dim);margin:0 0 8px\">Outils — npm &amp; GitLab</h3>" +
      (r.tools.length === 0 ? emptyState("Aucun outil trouvé pour cette recherche.")
        : '<div class="grid">' + r.tools.map(toolCard).join("") + "</div>") + "</div>";
    html += "<div><h3 class=\"mono\" style=\"font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--dim);margin:0 0 8px\">Discussions — Hacker News</h3>" +
      (r.stories.length === 0 ? emptyState("Aucune discussion trouvée pour cette recherche.")
        : '<div class="story-list">' + r.stories.map(storyRow).join("") + "</div>") + "</div>";
    html += "</div>";
  }
  return html + "</section>";
}

function render() {
  favRegistry = {};
  var main = document.getElementById("main");
  renderTabs();
  if (state.loading) {
    main.innerHTML = '<div class="loading"><p>Récupération des tendances en direct…</p><p>Hugging Face · npm · GitLab · Hacker News · OpenAlex</p></div>';
    return;
  }
  var allFailed = FEEDS.every(function (f) {
    return state.meta[f.meta] && state.meta[f.meta].error;
  });
  if (allFailed) {
    main.innerHTML = '<div class="error-box"><h2>Impossible de charger le tableau de bord.</h2>' +
      "<p>Les sources sont peut-être momentanément inaccessibles.</p>" +
      '<button type="button" class="btn-accent" data-action="retry">Réessayer</button></div>';
    return;
  }
  var html = "";
  if (state.searchQuery) {
    html = renderSearch();
  } else if (state.view === "apercu") {
    html = renderApercu();
  } else if (state.view === "modeles") {
    html = renderModeles();
  } else if (state.view === "outils") {
    html = renderOutils();
  } else if (state.view === "actus") {
    html = renderActus();
  } else if (state.view === "recherche") {
    html = renderRecherche();
  } else if (state.view === "favoris") {
    html = renderFavoris();
  }
  main.innerHTML = html;
}

/* -------------------------------------------------------------- démarrage */

function setView(view) {
  state.view = view;
  state.searchQuery = "";
  state.searchResults = null;
  var input = document.getElementById("search");
  if (input) input.value = "";
  document.getElementById("search-clear").hidden = true;
  render();
  window.scrollTo({ top: 0 });
}

async function runSearch(q) {
  state.searchQuery = q;
  state.searchResults = null;
  render();
  try {
    state.searchResults = await searchTrends(q);
  } catch (e) {
    state.searchResults = { models: [], tools: [], stories: [] };
  }
  render();
  window.scrollTo({ top: 0 });
}

function init() {
  var refreshBtn = document.getElementById("refresh-btn");
  var searchForm = document.getElementById("search-form");
  var searchInput = document.getElementById("search");
  var searchClear = document.getElementById("search-clear");

  document.getElementById("tabs").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-view]");
    if (btn) setView(btn.getAttribute("data-view"));
  });

  document.getElementById("main").addEventListener("click", function (e) {
    var favBtn = e.target.closest("[data-fav-key]");
    if (favBtn) {
      var item = favRegistry[favBtn.getAttribute("data-fav-key")];
      if (item) {
        toggleFav(item);
        render();
      }
      return;
    }
    var removeBtn = e.target.closest("[data-fav-remove]");
    if (removeBtn) {
      var parts = removeBtn.getAttribute("data-fav-remove").split(":");
      var kind = parts[0];
      var id = parts.slice(1).join(":");
      toggleFav({ kind: kind, externalId: id, title: "", url: "" });
      render();
      return;
    }
    var gotoBtn = e.target.closest("[data-goto]");
    if (gotoBtn) {
      setView(gotoBtn.getAttribute("data-goto"));
      return;
    }
    var tabBtn = e.target.closest("[data-model-tab]");
    if (tabBtn) {
      state.modelTab = tabBtn.getAttribute("data-model-tab");
      render();
      return;
    }
    var catBtn = e.target.closest("[data-category]");
    if (catBtn) {
      state.category = catBtn.getAttribute("data-category");
      render();
      return;
    }
    var retryBtn = e.target.closest('[data-action="retry"]');
    if (retryBtn) {
      state.loading = true;
      render();
      loadAll(true).then(render);
    }
  });

  searchForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var q = searchInput.value.trim();
    if (q.length >= 2) {
      searchClear.hidden = false;
      runSearch(q);
    }
  });
  searchInput.addEventListener("input", function () {
    searchClear.hidden = searchInput.value.trim().length === 0;
  });
  searchClear.addEventListener("click", function () {
    searchInput.value = "";
    searchClear.hidden = true;
    state.searchQuery = "";
    state.searchResults = null;
    render();
  });

  refreshBtn.addEventListener("click", async function () {
    if (state.refreshing) return;
    state.refreshing = true;
    refreshBtn.disabled = true;
    refreshBtn.textContent = "…";
    await loadAll(true);
    state.refreshing = false;
    refreshBtn.disabled = false;
    refreshBtn.textContent = "↻ Actualiser";
    render();
  });

  render();
  loadAll(false).then(render);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}

/* Exposé pour les tests Node (node --check + require). Sans effet navigateur. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    fmtNum: fmtNum,
    timeAgo: timeAgo,
    fmtDate: fmtDate,
    pipelineLabel: pipelineLabel,
    mapModel: mapModel,
    mapSpace: mapSpace,
    mapNpmPackage: mapNpmPackage,
    mapGitlabProject: mapGitlabProject,
    mapHnHit: mapHnHit,
    mapOpenAlexWork: mapOpenAlexWork,
    mapS2Paper: mapS2Paper,
    openAlexAbstract: openAlexAbstract,
    AI_TITLE_RE: AI_TITLE_RE,
  };
}
