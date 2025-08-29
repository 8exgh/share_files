import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { UploadedFile } from '@/types';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

export async function ensureUploadDir() {
  try {
    await fs.access(UPLOAD_DIR);
  } catch {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  }
}

export function sanitizeFilename(filename: string): string {
  // Remove path traversal attempts and special characters
  return filename
    .replace(/[\/\\]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/[^\w\s.-]/g, '')
    .trim();
}

export async function saveFile(buffer: Buffer, originalFilename: string): Promise<UploadedFile> {
  await ensureUploadDir();
  
  const fileId = uuidv4();
  const sanitizedFilename = sanitizeFilename(originalFilename);
  const fileDir = path.join(UPLOAD_DIR, fileId);
  const filePath = path.join(fileDir, sanitizedFilename);
  
  // Create directory for this file
  await fs.mkdir(fileDir, { recursive: true });
  
  // Save file
  await fs.writeFile(filePath, buffer);
  
  // Get file stats
  const stats = await fs.stat(filePath);
  
  const uploadedFile: UploadedFile = {
    id: fileId,
    filename: sanitizedFilename,
    size: stats.size,
    uploadDate: new Date().toISOString(),
    downloadUrl: `/f/${fileId}/${encodeURIComponent(sanitizedFilename)}`
  };
  
  return uploadedFile;
}

export async function listFiles(): Promise<UploadedFile[]> {
  await ensureUploadDir();
  
  const files: UploadedFile[] = [];
  
  try {
    const directories = await fs.readdir(UPLOAD_DIR);
    
    for (const dir of directories) {
      const dirPath = path.join(UPLOAD_DIR, dir);
      const stat = await fs.stat(dirPath);
      
      if (stat.isDirectory() && dir !== '.gitkeep') {
        const filesInDir = await fs.readdir(dirPath);
        
        if (filesInDir.length > 0) {
          const filename = filesInDir[0];
          const filePath = path.join(dirPath, filename);
          const fileStat = await fs.stat(filePath);
          
          files.push({
            id: dir,
            filename: filename,
            size: fileStat.size,
            uploadDate: fileStat.birthtime.toISOString(),
            downloadUrl: `/f/${dir}/${encodeURIComponent(filename)}`
          });
        }
      }
    }
  } catch (error) {
    console.error('Error listing files:', error);
  }
  
  // Sort by upload date (newest first)
  return files.sort((a, b) => 
    new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime()
  );
}

export async function getFile(uuid: string, filename: string): Promise<Buffer | null> {
  const sanitizedFilename = sanitizeFilename(filename);
  const filePath = path.join(UPLOAD_DIR, uuid, sanitizedFilename);
  
  try {
    // Validate UUID format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
      return null;
    }
    
    // Check if file exists
    await fs.access(filePath);
    
    // Read and return file
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}

export async function deleteFile(uuid: string): Promise<boolean> {
  const dirPath = path.join(UPLOAD_DIR, uuid);
  
  try {
    // Validate UUID format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
      return false;
    }
    
    // Remove directory and its contents
    await fs.rm(dirPath, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}