# File Share (app)

This is the Next.js application. See the [repository README](../README.md) for
an overview, screenshots, and testing/CI documentation.

```bash
npm install
npm run dev          # development server (http://localhost:3000)
npm run build        # production build
npm run start        # production server
npm run test         # Playwright e2e tests (starts its own dev server)
npm run screenshots  # regenerate README screenshots in ../docs/screenshots
```

Required environment variables (put them in `.env.local` for development):
`SESSION_SECRET` (32+ chars), `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and
optionally `UPLOAD_DIR` (defaults to `./uploads`).
