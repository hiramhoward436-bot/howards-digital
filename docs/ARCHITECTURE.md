# Howard's Digital Architecture

## v0.1

```text
Browser / future AI client
          |
          v
Cloudflare Worker API
     |            |
     v            v
    D1            R2
 metadata      file bytes
```

### Responsibilities

**Worker**
- Authentication/authorization boundary
- Project and folder API
- File metadata API
- Secure upload/download authorization
- Share-token handling
- AI-friendly read API

**D1**
- Projects
- Folders
- File metadata
- Share records
- Status information

**R2**
- Actual file bytes
- Large project archives
- Builds and backups when intentionally stored in HD

**GitHub**
- Source code
- Infrastructure configuration
- Documentation
- Version history

### Security rules

1. Private project files are not public by default.
2. Secrets never go into GitHub.
3. Large files bypass the Worker request body and upload directly to R2 using authorized URLs.
4. D1 stores metadata, not large file contents.
5. Sharing uses explicit tokens rather than exposing storage keys.
