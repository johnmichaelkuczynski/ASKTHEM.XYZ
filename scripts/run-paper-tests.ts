import fs from 'fs';
import path from 'path';
import http from 'http';

const BASE_URL = 'http://localhost:5000';
const OUTPUT_DIR = path.join(process.cwd(), 'scripts', 'paper-writer-tests', 'outputs');
const TARGET_WORDS = 2540;

interface TestResult {
  figureId: string;
  success: boolean;
  wordCount: number;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];

async function getAllFigures(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    http.get(`${BASE_URL}/api/figures`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const figures = JSON.parse(data);
          resolve(figures.map((f: any) => f.id));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function testPaperWriter(figureId: string): Promise<TestResult> {
  const startTime = Date.now();
  console.log(`    Starting paper generation...`);
  
  return new Promise((resolve) => {
    const postData = JSON.stringify({
      topic: "Write a comprehensive summary of your philosophical work and key ideas",
      wordLength: TARGET_WORDS,
      selectedModel: "zhi2"
    });

    const options = {
      hostname: 'localhost',
      port: 5000,
      path: `/api/figures/${figureId}/write-paper`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Accept': 'text/event-stream'
      }
    };

    let content = '';
    let error: string | undefined;

    const req = http.request(options, (res) => {
      let buffer = '';
      
      res.on('data', (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              continue;
            }
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                content += parsed.content;
              }
              if (parsed.error) {
                error = parsed.error;
              }
            } catch (e) {
              // Not valid JSON
            }
          }
        }
      });

      res.on('end', () => {
        const duration = Date.now() - startTime;
        const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
        const success = wordCount >= 100 && !error;

        console.log(`    Received ${wordCount} words in ${(duration / 1000).toFixed(1)}s`);

        if (success && content.length > 0) {
          const outputFile = path.join(OUTPUT_DIR, `${figureId}-summary.txt`);
          const header = `${figureId.toUpperCase()} - Summary of Work\n` +
                         `Word Count: ${wordCount}\n` +
                         `Generated: ${new Date().toISOString()}\n` +
                         `${'='.repeat(60)}\n\n`;
          try {
            fs.writeFileSync(outputFile, header + content);
            console.log(`    Saved to ${outputFile}`);
          } catch (writeErr) {
            console.log(`    Failed to write file: ${writeErr}`);
          }
        }

        resolve({
          figureId,
          success,
          wordCount,
          error,
          duration
        });
      });

      res.on('error', (e) => {
        console.log(`    Response error: ${e.message}`);
        resolve({
          figureId,
          success: false,
          wordCount: 0,
          error: e.message,
          duration: Date.now() - startTime
        });
      });
    });

    req.on('error', (e) => {
      console.log(`    Request error: ${e.message}`);
      resolve({
        figureId,
        success: false,
        wordCount: 0,
        error: e.message,
        duration: Date.now() - startTime
      });
    });

    req.setTimeout(600000, () => {
      console.log(`    Timeout after 10 minutes`);
      req.destroy();
      resolve({
        figureId,
        success: false,
        wordCount: content.split(/\s+/).filter(w => w.length > 0).length,
        error: 'Timeout after 10 minutes',
        duration: Date.now() - startTime
      });
    });

    req.write(postData);
    req.end();
  });
}

async function main() {
  console.log('='.repeat(60));
  console.log('PAPER WRITER COMPREHENSIVE TEST');
  console.log(`Target: ${TARGET_WORDS} words per thinker`);
  console.log('='.repeat(60));
  console.log('');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const figures = await getAllFigures();
  console.log(`Found ${figures.length} thinkers to test\n`);

  for (let i = 0; i < figures.length; i++) {
    const figureId = figures[i];
    console.log(`[${i + 1}/${figures.length}] Testing ${figureId}...`);
    
    const result = await testPaperWriter(figureId);
    results.push(result);
    
    if (result.success) {
      console.log(`  => SUCCESS: ${result.wordCount} words\n`);
    } else {
      console.log(`  => FAILED: ${result.error || 'Unknown error'}\n`);
    }

    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));

  const passed = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`\nPassed: ${passed.length}/${results.length}`);
  console.log(`Failed: ${failed.length}/${results.length}`);

  if (failed.length > 0) {
    console.log('\nFailed thinkers:');
    failed.forEach(r => {
      console.log(`  - ${r.figureId}: ${r.error || 'No content'}`);
    });
  }

  if (passed.length > 0) {
    console.log('\nWord count summary:');
    const avgWords = Math.round(passed.reduce((sum, r) => sum + r.wordCount, 0) / passed.length);
    console.log(`  Average: ${avgWords} words`);
    console.log(`  Min: ${Math.min(...passed.map(r => r.wordCount))} words`);
    console.log(`  Max: ${Math.max(...passed.map(r => r.wordCount))} words`);
  }

  const manifestPath = path.join(OUTPUT_DIR, 'test-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    targetWords: TARGET_WORDS,
    totalThinkers: figures.length,
    passed: passed.length,
    failed: failed.length,
    results: results
  }, null, 2));

  console.log(`\nResults saved to: ${OUTPUT_DIR}`);
  console.log(`Manifest: ${manifestPath}`);
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
