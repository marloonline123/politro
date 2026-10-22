export type ProcessingStatus =
  | 'processed'
  | 'invalid_url'
  | 'not_found'
  | 'private'
  | 'restricted'
  | 'error';

export interface InputProfile {
  rowNumber: number;
  rawInput: string;
  normalizedUrl: string;
  username: string;
  isValidUrl: boolean;
  isDuplicate: boolean;
  errorReason?: string;
}

export interface ScrapedProfile {
  username: string;
  instagramUrl: string;
  displayName?: string;
  bio?: string;
  websiteUrl?: string;
  publicEmail?: string;
  publicPhone?: string;
  whatsapp?: string;
  isPrivate?: boolean;
  exists?: boolean;
  postCaptions: string[];
  accessStatus: ProcessingStatus;
}

export interface ClassificationResult {
  isFoodBusiness: boolean;
  category: string;
  confidence: number;
  reasoning: string;
}

export interface ProfileResult {
  inputRow: number;
  originalInput: string;
  normalizedUrl: string;
  username: string;
  status: ProcessingStatus;
  errorDetails?: string;
  scrapedData: ScrapedProfile;
  classification: ClassificationResult;
  processedAt: string;
}

export interface CheckpointData {
  lastUpdated: string;
  processedMap: Record<string, ProfileResult>;
}
