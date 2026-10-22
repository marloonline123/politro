import { chromium } from 'playwright';
import { loadConfig } from './config.js';
import { build2CaptchaCdpUrl } from './collectors/profile-collector.js';

async function main() {
  const config = loadConfig();
  const cdpUrl = build2CaptchaCdpUrl(config);
  console.log('Connecting to 2Captcha CDP URL...');

  let browser;
  try {
    browser = await chromium.connectOverCDP(cdpUrl, { timeout: 60000 });
    const context = browser.contexts()[0] || (await browser.newContext());

    const profiles = [
      'https://www.instagram.com/contact.clickacareer/',
      'https://www.instagram.com/coregrouphr/',
    ];

    for (const url of profiles) {
      console.log(`\nTesting with domcontentloaded on ${url}`);
      const page = await context.newPage();
      const t0 = Date.now();
      try {
        const res = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        console.log(`SUCCESS in ${Date.now() - t0}ms, status: ${res?.status()}`);
        console.log('Title:', await page.title());
      } catch (err: any) {
        console.log(`FAILED in ${Date.now() - t0}ms: ${err.message}`);
      } finally {
        await page.close().catch(() => {});
      }
    }
  } catch (err: any) {
    console.error('Fatal error:', err);
  } finally {
    if (browser) await browser.close();
  }
}

main();
