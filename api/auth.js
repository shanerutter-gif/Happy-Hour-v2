export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl) return new Response(JSON.stringify({ error: 'Missing SUPABASE_URL' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  if (!serviceKey)  return new Response(JSON.stringify({ error: 'Missing SUPABASE_SERVICE_KEY' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  let body;
  try { body = await req.json(); }
  catch (e) { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const { mode, email, password, name } = body;
  if (!mode || !email || !password) return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const endpoint = mode === 'signup'
    ? `${supabaseUrl}/auth/v1/signup`
    : `${supabaseUrl}/auth/v1/token?grant_type=password`;

  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
      body: JSON.stringify(mode === 'signup' ? { email, password, data: { full_name: name } } : { email, password })
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Could not reach Supabase: ' + e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  const data = await res.json();
  return new Response(JSON.stringify(data), { status: res.status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
}
