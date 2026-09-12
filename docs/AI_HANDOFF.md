# Howard's Digital — AI Handoff Sheet

**Purpose:** This file is the continuity sheet for Howard's Digital (HD). An AI assistant should read this file before making changes to the project.

## Current Project
- **Project:** Howard's Digital / HD
- **Repository:** `hiramhoward436-bot/howards-digital`
- **Default branch:** `main`
- **Current version:** v0.1 foundation
- **Current phase:** Build → Cloudflare deployment
- **Last known live URL:** `https://hd.howardsdigital.com` is planned but is not yet verified as live.

## What HD Is
Howard's Digital is intended to be a simple, free, private-first file/project storage and sharing site. It should eventually let Hiram organize projects, upload files, retrieve/download them, share selected files or folders, and give authorized AI assistants a reliable way to find and retrieve project files without repeatedly asking Hiram to upload large files.

The first release should stay small, reliable, and easy to use. Do not overbuild the advanced AI workspace until the basic site is working.

## Architecture Chosen
```text
Browser / future AI client
          │
          ▼
Cloudflare Worker / API
      │           │
      ▼           ▼
     D1          R2
  metadata    actual files
      │
      ▼
AI access layer

GitHub = source, configuration, documentation, and version history
```

### Responsibilities
- **GitHub:** source code, configuration, documentation, history. Do not use it as the main storage location for large project files.
- **Cloudflare Worker:** web/API layer, authorization, project/folder/file operations, sharing, and future AI access.
- **Cloudflare D1:** project, folder, file metadata, status, and share records.
- **Cloudflare R2:** actual uploaded file bytes.

## Files Created So Far
- `README.md` — project overview
- `.gitignore` — prevents secrets/build clutter from being committed
- `docs/ARCHITECTURE.md` — architecture decisions
- `docs/PROJECT_STATUS.md` — milestone/status record
- `docs/BUILD_NOTES.md` — build notes
- `docs/AI_HANDOFF.md` — this continuity sheet
- `package.json` — project/package configuration
- `wrangler.toml` — Cloudflare Worker configuration placeholder
- `migrations/0001_initial.sql` — initial D1 schema
- `src/index.js` — Worker/application entry point
- `public/index.html` — dashboard shell
- `public/app.js` — dashboard behavior
- `public/styles.css` — dashboard styling

## Implemented in v0.1
- Cloudflare Worker application scaffold
- Health endpoint foundation
- Projects API read foundation
- D1 schema foundation
- R2 binding/configuration placeholder
- Responsive HD dashboard
- Project loading/refresh behavior
- Initial private-first storage architecture
- Direct-to-R2 upload strategy planned for large files

## Database Model
```text
PROJECTS
  project_id
  name
  description
  status
  created
  updated

FOLDERS
  folder_id
  project_id
  parent_id
  name

FILES
  file_id
  project_id
  folder_id
  filename
  size
  type
  storage_key
  created
  updated
  version

SHARES
  share_id
  file_id / folder_id
  token
  expiration
  created
```

## Storage Layout Concept
```text
Howard's Digital/
├── Chase Adventures/
├── Ember Scrolls/
├── Project HD/
└── Other Projects/
```

## Planned API Direction
```text
/projects
/projects/:name
/projects/:name/status
/projects/:name/files
/files/:id
/files/:id/download
/shares/:token
```

## Security Rules
1. Keep projects/files private by default.
2. Never put passwords, API keys, tokens, or other secrets in GitHub.
3. Share tokens must not expose raw storage keys.
4. Large uploads should go directly to R2 rather than through the Worker request body.
5. D1 stores metadata, not the actual file contents.
6. Do not claim a deployment is complete until the Worker, D1, R2, and DNS route have actually been verified.

## Important Free-Tier Constraints
The design was chosen around Cloudflare's free-tier limits. Avoid unnecessary database reads/writes, full-table scans, and unnecessary Worker work. Use targeted queries, indexes, caching where appropriate, and direct-to-R2 uploads for large files.

## Current Known Blocker / Next Task
The source scaffold is in GitHub, but the real Cloudflare resources have not yet been created/verified. The next build phase is:

1. Connect/authorize Cloudflare access if available.
2. Create the D1 database.
3. Create the R2 bucket.
4. Put the real D1 database ID and R2 bucket name into the Worker configuration.
5. Deploy the Worker.
6. Test the Worker/dashboard.
7. Configure the `hd.howardsdigital.com` route/DNS.
8. Verify the live site.

Do these in small, verifiable steps. Do not pretend a step is complete if it has not been verified.

## Future Enhancements — Not Yet Implemented
These are ideas, not completed features:
- Project/folder/file management UI
- File upload/download/delete/restore UI
- Search
- Secure sharing UI
- Storage usage display and warnings
- Project status editor
- AI-friendly authenticated access API
- Persistent AI project workspace/handoff automation
- Automatic Windows folder syncing
- Google Drive/OneDrive/Dropbox integration
- Version history beyond the initial foundation

Do not implement all of these at once. Finish and test the basic HD site first, then review what should be added.

## AI Continuation Instructions
When Hiram says **"Continue Project HD"**:

1. Read `docs/AI_HANDOFF.md`.
2. Read `docs/PROJECT_STATUS.md` and `docs/BUILD_NOTES.md`.
3. Inspect the actual repository state before deciding what is complete.
4. Continue from the first unfinished milestone that can actually be performed.
5. Make the change rather than merely describing it when the necessary access/tools are available.
6. Verify the change when possible.
7. Update this handoff sheet and the project status/build notes when a meaningful milestone changes.
8. Report an honest progress percentage based on completed, verified work — never simulated background progress.
9. If blocked by an account authorization or user action, state exactly what is needed and give Hiram only the next necessary step.

## Progress Reporting
The percentage is a project-status indicator, not a claim that work is happening in the background. It should move only when real project work has been completed and verified.

## Last Build Note
The v0.1 application scaffold was created in the `build/v0.1-worker` branch and then fast-forwarded into `main`. The current `main` branch therefore contains the actual v0.1 foundation.

---

**Continuity rule:** When in doubt, inspect the repository and the latest status/build notes instead of guessing what was previously done.
