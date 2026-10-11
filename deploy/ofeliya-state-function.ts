// Deployment replaces TOKEN_SHA256 with the hash of a random server-only key.
const TOKEN_SHA256 = '__OFELIYA_STATE_TOKEN_SHA256__';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});
Deno.serve(async (req: Request) => {
  try {
    const token = req.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
    if (!/^[a-f0-9]{64}$/.test(token)) return json({ error: 'unauthorized' }, 401);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const hex = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
    if (hex !== TOKEN_SHA256) return json({ error: 'unauthorized' }, 401);
    if (req.method !== 'POST') return json({ error: 'method' }, 405);
    if (Number(req.headers.get('content-length') ?? 0) > 8_000_000) return json({ error: 'too-large' }, 413);
    const raw = await req.text();
    if (raw.length > 8_000_000) return json({ error: 'too-large' }, 413);
    const input = JSON.parse(raw);
    if (!['read', 'claim', 'commit'].includes(input.op)) return json({ error: 'operation' }, 400);
    const response = await fetch(Deno.env.get('SUPABASE_URL') + '/rest/v1/rpc/ofeliya_state_call', {
      method: 'POST', headers: {
        'content-type': 'application/json',
        apikey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        authorization: 'Bearer ' + Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      }, body: JSON.stringify(input), signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return json({ error: 'database-unavailable' }, 503);
    const result = await response.json();
    return json(result, result.error ? 409 : 200);
  } catch { return json({ error: 'state-unavailable' }, 503); }
});
