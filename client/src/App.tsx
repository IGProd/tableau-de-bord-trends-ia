import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";

type Dashboard = ApiResponse<typeof api, "getDashboard">;
type Model = Dashboard["modelsTrending"][number];
type Tool = Dashboard["npmTools"][number];
type Space = Dashboard["spaces"][number];
type Story = Dashboard["hnStories"][number];
type Paper = Dashboard["papers"][number];
type FavKind = "model" | "tool" | "space" | "news" | "paper";

type View = "apercu" | "modeles" | "outils" | "actus" | "recherche" | "favoris";

const VIEWS: { id: View; label: string }[] = [
  { id: "apercu", label: "Aperçu" },
  { id: "modeles", label: "Modèles" },
  { id: "outils", label: "Outils" },
  { id: "actus", label: "Actualités" },
  { id: "recherche", label: "Recherche" },
  { id: "favoris", label: "Favoris" },
];

const PIPELINE_FR: Record<string, string> = {
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
  "summarization": "Résumé",
  "translation": "Traduction",
  "image-to-image": "Image → image",
  "audio-classification": "Classification audio",
  "fill-mask": "Texte masqué",
  "video-classification": "Classification vidéo",
  "text-to-video": "Texte → vidéo",
  "image-segmentation": "Segmentation",
  "depth-estimation": "Estimation de profondeur",
  "sentence-similarity": "Similarité de phrases",
};

function pipelineLabel(tag: string | null): string {
  if (!tag) return "Modèle";
  return PIPELINE_FR[tag] ?? tag.replace(/-/g, " ");
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")} M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")} k`;
  return String(n);
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `il y a ${d} j`;
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ------------------------------------------------------------ small pieces

function FavButton({
  active,
  label,
  onToggle,
}: {
  active: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
        active
          ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]"
          : "border-[var(--border)] text-[var(--dim)] hover:text-[var(--text)]"
      }`}
    >
      {active ? "★ Suivi" : "☆ Suivre"}
    </button>
  );
}

function SectionTitle({
  title,
  hint,
  asOf,
  stale,
}: {
  title: string;
  hint?: string;
  asOf?: string | null;
  stale?: boolean;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-lg font-extrabold tracking-tight text-[var(--text)]">
        {title}
      </h2>
      <p className="font-mono2 text-right text-[11px] text-[var(--dim)]">
        {hint}
        {asOf ? ` · maj ${timeAgo(asOf)}` : ""}
        {stale ? " · cache" : ""}
      </p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-8 text-center text-sm text-[var(--dim)]">
      {text}
    </div>
  );
}

// ------------------------------------------------------------ cards

function ModelCard({
  model,
  rank,
  isFav,
  onToggleFav,
}: {
  model: Model;
  rank?: number;
  isFav: boolean;
  onToggleFav: () => void;
}) {
  return (
    <div className="min-w-0 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {rank != null && (
            <span className="font-mono2 mr-2 text-sm font-semibold text-[var(--accent)]">
              #{rank + 1}
            </span>
          )}
          <a
            href={model.url}
            target="_blank"
            rel="noreferrer"
            className="break-words text-[15px] font-bold leading-snug text-[var(--text)] underline-offset-2 hover:underline"
          >
            {model.name}
          </a>
          <p className="font-mono2 mt-0.5 truncate text-xs text-[var(--dim)]">
            {model.owner} · {pipelineLabel(model.pipelineTag)}
            {model.createdAt ? ` · ${fmtDate(model.createdAt)}` : ""}
          </p>
        </div>
        <FavButton
          active={isFav}
          label={`${isFav ? "Retirer des favoris" : "Suivre le modèle"} ${model.id}`}
          onToggle={onToggleFav}
        />
      </div>
      <div className="font-mono2 mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--dim)]">
        <span>
          <span className="font-semibold text-[var(--teal)]">
            {fmtNum(model.trendingScore)}
          </span>{" "}
          score tendance
        </span>
        <span>♥ {fmtNum(model.likes)}</span>
        <span>↓ {fmtNum(model.downloads)} téléchargements</span>
      </div>
    </div>
  );
}

function ToolCard({
  tool,
  isFav,
  onToggleFav,
}: {
  tool: Tool;
  isFav: boolean;
  onToggleFav: () => void;
}) {
  return (
    <div className="min-w-0 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <a
          href={tool.url}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 break-words text-[15px] font-bold leading-snug text-[var(--text)] underline-offset-2 hover:underline"
        >
          {tool.fullName}
        </a>
        <FavButton
          active={isFav}
          label={`${isFav ? "Retirer des favoris" : "Suivre l'outil"} ${tool.fullName}`}
          onToggle={onToggleFav}
        />
      </div>
      {tool.description && (
        <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-[var(--dim)]">
          {tool.description}
        </p>
      )}
      <div className="font-mono2 mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--dim)]">
        {tool.downloadsMonthly != null && (
          <span>
            <span className="font-semibold text-[var(--teal)]">
              ↓ {fmtNum(tool.downloadsMonthly)}
            </span>{" "}
            téléchargements / mois
          </span>
        )}
        {tool.stars != null && (
          <span>
            <span className="font-semibold text-[var(--teal)]">
              ★ {fmtNum(tool.stars)}
            </span>
          </span>
        )}
        {tool.forks != null && <span>⑂ {fmtNum(tool.forks)}</span>}
        {tool.language && <span>{tool.language}</span>}
        {tool.createdAt && (
          <span>
            {tool.source === "npm" ? "maj " : "créé le "}
            {fmtDate(tool.createdAt)}
          </span>
        )}
        <span className="text-[var(--accent)]">
          {tool.source === "npm" ? "npm" : "GitLab"}
        </span>
      </div>
    </div>
  );
}

function SpaceCard({
  space,
  isFav,
  onToggleFav,
}: {
  space: Space;
  isFav: boolean;
  onToggleFav: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="min-w-0">
        <a
          href={space.url}
          target="_blank"
          rel="noreferrer"
          className="break-words text-[15px] font-bold leading-snug text-[var(--text)] underline-offset-2 hover:underline"
        >
          {space.id}
        </a>
        <p className="font-mono2 mt-0.5 text-xs text-[var(--dim)]">
          ♥ {fmtNum(space.likes)}
          {space.sdk ? ` · ${space.sdk}` : ""} · Hugging Face Spaces
        </p>
      </div>
      <FavButton
        active={isFav}
        label={`${isFav ? "Retirer des favoris" : "Suivre la démo"} ${space.id}`}
        onToggle={onToggleFav}
      />
    </div>
  );
}

function StoryRow({
  story,
  isFav,
  onToggleFav,
}: {
  story: Story;
  isFav: boolean;
  onToggleFav: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] py-3.5 last:border-b-0">
      <div className="min-w-0">
        <a
          href={story.url}
          target="_blank"
          rel="noreferrer"
          className="text-[15px] font-semibold leading-snug text-[var(--text)] underline-offset-2 hover:underline"
        >
          {story.title}
        </a>
        <p className="font-mono2 mt-1 text-xs text-[var(--dim)]">
          {story.source || hostOf(story.url)}
          {story.publishedAt ? ` · ${timeAgo(story.publishedAt)}` : ""}
          {story.points != null ? ` · ▲ ${story.points}` : ""}
          {story.comments != null ? ` · ${story.comments} comm.` : ""}
        </p>
      </div>
      <FavButton
        active={isFav}
        label={`${isFav ? "Retirer des favoris" : "Garder l'article"} ${story.title}`}
        onToggle={onToggleFav}
      />
    </div>
  );
}

function PaperCard({
  paper,
  isFav,
  onToggleFav,
}: {
  paper: Paper;
  isFav: boolean;
  onToggleFav: () => void;
}) {
  return (
    <div className="min-w-0 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <a
          href={paper.url}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 text-[15px] font-bold leading-snug text-[var(--text)] underline-offset-2 hover:underline"
        >
          {paper.title}
        </a>
        <FavButton
          active={isFav}
          label={`${isFav ? "Retirer des favoris" : "Garder le papier"} ${paper.title}`}
          onToggle={onToggleFav}
        />
      </div>
      <p className="font-mono2 mt-1 text-xs text-[var(--dim)]">
        {paper.authors.join(", ")}
        {paper.publishedAt ? ` · ${fmtDate(paper.publishedAt)}` : ""} · arXiv
      </p>
      {paper.summary && (
        <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-[var(--dim)]">
          {paper.summary}…
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------ app

export function App() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>("apercu");
  const [modelTab, setModelTab] = useState<"trending" | "new" | "popular">(
    "trending",
  );
  const [category, setCategory] = useState<string>("all");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.getDashboard({ force: false }),
    staleTime: 5 * 60 * 1000,
  });

  const favorites = useQuery({
    queryKey: ["favorites"],
    queryFn: () => api.listFavorites({}),
  });

  const refresh = useMutation({
    mutationFn: () => api.getDashboard({ force: true }),
    onSuccess: (data) => {
      queryClient.setQueryData(["dashboard"], data);
    },
  });

  const toggleFav = useMutation({
    mutationFn: (args: {
      kind: FavKind;
      externalId: string;
      title: string;
      url: string;
      subtitle: string | null;
    }) => api.toggleFavorite(args),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["favorites"] }),
  });

  const search = useQuery({
    queryKey: ["search", searchQuery],
    queryFn: () => api.searchTrends({ query: searchQuery }),
    enabled: searchQuery.length >= 2,
  });

  const favSet = useMemo(() => {
    const s = new Set<string>();
    for (const f of favorites.data?.favorites ?? []) {
      s.add(`${f.kind}:${f.externalId}`);
    }
    return s;
  }, [favorites.data]);

  const isFav = (kind: FavKind, id: string) => favSet.has(`${kind}:${id}`);
  const toggle = (
    kind: FavKind,
    externalId: string,
    title: string,
    url: string,
    subtitle: string | null,
  ) => toggleFav.mutate({ kind, externalId, title, url, subtitle });

  const data = dashboard.data;
  const topModel = data?.modelsTrending[0];
  const latestAsOf =
    data?.feeds.models.asOf ?? data?.feeds.hn.asOf ?? null;

  const modelList =
    modelTab === "trending"
      ? (data?.modelsTrending ?? [])
      : modelTab === "new"
        ? (data?.modelsNew ?? [])
        : (data?.modelsPopular ?? []);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of data?.modelsTrending ?? []) {
      if (m.pipelineTag) counts.set(m.pipelineTag, (counts.get(m.pipelineTag) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  const filteredModels =
    category === "all"
      ? modelList
      : modelList.filter((m) => m.pipelineTag === category);

  const searching = searchQuery.length >= 2;

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      {/* Fixed header (Safe Areas approach A) */}
      <header className="fixed inset-x-0 top-0 z-30 border-b border-[var(--border)] bg-[var(--bg)] pt-safe">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2.5">
          <span className="font-mono2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
            ● Live
          </span>
          <span className="hidden text-sm font-extrabold tracking-tight sm:block">
            Veille IA
          </span>
          <form
            className="mx-auto flex w-full max-w-md flex-1 items-center gap-2 sm:mx-2"
            onSubmit={(e) => {
              e.preventDefault();
              setSearchQuery(searchInput.trim());
            }}
          >
            <label htmlFor="search" className="sr-only">
              Rechercher un modèle, un outil ou un sujet IA
            </label>
            <input
              id="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Rechercher : agent, vidéo, llama…"
              className="w-full rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm text-[var(--text)] placeholder:text-[var(--dim)] focus:border-[var(--accent)] focus:outline-none"
            />
            {searching && (
              <button
                type="button"
                aria-label="Effacer la recherche"
                onClick={() => {
                  setSearchQuery("");
                  setSearchInput("");
                }}
                className="shrink-0 rounded-full border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--dim)]"
              >
                ✕
              </button>
            )}
          </form>
          <button
            type="button"
            aria-label="Actualiser les données"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            className="shrink-0 rounded-full bg-[var(--accent)] px-3.5 py-2 text-sm font-bold text-[var(--accent-ink)] disabled:opacity-50"
          >
            {refresh.isPending ? "…" : "↻ Actualiser"}
          </button>
        </div>
        <nav
          aria-label="Sections du tableau de bord"
          className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 pb-2"
        >
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-label={`Afficher la section ${v.label}`}
              aria-pressed={view === v.id && !searching}
              onClick={() => {
                setView(v.id);
                setSearchQuery("");
                setSearchInput("");
              }}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                view === v.id && !searching
                  ? "bg-[var(--text)] text-[var(--bg)]"
                  : "text-[var(--dim)] hover:text-[var(--text)]"
              }`}
            >
              {v.label}
              {v.id === "favoris" && (favorites.data?.favorites.length ?? 0) > 0
                ? ` (${favorites.data?.favorites.length})`
                : ""}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-10 pt-[calc(env(safe-area-inset-top)+118px)]">
        {dashboard.isPending && (
          <div className="py-16 text-center">
            <p className="font-mono2 text-sm text-[var(--dim)]">
              Récupération des tendances en direct…
            </p>
            <p className="mt-2 text-xs text-[var(--dim)]">
              Hugging Face · npm · GitLab · Hacker News · arXiv · presse IA
            </p>
          </div>
        )}

        {dashboard.isError && (
          <div className="py-16 text-center">
            <p className="text-base font-bold">Impossible de charger le tableau de bord.</p>
            <p className="mt-2 text-sm text-[var(--dim)]">
              Les sources sont peut-être momentanément inaccessibles.
            </p>
            <button
              type="button"
              aria-label="Réessayer le chargement"
              onClick={() => dashboard.refetch()}
              className="mt-4 rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-bold text-[var(--accent-ink)]"
            >
              Réessayer
            </button>
          </div>
        )}

        {data && searching && (
          <section aria-label="Résultats de recherche">
            <SectionTitle title={`Résultats pour « ${searchQuery} »`} />
            {search.isPending && (
              <p className="font-mono2 py-8 text-center text-sm text-[var(--dim)]">
                Recherche sur Hugging Face, npm, GitLab et Hacker News…
              </p>
            )}
            {search.data && (
              <div className="space-y-8">
                <div>
                  <h3 className="font-mono2 mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--dim)]">
                    Modèles — Hugging Face
                  </h3>
                  {search.data.models.length === 0 ? (
                    <EmptyState text="Aucun modèle trouvé pour cette recherche." />
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {search.data.models.map((m) => (
                        <ModelCard
                          key={m.id}
                          model={m}
                          isFav={isFav("model", m.id)}
                          onToggleFav={() =>
                            toggle("model", m.id, m.id, m.url, pipelineLabel(m.pipelineTag))
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <h3 className="font-mono2 mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--dim)]">
                    Outils — npm & GitLab
                  </h3>
                  {search.data.tools.length === 0 ? (
                    <EmptyState text="Aucun outil trouvé pour cette recherche." />
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {search.data.tools.map((t) => (
                        <ToolCard
                          key={t.id}
                          tool={t}
                          isFav={isFav("tool", t.id)}
                          onToggleFav={() =>
                            toggle("tool", t.id, t.fullName, t.url, t.description)
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <h3 className="font-mono2 mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--dim)]">
                    Discussions — Hacker News
                  </h3>
                  {search.data.stories.length === 0 ? (
                    <EmptyState text="Aucune discussion trouvée pour cette recherche." />
                  ) : (
                    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4">
                      {search.data.stories.map((s) => (
                        <StoryRow
                          key={s.id}
                          story={s}
                          isFav={isFav("news", s.id)}
                          onToggleFav={() =>
                            toggle("news", s.id, s.title, s.url, s.source)
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {data && !searching && view === "apercu" && (
          <div className="space-y-10">
            {/* Pulse */}
            {topModel ? (
              <section
                aria-label="Le modèle le plus tendance du moment"
                className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]"
              >
                <div className="border-l-4 border-[var(--accent)] p-5 sm:p-6">
                  <p className="font-mono2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
                    Le pulse du moment · Hugging Face
                  </p>
                  <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
                    <a
                      href={topModel.url}
                      target="_blank"
                      rel="noreferrer"
                      className="max-w-full break-words text-2xl font-extrabold leading-tight tracking-tight underline-offset-4 hover:underline sm:text-3xl"
                    >
                      {topModel.name}
                    </a>
                    <FavButton
                      active={isFav("model", topModel.id)}
                      label={`${isFav("model", topModel.id) ? "Retirer des favoris" : "Suivre le modèle"} ${topModel.id}`}
                      onToggle={() =>
                        toggle("model", topModel.id, topModel.id, topModel.url, pipelineLabel(topModel.pipelineTag))
                      }
                    />
                  </div>
                  <p className="font-mono2 mt-1 text-sm text-[var(--dim)]">
                    {topModel.owner} · {pipelineLabel(topModel.pipelineTag)}
                    {topModel.createdAt ? ` · sorti le ${fmtDate(topModel.createdAt)}` : ""}
                  </p>
                  <div className="mt-5 grid grid-cols-3 gap-3">
                    <div className="rounded-lg bg-[var(--surface-2)] p-3">
                      <p className="font-mono2 text-xl font-semibold text-[var(--accent)] sm:text-2xl">
                        {fmtNum(topModel.trendingScore)}
                      </p>
                      <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--dim)]">
                        Score tendance
                      </p>
                    </div>
                    <div className="rounded-lg bg-[var(--surface-2)] p-3">
                      <p className="font-mono2 text-xl font-semibold sm:text-2xl">
                        {fmtNum(topModel.likes)}
                      </p>
                      <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--dim)]">
                        Likes
                      </p>
                    </div>
                    <div className="rounded-lg bg-[var(--surface-2)] p-3">
                      <p className="font-mono2 text-xl font-semibold sm:text-2xl">
                        {fmtNum(topModel.downloads)}
                      </p>
                      <p className="mt-0.5 break-words text-[10px] font-semibold uppercase leading-tight tracking-wide text-[var(--dim)]">
                        Téléchargements
                      </p>
                    </div>
                  </div>
                </div>
              </section>
            ) : (
              data.feeds.models.error && (
                <EmptyState text="Hugging Face est injoignable pour le moment — réessaie avec Actualiser." />
              )
            )}

            {/* Compteurs */}
            <section
              aria-label="Compteurs du jour"
              className="grid grid-cols-2 gap-3 sm:grid-cols-4"
            >
              {[
                { n: data.modelsTrending.length, l: "Modèles en tendance", v: "modeles" as View },
                { n: data.modelsNew.length, l: "Nouveaux modèles suivis", v: "modeles" as View },
                { n: data.npmTools.length + data.gitlabTools.length, l: "Outils & projets suivis", v: "outils" as View },
                { n: data.webNews.length + data.hnStories.length, l: "Articles & discussions", v: "actus" as View },
              ].map((c) => (
                <button
                  key={c.l}
                  type="button"
                  aria-label={`Voir le détail : ${c.l}`}
                  onClick={() => setView(c.v)}
                  className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 text-left"
                >
                  <p className="font-mono2 text-3xl font-semibold">{c.n}</p>
                  <p className="mt-1 text-xs font-semibold text-[var(--dim)]">{c.l}</p>
                </button>
              ))}
            </section>

            {/* Top modèles */}
            <section aria-label="Top modèles tendance">
              <SectionTitle
                title="Modèles en tendance"
                asOf={data.feeds.models.asOf}
                stale={data.feeds.models.stale}
              />
              {data.modelsTrending.length === 0 ? (
                <EmptyState text="Aucun modèle récupéré pour le moment." />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {data.modelsTrending.slice(0, 6).map((m, i) => (
                    <ModelCard
                      key={m.id}
                      model={m}
                      rank={i}
                      isFav={isFav("model", m.id)}
                      onToggleFav={() =>
                        toggle("model", m.id, m.id, m.url, pipelineLabel(m.pipelineTag))
                      }
                    />
                  ))}
                </div>
              )}
              <button
                type="button"
                aria-label="Voir tous les modèles"
                onClick={() => setView("modeles")}
                className="mt-3 text-sm font-bold text-[var(--accent)]"
              >
                Tous les modèles →
              </button>
            </section>

            {/* Actus */}
            <section aria-label="Dernières actualités IA">
              <SectionTitle
                title="À la une de l'IA"
                asOf={data.feeds.web.asOf}
                stale={data.feeds.web.stale}
              />
              {data.webNews.length === 0 && data.hnStories.length === 0 ? (
                <EmptyState text="Aucune actualité récupérée pour le moment." />
              ) : (
                <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4">
                  {(data.webNews.length > 0 ? data.webNews : data.hnStories)
                    .slice(0, 5)
                    .map((s) => (
                      <StoryRow
                        key={s.id}
                        story={s}
                        isFav={isFav("news", s.id)}
                        onToggleFav={() =>
                          toggle("news", s.id, s.title, s.url, s.source)
                        }
                      />
                    ))}
                </div>
              )}
              <button
                type="button"
                aria-label="Voir toutes les actualités"
                onClick={() => setView("actus")}
                className="mt-3 text-sm font-bold text-[var(--accent)]"
              >
                Toutes les actualités →
              </button>
            </section>

            {/* Outils */}
            <section aria-label="Outils émergents">
              <SectionTitle
                title="Outils qui montent"
                hint="npm · téléchargements mensuels"
                asOf={data.feeds.npm.asOf}
                stale={data.feeds.npm.stale}
              />
              {data.npmTools.length === 0 ? (
                <EmptyState text="Aucun outil récupéré pour le moment." />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {data.npmTools.slice(0, 4).map((t) => (
                    <ToolCard
                      key={t.id}
                      tool={t}
                      isFav={isFav("tool", t.id)}
                      onToggleFav={() =>
                        toggle("tool", t.id, t.fullName, t.url, t.description)
                      }
                    />
                  ))}
                </div>
              )}
              <button
                type="button"
                aria-label="Voir tous les outils"
                onClick={() => setView("outils")}
                className="mt-3 text-sm font-bold text-[var(--accent)]"
              >
                Tous les outils →
              </button>
            </section>

            <p className="font-mono2 pt-2 text-center text-[11px] text-[var(--dim)]">
              Sources : Hugging Face · npm · GitLab · Hacker News · arXiv · presse web
              {latestAsOf ? ` — données récupérées ${timeAgo(latestAsOf)}` : ""}
            </p>
          </div>
        )}

        {data && !searching && view === "modeles" && (
          <section aria-label="Tous les modèles">
            <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Tri des modèles">
              {(
                [
                  { id: "trending", label: "En tendance" },
                  { id: "new", label: "Nouveautés" },
                  { id: "popular", label: "Les plus téléchargés" },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-label={`Trier les modèles : ${t.label}`}
                  aria-pressed={modelTab === t.id}
                  onClick={() => setModelTab(t.id)}
                  className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ${
                    modelTab === t.id
                      ? "bg-[var(--accent)] text-[var(--accent-ink)]"
                      : "border border-[var(--border)] text-[var(--dim)]"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {modelTab === "trending" && categories.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Filtrer par type de modèle">
                <button
                  type="button"
                  aria-label="Tous les types de modèles"
                  aria-pressed={category === "all"}
                  onClick={() => setCategory("all")}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    category === "all"
                      ? "bg-[var(--text)] text-[var(--bg)]"
                      : "border border-[var(--border)] text-[var(--dim)]"
                  }`}
                >
                  Tous types
                </button>
                {categories.map(([tag, count]) => (
                  <button
                    key={tag}
                    type="button"
                    aria-label={`Filtrer : ${pipelineLabel(tag)}`}
                    aria-pressed={category === tag}
                    onClick={() => setCategory(tag)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      category === tag
                        ? "bg-[var(--text)] text-[var(--bg)]"
                        : "border border-[var(--border)] text-[var(--dim)]"
                    }`}
                  >
                    {pipelineLabel(tag)} ({count})
                  </button>
                ))}
              </div>
            )}
            <SectionTitle
              title={
                modelTab === "trending"
                  ? "Modèles en tendance"
                  : modelTab === "new"
                    ? "Nouveaux modèles"
                    : "Modèles les plus téléchargés"
              }
              hint="Hugging Face"
              asOf={data.feeds.models.asOf}
              stale={data.feeds.models.stale}
            />
            {filteredModels.length === 0 ? (
              <EmptyState text="Aucun modèle dans cette sélection pour le moment." />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {filteredModels.map((m, i) => (
                  <ModelCard
                    key={m.id}
                    model={m}
                    rank={modelTab === "trending" ? i : undefined}
                    isFav={isFav("model", m.id)}
                    onToggleFav={() =>
                      toggle("model", m.id, m.id, m.url, pipelineLabel(m.pipelineTag))
                    }
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {data && !searching && view === "outils" && (
          <div className="space-y-10">
            <section aria-label="Packages npm IA populaires">
              <SectionTitle
                title="Packages IA populaires"
                hint="npm · MCP, LLM, agents — triés par téléchargements mensuels"
                asOf={data.feeds.npm.asOf}
                stale={data.feeds.npm.stale}
              />
              {data.npmTools.length === 0 ? (
                <EmptyState text="Le registre npm est injoignable pour le moment — réessaie avec Actualiser." />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {data.npmTools.map((t) => (
                    <ToolCard
                      key={t.id}
                      tool={t}
                      isFav={isFav("tool", t.id)}
                      onToggleFav={() =>
                        toggle("tool", t.id, t.fullName, t.url, t.description)
                      }
                    />
                  ))}
                </div>
              )}
            </section>
            <section aria-label="Projets open source IA GitLab">
              <SectionTitle
                title="Projets open source IA"
                hint="GitLab · triés par étoiles"
                asOf={data.feeds.gitlab.asOf}
                stale={data.feeds.gitlab.stale}
              />
              {data.gitlabTools.length === 0 ? (
                <EmptyState text="Aucun projet GitLab récupéré pour le moment." />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {data.gitlabTools.map((t) => (
                    <ToolCard
                      key={t.id}
                      tool={t}
                      isFav={isFav("tool", t.id)}
                      onToggleFav={() =>
                        toggle("tool", t.id, t.fullName, t.url, t.description)
                      }
                    />
                  ))}
                </div>
              )}
            </section>
            <section aria-label="Démos Hugging Face Spaces populaires">
              <SectionTitle
                title="Démos & apps populaires"
                hint="Hugging Face Spaces"
                asOf={data.feeds.spaces.asOf}
                stale={data.feeds.spaces.stale}
              />
              {data.spaces.length === 0 ? (
                <EmptyState text="Aucune démo récupérée pour le moment." />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {data.spaces.map((s) => (
                    <SpaceCard
                      key={s.id}
                      space={s}
                      isFav={isFav("space", s.id)}
                      onToggleFav={() =>
                        toggle("space", s.id, s.id, s.url, "Hugging Face Spaces")
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {data && !searching && view === "actus" && (
          <div className="space-y-10">
            <section aria-label="Actualités presse IA">
              <SectionTitle
                title="À la une"
                hint="Presse & web"
                asOf={data.feeds.web.asOf}
                stale={data.feeds.web.stale}
              />
              {data.webNews.length === 0 ? (
                <EmptyState text="Aucune actualité presse récupérée pour le moment." />
              ) : (
                <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4">
                  {data.webNews.map((s) => (
                    <StoryRow
                      key={s.id}
                      story={s}
                      isFav={isFav("news", s.id)}
                      onToggleFav={() =>
                        toggle("news", s.id, s.title, s.url, s.source)
                      }
                    />
                  ))}
                </div>
              )}
            </section>
            <section aria-label="Discussions Hacker News">
              <SectionTitle
                title="En direct de Hacker News"
                hint="Triées par date"
                asOf={data.feeds.hn.asOf}
                stale={data.feeds.hn.stale}
              />
              {data.hnStories.length === 0 ? (
                <EmptyState text="Aucune discussion récupérée pour le moment." />
              ) : (
                <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4">
                  {data.hnStories.map((s) => (
                    <StoryRow
                      key={s.id}
                      story={s}
                      isFav={isFav("news", s.id)}
                      onToggleFav={() =>
                        toggle("news", s.id, s.title, s.url, s.source)
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {data && !searching && view === "recherche" && (
          <section aria-label="Papiers de recherche arXiv">
            <SectionTitle
              title="Derniers papiers de recherche"
              hint="arXiv · cs.AI / cs.CL / cs.LG"
              asOf={data.feeds.papers.asOf}
              stale={data.feeds.papers.stale}
            />
            {data.papers.length === 0 ? (
              <EmptyState text="arXiv est injoignable pour le moment — réessaie avec Actualiser." />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {data.papers.map((p) => (
                  <PaperCard
                    key={p.id}
                    paper={p}
                    isFav={isFav("paper", p.id)}
                    onToggleFav={() =>
                      toggle("paper", p.id, p.title, p.url, p.authors.join(", "))
                    }
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {data && !searching && view === "favoris" && (
          <section aria-label="Mes favoris">
            <SectionTitle title="Mes favoris" hint="Modèles, outils et articles suivis" />
            {(favorites.data?.favorites.length ?? 0) === 0 ? (
              <EmptyState text="Rien ici pour l'instant. Touche « ☆ Suivre » sur un modèle, un outil ou un article pour le retrouver ici." />
            ) : (
              <div className="space-y-3">
                {favorites.data?.favorites.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-start justify-between gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4"
                  >
                    <div className="min-w-0">
                      <span className="font-mono2 text-[11px] font-semibold uppercase tracking-wider text-[var(--accent)]">
                        {f.kind === "model"
                          ? "Modèle"
                          : f.kind === "tool"
                            ? "Outil"
                            : f.kind === "space"
                              ? "Démo"
                              : f.kind === "paper"
                                ? "Papier"
                                : "Article"}
                      </span>
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-0.5 block break-words text-[15px] font-bold leading-snug underline-offset-2 hover:underline"
                      >
                        {f.title}
                      </a>
                      {f.subtitle && (
                        <p className="mt-0.5 line-clamp-2 text-sm text-[var(--dim)]">
                          {f.subtitle}
                        </p>
                      )}
                      <p className="font-mono2 mt-1 text-xs text-[var(--dim)]">
                        {hostOf(f.url)} · ajouté {timeAgo(f.createdAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`Retirer ${f.title} des favoris`}
                      onClick={() =>
                        toggle(f.kind, f.externalId, f.title, f.url, f.subtitle)
                      }
                      className="shrink-0 rounded-full border border-[var(--border)] px-2.5 py-1 text-xs font-semibold text-[var(--dim)]"
                    >
                      Retirer
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
