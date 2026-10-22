import fs from 'fs';
import path from 'path';
import { ProfileResult, CheckpointData } from '../types/index.js';
import { logger } from './logger.js';

export class CheckpointManager {
  private filePath: string;
  private cache: Map<string, ProfileResult> = new Map();

  constructor(filePath: string) {
    this.filePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  }

  public load(): void {
    if (!fs.existsSync(this.filePath)) return;

    try {
      const data: CheckpointData = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      if (data?.processedMap) {
        for (const [key, res] of Object.entries(data.processedMap)) {
          this.cache.set(key, res);
        }
        logger.info(`Loaded ${this.cache.size} profiles from checkpoint.`);
      }
    } catch (err: any) {
      logger.warn(`Could not read checkpoint: ${err.message}. Starting fresh.`);
    }
  }

  public get(key: string): ProfileResult | undefined {
    return this.cache.get(key.toLowerCase());
  }

  public save(result: ProfileResult): void {
    const key = (result.username || result.normalizedUrl || result.originalInput).toLowerCase();
    this.cache.set(key, result);
    this.flush();
  }

  public flush(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const mapObj: Record<string, ProfileResult> = {};
      for (const [k, v] of this.cache.entries()) {
        mapObj[k] = v;
      }

      const checkpoint: CheckpointData = {
        lastUpdated: new Date().toISOString(),
        processedMap: mapObj,
      };

      fs.writeFileSync(this.filePath, JSON.stringify(checkpoint, null, 2), 'utf-8');
    } catch (err: any) {
      logger.warn(`Failed writing checkpoint: ${err.message}`);
    }
  }
}
