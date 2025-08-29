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
```

## Server Setup

### Initial Setup (Run Once)
```bash
# Create persistent storage directories
sudo mkdir -p /var/lib/file-share/uploads
sudo mkdir -p /var/lib/file-share/data

# Set proper permissions
sudo chown -R 1001:1001 /var/lib/file-share
sudo chmod -R 755 /var/lib/file-share
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
sudo chmod -R 755 /var/lib/file-share

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
sudo chmod -R 755 /var/lib/file-share
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