# Tableau de bord Trends IA

Tableau de bord complet (en français) pour suivre les tendances IA : nouveaux
modèles et outils IA, plus actualités IA. Une section « Pulse du moment »,
puis Modèles, Outils, News, Recherche arXiv et Favoris, avec recherche
multi-sources, boutons suivre par carte, et un bouton Actualiser (cache d'une
heure).

## Sources de données (en direct)

- **Hugging Face** — modèles tendance / nouveaux / populaires, et Spaces populaires
- **npm** — packages IA populaires (téléchargements mensuels)
- **GitLab** — projets open source IA (étoiles)
- **Hacker News (Algolia)** — discussions IA récentes
- **arXiv** — derniers papiers cs.AI / cs.CL / cs.LG
- **Recherche web** — actualités IA éditoriales

GitHub n'est pas utilisé à l'exécution : `api.github.com` / `github.com`
expirent en timeout depuis le runtime d'actions (vérifié par sondes) ;
GitLab + npm couvrent le pilier « outils IA ». Détails et métriques dans
`DATA-PLAN.md`. En cas de panne d'une source, le dernier cache est servi avec
sa date, sinon un état vide honnête — jamais de lignes inventées.

## Stack

React 19 + TypeScript, Bun, Tailwind CSS, Drizzle (SQLite), Recharts.
Client dans `client/`, actions serveur dans `server/src/actions.ts`, schéma
dans `server/src/schema.ts`, migrations Drizzle dans `drizzle/`.

## Démarrage

```sh
bun install
bun run typecheck
bun run build
```

Ce dépôt est la source telle qu'elle tourne dans l'environnement hébergé Muse
(`space.json`, runtime TypeScript). La dépendance `@hatch/space-sdk` est une
dépendance `file:` locale à cet environnement : hors Muse, `bun install`
demande de la remplacer par le SDK d'hébergement correspondant, et les actions
serveur + la base SQLite (`app.db`, non versionnée, favoris + cache) demandent
le runtime d'hébergement.

## Structure

- `client/src/` — interface React (`App.tsx`, `api.ts`, `theme.css`)
- `server/src/` — actions serveur et schéma Drizzle
- `drizzle/` — migrations SQL
- `AGENTS.md` — règles de construction de l'artefact
- `DATA-PLAN.md` — plan de données, sources testées et approches rejetées

## Version statique pour GitHub Pages (`docs/`)

Le dossier `docs/` contient une version 100 % statique du tableau de bord —
`index.html`, `app.js`, `styles.css`, vanilla JS, aucun build, aucune
dépendance — prévue pour GitHub Pages. Elle appelle les mêmes API publiques
directement depuis le navigateur (Hugging Face, npm, GitLab, Hacker News,
OpenAlex) ; les favoris sont stockés en `localStorage` et les flux sont mis
en cache 60 minutes dans le navigateur.

Différences honnêtes avec la version complète :
- **Papiers de recherche :** l'API arXiv n'envoie pas d'en-tête CORS, donc
  un navigateur ne peut pas l'interroger. La version statique utilise
  **OpenAlex** (mêmes domaines, tri par date), avec Semantic Scholar en
  secours. La section l'indique.
- **Presse éditoriale :** le flux « À la une » (recherche web côté serveur)
  n'a pas d'équivalent navigateur : il est omis, et la page le dit.
- Pas de base de données, pas de serveur : en cas de panne d'une source, la
  section affiche un message d'erreur qui nomme la source, jamais de données
  inventées.

### Activer GitHub Pages

Dans le dépôt, **Settings → Pages → Build and deployment → Source :
« Deploy from a branch »**, branche `main`, dossier `/docs`, puis Save.
L'adresse est alors `https://igprod.github.io/tableau-de-bord-trends-ia/`.
Sur un compte GitHub gratuit, Pages exige un dépôt **public** (un dépôt
privé ne peut être publié que avec GitHub Pro).
