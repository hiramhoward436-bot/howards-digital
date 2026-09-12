# Howard's Digital

Howard's Digital (HD) is a private-first project file storage and sharing workspace.

## Architecture

- **Cloudflare Worker** — application/API layer
- **Cloudflare R2** — project files and large objects
- **Cloudflare D1** — project/file metadata
- **GitHub** — source control and deployment source

## v0.1 goals

- Dashboard
- Projects and folders
- File metadata
- Secure uploads directly to R2
- Downloads and controlled sharing
- Project status
- AI-friendly project/file API
- Usage protection for free-tier services

The repository intentionally contains application source and configuration only. Actual project files and secrets must never be committed here.
