import https from 'https';
import fs from 'fs';

const fileId = '1kaJFDyQ7ZTY8eSB3L8UGMc6zyBiqM15H';
const url = `https://drive.google.com/uc?export=download&id=${fileId}`;

function download(u, dest) {
  return new Promise((resolve, reject) => {
    https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        download(res.headers.location, dest).then(resolve).catch(reject);
      } else {
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }
    }).on('error', reject);
  });
}

await download(url, 'test-ocr.jpg');
const stat = fs.statSync('test-ocr.jpg');
console.log(`Downloaded: ${stat.size} bytes`);
