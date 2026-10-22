import { chromium, Browser, BrowserContext } from 'playwright';
import { BotConfig } from '../config.js';
import { ScrapedProfile, ProcessingStatus, InputProfile } from '../types/index.js';
import { logger } from '../utils/logger.js';

export function build2CaptchaCdpUrl(config: BotConfig): string {
  if (config.twocaptchaBrowserWsUrl) {
    return config.twocaptchaBrowserWsUrl;
  }

  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const profileId =
    'profile_' +
    Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');

  const country = (config.twocaptchaCountryCode || 'us').toLowerCase();
  const username = `${config.twocaptchaBrowserLogin}-pid-${profileId}-zone-scraping_browser-country-${country}`;
  return `ws://${username}:${config.twocaptchaBrowserPassword}@cb.2captcha.com:9222`;
}

export class ProfileCollector {
  private config: BotConfig;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  constructor(config: BotConfig) {
    this.config = config;
  }

  public async initBrowser(): Promise<void> {
    if (this.browser && this.browser.isConnected()) return;

    if (this.config.use2Captcha) {
      logger.info('Connecting to 2Captcha Scraping Browser API...');

      const maxRetries = 5;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const cdpUrl = build2CaptchaCdpUrl(this.config);
        try {
          this.browser = await chromium.connectOverCDP(cdpUrl, { timeout: 60000 });
          this.context = this.browser.contexts()[0] || (await this.browser.newContext());
          logger.success('Connected to 2Captcha Scraping Browser.');
          return;
        } catch (err: any) {
          if (attempt === maxRetries) {
            throw err;
          }
          logger.warn(`Failed to connect to 2Captcha (attempt ${attempt}/${maxRetries}): ${err.message}. Retrying with fresh session in 5s...`);
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    } else {
      logger.info('Launching local headless Chromium browser...');

      this.browser = await chromium.launch({
        headless: this.config.headless,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
        ],
      });

      this.context = await this.browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        locale: 'en-US',
        timezoneId: 'America/New_York',
      });

      // Hide webdriver flag from navigator
      await this.context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });

      logger.success('Local Chromium browser launched.');
    }
  }

  public async close(): Promise<void> {
    if (this.context && !this.config.use2Captcha) {
      // Only close local contexts — 2Captcha contexts are managed remotely
      await this.context.close().catch(() => {});
    }
    this.context = null;
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }

  public async scrapeProfile(input: InputProfile): Promise<{
    profile: ScrapedProfile;
    status: ProcessingStatus;
    errorDetails?: string;
  }> {
    const baseProfile: ScrapedProfile = {
      username: input.username,
      instagramUrl: input.normalizedUrl,
      postCaptions: [],
      accessStatus: 'error',
    };

    if (!input.isValidUrl) {
      baseProfile.accessStatus = 'invalid_url';
      return {
        profile: baseProfile,
        status: 'invalid_url',
        errorDetails: input.errorReason || 'Invalid URL',
      };
    }

    await this.initBrowser();
    if (!this.context) {
      throw new Error('Browser context not initialized');
    }

    const page = await this.context.newPage();

    try {
      logger.info(`[@${input.username}] Scraping profile: ${input.normalizedUrl}`);

      const response = await page.goto(input.normalizedUrl, {
        waitUntil: 'domcontentloaded',
        timeout: this.config.timeoutMs,
      });

      const httpStatus = response ? response.status() : 0;
      const currentUrl = page.url();

      // 404
      if (httpStatus === 404) {
        baseProfile.accessStatus = 'not_found';
        baseProfile.exists = false;
        return { profile: baseProfile, status: 'not_found', errorDetails: 'HTTP 404' };
      }

      // Wait for page hydration
      await page.waitForTimeout(1000);

      const pageTitle = await page.title().catch(() => '');
      const bodyText = (await page.evaluate('document.body ? document.body.innerText : ""').catch(() => '')) as string;
      const pageHtml = (await page.content().catch(() => '')) || '';

      // Check if page doesn't exist
      const isNotFound =
        bodyText.includes("Sorry, this page isn't available") ||
        bodyText.includes('The link you followed may be broken') ||
        pageTitle.includes('Page Not Found') ||
        pageHtml.includes("Sorry, this page isn't available");

      if (isNotFound) {
        baseProfile.accessStatus = 'not_found';
        baseProfile.exists = false;
        return { profile: baseProfile, status: 'not_found', errorDetails: 'Profile not found' };
      }

      // Check for login wall or challenge
      const isRestricted =
        currentUrl.includes('/accounts/login') ||
        currentUrl.includes('/challenge/') ||
        bodyText.includes('Log In to Instagram');

      // Extract metadata from page
      const metaData = (await page.evaluate(`(() => {
        function getMeta(prop) {
          const el =
            document.querySelector('meta[property="' + prop + '"]') ||
            document.querySelector('meta[name="' + prop + '"]');
          return el ? el.getAttribute('content') : null;
        }

        const ogTitle = getMeta('og:title') || '';
        const ogDesc = getMeta('og:description') || '';
        const metaDesc = getMeta('description') || '';

        const altTexts = [];
        document.querySelectorAll('article img[alt]').forEach(function(img) {
          const alt = img.getAttribute('alt');
          if (alt && alt.trim().length > 10) {
            altTexts.push(alt.trim());
          }
        });

        const externalLinks = [];
        document.querySelectorAll('a[href]').forEach(function(a) {
          const href = a.getAttribute('href') || '';
          if (href.includes('l.instagram.com') && href.includes('u=')) {
            try {
              const u = new URL(href, window.location.origin).searchParams.get('u');
              if (u) {
                externalLinks.push(decodeURIComponent(u));
              }
            } catch(e) {}
          } else if (href && !href.startsWith('/') && !href.includes('instagram.com') && !href.includes('facebook.com')) {
            if (a.closest('header')) {
              externalLinks.push(href);
            }
          }
        });

        // Try extracting bio directly from header text elements
        let domBio = '';
        const header = document.querySelector('header');
        if (header) {
          const textNodes = header.querySelectorAll('span, div[dir="auto"]');
          for (let i = 0; i < textNodes.length; i++) {
            const t = (textNodes[i].textContent || '').trim();
            if (
              t.length > 15 &&
              !t.toLowerCase().includes('followers') &&
              !t.toLowerCase().includes('following') &&
              !t.toLowerCase().includes('posts')
            ) {
              domBio = t;
              break;
            }
          }
        }

        return { ogTitle, ogDesc, metaDesc, altTexts, externalLinks, domBio };
      })()`)) as {
        ogTitle: string;
        ogDesc: string;
        metaDesc: string;
        altTexts: string[];
        externalLinks: string[];
        domBio?: string;
      };

      // Parse display name from page title
      const titleToParse = metaData.ogTitle || pageTitle;
      const titleMatch = titleToParse.match(/^(.*?)(?:\s*\(@[a-zA-Z0-9._]+\))?\s*(?:•|on Instagram)/);
      if (titleMatch && titleMatch[1]) {
        baseProfile.displayName = titleMatch[1].trim();
      }

      // Extract bio
      let bioText = metaData.metaDesc || metaData.ogDesc || '';
      const bioSubMatch =
        bioText.match(/(?:on Instagram|from\s+[^:]+):\s*["“]([\s\S]+?)["”]?$/i) ||
        bioText.match(/:\s*["“]([\s\S]+?)["”]?$/i) ||
        bioText.match(/["“]([\s\S]{10,})["”]/);

      if (bioSubMatch && bioSubMatch[1]) {
        baseProfile.bio = bioSubMatch[1].trim();
      } else if (metaData.domBio) {
        baseProfile.bio = metaData.domBio.trim();
      } else {
        baseProfile.bio = bioText.trim();
      }

      // Post captions
      if (metaData.altTexts.length > 0) {
        baseProfile.postCaptions = metaData.altTexts.slice(0, this.config.maxPostsToInspect);
      }

      // Private account
      if (bodyText.includes('This Account is Private') || bioText.includes('This account is private')) {
        baseProfile.isPrivate = true;
      }

      // Extract website URL
      const bioAndText = `${baseProfile.bio || ''} ${bodyText} ${metaData.metaDesc} ${metaData.ogDesc}`;
      const urlMatches = bioAndText.match(/https?:\/\/[^\s"'<>]+/gi) || [];
      const candidateUrls = [...metaData.externalLinks, ...urlMatches];

      for (const rawUrl of candidateUrls) {
        const cleanUrl = rawUrl.replace(/[.,;:)\]]+$/, '');
        if (
          cleanUrl.startsWith('http') &&
          !cleanUrl.includes('instagram.com') &&
          !cleanUrl.includes('facebook.com') &&
          !cleanUrl.includes('twitter.com') &&
          !cleanUrl.includes('tiktok.com')
        ) {
          baseProfile.websiteUrl = cleanUrl;
          break;
        }
      }

      // Extract contact info
      const emailMatch = bioAndText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (emailMatch) {
        baseProfile.publicEmail = emailMatch[0].toLowerCase();
      }

      const phoneMatch = bioAndText.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,5}/);
      if (phoneMatch && phoneMatch[0].trim().length >= 8) {
        baseProfile.publicPhone = phoneMatch[0].trim();
      }

      const waMatch = bioAndText.match(/https?:\/\/(?:wa\.me|api\.whatsapp\.com\/send)\S+/i);
      if (waMatch) {
        baseProfile.whatsapp = waMatch[0].replace(/[.,;:)\]]+$/, '');
      }

      // Determine status
      const hasData = !!(baseProfile.displayName || baseProfile.bio || baseProfile.websiteUrl);

      if (isRestricted && !hasData) {
        baseProfile.accessStatus = 'restricted';
        return { profile: baseProfile, status: 'restricted', errorDetails: 'Profile behind login wall' };
      }

      if (baseProfile.isPrivate) {
        baseProfile.accessStatus = 'private';
      } else {
        baseProfile.accessStatus = 'processed';
      }

      logger.info(`[@${input.username}] Scraped data: name="${baseProfile.displayName || 'N/A'}" | bio="${(baseProfile.bio || '').slice(0, 80)}..." | website="${baseProfile.websiteUrl || 'none'}"`);

      return { profile: baseProfile, status: baseProfile.accessStatus };
    } catch (err: any) {
      logger.error(`[@${input.username}] Scraping error: ${err.message}`);
      baseProfile.accessStatus = 'error';
      return {
        profile: baseProfile,
        status: 'error',
        errorDetails: err.message,
      };
    } finally {
      await page.close().catch(() => {});
    }
  }
}
