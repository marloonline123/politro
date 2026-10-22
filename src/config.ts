import dotenv from "dotenv";
import path from "path";
import dns from "node:dns";

// Prioritize IPv4 DNS resolution to avoid ETIMEDOUT / ENETUNREACH issues on networks with incomplete IPv6
try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  // Ignored if unsupported
}

dotenv.config();

export interface BotConfig {
  // 2Captcha Browser API
  use2Captcha: boolean;
  twocaptchaBrowserLogin: string;
  twocaptchaBrowserPassword: string;
  twocaptchaCountryCode: string;
  twocaptchaBrowserWsUrl: string;

  // Bot behavior
  concurrency: number;
  requestDelayMs: number;
  timeoutMs: number;
  maxPostsToInspect: number;

  // AI classification (required)
  aiBaseUrl: string;
  aiModel: string;
  aiApiKey: string;
  aiProxy?: string;

  // Output
  outputDir: string;
  checkpointFile: string;
  defaultInputFile: string;
  headless: boolean;
}

export function loadConfig(overrides?: Partial<BotConfig>): BotConfig {
  const aiApiKey =
    process.env.OPENROUTER_API_KEY ||
    process.env.AI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    "";

  if (!aiApiKey) {
    throw new Error(
      "AI API key is required. Set OPENROUTER_API_KEY, AI_API_KEY, or OPENAI_API_KEY in your .env file.",
    );
  }

  const outputDir = process.env.OUTPUT_DIR || "output";

  return {
    use2Captcha:
      process.env.USE_2CAPTCHA === "true" || process.env.USE_2CAPTCHA === "1",
    twocaptchaBrowserLogin: process.env.TWOCAPTCHA_BROWSER_LOGIN || "",
    twocaptchaBrowserPassword: process.env.TWOCAPTCHA_BROWSER_PASSWORD || "",
    twocaptchaCountryCode: process.env.TWOCAPTCHA_COUNTRY_CODE || "us",
    twocaptchaBrowserWsUrl: process.env.TWOCAPTCHA_BROWSER_WS_URL || "",

    concurrency: parseInt(process.env.CONCURRENCY || "2", 10),
    requestDelayMs: parseInt(process.env.REQUEST_DELAY_MS || "1500", 10),
    timeoutMs: parseInt(process.env.TIMEOUT_MS || "30000", 10),
    maxPostsToInspect: parseInt(process.env.MAX_POSTS_TO_INSPECT || "6", 10),

    aiBaseUrl: process.env.AI_BASE_URL || "https://openrouter.ai/api/v1",
    aiModel: process.env.AI_MODEL || "openrouter/free",
    aiApiKey,
    aiProxy:
      process.env.AI_PROXY ||
      process.env.HTTPS_PROXY ||
      process.env.HTTP_PROXY ||
      "",

    outputDir,
    checkpointFile:
      process.env.CHECKPOINT_FILE || path.join(outputDir, ".checkpoint.json"),
    defaultInputFile: process.env.INPUT_FILE || "profiles.txt",
    headless: process.env.HEADLESS !== "false",
    ...overrides,
  };
}
