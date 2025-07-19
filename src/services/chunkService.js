// src/services/chunkService.js - Optimized for speed
const logger = require('../utils/logger');
const workflowLogger = require('../utils/workflowLogger');
const config = require('../config/audit');

class ChunkService {
  constructor() {
    // Cache for token estimation to avoid repeated calculations
    this.tokenCache = new Map();
  }

  // Fast token estimation without tiktoken for better performance
  estimateTokensFast(text) {
    if (!text) return 0;
    
    // Check cache first
    const cacheKey = text.length + '_' + text.substring(0, 50);
    if (this.tokenCache.has(cacheKey)) {
      return this.tokenCache.get(cacheKey);
    }
    
    // Fast approximation: ~4 characters per token for English text
    // This is much faster than tiktoken encoding
    const approximateTokens = Math.ceil(text.length / 4);
    
    // Cache the result
    this.tokenCache.set(cacheKey, approximateTokens);
    
    // Keep cache size reasonable
    if (this.tokenCache.size > 1000) {
      const firstKey = this.tokenCache.keys().next().value;
      this.tokenCache.delete(firstKey);
    }
    
    return approximateTokens;
  }

  // Original tiktoken method for accuracy when needed
  estimateTokensAccurate(text) {
    try {
      const { encoding_for_model } = require('@dqbd/tiktoken');
      const modelType = config.models.openai.model.includes('gpt-4') ? 'gpt-4' : 'gpt-3.5-turbo';
      const enc = encoding_for_model(modelType);
      const tokens = enc.encode(text);
      enc.free();
      return tokens.length;
    } catch (error) {
      // Fallback to fast estimation if tiktoken fails
      return this.estimateTokensFast(text);
    }
  }

  chunkRowsByTokenCount(rows, tokenLimit, useFastEstimation = true) {
    const startTime = Date.now();
    const chunks = [];
    let currentChunk = [];
    let tokenCount = 0;
    let processedRows = 0;

    workflowLogger.debug('Starting optimized chunking process', { 
      rowCount: rows.length, 
      tokenLimit,
      useFastEstimation
    });

    // Use appropriate token estimation method
    const estimateTokens = useFastEstimation ? 
      this.estimateTokensFast.bind(this) : 
      this.estimateTokensAccurate.bind(this);

    for (const row of rows) {
      // Create a simplified row string for token estimation
      const rowString = this._createRowString(row);
      const rowTokens = estimateTokens(rowString);

      // Check if adding this row would exceed the limit
      if (tokenCount + rowTokens > tokenLimit && currentChunk.length > 0) {
        chunks.push([...currentChunk]); // Create a copy
        
        // Log progress less frequently to improve performance
        if (chunks.length % 10 === 0) {
          workflowLogger.debug('Chunking progress', { 
            chunkNumber: chunks.length,
            rowCount: currentChunk.length,
            tokenCount,
            totalProcessed: processedRows
          });
        }
        
        currentChunk = [];
        tokenCount = 0;
      }

      currentChunk.push(row);
      tokenCount += rowTokens;
      processedRows++;
    }

    // Add the final chunk if it has content
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }
    
    const duration = Date.now() - startTime;
    
    logger.info(`Fast chunking: ${chunks.length} chunks from ${rows.length} rows in ${duration}ms`);
    workflowLogger.info('Optimized chunking completed', {
      totalRows: rows.length,
      totalChunks: chunks.length,
      tokenLimit,
      duration,
      averageChunkSize: chunks.length > 0 ? Math.round(rows.length / chunks.length) : 0,
      estimationMethod: useFastEstimation ? 'fast' : 'accurate'
    });
    
    return chunks;
  }

  // Optimized row string creation
  _createRowString(row) {
    // Only include the most important fields for token estimation
    // This reduces processing time significantly
    const importantFields = [
      'Address', 'URL', 'Title', 'Meta Description 1', 'H1-1', 'H1-2',
      'Word Count', 'Status Code', 'Indexability'
    ];
    
    const values = [];
    for (const field of importantFields) {
      const value = row[field];
      if (value) {
        values.push(String(value));
      }
    }
    
    return values.join(' | ');
  }

  // Method to chunk with size limits for better performance
  chunkRowsBySize(rows, maxChunkSize = 50) {
    const chunks = [];
    
    for (let i = 0; i < rows.length; i += maxChunkSize) {
      chunks.push(rows.slice(i, i + maxChunkSize));
    }
    
    workflowLogger.info('Size-based chunking completed', {
      totalRows: rows.length,
      totalChunks: chunks.length,
      maxChunkSize
    });
    
    return chunks;
  }

  // Smart chunking that chooses the best method based on data size
  smartChunk(rows, tokenLimit, maxChunkSize = 100) {
    const startTime = Date.now();
    
    // For large datasets, use size-based chunking for speed
    if (rows.length > 500) {
      workflowLogger.info('Using size-based chunking for large dataset', {
        rowCount: rows.length,
        method: 'size-based',
        maxChunkSize
      });
      return this.chunkRowsBySize(rows, maxChunkSize);
    }
    
    // For medium datasets, use fast token estimation
    if (rows.length > 100) {
      workflowLogger.info('Using fast token estimation for medium dataset', {
        rowCount: rows.length,
        method: 'fast-tokens',
        tokenLimit
      });
      return this.chunkRowsByTokenCount(rows, tokenLimit, true);
    }
    
    // For small datasets, use accurate token estimation
    workflowLogger.info('Using accurate token estimation for small dataset', {
      rowCount: rows.length,
      method: 'accurate-tokens',
      tokenLimit
    });
    return this.chunkRowsByTokenCount(rows, tokenLimit, false);
  }

  // Clear cache method for memory management
  clearCache() {
    this.tokenCache.clear();
    workflowLogger.debug('Token estimation cache cleared');
  }
}

module.exports = new ChunkService();