const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 8000;
const DATA_FILE = path.join(__dirname, 'payments.json');
const MATCHES_FILE = path.join(__dirname, 'matches.json');

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function loadMatches() {
  const data = readJson(MATCHES_FILE, { entries: {} });
  return data.entries || {};
}

function loadPayments() {
  return readJson(DATA_FILE, { records: {} });
}

function savePayments(data) {
  writeJson(DATA_FILE, data);
}

function normalizeRecord(record) {
  if (!record) return null;
  let pending = record.pending_count;
  let credits = record.credits;
  let used = record.used_count;

  if (pending == null && credits == null && used == null && record.status) {
    if (record.status === 'pending') {
      pending = 1;
      credits = 0;
      used = 0;
    } else if (record.status === 'approved') {
      pending = 0;
      credits = 1;
      used = 0;
    } else if (record.status === 'used') {
      pending = 0;
      credits = 0;
      used = 1;
    } else {
      pending = 0;
      credits = 0;
      used = 0;
    }
  } else {
    pending = Number(pending || 0);
    credits = Number(credits || 0);
    used = Number(used || 0);
  }

  record.pending_count = pending;
  record.credits = credits;
  record.used_count = used;
  return record;
}

function computeStatus(record) {
  if (!record) return 'none';
  if (record.credits > 0) return 'approved';
  if (record.pending_count > 0) return 'pending';
  return 'none';
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

function normalizeId(id) {
  return String(id || '').replace(/\s+/g, '').toUpperCase();
}

const matches = loadMatches();

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (pathname === '/api/status' && req.method === 'GET') {
    const id = normalizeId(parsed.query.id);
    const payments = loadPayments();
    const record = normalizeRecord(payments.records[id]);
    if (!record) return sendJson(res, 200, { status: 'none' });
    return sendJson(res, 200, { status: computeStatus(record), record });
  }

  if (pathname === '/api/submit-payment' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const id = normalizeId(body.id);
      const utr = String(body.utr || '').trim();
      if (!id) {
        return sendJson(res, 400, { error: 'ID is required.' });
      }
      if (!matches[id]) {
        return sendJson(res, 404, { error: 'ID not found in matches.' });
      }

      const payments = loadPayments();
      const existing = normalizeRecord(payments.records[id]);
      const now = new Date().toISOString();
      if (existing) {
        existing.pending_count += 1;
        existing.lastSubmittedAt = now;
        payments.records[id] = existing;
      } else {
        payments.records[id] = {
          id,
          utr,
          pending_count: 1,
          credits: 0,
          used_count: 0,
          lastSubmittedAt: now,
        };
      }
      savePayments(payments);
      const updated = normalizeRecord(payments.records[id]);
      return sendJson(res, 200, {
        status: computeStatus(updated),
        pending_count: updated.pending_count,
        credits: updated.credits,
        used_count: updated.used_count,
      });
    } catch (err) {
      return sendJson(res, 400, { error: 'Invalid JSON.' });
    }
  }

  if (pathname === '/api/lookup' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const id = normalizeId(body.id);
      if (!id) return sendJson(res, 400, { error: 'ID is required.' });

      const payments = loadPayments();
      const record = normalizeRecord(payments.records[id]);
      if (!record) return sendJson(res, 403, { error: 'Payment not submitted.' });
      if (record.pending_count > 0 && record.credits <= 0) return sendJson(res, 403, { error: 'Payment pending approval.' });
      if (record.credits <= 0) return sendJson(res, 403, { error: 'No approved payment credit available.' });

      const entry = matches[id];
      if (!entry) return sendJson(res, 404, { error: 'ID not found in matches.' });

      record.credits -= 1;
      record.used_count += 1;
      record.lastUsedAt = new Date().toISOString();
      payments.records[id] = record;
      savePayments(payments);

      return sendJson(res, 200, { entry, credits_left: record.credits, used_count: record.used_count });
    } catch (err) {
      return sendJson(res, 400, { error: 'Invalid JSON.' });
    }
  }

  if (pathname === '/api/admin/pending' && req.method === 'GET') {
    const payments = loadPayments();
    const pending = Object.values(payments.records)
      .map(normalizeRecord)
      .filter(r => r && r.pending_count > 0);
    return sendJson(res, 200, { pending });
  }

  if (pathname === '/api/admin/approve' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const id = normalizeId(body.id);
      const payments = loadPayments();
      const record = normalizeRecord(payments.records[id]);
      if (!record) return sendJson(res, 404, { error: 'No payment found.' });
      if (record.pending_count <= 0) return sendJson(res, 400, { error: 'No pending payment to approve.' });
      record.pending_count -= 1;
      record.credits += 1;
      record.approvedAt = new Date().toISOString();
      payments.records[id] = record;
      savePayments(payments);
      return sendJson(res, 200, { status: 'approved', pending_count: record.pending_count, credits: record.credits });
    } catch (err) {
      return sendJson(res, 400, { error: 'Invalid JSON.' });
    }
  }

  if (pathname === '/rose' && req.method === 'GET') {
    const adminPath = path.join(__dirname, 'admin.html');
    const html = fs.readFileSync(adminPath, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(html);
  }

  // static file serving
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(__dirname, filePath);

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml',
    }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});
