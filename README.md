# RepoForge Studio

> Clone, inspect, compile, and launch any public or private GitHub repository in seconds—complete with live previews, branch diffs, automated README & CI workflows, and Google Drive export.

## GitHub Repository "About" Description

Use the description below when configuring your repository's **About** sidebar on GitHub:

```text
Clone, inspect, compile, and launch any public or private GitHub repository in seconds—complete with live previews, branch diffs, automated README & CI workflows, and Google Drive export.
```

**Suggested GitHub Topics:**
`repoforge` · `github-importer` · `developer-tools` · `live-preview` · `ci-cd-generator` · `branch-diff` · `google-drive-api` · `nodejs` · `react` · `typescript`

---

## Full Application Description

**RepoForge Studio** is a full-stack GitHub repository workspace inspector, automated Node.js 22 build normalizer, and live application runner. Paste any public or private GitHub URL (including monorepo `/tree/branch/subdir` paths) to:

- **Clone & Inspect Source Trees**: Analyze framework stack, language composition, npm scripts, dependencies, `.env` keys, and Prisma/Drizzle/SQL database schemas.
- **Compile & Launch Live Previews**: Automatically normalize lockfiles (`pnpm`/`yarn`/`bun` to `npm`), configure relative asset base paths, run post-build smoke probes, and mount compiled applications in responsive or full-screen sandboxes.
- **Test Backend APIs & Side-by-Side Branch Diffs**: Spawn isolated backend API subprocesses with an interactive HTTP client, and compare Base vs. Head branches or pull requests side by side.
- **Generate Tailored `README.md` & GitHub Actions Workflows**: Synthesize project-specific documentation, CI build verification, Cloud Run / GitHub Pages deployment pipelines, and security health workflows.
- **One-Click Google Drive Folder Export**: Create a dedicated folder in Google Drive containing the full project archive, mirrored source files, generated documentation, and inspection manifest.
- **Whole-App Light & Dark Mode**: Switch seamlessly between crisp daylight Light Mode and high-contrast Dark Mode across every workspace panel and support route.

---

## Local Development

```bash
npm install
npm run dev
```

### Production Build & Start

```bash
npm run build
npm start
```
