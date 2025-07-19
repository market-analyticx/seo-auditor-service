// src/services/chunkService.js - Optimized for speed and efficiency
const logger = require('../utils/logger');
const workflowLogger = require('../utils/workflowLogger');

class ChunkService {
  constructor() {
    // Cache for fast token estimation
    this.tokenCache = new Map();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  // Fast token estimation (4 chars per token approximation)
  estimateTokensFast(text) {
    if (!text) return 0;
    
    // Use cache for repeated content
    const cacheKey = text.length + '_' + (text.substring(0, 50));
    if (this.tokenCache.has(cacheKey)) {
      this.cacheHits++;
      return this.tokenCache.get(cacheKey);
    }
    
    this.cacheMisses++;
    // Fast approximation: ~4 characters per token
    const approximateTokens = Math.ceil(text.length / 4);
    
    // Cache the result
    this.tokenCache.set(cacheKey, approximateTokens);
    
    // Keep cache size reasonable (memory management)
    if (this.tokenCache.size > 2000) {
      // Remove oldest entries
      const keysToDelete = Array.from(this.tokenCache.keys()).slice(0, 500);
      keysToDelete.forEach(key => this.tokenCache.delete(key));
    }
    
    return approximateTokens;
  }

  // Size-based chunking for large datasets (fastest method)
  chunkBySize(rows, chunkSize = 25) {
    const startTime = Date.now();
    const chunks = [];
    
    for (let i = 0; i < rows.length; i += chunkSize) {
      chunks.push(rows.slice(i, i + chunkSize));
    }
    
    const duration = Date.now() - startTime;
    
    workflowLogger.info('Size-based chunking completed', {
      totalRows: rows.length,
      totalChunks: chunks.length,
      chunkSize,
      duration,
      method: 'size-based'
    });
    
    return chunks;
  }

  // Smart chunking that chooses the best method
  smartChunk(rows, tokenLimit = 4000) {
    const startTime = Date.now();
    
    // For very large datasets, use size-based chunking
    if (rows.length > 500) {
      workflowLogger.info('Using size-based chunking for large dataset', {
        rowCount: rows.length,
        reason: 'Performance optimization'
      });
      return this.chunkBySize(rows, 30);
    }
    
    // For medium datasets, use fast token estimation
    if (rows.length > 100) {
      return this.chunkByTokensFast(rows, tokenLimit);
    }
    
    // For small datasets, we can afford accurate estimation
    return this.chunkByTokensFast(rows, tokenLimit);
  }

  // Fast token-based chunking
  chunkByTokensFast(rows, tokenLimit = 4000) {
    const startTime = Date.now();
    const chunks = [];
    let currentChunk = [];
    let tokenCount = 0;

    workflowLogger.debug('Starting fast token-based chunking', { 
      rowCount: rows.length, 
      tokenLimit 
    });

    for (const row of rows) {
      const rowString = this._createOptimizedRowString(row);
      const rowTokens = this.estimateTokensFast(rowString);

      if (tokenCount + rowTokens > tokenLimit && currentChunk.length > 0) {
        chunks.push([...currentChunk]);
        currentChunk = [];
        tokenCount = 0;
      }

      currentChunk.push(row);
      tokenCount += rowTokens;
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }
    
    const duration = Date.now() - startTime;
    
    logger.info(`Fast chunking: ${chunks.length} chunks from ${rows.length} rows in ${duration}ms`);
    workflowLogger.info('Fast token-based chunking completed', {
      totalRows: rows.length,
      totalChunks: chunks.length,
      tokenLimit,
      duration,
      averageChunkSize: chunks.length > 0 ? Math.round(rows.length / chunks.length) : 0,
      cacheStats: {
        hits: this.cacheHits,
        misses: this.cacheMisses,
        hitRate: Math.round((this.cacheHits / (this.cacheHits + this.cacheMisses)) * 100)
      }
    });
    
    return chunks;
  }

  // Create optimized row string with only essential fields
  _createOptimizedRowString(row) {
    // Only include fields essential for SEO analysis
    const essentialFields = [
      'Address', 'URL', 'Title', 'Meta Description 1', 'H1-1', 'H1-2',
      'Word Count', 'Status Code', 'Indexability', 'Canonical Link Element 1',
      'Inlinks', 'Outlinks'
    ];
    
    const values = [];
    for (const field of essentialFields) {
      const value = row[field];
      if (value && String(value).trim()) {
        values.push(String(value).substring(0, 200)); // Limit field length
      }
    }
    
    return values.join(' | ');
  }

  // Adaptive chunking based on system resources and data characteristics
  adaptiveChunk(rows, options = {}) {
    const {
      targetChunks = 20,
      maxChunkSize = 50,
      tokenLimit = 4000,
      preferSpeed = true
    } = options;

    const startTime = Date.now();
    
    // Determine best chunking strategy
    if (preferSpeed && rows.length > 300) {
      // Speed priority: size-based chunking
      const chunkSize = Math.min(Math.ceil(rows.length / targetChunks), maxChunkSize);
      return this.chunkBySize(rows, chunkSize);
    } else if (rows.length > 100) {
      // Balanced approach: fast token estimation
      return this.chunkByTokensFast(rows, tokenLimit);
    } else {
      // Small datasets: can afford token-based approach
      return this.chunkByTokensFast(rows, tokenLimit);
    }
  }

  // Memory-efficient chunking for very large datasets
  efficientChunkForLargeData(rows, maxMemoryChunks = 100) {
    workflowLogger.info('Using memory-efficient chunking for very large dataset', {
      rowCount: rows.length,
      maxMemoryChunks
    });

    const chunks = [];
    const chunkSize = Math.ceil(rows.length / maxMemoryChunks);
    
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      chunks.push(chunk);
      
      // Log progress for very large datasets
      if (chunks.length % 20 === 0) {
        workflowLogger.debug('Memory-efficient chunking progress', {
          chunksCreated: chunks.length,
          totalRows: rows.length,
          progress: Math.round((i / rows.length) * 100)
        });
      }
    }

    return chunks;
  }

  // Get chunking statistics for monitoring
  getChunkingStats() {
    return {
      cacheSize: this.tokenCache.size,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      hitRate: this.cacheHits + this.cacheMisses > 0 ? 
        Math.round((this.cacheHits / (this.cacheHits + this.cacheMisses)) * 100) : 0
    };
  }

  // Clear cache to free memory
  clearCache() {
    const cacheSize = this.tokenCache.size;
    this.tokenCache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
    
    workflowLogger.debug('Token cache cleared', {
      clearedEntries: cacheSize
    });
  }

  // Estimate processing time for chunking strategy
  estimateProcessingTime(rows, strategy = 'smart') {
    const estimates = {
      'size-based': rows.length * 0.001, // ~1ms per row
      'fast-tokens': rows.length * 0.01,  // ~10ms per row  
      'smart': rows.length * (rows.length > 500 ? 0.001 : 0.01)
    };

    return {
      estimatedMs: Math.round(estimates[strategy] || estimates.smart),
      strategy,
      rowCount: rows.length
    };
  }

  // Benchmark different chunking methods
  benchmark(rows, iterations = 3) {
    const results = {};
    const methods = [
      { name: 'size-based', fn: () => this.chunkBySize(rows, 25) },
      { name: 'fast-tokens', fn: () => this.chunkByTokensFast(rows, 4000) },
      { name: 'smart', fn: () => this.smartChunk(rows, 4000) }
    ];

    for (const method of methods) {
      const times = [];
      
      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        const chunks = method.fn();
        const duration = Date.now() - start;
        times.push(duration);
        
        if (i === 0) {
          results[method.name] = {
            avgDuration: 0,
            chunkCount: chunks.length,
            avgChunkSize: Math.round(rows.length / chunks.length)
          };
        }
      }
      
      results[method.name].avgDuration = Math.round(
        times.reduce((a, b) => a + b, 0) / times.length
      );
    }

    workflowLogger.info('Chunking benchmark completed', {
      rowCount: rows.length,
      iterations,
      results
    });

    return results;
  }
}

module.exports = new ChunkService();