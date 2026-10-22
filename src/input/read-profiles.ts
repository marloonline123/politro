import fs from 'fs';
import path from 'path';
import { InputProfile } from '../types/index.js';
import { normalizeInstagramUrl } from './normalize-url.js';
import { logger } from '../utils/logger.js';

export function readProfilesFromFile(filePath: string): InputProfile[] {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Input file not found at: ${absolutePath}`);
  }

  const fileContent = fs.readFileSync(absolutePath, 'utf-8');
  return parseProfilesContent(fileContent);
}

export function parseProfilesContent(content: string): InputProfile[] {
  const lines = content.split(/\r?\n/);
  const profiles: InputProfile[] = [];
  const seenUsernames = new Set<string>();

  let actualRowNumber = 0;

  for (const rawLine of lines) {
    actualRowNumber++;
    const trimmed = rawLine.trim();

    // Ignore empty lines and lines starting with '#'
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const norm = normalizeInstagramUrl(trimmed);

    let isDuplicate = false;
    if (norm.isValid) {
      if (seenUsernames.has(norm.username)) {
        isDuplicate = true;
      } else {
        seenUsernames.add(norm.username);
      }
    }

    profiles.push({
      rowNumber: actualRowNumber,
      rawInput: rawLine,
      normalizedUrl: norm.normalizedUrl,
      username: norm.username,
      isValidUrl: norm.isValid,
      isDuplicate,
      errorReason: norm.errorReason,
    });
  }

  logger.info(`Loaded ${profiles.length} profile entries from input (filtered comments & blank lines).`);
  return profiles;
}
