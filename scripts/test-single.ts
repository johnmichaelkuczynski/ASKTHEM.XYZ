import fs from 'fs';
import path from 'path';
import http from 'http';

const OUTPUT_DIR = path.join(process.cwd(), 'scripts', 'paper-writer-tests', 'outputs');
const TARGET_WORDS = 2540;

const figureId = process.argv[2];
if (!figureId) {
  console.error('Usage: npx tsx scripts/test-single.ts <figureId>');
  process.exit(1);
}

async function testPaperWriter(figureId: string): Promise<void> {
  console.log(`Testing ${figureId}...`);
  
  return new Promise((resolve, reject) => {
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
    const startTime = Date.now();

    const req = http.request(options, (res) => {
      let buffer = '';
      
      res.on('data', (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) content += parsed.content;
            } catch {}
          }
        }
      });

      res.on('end', () => {
        const duration = (Date.now() - startTime) / 1000;
        const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
        
        if (wordCount >= 100) {
          if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
          const outputFile = path.join(OUTPUT_DIR, `${figureId}-summary.txt`);
          const header = `${figureId.toUpperCase()} - Summary of Work\nWord Count: ${wordCount}\nGenerated: ${new Date().toISOString()}\n${'='.repeat(60)}\n\n`;
          fs.writeFileSync(outputFile, header + content);
          console.log(`SUCCESS: ${figureId} - ${wordCount} words in ${duration.toFixed(1)}s`);
          resolve();
        } else {
          console.log(`FAILED: ${figureId} - only ${wordCount} words`);
          reject(new Error(`Only ${wordCount} words`));
        }
      });
    });

    req.on('error', (e) => {
      console.log(`ERROR: ${figureId} - ${e.message}`);
      reject(e);
    });

    req.setTimeout(600000, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });

    req.write(postData);
    req.end();
  });
}

testPaperWriter(figureId)
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
