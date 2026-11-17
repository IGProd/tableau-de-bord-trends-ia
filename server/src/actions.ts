// Server actions for the AI Trends dashboard.
//
// Data comes from live public sources, fetched on open and cached in
// feed_snapshots (60-minute staleness budget):
//   - Hugging Face API  : trending / new / popular models, popular Spaces
//   - npm registry      : popular AI packages (monthly downloads)
//   - GitLab API        : open-source AI projects (stars)
//   - HN Algolia API    : recent AI stories from Hacker News (title-filtered)
//   - arXiv API         : latest cs.AI / cs.CL / cs.LG papers
//   - ctx.tool.web_search : editorial AI news headlines (articles only)
// Note: api.github.com / github.com time out from the action runtime egress
// (verified by probe), so GitHub is not used at runtime; GitLab + npm
// cover the "outils IA" pillar with structured metrics.
// On a source failure the last cache is served, labeled with its as_of;
// with no cache the feed returns an honest empty list + error flag.

import { defineAction, z, type ActionsModule, type Ctx } from "@hatch/space-sdk";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "./schema";

const STALE_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------- shapes

const modelSchema = z.object({
  id: z.string(),
  owner: z.string(),
  name: z.string(),
  likes: z.number(),
  downloads: z.number(),
  trendingScore: z.number(),
  pipelineTag: z.string().nullable(),
  createdAt: z.string().nullable(),
  url: z.string(),
});

const spaceSchema = z.object({
  id: z.string(),
  likes: z.number(),
  sdk: z.string().nullable(),
  createdAt: z.string().nullable(),
  url: z.string(),
});

const toolSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  description: z.string().nullable(),
  source: z.enum(["npm", "gitlab"]),
  stars: z.number().nullable(),
  forks: z.number().nullable(),
  downloadsMonthly: z.number().nullable(),
  language: z.string().nullable(),
  createdAt: z.string().nullable(),
  url: z.string(),
});

const storySchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  source: z.string(),
  points: z.number().nullable(),
  comments: z.number().nullable(),
  publishedAt: z.string().nullable(),
});

const paperSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  authors: z.array(z.string()),
  publishedAt: z.string().nullable(),
  url: z.string(),
});

const feedMetaSchema = z.object({
  asOf: z.string().nullable(),
  stale: z.boolean(),
  error: z.boolean(),
});

const favoriteSchema = z.object({
  id: z.number(),
  kind: z.enum(["model", "tool", "space", "news", "paper"]),
  externalId: z.string(),
  title: z.string(),
  url: z.string(),
  subtitle: z.string().nullable(),
  createdAt: z.string(),
});

type ModelItem = z.infer<typeof modelSchema>;
type SpaceItem = z.infer<typeof spaceSchema>;
type ToolItem = z.infer<typeof toolSchema>;
type StoryItem = z.infer<typeof storySchema>;
type PaperItem = z.infer<typeof paperSchema>;

interface FeedResult<T> {
  items: T[];
  asOf: string | null;
  stale: boolean;
  error: boolean;
}

// ---------------------------------------------------------------- helpers

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "muse-trends-ia-dashboard",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as unknown;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "muse-trends-ia-dashboard" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null
    ? (v as Record<string, unknown>)
    : {};
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

// ---------------------------------------------------------------- models

function mapModel(raw: unknown): ModelItem {
  const m = asRecord(raw);
  const id = str(m.id) || str(m.modelId);
  const slash = id.indexOf("/");
  return {
    id,
    owner: slash > 0 ? id.slice(0, slash) : "",
    name: slash > 0 ? id.slice(slash + 1) : id,
    likes: num(m.likes),
    downloads: num(m.downloads),
    trendingScore: num(m.trendingScore),
    pipelineTag: strOrNull(m.pipeline_tag),
    createdAt: strOrNull(m.createdAt),
    url: `https://huggingface.co/${id}`,
  };
}

async function fetchModels(sort: string, limit: number): Promise<ModelItem[]> {
  const data = await fetchJson(
    `https://huggingface.co/api/models?sort=${encodeURIComponent(sort)}&direction=-1&limit=${limit}`,
  );
  return asArray(data).map(mapModel).filter((m) => m.id.length > 0);
}

async function fetchNewModels(): Promise<ModelItem[]> {
  // The raw createdAt firehose is full of untagged test uploads; keep only
  // models that declare a pipeline task, which is what a reader means by
  // "nouveau modèle".
  const all = await fetchModels("createdAt", 60);
  return all.filter((m) => m.pipelineTag !== null).slice(0, 18);
}

async function fetchSpaces(): Promise<SpaceItem[]> {
  const data = await fetchJson(
    "https://huggingface.co/api/spaces?sort=likes&direction=-1&limit=12",
  );
  return asArray(data)
    .map((raw) => {
      const s = asRecord(raw);
      const id = str(s.id);
      return {
        id,
        likes: num(s.likes),
        sdk: strOrNull(s.sdk),
        createdAt: strOrNull(s.createdAt),
        url: `https://huggingface.co/spaces/${id}`,
      };
    })
    .filter((s) => s.id.length > 0);
}

// ---------------------------------------------------------------- tools

function mapNpmPackage(raw: unknown): ToolItem | null {
  const o = asRecord(raw);
  const pkg = asRecord(o.package);
  const name = str(pkg.name);
  if (!name) return null;
  const links = asRecord(pkg.links);
  const downloads = asRecord(o.downloads);
  return {
    id: `npm:${name}`,
    fullName: name,
    description: strOrNull(pkg.description),
    source: "npm",
    stars: null,
    forks: null,
    downloadsMonthly: numOrNull(downloads.monthly),
    language: null,
    createdAt: strOrNull(pkg.date),
    url: strOrNull(links.npm) ?? `https://www.npmjs.com/package/${name}`,
  };
}

async function fetchNpmTools(): Promise<ToolItem[]> {
  const queries = ["keywords:mcp", "keywords:llm", "keywords:openai", "keywords:ai-agent"];
  const byId = new Map<string, ToolItem>();
  for (const q of queries) {
    try {
      const data = asRecord(
        await fetchJson(
          `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=20`,
        ),
      );
      for (const raw of asArray(data.objects)) {
        const t = mapNpmPackage(raw);
        if (t && !byId.has(t.id)) byId.set(t.id, t);
      }
    } catch {
      // other queries may still succeed
    }
  }
  return [...byId.values()]
    .filter((t) => (t.downloadsMonthly ?? 0) >= 1000)
    .sort((a, b) => (b.downloadsMonthly ?? 0) - (a.downloadsMonthly ?? 0))
    .slice(0, 15);
}

function mapGitlabProject(raw: unknown): ToolItem | null {
  const p = asRecord(raw);
  const path = str(p.path_with_namespace);
  if (!path) return null;
  return {
    id: `gitlab:${path}`,
    fullName: path,
    description: strOrNull(p.description)?.slice(0, 300) ?? null,
    source: "gitlab",
    stars: numOrNull(p.star_count),
    forks: numOrNull(p.forks_count),
    downloadsMonthly: null,
    language: null,
    createdAt: strOrNull(p.created_at),
    url: str(p.web_url) || `https://gitlab.com/${path}`,
  };
}

async function fetchGitlabTools(): Promise<ToolItem[]> {
  const topics = ["artificial-intelligence", "llm", "machine-learning"];
  const byId = new Map<string, ToolItem>();
  for (const topic of topics) {
    try {
      const data = await fetchJson(
        `https://gitlab.com/api/v4/projects?topic=${encodeURIComponent(topic)}&order_by=star_count&sort=desc&per_page=12&simple=true`,
      );
      for (const raw of asArray(data)) {
        const t = mapGitlabProject(raw);
        if (t && !byId.has(t.id)) byId.set(t.id, t);
      }
    } catch {
      // other topics may still succeed
    }
  }
  return [...byId.values()]
    .filter((t) => (t.stars ?? 0) >= 3)
    .sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0))
    .slice(0, 12);
}

// ---------------------------------------------------------------- news HN

const AI_TITLE_RE =
  /\b(ai|llm|llms|gpt|agi|openai|anthropic|claude|gemini|llama|mistral|deepseek|qwen|copilot|chatgpt|chatbot|machine learning|deep learning|neural|artificial intelligence|mcp|rag|inference|transformer|diffusion|humanoid|ai agents?)\b/i;

async function fetchHnStories(): Promise<StoryItem[]> {
  const queries = ["AI", "LLM", "OpenAI", "Anthropic"];
  const byId = new Map<string, StoryItem>();
  for (const q of queries) {
    try {
      const data = asRecord(
        await fetchJson(
          `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=15`,
        ),
      );
      for (const raw of asArray(data.hits)) {
        const h = asRecord(raw);
        const oid = str(h.objectID);
        const title = str(h.title);
        // Algolia matches "ai" inside unrelated words; require a real
        // AI keyword in the title so the feed stays on-topic.
        if (!oid || !title || !AI_TITLE_RE.test(title) || byId.has(oid)) {
          continue;
        }
        const url =
          strOrNull(h.url) ?? `https://news.ycombinator.com/item?id=${oid}`;
        let source = "Hacker News";
        try {
          source = new URL(url).hostname.replace(/^www\./, "");
        } catch {
          source = "Hacker News";
        }
        byId.set(oid, {
          id: oid,
          title,
          url,
          source,
          points: typeof h.points === "number" ? h.points : null,
          comments: typeof h.num_comments === "number" ? h.num_comments : null,
          publishedAt: strOrNull(h.created_at),
        });
      }
    } catch {
      // keep going with other queries
    }
  }
  return [...byId.values()]
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    .slice(0, 20);
}

// ---------------------------------------------------------------- papers

function deEnt(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

async function fetchPapers(): Promise<PaperItem[]> {
  const xml = await fetchText(
    "https://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.CL+OR+cat:cs.LG&start=0&max_results=12&sortBy=submittedDate&sortOrder=descending",
  );
  const entries = xml.split("<entry>").slice(1);
  const papers: PaperItem[] = [];
  for (const entry of entries) {
    const pick = (tag: string): string => {
      const m = entry.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
      return m?.[1] ? deEnt(m[1].trim().replace(/\s+/g, " ")) : "";
    };
    const idRaw = pick("id");
    const absUrl = idRaw.replace("http://", "https://");
    const authors = [
      ...entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g),
    ]
      .map((m) => deEnt((m[1] ?? "").trim()))
      .filter((a) => a.length > 0)
      .slice(0, 4);
    const title = pick("title");
    if (!title || !absUrl) continue;
    papers.push({
      id: absUrl,
      title,
      summary: pick("summary").slice(0, 420),
      authors,
      publishedAt: strOrNull(pick("published")),
      url: absUrl,
    });
  }
  return papers;
}

// ---------------------------------------------------------------- web news

async function fetchWebNews(ctx: Ctx): Promise<StoryItem[]> {
  const queries = [
    "latest artificial intelligence news today",
    "new AI model release announcement",
  ];
  const byUrl = new Map<string, StoryItem>();
  for (const q of queries) {
    try {
      const res = await ctx.tool.web_search(q);
      const results = res.content?.results ?? [];
      for (const r of results) {
        if (!r.url || !r.title || r.is_index_page) continue;
        let parsed: URL;
        try {
          parsed = new URL(r.url);
        } catch {
          continue;
        }
        // Articles only: skip homepages and section/category pages.
        if (parsed.pathname === "/" || parsed.pathname.startsWith("/category/")) {
          continue;
        }
        const normalized = `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}`;
        if (byUrl.has(normalized)) continue;
        byUrl.set(normalized, {
          id: r.url,
          title: r.title,
          url: r.url,
          source: r.source ?? "Web",
          points: null,
          comments: null,
          publishedAt: r.published_at ?? null,
        });
      }
    } catch {
      // web_search unavailable: HN feed still covers news
    }
  }
  return [...byUrl.values()].slice(0, 12);
}

// ---------------------------------------------------------------- cache

async function getFeed<T>(
  ctx: Ctx,
  feedKey: string,
  fetcher: () => Promise<T[]>,
  force: boolean,
): Promise<FeedResult<T>> {
  const db = ctx.db<typeof schema>();
  const rows = await db
    .select()
    .from(schema.feedSnapshots)
    .where(eq(schema.feedSnapshots.feedKey, feedKey))
    .orderBy(desc(schema.feedSnapshots.id))
    .limit(1);
  const cached = rows[0];
  const cachedItems: T[] = cached ? (JSON.parse(cached.payload) as T[]) : [];
  const cachedAsOf = cached ? cached.fetchedAt.toISOString() : null;
  const fresh =
    cached != null && Date.now() - cached.fetchedAt.getTime() < STALE_MS;

  if (fresh && !force) {
    return { items: cachedItems, asOf: cachedAsOf, stale: false, error: false };
  }
  try {
    const items = await fetcher();
    if (items.length === 0 && cachedItems.length > 0) {
      return { items: cachedItems, asOf: cachedAsOf, stale: true, error: true };
    }
    const now = new Date();
    await db.insert(schema.feedSnapshots).values({
      feedKey,
      payload: JSON.stringify(items),
      fetchedAt: now,
    });
    const all = await db
      .select({ id: schema.feedSnapshots.id })
      .from(schema.feedSnapshots)
      .where(eq(schema.feedSnapshots.feedKey, feedKey))
      .orderBy(desc(schema.feedSnapshots.id));
    for (const old of all.slice(0, Math.max(0, all.length - 3))) {
      await db
        .delete(schema.feedSnapshots)
        .where(eq(schema.feedSnapshots.id, old.id));
    }
    return { items, asOf: now.toISOString(), stale: false, error: false };
  } catch {
    if (cachedItems.length > 0) {
      return { items: cachedItems, asOf: cachedAsOf, stale: true, error: true };
    }
    return { items: [], asOf: null, stale: false, error: true };
  }
}

// ---------------------------------------------------------------- actions

const dashboardResponse = z.object({
  modelsTrending: z.array(modelSchema),
  modelsNew: z.array(modelSchema),
  modelsPopular: z.array(modelSchema),
  spaces: z.array(spaceSchema),
  npmTools: z.array(toolSchema),
  gitlabTools: z.array(toolSchema),
  hnStories: z.array(storySchema),
  webNews: z.array(storySchema),
  papers: z.array(paperSchema),
  feeds: z.object({
    models: feedMetaSchema,
    spaces: feedMetaSchema,
    npm: feedMetaSchema,
    gitlab: feedMetaSchema,
    hn: feedMetaSchema,
    web: feedMetaSchema,
    papers: feedMetaSchema,
  }),
});

type DashboardResponse = z.infer<typeof dashboardResponse>;

async function loadDashboard(
  ctx: Ctx,
  force: boolean,
): Promise<DashboardResponse> {
  const [trending, fresh, popular, spaces, npm, gitlab, hn, web, papers] =
    await Promise.all([
      getFeed(ctx, "models_trending", () => fetchModels("trendingScore", 18), force),
      getFeed(ctx, "models_new", fetchNewModels, force),
      getFeed(ctx, "models_popular", () => fetchModels("downloads", 18), force),
      getFeed(ctx, "spaces", fetchSpaces, force),
      getFeed(ctx, "tools_npm", fetchNpmTools, force),
      getFeed(ctx, "tools_gitlab", fetchGitlabTools, force),
      getFeed(ctx, "news_hn", fetchHnStories, force),
      getFeed(ctx, "news_web", () => fetchWebNews(ctx), force),
      getFeed(ctx, "papers", fetchPapers, force),
    ]);
  const meta = (f: FeedResult<unknown>) => ({
    asOf: f.asOf,
    stale: f.stale,
    error: f.error,
  });
  return {
    modelsTrending: trending.items,
    modelsNew: fresh.items,
    modelsPopular: popular.items,
    spaces: spaces.items,
    npmTools: npm.items,
    gitlabTools: gitlab.items,
    hnStories: hn.items,
    webNews: web.items,
    papers: papers.items,
    feeds: {
      models: meta(trending),
      spaces: meta(spaces),
      npm: meta(npm),
      gitlab: meta(gitlab),
      hn: meta(hn),
      web: meta(web),
      papers: meta(papers),
    },
  };
}

export const Actions = {
  getDashboard: defineAction({
    request: z.object({
      force: z.boolean().default(false),
    }),
    response: dashboardResponse,
    async handler(ctx, args): Promise<DashboardResponse> {
      return loadDashboard(ctx, args.force);
    },
  }),

  searchTrends: defineAction({
    request: z.object({ query: z.string().min(2).max(80) }),
    response: z.object({
      models: z.array(modelSchema),
      tools: z.array(toolSchema),
      stories: z.array(storySchema),
    }),
    async handler(_ctx, args) {
      const q = args.query.trim();
      const [models, npmTools, gitlabTools, stories] = await Promise.all([
        (async (): Promise<ModelItem[]> => {
          try {
            const data = await fetchJson(
              `https://huggingface.co/api/models?search=${encodeURIComponent(q)}&sort=downloads&direction=-1&limit=10`,
            );
            return asArray(data).map(mapModel).filter((m) => m.id.length > 0);
          } catch {
            return [];
          }
        })(),
        (async (): Promise<ToolItem[]> => {
          try {
            const data = asRecord(
              await fetchJson(
                `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=10`,
              ),
            );
            return asArray(data.objects)
              .map(mapNpmPackage)
              .filter((t): t is ToolItem => t !== null);
          } catch {
            return [];
          }
        })(),
        (async (): Promise<ToolItem[]> => {
          try {
            const data = await fetchJson(
              `https://gitlab.com/api/v4/projects?search=${encodeURIComponent(q)}&order_by=star_count&sort=desc&per_page=10&simple=true`,
            );
            return asArray(data)
              .map(mapGitlabProject)
              .filter((t): t is ToolItem => t !== null);
          } catch {
            return [];
          }
        })(),
        (async (): Promise<StoryItem[]> => {
          try {
            const data = asRecord(
              await fetchJson(
                `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=10`,
              ),
            );
            return asArray(data.hits)
              .map((raw) => {
                const h = asRecord(raw);
                const oid = str(h.objectID);
                const url =
                  strOrNull(h.url) ??
                  `https://news.ycombinator.com/item?id=${oid}`;
                let source = "Hacker News";
                try {
                  source = new URL(url).hostname.replace(/^www\./, "");
                } catch {
                  source = "Hacker News";
                }
                return {
                  id: oid,
                  title: str(h.title),
                  url,
                  source,
                  points: typeof h.points === "number" ? h.points : null,
                  comments:
                    typeof h.num_comments === "number" ? h.num_comments : null,
                  publishedAt: strOrNull(h.created_at),
                };
              })
              .filter((s) => s.title.length > 0);
          } catch {
            return [];
          }
        })(),
      ]);
      const tools = [...npmTools, ...gitlabTools].sort(
        (a, b) =>
          (b.downloadsMonthly ?? b.stars ?? 0) -
          (a.downloadsMonthly ?? a.stars ?? 0),
      );
      return { models, tools, stories };
    },
  }),

  listFavorites: defineAction({
    request: z.object({}),
    response: z.object({ favorites: z.array(favoriteSchema) }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.favorites)
        .orderBy(desc(schema.favorites.id));
      return {
        favorites: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          externalId: r.externalId,
          title: r.title,
          url: r.url,
          subtitle: r.subtitle,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    },
  }),

  toggleFavorite: defineAction({
    request: z.object({
      kind: z.enum(["model", "tool", "space", "news", "paper"]),
      externalId: z.string().min(1).max(300),
      title: z.string().min(1).max(500),
      url: z.string().min(1).max(1000),
      subtitle: z.string().max(500).nullable().default(null),
    }),
    response: z.object({ isFavorite: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const existing = await db
        .select()
        .from(schema.favorites)
        .where(
          and(
            eq(schema.favorites.kind, args.kind),
            eq(schema.favorites.externalId, args.externalId),
          ),
        )
        .limit(1);
      if (existing[0]) {
        await db
          .delete(schema.favorites)
          .where(eq(schema.favorites.id, existing[0].id));
        ctx.invalidateQueries();
        return { isFavorite: false };
      }
      await db.insert(schema.favorites).values({
        kind: args.kind,
        externalId: args.externalId,
        title: args.title,
        url: args.url,
        subtitle: args.subtitle,
      });
      ctx.invalidateQueries();
      return { isFavorite: true };
    },
  }),
} satisfies ActionsModule;
