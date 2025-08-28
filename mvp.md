mvp1

## Project Overview

A simple anonymous file sharing application where only admins can upload files, and anyone with the direct link can download them without authentication.

## Technology Stack

- **Framework**: Next.js 14+ (App Router)
- **Language**: TypeScript
- **Session Management**: iron-session
- **Storage**: Local filesystem
- **Styling**: Tailwind CSS (recommended for rapid MVP development)

## Project Structure

```
anonymous-file-share/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                    # Home/Login page
│   ├── admin/
│   │   ├── page.tsx                # Admin dashboard
│   │   └── layout.tsx              # Protected layout
│   ├── api/
│   │   ├── auth/
│   │   │   ├── login/route.ts     # Login endpoint
│   │   │   └── logout/route.ts    # Logout endpoint
│   │   ├── upload/route.ts        # File upload endpoint
│   │   └── files/route.ts         # List files endpoint
│   └── f/
│       └── [uuid]/
│           └── [filename]/route.ts # File download endpoint
├── lib/
│   ├── session.ts                  # Iron-session configuration
│   ├── auth.ts                     # Authentication utilities
│   └── storage.ts                  # File storage utilities
├── components/
│   ├── LoginForm.tsx
│   ├── FileUpload.tsx
│   └── FileList.tsx
├── types/
│   └── index.ts                    # TypeScript type definitions
├── uploads/                        # File storage directory
│   └── .gitkeep
├── .env.local
├── .gitignore
├── package.json
├── tsconfig.json
└── next.config.js
```

## Core Features

### 1. Authentication System

#### Session Configuration (`lib/session.ts`)

```typescript
import { SessionOptions } from 'iron-session';

export interface SessionData {
  isLoggedIn: boolean;
  isAdmin: boolean;
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET!, // Min 32 chars
  cookieName: 'file-share-session',
  ttl: 60 * 60 * 24, // 24 hours
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'strict',
  },
};
```

#### Environment Variables (`.env.local`)

```
SESSION_SECRET=your-secret-key-at-least-32-characters-long
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-secure-password
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=104857600
```

### 2. Pages Implementation

#### Home Page (`app/page.tsx`)

- Display login form for admin access
- No public file listing
- Redirect to `/admin` if already logged in
- Clean, minimal design

#### Admin Dashboard (`app/admin/page.tsx`)

- Protected route (check session)
- File upload component
- List of all uploaded files with:
    - Original filename
    - Upload date
    - File size
    - Copy-able anonymous link
    - Delete button (optional for MVP)
- Logout button

### 3. API Routes

#### Login (`app/api/auth/login/route.ts`)

```typescript
// POST request
// Body: { username: string, password: string }
// Validate against env variables
// Create session using iron-session
// Return: { success: boolean, message?: string }
```

#### Upload (`app/api/upload/route.ts`)

```typescript
// POST request (multipart/form-data)
// Verify admin session
// Generate UUID for file
// Save file to: uploads/{uuid}/{original-filename}
// Store metadata in JSON file or in-memory
// Return: { success: boolean, fileId: string, url: string }
```

#### List Files (`app/api/files/route.ts`)

```typescript
// GET request
// Verify admin session
// Read filesystem to get all files
// Return: Array<{
//   id: string,
//   filename: string,
//   size: number,
//   uploadDate: string,
//   downloadUrl: string
// }>
```

#### Download (`app/f/[uuid]/[filename]/route.ts`)

```typescript
// GET request
// No authentication required
// Validate UUID and filename match
// Stream file to response
// Set appropriate headers for download
```

### 4. File Storage Structure

```
uploads/
├── 550e8400-e29b-41d4-a716-446655440000/
│   └── document.pdf
├── 6ba7b810-9dad-11d1-80b4-00c04fd430c8/
│   └── image.jpg
└── metadata.json (optional - for persistence)
```

### 5. Security Considerations

#### Required Implementations

1. **Input Validation**
- Sanitize filenames (remove path traversal attempts)
- Validate file size limits
- Optional: File type restrictions
1. **Session Security**
- Use strong session secret (32+ characters)
- HTTP-only cookies
- Secure flag in production
1. **File Access**
- Files only accessible through UUID routes
- No directory listing enabled
- Validate UUID format before filesystem access
1. **Rate Limiting** (Optional for MVP)
- Limit upload attempts
- Limit download bandwidth per IP

### 6. UI/UX Requirements

#### Login Page

- Centered login form
- Username and password fields
- Error message display
- Submit button

#### Admin Dashboard

- Header with logout button
- Upload section:
    - Drag-and-drop area
    - File selection button
    - Upload progress indicator
- Files table/grid:
    - Sortable by date
    - Copy link button (with clipboard feedback)
    - File size formatting (KB, MB, GB)
    - Responsive design

### 7. Component Specifications

#### FileUpload Component

```typescript
interface FileUploadProps {
  onUploadComplete: (file: UploadedFile) => void;
}
// Features:
// - Drag and drop
// - Progress bar
// - Error handling
// - File size validation client-side
```

#### FileList Component

```typescript
interface FileListProps {
  files: UploadedFile[];
  onRefresh: () => void;
}
// Features:
// - Copy link functionality
// - Formatted dates and sizes
// - Optional: Delete functionality
```

### 8. Type Definitions (`types/index.ts`)

```typescript
export interface UploadedFile {
  id: string;
  filename: string;
  size: number;
  uploadDate: string;
  downloadUrl: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
}
```

### 9. Middleware Setup

#### Admin Route Protection (`app/admin/layout.tsx`)

```typescript
// Check session for admin access
// Redirect to home if not authenticated
// Wrap children with session provider if needed
```

### 10. Next.js Configuration (`next.config.js`)

```javascript
module.exports = {
  experimental: {
    serverActions: true,
  },
  // Disable image optimization for uploaded files
  images: {
    unoptimized: true,
  },
};
```

### 11. Package Dependencies (`package.json`)

```json
{
  "dependencies": {
    "next": "^14.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "iron-session": "^8.0.0",
    "uuid": "^9.0.0",
    "formidable": "^3.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.2.0",
    "@types/uuid": "^9.0.0",
    "@types/formidable": "^3.0.0",
    "typescript": "^5.0.0",
    "tailwindcss": "^3.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0"
  }
}
```

### 12. Git Ignore File (`.gitignore`)

```
# Dependencies
node_modules/
.pnp
.pnp.js

# Testing
coverage/
.nyc_output

# Next.js
.next/
out/
build/
dist/

# Production
*.production

# Misc
.DS_Store
*.pem
.idea/
.vscode/
*.swp
*.swo

# Debug
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.pnpm-debug.log*

# Local env files
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Vercel
.vercel

# TypeScript
*.tsbuildinfo
next-env.d.ts

# Uploaded files
uploads/*
!uploads/.gitkeep

# OS files
Thumbs.db
.DS_Store

# IDE
.idea/
.vscode/
*.sublime-project
*.sublime-workspace

# Logs
logs/
*.log
```

## Implementation Steps

1. **Setup Project**

   ```bash
   npx create-next-app@latest file-share --typescript --tailwind --app
   cd file-share
   npm install iron-session uuid formidable
   npm install -D @types/formidable @types/uuid
   ```
1. **Configure Environment**
- Create `.env.local` with required variables
- Create `uploads` directory with `.gitkeep`
1. **Implement Session Management**
- Create session configuration
- Implement auth utilities
1. **Build API Routes**
- Login/logout endpoints
- File upload handler
- File listing endpoint
- Download endpoint
1. **Create UI Components**
- Login form
- File upload with drag-and-drop
- File list with copy links
1. **Implement Pages**
- Home/login page
- Protected admin dashboard
1. **Testing Checklist**
- [ ] Admin login works
- [ ] Session persists across refreshes
- [ ] File upload works for various file types
- [ ] Anonymous links are accessible without login
- [ ] Copy link functionality works
- [ ] Logout clears session
- [ ] Large file handling
- [ ] Concurrent uploads

## Optional Enhancements (Post-MVP)

1. **Database Integration**
- Replace filesystem metadata with SQLite/PostgreSQL
- Add file expiration dates
- Track download counts
1. **Advanced Features**
- Multiple admin users
- File preview for images/PDFs
- Bulk upload
- ZIP download for multiple files
- Password-protected links
- Temporary links with expiration
1. **Monitoring**
- Upload/download analytics
- Storage usage dashboard
- Error logging
1. **Performance**
- CDN integration
- Chunked uploads for large files
- Background job processing

## Deployment Considerations

1. **Storage**: Ensure persistent volume for uploads directory
1. **Environment**: Secure environment variables in production
1. **HTTPS**: Required for secure cookies
1. **Backup**: Regular backup strategy for uploaded files
1. **Scaling**: Consider S3/cloud storage for production