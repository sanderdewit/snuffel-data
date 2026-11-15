# snuffel-data (public repo): data pipeline and shared core

- This repo is the source of `lib/` and `i18n/` (29 language packs). The website (private repo, `web/`) and the app (`src/core`, `src/i18n/packs`) keep identical copies, and their CI fails when a copy differs from main here.
  So: change it here, run `node tests/i18n.test.js`, **push here first**, then copy to the other two repos.
- `lost/groups.json` lists the search groups for lost dogs. Validate it with `node tools/lost-groups.js check`. The `lost-groups` workflow publishes it on every push to main.
- Before committing: check `git branch --show-current` (other sessions may leave a feature branch checked out) and run the tests in `.github/workflows/test.yml`.
- After pushing: watch the runs until they are green before saying something is live.
- No `Co-Authored-By` / "Generated with" lines in commits.
