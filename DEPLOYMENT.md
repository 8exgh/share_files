# File Share Application Deployment Guide

## Overview
This document outlines the deployment process for the File Share application using Docker and GitHub Actions.

## Required GitHub Secrets

Before deploying, you must configure the following secrets in your GitHub repository:

### For Build & Push Workflow (`build-and-push.yml`)
- **`DEPLOY_TOKEN`**: GitHub Personal Access Token with `packages:write` and `repo` permissions

### For Deployment Workflow (`deploy.yml`)
- **`READ_PACKAGES_PAT`**: GitHub Personal Access Token with `packages:read` permission
- **`FILE_SHARE_SESSION_SECRET`**: Strong secret key (minimum 32 characters) for session encryption
- **`FILE_SHARE_ADMIN_USERNAME`**: Admin username for login (default: admin)
- **`FILE_SHARE_ADMIN_PASSWORD`**: Strong admin password for login

## Deployment Architecture

### Docker Volumes
The application uses persistent volumes to ensure uploaded files survive container restarts:

- **`/var/lib/file-share/uploads`**: Stores all uploaded files
  - Mounted to `/app/uploads` in container
  - Permissions: 755, owned by user 1001 (nextjs user)
  
- **`/var/lib/file-share/data`**: Optional data directory for future use
  - Mounted to `/app/data` in container
  - Can be used for database files or metadata

### Port Configuration
- **Host Port**: 3005
- **Container Port**: 3000
- Access the application at: `http://your-server:3005`

## Deployment Process

### Automatic Deployment
1. Push code to `main` branch
2. GitHub Action builds and pushes Docker image
3. Triggers deployment webhook
4. Deployment workflow pulls and runs new container

### Manual Deployment
1. Go to Actions tab in GitHub
2. Select "Deploy File Share to Server"
3. Click "Run workflow"
4. Select branch and click "Run workflow"

## Environment Variables

The container requires these environment variables:

```bash
NODE_ENV=production              # Production mode
SESSION_SECRET=<secret>          # Session encryption key
ADMIN_USERNAME=<username>        # Admin login username
ADMIN_PASSWORD=<password>        # Admin login password
UPLOAD_DIR=/app/uploads         # Upload directory path
MAX_FILE_SIZE=104857600         # Max file size (100MB)
MAX_NOTE_SIZE=1048576           # Max UTF-8 note content (1MiB, capped by MAX_FILE_SIZE)
MAX_STORAGE_SIZE=10737418240    # Uploaded-file quota (10GiB)
MAX_CONCURRENT_UPLOADS=4
MAX_CONCURRENT_DOWNLOADS=32
UPLOAD_TIMEOUT_MS=600000        # Upload deadline (10 minutes)
AUTH_MAX_ATTEMPTS=10            # Shared failed-password budget for login and Basic auth
AUTH_WINDOW_MS=900000           # Budget resets after 15 minutes
```

The build and runtime use Node.js 24 LTS. Keep the image updated; rebuilding an
unsupported Node.js release does not restore security support.

Uploads are written under `/app/uploads/.pending` and become publicly available
only after successful completion. Oversized requests return 413; exhausted storage
returns 507; transfer concurrency limits return 503 with `Retry-After`. Streaming
uploads reserve `MAX_FILE_SIZE` bytes against the storage quota until completion,
so leave enough quota headroom for simultaneous uploads. Temporary directories left
by a terminated process are reclaimed by the cleanup job after the upload deadline
plus a one-minute grace period. Previously created unmarked files remain pinned;
review any partial uploads left by older versions manually.

Session records and the shared authentication attempt counter live under
`/app/uploads/.security`, which must remain writable and persist with the uploads
volume. Logout deletes that session's server record. Changing the admin credentials
or session secret invalidates existing sessions. Cookies issued before this upgrade
do not contain a server session ID, so administrators will need to sign in again.
Treat the `.security` directory as sensitive; restoring old session records from a
backup can restore a revoked session. Rotate `SESSION_SECRET` after such a restore.

Social post records and their optional attachments live under
`/app/uploads/.social-posts` in the same persistent volume. They require an admin
session to view and stay available until explicitly deleted, including after
archiving. Ordinary file expiration does not remove social posts. Attachments
share `MAX_FILE_SIZE`, storage quota, and transfer limits with file uploads;
each new post also reserves 32 KiB for metadata. Supported formats are JPEG, PNG,
GIF, WebP, MP4, WebM, and MOV. Playback depends on the browser's codec support.
The Social Posts tab tracks publication manually: checking both Twitter and
LinkedIn archives a post, and clearing either checkbox returns it to the queue.

Authentication attempts share one account-wide budget across both HTTP endpoints;
the application does not trust user-supplied forwarding headers for this limit.
After the budget is exhausted, password authentication returns 429 with
`Retry-After` until the window expires. Existing valid sessions keep working.
This limits attacker-induced lockout to a finite window; an upstream trusted proxy
should also limit requests per client. The counters and transfer reservations are
designed for this app's single Node process. Before running multiple instances or
workers, replace admission control with a shared transactional store.

## Server Setup

### Initial Setup (Run Once)
```bash
# Create persistent storage directories
sudo mkdir -p /var/lib/file-share/uploads
sudo mkdir -p /var/lib/file-share/data

# Set proper permissions
sudo chown -R 1001:1001 /var/lib/file-share
sudo chmod -R u=rwX,go= /var/lib/file-share
```

### Manual Container Management
```bash
# Stop container
docker stop file-share-app

# Start container
docker start file-share-app

# View logs
docker logs file-share-app

# Access container shell
docker exec -it file-share-app sh

# Check volume contents
ls -la /var/lib/file-share/uploads
```

## Backup and Restore

### Backup Uploaded Files
```bash
# Create backup
tar -czf file-share-backup-$(date +%Y%m%d).tar.gz /var/lib/file-share/uploads

# Backup to remote location
rsync -avz /var/lib/file-share/uploads/ user@backup-server:/backups/file-share/
```

### Restore Files
```bash
# Stop container
docker stop file-share-app

# Restore from backup
tar -xzf file-share-backup-20240101.tar.gz -C /

# Fix permissions
sudo chown -R 1001:1001 /var/lib/file-share
sudo chmod -R u=rwX,go= /var/lib/file-share

# Start container
docker start file-share-app
```

## Monitoring

### Health Checks
The deployment workflow includes automatic health checks:
- Waits for application startup
- Verifies HTTP response
- Checks volume mounts
- Shows container logs on failure

### Manual Health Check
```bash
# Check if container is running
docker ps | grep file-share-app

# Check application health
curl -f http://localhost:3005

# Check disk usage
df -h /var/lib/file-share
du -sh /var/lib/file-share/uploads
```

## Troubleshooting

### Container Won't Start
```bash
# Check logs
docker logs file-share-app

# Check permissions
ls -la /var/lib/file-share/

# Verify environment variables
docker inspect file-share-app | grep -A 20 "Env"
```

### Files Not Persisting
```bash
# Verify volume mounts
docker inspect file-share-app | grep -A 10 "Mounts"

# Check inside container
docker exec file-share-app ls -la /app/uploads
```

### Permission Issues
```bash
# Fix ownership
sudo chown -R 1001:1001 /var/lib/file-share

# Fix permissions
sudo chmod -R u=rwX,go= /var/lib/file-share
```

## Security Considerations

1. **Use Strong Secrets**: Generate secure session secrets and passwords
2. **HTTPS**: Configure reverse proxy (nginx/traefik) for SSL
3. **Firewall**: Restrict access to port 3005 if not using reverse proxy
4. **Regular Updates**: Keep Docker images updated
5. **Backup**: Regularly backup uploaded files
6. **Monitoring**: Set up alerts for disk space and container health

## Scaling Considerations

For high availability:
1. Use external object storage (S3, MinIO) instead of local volumes
2. Implement database for file metadata
3. Use Redis for session storage
4. Deploy multiple container instances with load balancer
