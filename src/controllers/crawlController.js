const path = require('path');
const logger = require('../utils/logger');
const config = require('../config');
const fileService = require('../services/fileService');
const crawlerService = require('../services/crawlerService');
const { validateUrl } = require('../utils/validation');

class CrawlController {
  async crawlWebsite(url, slug) {
    const startTime = Date.now();
    logger.info(`Starting crawl for URL: ${url} with slug: ${slug}`);

    try {
      // Validate input
      if (!url || !validateUrl(url)) {
        throw new Error('Invalid URL provided');
      }

      const outputDir = path.join(config.paths.exportsDir, slug);

      // Prepare directory
      await fileService.removeDirectory(outputDir);
      await fileService.ensureDirectoryExists(outputDir);

      // Execute crawl
      await crawlerService.execute(url, outputDir);

      const duration = Date.now() - startTime;
      logger.info(`Crawl completed in ${duration}ms`);

      return {
        success: true,
        outputDir,
        duration,
        slug,
        url
      };
    } catch (error) {
      logger.error(`Crawl failed: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new CrawlController();