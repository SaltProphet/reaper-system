# Security policy

## Reporting a vulnerability

Report suspected vulnerabilities through GitHub's private vulnerability reporting or security advisory flow for this repository. Do not open a public issue containing credentials, session data, private source material, or reproduction details that expose user data.

Include the affected commit, impact, reproduction steps, and any suggested mitigation. Rotate credentials that may have been disclosed before sharing diagnostic material.

## Security boundaries

- OpenAI, Firecrawl, database, and authentication credentials are server-side.
- Workflow and run operations require an authenticated user and owner-scoped database queries.
- Client-supplied user IDs are not trusted.
- Model citations are checked against source IDs retrieved during the same run.
- Arbitrary user code and generic HTTP execution are not supported.
