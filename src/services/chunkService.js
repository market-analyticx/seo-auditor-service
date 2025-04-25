// src/services/chunkService.js
const { encoding_for_model } = require('@dqbd/tiktoken');
const logger = require('../utils/logger');
const workflowLogger = require('../utils/workflowLogger');
const config = require('../config/audit');

class ChunkService {
  estimateTokens(text) {
    const modelType = config.models.openai.model.includes('gpt-4') ? 'gpt-4' : 'gpt-3.5-turbo';
    const enc = encoding_for_model(modelType);
    const tokens = enc.encode(text);
    enc.free();
    return tokens.length;
  }

  chunkRowsByTokenCount(rows, tokenLimit) {
    const chunks = [];
    let currentChunk = [];
    let tokenCount = 0;

    workflowLogger.debug('Starting chunking process', { 
      rowCount: rows.length, 
      tokenLimit 
    });

    for (const row of rows) {
      const rowString = Object.values(row).join(' | ');
      const rowTokens = this.estimateTokens(rowString);

      if (tokenCount + rowTokens > tokenLimit && currentChunk.length > 0) {
        chunks.push(currentChunk);
        workflowLogger.debug('Created chunk', { 
          chunkNumber: chunks.length,
          rowCount: currentChunk.length,
          tokenCount 
        });
        currentChunk = [];
        tokenCount = 0;
      }

      currentChunk.push(row);
      tokenCount += rowTokens;
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
      workflowLogger.debug('Created final chunk', { 
        chunkNumber: chunks.length,
        rowCount: currentChunk.length,
        tokenCount 
      });
    }
    
    logger.info(`Created ${chunks.length} chunks from ${rows.length} rows`);
    workflowLogger.info('Chunking completed', {
      totalRows: rows.length,
      totalChunks: chunks.length,
      tokenLimit
    });
    
    return chunks;
  }
}

module.exports = new ChunkService();