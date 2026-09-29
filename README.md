# Birma AI Audit

A full-stack starter implementation for Birma Enterprises' AI footage auditing workflow.

## Included
- Dashboard for clients, workflows, audit logs and analysis results
- SQLite backend with REST APIs
- Client CRUD
- Workflow CRUD
- Audit log creation/listing
- Analysis result creation/listing
- Local video loading in browser for manual review
- Optional sampled-frame analysis through Anthropic Claude when `ANTHROPIC_API_KEY` is configured
- Privacy Policy page based on the supplied file
- Custom 404 page based on the supplied file
- Responsive dark UI

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

For Claude frame analysis:
1. Copy `.env.example` to `.env`.
2. Add `ANTHROPIC_API_KEY`.
3. Restart the server.

The application does not upload a full video for the Claude endpoint; the browser sends a selected still frame as an image.

## Important
The supplied Privacy Policy is explicitly marked as a template. Replace placeholders and have counsel review it before production use.
