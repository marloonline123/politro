export interface NormalizedResult {
  isValid: boolean;
  username: string;
  normalizedUrl: string;
  errorReason?: string;
}

const RESERVED_PATHS = new Set([
  'p',
  'reel',
  'reels',
  'stories',
  'explore',
  'direct',
  'tv',
  'accounts',
  'developer',
  'about',
  'legal',
  'privacy',
  'terms',
  'directory',
  'help',
  'press',
  'api',
]);

const USERNAME_REGEX = /^[a-zA-Z0-9._]{1,30}$/;

export function normalizeInstagramUrl(rawInput: string): NormalizedResult {
  if (!rawInput || typeof rawInput !== 'string') {
    return {
      isValid: false,
      username: '',
      normalizedUrl: '',
      errorReason: 'Empty or non-string input',
    };
  }

  const trimmed = rawInput.trim();
  if (trimmed.length === 0) {
    return {
      isValid: false,
      username: '',
      normalizedUrl: '',
      errorReason: 'Empty input',
    };
  }

  // Handle plain handle like "@mycafe" or "mycafe"
  if (!trimmed.includes('/') && !trimmed.includes(':')) {
    const handle = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
    if (isValidUsername(handle)) {
      return {
        isValid: true,
        username: handle.toLowerCase(),
        normalizedUrl: `https://www.instagram.com/${handle.toLowerCase()}/`,
      };
    } else {
      return {
        isValid: false,
        username: handle,
        normalizedUrl: '',
        errorReason: `Invalid Instagram username format: "${handle}"`,
      };
    }
  }

  // Handle URL strings
  let urlStringToParse = trimmed;
  if (!/^https?:\/\//i.test(urlStringToParse)) {
    urlStringToParse = `https://${urlStringToParse}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(urlStringToParse);
  } catch (err: any) {
    return {
      isValid: false,
      username: '',
      normalizedUrl: '',
      errorReason: `Malformed URL structure: ${err.message || 'parse error'}`,
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  const validHostnames = ['instagram.com', 'www.instagram.com', 'm.instagram.com', 'instagr.am'];
  if (!validHostnames.includes(hostname)) {
    return {
      isValid: false,
      username: '',
      normalizedUrl: '',
      errorReason: `Invalid hostname: "${parsed.hostname}". Must be instagram.com`,
    };
  }

  // Extract path segments
  // e.g. "/fiveguysksa/" -> ["fiveguysksa"]
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length === 0) {
    return {
      isValid: false,
      username: '',
      normalizedUrl: '',
      errorReason: 'Missing profile username in URL path',
    };
  }

  const candidate = segments[0];

  // Check if it's a reserved path like /p/ (post) or /stories/
  if (RESERVED_PATHS.has(candidate.toLowerCase())) {
    return {
      isValid: false,
      username: candidate,
      normalizedUrl: '',
      errorReason: `URL points to an Instagram system path or media item ("/${candidate}/"), not a public profile`,
    };
  }

  if (!isValidUsername(candidate)) {
    return {
      isValid: false,
      username: candidate,
      normalizedUrl: '',
      errorReason: `Extracted username "${candidate}" is invalid`,
    };
  }

  const cleanUsername = candidate.toLowerCase();
  return {
    isValid: true,
    username: cleanUsername,
    normalizedUrl: `https://www.instagram.com/${cleanUsername}/`,
  };
}

export function isValidUsername(username: string): boolean {
  if (!username || username.length < 1 || username.length > 30) return false;
  if (!USERNAME_REGEX.test(username)) return false;
  if (username.startsWith('.') || username.endsWith('.')) return false;
  if (username.includes('..')) return false;
  return true;
}
