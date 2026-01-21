const http = require('http');
const fs = require('fs');

const name = process.argv[2];
const path = process.argv[3];
const body = JSON.parse(process.argv[4]);

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
let lastWords = 0;

const req = http.request(options, (res) => {
  res.on('data', (chunk) => {
    const lines = chunk.toString().split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.substring(6);
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed.content) content += parsed.content;
          const words = content.split(/\s+/).filter(w => w.length > 0).length;
          if (words - lastWords >= 2000) {
            console.log(`${name}: ${words} words`);
            lastWords = words;
          }
        } catch (e) {}
      }
    }
  });
  res.on('end', () => {
    const finalWords = content.split(/\s+/).filter(w => w.length > 0).length;
    console.log(`${name}: COMPLETE - ${finalWords} words`);
    fs.writeFileSync(`test_outputs/${name}.txt`, content);
  });
});

req.on('error', (e) => console.error(e.message));
req.write(postData);
req.end();
