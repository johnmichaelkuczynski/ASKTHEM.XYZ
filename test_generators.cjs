const http = require('http');
const fs = require('fs');

function testGenerator(name, path, body) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    let content = '';
    let wordCount = 0;
    
    console.log(`[${name}] Starting generation...`);
    
    const req = http.request(options, (res) => {
      res.on('data', (chunk) => {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.substring(6);
            if (data === '[DONE]') {
              continue;
            }
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                content += parsed.content;
                const newWords = content.split(/\s+/).filter(w => w.length > 0).length;
                if (newWords - wordCount >= 1000) {
                  console.log(`[${name}] Progress: ${newWords} words`);
                  wordCount = newWords;
                }
              }
              if (parsed.status) {
                console.log(`[${name}] ${parsed.status}`);
              }
              if (parsed.error) {
                console.log(`[${name}] ERROR: ${parsed.error}`);
              }
            } catch (e) {}
          }
        }
      });
      
      res.on('end', () => {
        const finalWords = content.split(/\s+/).filter(w => w.length > 0).length;
        console.log(`[${name}] Complete: ${finalWords} words`);
        fs.writeFileSync(`test_outputs/${name}.txt`, content);
        resolve({ name, words: finalWords });
      });
    });

    req.on('error', (e) => {
      console.error(`[${name}] Error: ${e.message}`);
      reject(e);
    });

    req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log('Starting all 4 generator tests with 20,000 words each...\n');
  
  const tests = [
    testGenerator('paper_writer_20k', '/api/figures/aristotle/write-paper', {
      topic: 'The nature of virtue and its role in human flourishing',
      wordLength: 20000,
      numberOfQuotes: 5
    }),
    testGenerator('dialogue_creator_20k', '/api/dialogue-creator', {
      authorId1: 'plato',
      authorId2: 'aristotle',
      text: 'The nature of justice and the ideal state - what makes a society just and how should individuals pursue virtue',
      wordLength: 20000
    }),
    testGenerator('interview_creator_20k', '/api/interview-creator', {
      thinkerId: 'nietzsche',
      topic: 'The will to power and the death of God',
      wordLength: 20000,
      mode: 'conservative',
      interviewerTone: 'neutral'
    }),
    testGenerator('debate_creator_20k', '/api/debate/generate', {
      thinker1Id: 'kant',
      thinker2Id: 'hume',
      mode: 'auto',
      wordLength: 20000
    })
  ];

  try {
    const results = await Promise.all(tests);
    console.log('\n=== RESULTS ===');
    for (const r of results) {
      console.log(`${r.name}: ${r.words} words`);
    }
  } catch (e) {
    console.error('Test failed:', e);
  }
}

runTests();
