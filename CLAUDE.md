# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an anonymous file sharing application built with Next.js 14+, TypeScript, and iron-session. The application allows only authenticated admins to upload files, while anyone with a direct link can download files without authentication.

## Commands

### Initial Setup
```bash
npx create-next-app@latest file-share --typescript --tailwind --app
cd file-share
npm install iron-session uuid formidable
npm install -D @types/formidable @types/uuid
```

### Development
```bash
npm run dev    # Start development server
npm run build  # Build for production
npm run start  # Start production server
npm run lint   # Run ESLint
npm run type-check  # Run TypeScript compiler check (if configured)
```

## Architecture

### Core Stack
- **Framework**: Next.js 14+ with App Router
- **Language**: TypeScript for type safety
- **Session Management**: iron-session for secure cookie-based sessions
- **Storage**: Local filesystem (uploads directory)
- **File Processing**: formidable for multipart form handling

### Key Design Patterns

1. **Authentication Flow**:
   - Single admin user authenticated via environment variables
   - Session-based authentication using iron-session
   - Protected routes using Next.js middleware/layouts

2. **File Storage Strategy**:
   - Files stored in `uploads/{uuid}/{original-filename}` structure
   - UUID-based URLs prevent enumeration attacks
   - No authentication required for downloads (security through obscurity)

3. **API Structure**:
   - RESTful endpoints under `/api/`
   - File downloads served from `/f/[uuid]/[filename]/` route
   - All admin operations require session validation

### Security Considerations

1. **Session Security**:
   - Use strong SESSION_SECRET (32+ characters)
   - HTTP-only, secure cookies in production
   - 24-hour session TTL

2. **File Handling**:
   - Sanitize filenames to prevent path traversal
   - Validate file size limits (MAX_FILE_SIZE env var)
   - UUID validation before filesystem access

3. **Input Validation**:
   - All user inputs must be validated
   - File uploads limited to authenticated admins only

## Project Structure

```
app/
├── page.tsx                    # Login page
├── admin/
│   ├── page.tsx               # Admin dashboard (protected)
│   └── layout.tsx             # Session validation wrapper
├── api/
│   ├── auth/
│   │   ├── login/route.ts     # Admin authentication
│   │   └── logout/route.ts    # Session cleanup
│   ├── upload/route.ts        # File upload (admin only)
│   └── files/route.ts         # List files (admin only)
└── f/
    └── [uuid]/
        └── [filename]/route.ts # Public file download

lib/
├── session.ts                  # iron-session configuration
├── auth.ts                    # Authentication utilities
└── storage.ts                 # File storage operations

components/
├── LoginForm.tsx              # Admin login interface
├── FileUpload.tsx             # Drag-and-drop upload
└── FileList.tsx               # File management table
```

## Environment Variables

Required in `.env.local`:
```
SESSION_SECRET=<minimum-32-characters>
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<secure-password>
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=104857600  # 100MB default
```

## Testing Checklist

When implementing features, verify:
- [ ] Admin login/logout functionality
- [ ] Session persistence across page refreshes
- [ ] File upload with various file types
- [ ] Anonymous download links work without authentication
- [ ] Copy-to-clipboard for share links
- [ ] File size validation
- [ ] Filename sanitization
- [ ] Proper error handling and user feedback