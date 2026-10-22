import { ScrapedProfile, ClassificationResult } from '../types/index.js';
import { BotConfig } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Unwrap Node/undici fetch errors into a readable multi-line message.
 * A top-level "fetch failed" TypeError hides the real reason in `cause`,
 * which is often an AggregateError (e.g. ETIMEDOUT / ENETUNREACH per address)
 * produced by the dual-stack (IPv4/IPv6) connection attempt.
 */
export function describeError(err: any): string {
  if (!err) return 'unknown error';
  const lines: string[] = [];
  const seen = new Set<any>();
  let cur = err;
  let depth = 0;

  while (cur && depth < 8 && !seen.has(cur)) {
    seen.add(cur);
    const name = cur.name ? `${cur.name}: ` : '';
    const msg = cur.message || '(no message)';
    const code = cur.code ? ` [code=${cur.code}]` : '';
    lines.push(`${name}${msg}${code}`);

    // AggregateError: expose each sub-error (the actual connection failures).
    if (Array.isArray(cur.errors) && cur.errors.length) {
      for (const sub of cur.errors) {
        const sCode = sub.code ? `[${sub.code}]` : '[error]';
        const addr = sub.address ? ` ${sub.syscall || 'connect'} ${sub.address}:${sub.port ?? ''}` : '';
        lines.push(`  - ${sCode}${addr} ${sub.message || ''}`.trimEnd());
      }
    }

    cur = cur.cause;
    depth++;
  }

  return lines.join(' | ');
}

export class AiClassifier {
  private config: BotConfig;
  private apiQueue: Promise<void> = Promise.resolve();

  constructor(config: BotConfig) {
    this.config = config;
  }

  /**
   * Classify a batch of profiles in a single AI request (typically 25-30 profiles).
   * Minimizes token usage on both input and output to stay well within free tier limits.
   */
  public async classifyBatch(profiles: ScrapedProfile[], maxRetries = 6): Promise<ClassificationResult[]> {
    if (profiles.length === 0) return [];

    const messages = this.buildBatchMessages(profiles);

    logger.info(`Sending batch of ${profiles.length} profiles to AI (${this.config.aiModel})...`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const rawResponse = await this.enqueueApiCall(() => this.callApi(messages));
        logger.info(`AI raw batch response (attempt ${attempt}/${maxRetries}): ${rawResponse.trim().slice(0, 150)}...`);
        const results = this.parseBatchResponse(rawResponse, profiles);
        return results;
      } catch (err: any) {
        const detail = describeError(err);
        if (attempt === maxRetries) {
          logger.error(`AI batch failed after ${maxRetries} attempts: ${detail}`);
          throw new Error(`AI batch failed after ${maxRetries} attempts: ${detail}`);
        }
        logger.warn(`AI batch attempt ${attempt}/${maxRetries} failed: ${detail}. Retrying in ${attempt * 3}s...`);
        await new Promise((r) => setTimeout(r, attempt * 3000));
      }
    }

    throw new Error('AI batch failed after retries');
  }

  public async classify(profile: ScrapedProfile): Promise<ClassificationResult> {
    const results = await this.classifyBatch([profile]);
    return results[0];
  }

  private buildBatchMessages(profiles: ScrapedProfile[]): Array<{ role: string; content: string }> {
    const lines = profiles.map((p, idx) => {
      const name = (p.displayName || '').replace(/[\r\n\t]+/g, ' ').slice(0, 40).trim();
      const bio = (p.bio || '').replace(/[\r\n\t]+/g, ' ').slice(0, 110).trim();
      const web = (p.websiteUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, '').slice(0, 50);

      const parts = [`[${idx + 1}] @${p.username}`];
      if (name) parts.push(`Name: ${name}`);
      if (bio) parts.push(`Bio: ${bio}`);
      if (web && web !== 'none') parts.push(`Web: ${web}`);
      return parts.join(' | ');
    });

    return [
      {
        role: 'system',
        content: `You classify Instagram profiles. Output ONLY a raw JSON array, no explanation, no markdown, no code fences. Each element: {"i":<index>,"isFood":<bool>,"cat":"<category>","conf":<0-100>,"r":"<reason max 10 words>"}.
Food business = restaurant, cafe, bakery, fast food, food truck, dessert/juice shop.
NOT food: catering, blogger/influencer, chef (personal), hiring/recruitment, delivery app, food supplier/equipment, personal account.`,
      },
      {
        role: 'user',
        content: `Classify these ${profiles.length} profiles:\n${lines.join('\n')}`,
      },
    ];
  }

  private enqueueApiCall<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.apiQueue.then(async () => {
      // Pause 2s between AI calls to avoid free tier rate limit burst
      await new Promise((r) => setTimeout(r, 2000));
      return fn();
    });
    this.apiQueue = result.then(() => {}, () => {});
    return result;
  }

  /**
   * Pre-flight health check that tests the OpenRouter / AI connection before starting the bot.
   * 1. Checks API key validity via /auth/key (if OpenRouter).
   * 2. Tests model responsiveness with a test prompt.
   * Throws an Error with actionable diagnostics if the test fails.
   */
  public async testConnection(): Promise<void> {
    const isLocalOrCustom = !this.config.aiBaseUrl.includes('openrouter.ai');
    logger.info(`[Pre-flight] Checking AI connection to ${isLocalOrCustom ? this.config.aiBaseUrl : 'OpenRouter'}...`);
    logger.info(`[Pre-flight] Target Model: ${this.config.aiModel}`);

    // Step 1: Check OpenRouter API key validity
    if (!isLocalOrCustom) {
      const authUrl = `${this.config.aiBaseUrl.replace(/\/+$/, '')}/auth/key`;
      try {
        const authRes = await fetch(authUrl, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.config.aiApiKey}`,
            'HTTP-Referer': 'https://github.com/instagram-lead-bot',
            'X-Title': 'Instagram Food Lead Bot',
          },
          signal: AbortSignal.timeout(15000),
        });

        if (authRes.status === 401 || authRes.status === 403) {
          throw new Error(`Invalid OpenRouter API Key (HTTP ${authRes.status}). Please check OPENROUTER_API_KEY in .env.`);
        }

        if (authRes.ok) {
          const authData: any = await authRes.json();
          const label = authData?.data?.label ? ` (Key: ${authData.data.label})` : '';
          const usage = authData?.data?.usage !== undefined ? ` | Usage: $${authData.data.usage}` : '';
          const limit = authData?.data?.limit !== undefined ? ` | Limit: $${authData.data.limit}` : '';
          logger.success(`[Pre-flight] OpenRouter API key is valid!${label}${usage}${limit}`);
        }
      } catch (err: any) {
        if (err.message && err.message.includes('Invalid OpenRouter API Key')) {
          throw err;
        }
        const detail = describeError(err);
        logger.warn(`[Pre-flight] Could not complete /auth/key check: ${detail}`);
      }
    }

    // Step 2: Test model responsiveness
    logger.info(`[Pre-flight] Testing model "${this.config.aiModel}" response...`);
    const testMessages = [
      { role: 'user', content: 'Respond with the word OK.' }
    ];

    try {
      const response = await this.callApi(testMessages);
      logger.success(`[Pre-flight] AI connection SUCCESSFUL! Model replied: "${response.trim().slice(0, 40)}"`);
    } catch (err: any) {
      const detail = describeError(err);
      logger.error(`[Pre-flight] AI connection test FAILED: ${detail}`);
      logger.error('------------------------------------------------------------');
      logger.error('Troubleshooting tips:');
      logger.error('1. Check if your OPENROUTER_API_KEY in .env is valid.');
      logger.error(`2. Check if the model "${this.config.aiModel}" is currently available (see free_models.txt).`);
      logger.error('3. Check your internet/VPN connection (if OpenRouter is blocked, enable a VPN or proxy).');
      logger.error('4. You can test your AI connection without scraping using: npm run start -- --test-ai');
      logger.error('------------------------------------------------------------');
      throw new Error(`AI pre-flight check failed: ${detail}`);
    }
  }

  private async callApi(messages: Array<{ role: string; content: string }>): Promise<string> {
    const url = `${this.config.aiBaseUrl.replace(/\/+$/, '')}/chat/completions`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.aiApiKey}`,
          'HTTP-Referer': 'https://github.com/instagram-lead-bot',
          'X-Title': 'Instagram Food Lead Bot',
        },
        body: JSON.stringify({
          model: this.config.aiModel,
          messages,
          temperature: 0.1,
          max_tokens: 2000,
        }),
        signal: AbortSignal.timeout(60000),
      });
    } catch (err: any) {
      // Surface the true connection cause (ETIMEDOUT/ENETUNREACH/DNS) instead of "fetch failed".
      throw new Error(`Network error calling ${url}: ${describeError(err)}`);
    }

    if (!res.ok) {
      const text = await res.text();
      let errMsg = text;
      try {
        const errJson = JSON.parse(text);
        errMsg = errJson.error?.message || errJson.message || text;
      } catch {}
      throw new Error(`AI API HTTP ${res.status}: ${errMsg}`);
    }

    const data: any = await res.json();
    const content = data.choices?.[0]?.message?.content || '';

    if (!content) {
      throw new Error('AI returned empty response');
    }

    return content;
  }

  private parseBatchResponse(raw: string, profiles: ScrapedProfile[]): ClassificationResult[] {
    let cleaned = raw.trim();

    // Strip thinking tags if returned by reasoning models
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    // Strip markdown fences
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    // Extract JSON array block
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    let jsonCandidate = cleaned;
    if (start !== -1 && end > start) {
      jsonCandidate = cleaned.slice(start, end + 1);
    } else if (start !== -1) {
      jsonCandidate = cleaned.slice(start) + ']';
    }

    let parsedArray: any[] = [];
    try {
      parsedArray = JSON.parse(jsonCandidate);
    } catch {
      // Fallback: extract objects using regex
      const objMatches = jsonCandidate.match(/\{[^{}]*\}/g) || [];
      for (const objStr of objMatches) {
        try {
          parsedArray.push(JSON.parse(objStr));
        } catch {
          const isFoodMatch = objStr.match(/"isFood(?:Business)?"\s*:\s*(true|false)/i);
          const iMatch = objStr.match(/"i"\s*:\s*(\d+)/i);
          const catMatch = objStr.match(/"cat(?:egory)?"\s*:\s*"([^"\r\n]+)"/i);
          const confMatch = objStr.match(/"conf(?:idence)?"\s*:\s*(\d+)/i);
          const rMatch = objStr.match(/"r(?:easoning)?"\s*:\s*"([^"\r\n]*)/i);

          if (isFoodMatch) {
            parsedArray.push({
              i: iMatch ? parseInt(iMatch[1], 10) : undefined,
              isFood: isFoodMatch[1].toLowerCase() === 'true',
              cat: catMatch ? catMatch[1].trim() : 'unknown',
              conf: confMatch ? parseInt(confMatch[1], 10) : 80,
              r: rMatch ? rMatch[1].trim() : 'Classified by AI',
            });
          }
        }
      }
    }

    if (!Array.isArray(parsedArray) || parsedArray.length === 0) {
      throw new Error(`Failed to parse AI batch response into array: ${cleaned.slice(0, 150)}`);
    }

    // Map results to the exact profiles in order
    return profiles.map((p, idx) => {
      const targetIndex = idx + 1;
      const matched =
        parsedArray.find((item) => item.i === targetIndex) ||
        parsedArray.find((item) => item.u && String(item.u).toLowerCase().includes(p.username.toLowerCase())) ||
        parsedArray[idx];

      if (!matched) {
        return {
          isFoodBusiness: false,
          category: 'unknown',
          confidence: 0,
          reasoning: 'Missing from AI batch response',
        };
      }

      const isFood = matched.isFood === true || matched.isFoodBusiness === true;
      const category = String(matched.cat || matched.category || (isFood ? 'food business' : 'other'));
      const confidence = typeof matched.conf === 'number'
        ? Math.max(0, Math.min(100, matched.conf))
        : typeof matched.confidence === 'number'
        ? Math.max(0, Math.min(100, matched.confidence))
        : 80;
      const reasoning = String(matched.r || matched.reasoning || '');

      return {
        isFoodBusiness: isFood,
        category,
        confidence,
        reasoning,
      };
    });
  }
}
