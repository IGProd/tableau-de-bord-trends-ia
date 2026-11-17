# Data Plan

## Context provenance
- `je veux que tu me code une application pour savoir quel sont les trends AI — Les deux, un tableau de bord complet (nouveaux modèles et outils IA + actualités IA)` (verbatim user request; defines the two pillars: 1) nouveaux modèles et outils IA, 2) actualités IA, in one complete dashboard)
- User writes in French → entire UI in French.

## Tested sources
### Hugging Face Models API — modèles tendance + nouveaux + populaires
**Used by**: getDashboard, searchTrends
**Test command**: `curl -s "https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=5"` + live action invocation (getDashboard force) returning real rows
**Sample output**: `deepseek-ai/DeepSeek-V4.1-Flash-1017` (likes 1180, trendingScore 1100, downloads 10233, createdAt 2026-10-17), `google/embeddinggemma-2`, `Qwen/Qwen3.8-27B`. Fields: id, likes, trendingScore, downloads, tags, pipeline_tag, createdAt.
**Processing**: sort=trendingScore / createdAt / downloads. 'Nouveautés' fetches 60 by createdAt and keeps only models with a pipeline_tag (raw firehose is full of untagged test uploads).

### Hugging Face Spaces API — démos / apps IA populaires
**Used by**: getDashboard
**Test command**: `curl -sL "https://huggingface.co/api/spaces?sort=likes&direction=-1&limit=2"` + live action run (12 spaces returned, e.g. enzostvs/deepsite 16610 likes)
**Processing**: Top spaces by likes; link to https://huggingface.co/spaces/<id>.

### npm Registry Search API — packages IA populaires (outils)
**Used by**: getDashboard (tools_npm), searchTrends
**Test command**: probe-ctx fetch `https://registry.npmjs.org/-/v1/search?text=llm%20agent&size=3`
**Sample output**: STATUS 200, objects carry `downloads.monthly` (e.g. 1086740), `package.name/description/date/links.npm`, searchScore.
**Processing**: Queries keywords:mcp / keywords:llm / keywords:openai / keywords:ai-agent, dedupe by name, keep monthly downloads >= 1000, sort desc, top 15. Covers the MCP/LLM tooling wave with a real usage metric.

### GitLab API — projets open source IA (outils)
**Used by**: getDashboard (tools_gitlab), searchTrends
**Test command**: probe-ctx fetch `https://gitlab.com/api/v4/projects?topic=artificial-intelligence&order_by=star_count&sort=desc&per_page=3&simple=true`
**Sample output**: STATUS 200, array of projects with description, star_count, forks_count, path_with_namespace, web_url.
**Processing**: Topics artificial-intelligence / llm / machine-learning, dedupe, stars >= 3, sort by stars desc, top 12.

### Hacker News Algolia API — discussions IA récentes
**Used by**: getDashboard, searchTrends
**Test command**: `curl -s "https://hn.algolia.com/api/v1/search_by_date?query=AI&tags=story&hitsPerPage=5"` + live action run
**Sample output**: Live dated stories from 2026-10-18. Fields: title, url, created_at, points, num_comments, objectID.
**Processing**: Queries AI/LLM/OpenAI/Anthropic merged & deduped; TITLE keyword filter (word-boundary regex: ai, llm, gpt, openai, claude, mcp, agent…) because Algolia matches 'ai' inside unrelated words (observed noise: retro-computing and local-news stories in the first live run). Sorted by date desc.

### arXiv API — papiers de recherche récents
**Used by**: getDashboard
**Test command**: `curl -sL "https://export.arxiv.org/api/query?search_query=cat:cs.AI&start=0&max_results=2&sortBy=submittedDate&sortOrder=descending"` + live action run (12 papers, e.g. LIBERO-PeRM 2610.22372)
**Processing**: Atom XML parsed server-side (cs.AI+cs.CL+cs.LG), summary truncated to 420 chars.

### ctx.tool.web_search — actualités IA éditoriales
**Used by**: getDashboard (news_web)
**Test command**: probe-ctx `ctx.tool.web_search("latest AI news artificial intelligence October 2026")` + live action run
**Sample output**: Real article results (TechCrunch, Reuters, Daily Caller…) with title/url/source/published_at/is_index_page.
**Processing**: Filtered to articles only: drops is_index_page results, homepages and /category/ pages (first live run surfaced section pages), deduped by normalized URL. URLs used verbatim as outbound links.

## Long-term data behavior
- **Refresh policy**: Fetch-on-open with DB cache (feed_snapshots keyed by feed). Staleness budget 60 min; manual 'Actualiser' forces refresh. Each section renders its as_of. On failure: last cache labeled stale, or honest empty state — never invented rows.
- **Growth**: Latest 3 snapshots kept per feed; favorites grow only by explicit user tap.
- **Ordering**: Models by trendingScore/createdAt/downloads; npm tools by monthly downloads; GitLab by stars; news & papers by date desc.
- **Time semantics**: Source timestamps stored as ISO instants, rendered viewer-local in French.

## Rejected approaches
- **Tried**: GitHub Search API for emerging tools (worked from builder shell: 200 in 1.7s)
  **Why rejected**: From the ACTION RUNTIME egress, both api.github.com and github.com time out (probe-ctx fetch: TimeoutError at 12-20s, twice, plus two live action runs returning empty tools while every other host responded). Replaced by GitLab API + npm registry, both probed 200 from the runtime probe.
- **Tried**: Product Hunt API
  **Why rejected**: Requires OAuth token.
- **Tried**: Static baked snapshot
  **Why rejected**: Trends/news must be current at open; web_fullstack fetch-on-open with cache.
- **Imagery**: No photos — data dashboard; identity comes from names, owners and live metrics. Remote avatars are hotlinks and are not rendered.
