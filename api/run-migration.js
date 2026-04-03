const { Client } = require('pg');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth check — must pass service key
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const auth = (req.headers.authorization || '').replace('Bearer ', '');
  if (!serviceKey || auth !== serviceKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    return res.status(500).json({ error: 'DATABASE_URL env var not set. Add it in Vercel: Settings → Environment Variables. Format: postgresql://postgres.[ref]:[password]@aws-0-us-west-1.pooler.supabase.com:6543/postgres' });
  }

  const sql = (req.body && req.body.sql) || '';
  if (!sql) return res.status(400).json({ error: 'Missing sql field in body' });

  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    await client.query(sql);
    await client.end();
    return res.status(200).json({ success: true, message: 'Migration executed successfully' });
  } catch (e) {
    try { await client.end(); } catch (_) {}
    return res.status(500).json({ error: e.message });
  }
};
