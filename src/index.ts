import { Command } from 'commander';
import { loadConfig } from './config.js';
import { Bot } from './bot.js';
import { logger } from './utils/logger.js';

const program = new Command();

program
  .name('instabot')
  .description('Classify Instagram profiles as food businesses (restaurant/cafe/etc) or not')
  .version('2.0.0')
  .option('-i, --input <path>', 'Path to profiles text file', 'profiles.txt')
  .option('-r, --resume', 'Resume from checkpoint (skip already processed)', false)
  .action(async (options) => {
    try {
      const config = loadConfig();
      const bot = new Bot(config);
      await bot.run({
        inputFile: options.input,
        resume: options.resume,
      });
      process.exit(0);
    } catch (err: any) {
      logger.error(`Fatal: ${err.message}`);
      process.exit(1);
    }
  });

program.parse(process.argv);
