// test-security.js — Verify security fixes are working
const https = require('https');

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'buildpdf.co',
      path,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data.substring(0, 300) }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runSecurityTests() {
  let passed = 0;
  let failed = 0;

  function check(name, condition) {
    if (condition) {
      console.log(`  ✅ ${name}`);
      passed++;
    } else {
      console.log(`  ❌ ${name}`);
      failed++;
    }
  }

  // === TEST 1: Email dedup ===
  console.log('\n=== TEST 1: Email Deduplication ===');
  const email1 = `sectest-${Date.now()}@buildpdf.co`;

  const reg1 = await request('POST', '/api/v1/register', { email: email1 });
  check('First registration succeeds', reg1.status === 201);

  const reg2 = await request('POST', '/api/v1/register', { email: email1 });
  check('Duplicate email blocked (409)', reg2.status === 409);
  check('Error mentions existing key', reg2.body.error?.includes('already has'));

  // === TEST 2: Invalid email formats ===
  console.log('\n=== TEST 2: Email Validation ===');
  const badEmail1 = await request('POST', '/api/v1/register', { email: 'notanemail' });
  check('Rejects email without @', badEmail1.status === 400);

  const badEmail2 = await request('POST', '/api/v1/register', { email: 'a'.repeat(300) + '@test.com' });
  check('Rejects email > 254 chars', badEmail2.status === 400);

  const badEmail3 = await request('POST', '/api/v1/register', { email: 'spaces in@email.com' });
  check('Rejects email with spaces', badEmail3.status === 400);

  // === TEST 3: Error message doesn't leak internals ===
  console.log('\n=== TEST 3: Error Message Safety ===');
  const apiKey = reg1.body.apiKey;

  // Send malformed base64 to trigger a conversion error
  const badConvert = await request('POST', '/api/v1/convert',
    { file: '!!!not-base64!!!', format: 'image' },
    { 'X-API-Key': apiKey }
  );
  check('Convert error is generic (no stack trace)', !badConvert.body.error?.includes('at '));
  check('Convert error has no "message" detail', !badConvert.body.details?.message);

  // === TEST 4: Missing/bad auth ===
  console.log('\n=== TEST 4: Authentication ===');
  const noKey = await request('POST', '/api/v1/convert', { html: '<p>test</p>' });
  check('No API key returns 401', noKey.status === 401);

  const fakeKey = await request('POST', '/api/v1/convert',
    { html: '<p>test</p>' },
    { 'X-API-Key': 'bpdf_totallyFakeKey1234567890' }
  );
  check('Fake API key returns 401', fakeKey.status === 401);

  const badPrefix = await request('POST', '/api/v1/convert',
    { html: '<p>test</p>' },
    { 'X-API-Key': 'notbpdf_prefix' }
  );
  check('Wrong prefix returns 401', badPrefix.status === 401);

  // === TEST 5: Feature gating ===
  console.log('\n=== TEST 5: Feature Gating ===');
  const extractFree = await request('POST', '/api/v1/extract',
    { file: 'dGVzdA==', output: 'text' },
    { 'X-API-Key': apiKey }
  );
  check('Free tier blocked from extract (403)', extractFree.status === 403);

  // === RESULTS ===
  console.log(`\n${'='.repeat(40)}`);
  console.log(`RESULTS: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log(`${'='.repeat(40)}\n`);
}

runSecurityTests().catch(err => console.error('Test suite failed:', err));
