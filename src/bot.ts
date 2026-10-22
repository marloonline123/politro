import { BotConfig } from './config.js';
import { InputProfile, ProfileResult, ScrapedProfile } from './types/index.js';
import { readProfilesFromFile } from './input/read-profiles.js';
import { ProfileCollector } from './collectors/profile-collector.js';
import { AiClassifier } from './analysis/ai-classifier.js';
import { CheckpointManager } from './utils/checkpoint.js';
import { exportResultsJson } from './output/json-exporter.js';
import { exportResultsCsv } from './output/csv-exporter.js';
import { logger } from './utils/logger.js';

export interface BotRunOptions {
  inputFile?: string;
  resume?: boolean;
}

export class Bot {
  private config: BotConfig;
  private checkpoint: CheckpointManager;
  private collector: ProfileCollector;
  private classifier: AiClassifier;
  private isShuttingDown = false;

  constructor(config: BotConfig) {
    this.config = config;
    this.checkpoint = new CheckpointManager(config.checkpointFile);
    this.collector = new ProfileCollector(config);
    this.classifier = new AiClassifier(config);

    process.once('SIGINT', () => this.shutdown('SIGINT'));
    process.once('SIGTERM', () => this.shutdown('SIGTERM'));
  }

  private async shutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    logger.warn(`Received ${signal}. Shutting down...`);
    this.checkpoint.flush();
    await this.collector.close();
    process.exit(0);
  }

  public async testAiConnection(): Promise<void> {
    logger.info('='.repeat(60));
    logger.info('  Instagram Food Business Classifier - AI Pre-flight Check');
    logger.info('='.repeat(60));
    await this.classifier.testConnection();
  }

  public async run(options: BotRunOptions = {}): Promise<ProfileResult[]> {
    const inputFile = options.inputFile || this.config.defaultInputFile;

    logger.info('='.repeat(60));
    logger.info('  Instagram Food Business Classifier');
    logger.info(`  Input: ${inputFile} | Resume: ${!!options.resume}`);
    logger.info('='.repeat(60));

    // Load input profiles
    const inputProfiles = readProfilesFromFile(inputFile);

    if (options.resume) {
      this.checkpoint.load();
    }

    // Separate already-processed from new
    const results: ProfileResult[] = [];
    const toProcess: InputProfile[] = [];

    for (const input of inputProfiles) {
      const key = (input.username || input.normalizedUrl || input.rawInput).toLowerCase();
      const existing = options.resume ? this.checkpoint.get(key) : undefined;

      if (existing) {
        logger.info(`[Row ${input.rowNumber}] Skipping (already processed): @${input.username}`);
        results.push(existing);
      } else {
        toProcess.push(input);
      }
    }

    logger.info(`${toProcess.length} profiles to process (scraping concurrency: ${this.config.concurrency})`);

    // ========================================================
    // Pre-flight: Test OpenRouter / AI connection before scraping
    // ========================================================
    if (toProcess.length > 0) {
      logger.info('');
      logger.info(`─── Pre-flight: Verifying AI connection (${this.config.aiModel}) ───`);
      await this.classifier.testConnection();
      logger.info('');
    }

    // ========================================================
    // Phase 1: Scrape all profiles
    // ========================================================
    logger.info(`─── Phase 1: Scraping ${toProcess.length} profiles ───`);

    // Init browser if we have valid URLs to scrape
    if (toProcess.some((p) => p.isValidUrl)) {
      await this.collector.initBrowser();
    }

    interface ScrapedEntry {
      input: InputProfile;
      profile: ScrapedProfile;
      status: any;
      errorDetails?: string;
    }

    const scrapedEntries: ScrapedEntry[] = [];
    let idx = 0;

    const worker = async () => {
      while (idx < toProcess.length && !this.isShuttingDown) {
        const item = toProcess[idx++];
        logger.info(`[${idx}/${toProcess.length}] [Row ${item.rowNumber}] Scraping @${item.username || item.rawInput}...`);

        const { profile, status, errorDetails } = await this.collector.scrapeProfile(item);

        if (status === 'invalid_url' || status === 'not_found' || status === 'error') {
          // Immediately record non-scrapable items
          const res: ProfileResult = {
            inputRow: item.rowNumber,
            originalInput: item.rawInput,
            normalizedUrl: item.normalizedUrl,
            username: item.username,
            status,
            errorDetails,
            scrapedData: profile,
            classification: { isFoodBusiness: false, category: 'none', confidence: 0, reasoning: status },
            processedAt: new Date().toISOString(),
          };
          results.push(res);
          this.checkpoint.save(res);
        } else {
          scrapedEntries.push({ input: item, profile, status, errorDetails });
        }

        if (this.config.requestDelayMs > 0 && idx < toProcess.length) {
          await new Promise((r) => setTimeout(r, this.config.requestDelayMs));
        }
      }
    };

    const workers = Array.from({ length: Math.max(1, this.config.concurrency) }, () => worker());
    await Promise.all(workers);

    // Close browser as soon as scraping finishes
    await this.collector.close();
    logger.success(`Phase 1 complete! Scraped ${scrapedEntries.length} valid profiles.`);

    // ========================================================
    // Phase 2: Bulk AI Classification (batches of 10)
    // ========================================================
    if (scrapedEntries.length > 0 && !this.isShuttingDown) {
      const BATCH_SIZE = 10;
      const totalBatches = Math.ceil(scrapedEntries.length / BATCH_SIZE);

      logger.info('');
      logger.info(`─── Phase 2: Classifying ${scrapedEntries.length} profiles via AI in ${totalBatches} batch(es) ───`);

      for (let bIdx = 0; bIdx < scrapedEntries.length; bIdx += BATCH_SIZE) {
        if (this.isShuttingDown) break;

        const currentBatch = scrapedEntries.slice(bIdx, bIdx + BATCH_SIZE);
        const batchNum = Math.floor(bIdx / BATCH_SIZE) + 1;

        logger.info(`[Batch ${batchNum}/${totalBatches}] Classifying ${currentBatch.length} profiles...`);

        try {
          const classifications = await this.classifier.classifyBatch(currentBatch.map((e) => e.profile));

          for (let j = 0; j < currentBatch.length; j++) {
            const entry = currentBatch[j];
            const classification = classifications[j] || {
              isFoodBusiness: false,
              category: 'unknown',
              confidence: 0,
              reasoning: 'Missing from AI batch response',
            };

            const result: ProfileResult = {
              inputRow: entry.input.rowNumber,
              originalInput: entry.input.rawInput,
              normalizedUrl: entry.input.normalizedUrl,
              username: entry.input.username,
              status: entry.status,
              errorDetails: entry.errorDetails,
              scrapedData: entry.profile,
              classification,
              processedAt: new Date().toISOString(),
            };

            results.push(result);
            this.checkpoint.save(result);

            logger.info(
              `  [Row ${entry.input.rowNumber}] @${entry.input.username} -> ${
                classification.isFoodBusiness ? '✅ FOOD BUSINESS' : '❌ NOT food business'
              } (${classification.category}, ${classification.confidence}%) - ${classification.reasoning}`
            );
          }
        } catch (err: any) {
          logger.error(`[Batch ${batchNum}/${totalBatches}] AI classification error: ${err.message}`);
          // Fallback to recording error for each profile in this batch
          for (const entry of currentBatch) {
            const result: ProfileResult = {
              inputRow: entry.input.rowNumber,
              originalInput: entry.input.rawInput,
              normalizedUrl: entry.input.normalizedUrl,
              username: entry.input.username,
              status: 'error',
              errorDetails: `AI batch error: ${err.message}`,
              scrapedData: entry.profile,
              classification: {
                isFoodBusiness: false,
                category: 'error',
                confidence: 0,
                reasoning: `AI Error: ${err.message}`,
              },
              processedAt: new Date().toISOString(),
            };
            results.push(result);
            this.checkpoint.save(result);
          }
        }
      }
    }

    // ========================================================
    // Phase 3: Export output files
    // ========================================================
    logger.info('');
    logger.info('Generating output files...');
    exportResultsJson(results, this.config.outputDir);
    exportResultsCsv(results, this.config.outputDir);

    // Print summary
    const foodCount = results.filter((r) => r.classification.isFoodBusiness).length;
    const notFoodCount = results.filter((r) => !r.classification.isFoodBusiness && r.status === 'processed').length;
    const errorCount = results.filter((r) => r.status === 'error' || r.status === 'invalid_url').length;

    logger.info('');
    logger.success(`Done! ${results.length} profiles processed.`);
    logger.success(`  ✅ Food businesses: ${foodCount}`);
    logger.success(`  ❌ Not food businesses: ${notFoodCount}`);
    if (errorCount > 0) {
      logger.warn(`  ⚠️  Errors/invalid: ${errorCount}`);
    }

    return results;
  }
}
