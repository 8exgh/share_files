export interface UploadedFile {
  id: string;
  filename: string;
  size: number;
  uploadDate: string;
  downloadUrl: string;
  autoDelete: boolean;
}

export interface AnonymousFile {
  id: string;
  filename: string;
  kind: 'file' | 'note';
  size: number;
  uploadDate: string;
  expiresAt: string;
  maskedIp: string;
  countryCode: string | null;
  sha256: string;
  downloadUrl: string;
  viewUrl?: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
}

export interface SocialPost {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  postedToTwitter: boolean;
  postedToLinkedIn: boolean;
  archived: boolean;
  asset?: {
    filename: string;
    mimeType: string;
    kind: 'image' | 'video';
    size: number;
    url: string;
  };
}
