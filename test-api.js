// test-api.js — Quick API endpoint tester
const https = require('https');

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'buildpdf.co',
      path: path,
      method: method,
      headers: { 'Content-Type': 'application/json' },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data.substring(0, 500) });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('=== TEST 1: Register API Key ===');
  const reg = await request('POST', '/api/v1/register', { email: 'test@buildpdf.co' });
  console.log('Status:', reg.status);
  console.log('Response:', JSON.stringify(reg.body, null, 2));

  if (reg.body.apiKey) {
    const apiKey = reg.body.apiKey;
    console.log('\n=== TEST 2: Check Usage ===');
    const usage = await request('GET', '/api/v1/usage');
    // Need to add key to headers - let's do a custom request
    const usageReq = new Promise((resolve, reject) => {
      const options = {
        hostname: 'buildpdf.co',
        path: '/api/v1/usage',
        method: 'GET',
        headers: { 'X-API-Key': apiKey },
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data.substring(0, 500) }); }
        });
      });
      req.on('error', reject);
      req.end();
    });
    const usageResult = await usageReq;
    console.log('Status:', usageResult.status);
    console.log('Response:', JSON.stringify(usageResult.body, null, 2));

    console.log('\n=== TEST 3: Convert HTML to PDF ===');
    const convertReq = new Promise((resolve, reject) => {
      const options = {
        hostname: 'buildpdf.co',
        path: '/api/v1/convert',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            // Truncate the PDF base64 for readability
            if (parsed.pdf) parsed.pdf = parsed.pdf.substring(0, 50) + '...[truncated]';
            resolve({ status: res.statusCode, body: parsed });
          } catch {
            resolve({ status: res.statusCode, body: data.substring(0, 500) });
          }
        });
      });
      req.on('error', reject);
      req.write(JSON.stringify({
        html: '<h1>BuildPDF API Test</h1><p>This PDF was generated via the API!</p>',
        options: { pageSize: 'a4', orientation: 'portrait' }
      }));
      req.end();
    });
    const convertResult = await convertReq;
    console.log('Status:', convertResult.status);
    console.log('Response:', JSON.stringify(convertResult.body, null, 2));
  }

  console.log('\n=== ALL TESTS COMPLETE ===');
}

runTests().catch(err => console.error('Test failed:', err));
