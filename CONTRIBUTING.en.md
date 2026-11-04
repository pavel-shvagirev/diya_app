# Contributing

[English](CONTRIBUTING.en.md) · [Русский](CONTRIBUTING.md)

## Setup

```sh
npm ci
npm start            # build + run the app
npm run check        # lint (code, Markdown, YAML) + typecheck + format + tests
npm run e2e          # the real app against an in-memory Disk (needs a display)
```

Node.js 22+. `npm test` rebuilds `better-sqlite3` for Node, `npm start` rebuilds it for Electron;
if a native-module error appears after switching, run `npm run native:rebuild:node` or
`npm run native:rebuild:electron`.

## Rules

- Prose in Markdown and YAML stays within 100 columns (`npm run lint:md`, `npm run lint:yaml`);
  tables and code blocks are exempt.
- Small, focused pull requests; one logical change per commit (`feat:`, `fix:`, `docs:`, …).
- Behaviour changes come with a test; a bug fix starts with a failing test that reproduces it.
- Do not mock a response shape you invented: take it from the official Yandex Disk docs
  (<https://yandex.com/dev/disk-api/doc/en/>) and cite the page in the test.
- UI: follow [docs/DESIGN.md](docs/DESIGN.md) (tokens only, no hard-coded colours, a hint on
  every action button). Every user-visible string goes into both languages (`strings.ts`).
- Anything with a security impact needs a note in the PR; a function with a known problem is
  switched off through `src/shared/features.ts`, enforced in the main process.
- Update `CHANGELOG.en.md` and `CHANGELOG.md` for user-visible changes; keep every Russian/English
  document pair in step (`X.md` is Russian, `X.en.md` English: README, CHANGELOG, ARCHITECTURE,
  RELEASING, SIGN_IN).
- Never commit tokens, client secrets, personal paths or account data; fixtures use fake values.
- Be respectful: [CODE_OF_CONDUCT.en.md](CODE_OF_CONDUCT.en.md).
- Working with an AI assistant: [AGENTS.md](AGENTS.md) is the briefing it follows.
- Forks: register your own Yandex OAuth application ([docs/SIGN_IN.en.md](docs/SIGN_IN.en.md)), keep
  the "not affiliated with Yandex" notices, and give the build its own name and icon; the Yandex
  Disk name and logo are not reusable (`assets/brand/NOTICE.md`).
