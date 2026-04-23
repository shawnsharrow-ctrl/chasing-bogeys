// Netlify function — GHIN authentication and handicap fetch proxy

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

function generateToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let t = '';
  for (let i = 0; i < 20; i++) t += chars[Math.floor(Math.random() * chars.length)];
  return t;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const params = event.queryStringParameters || {};
  const action = params.action;

  try {
    if (action === 'login' && event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { ghin_number, password } = body;

      if (!ghin_number || !password) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email and password required' }) };
      }

      const loginRes = await fetch('https://api2.ghin.com/api/v1/golfer_login.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          user: { password, email_or_ghin: ghin_number, remember_me: true },
          token: generateToken(),
        }),
      });

      const d = await loginRes.json();

      // Token lives at golfer_user_token per GHIN's source
      const token = d.golfer_user_token;
      if (!loginRes.ok || !token) {
        const msg = d.error
          || d.errors?.digital_profile?.[0]?.top_line
          || (d.errors ? JSON.stringify(d.errors) : 'Login failed');
        return { statusCode: 401, headers, body: JSON.stringify({ error: msg }) };
      }

      // Golfer data lives at golfers[0] per GHIN's source
      const golfer = d.golfers?.[0] || {};

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          token,
          ghin_number: golfer.ghin_number || ghin_number,
          first_name: golfer.first_name || '',
          handicap_index: golfer.handicap_index || null,
          low_hi: golfer.low_hi || null,
          club_name: golfer.club_name || '',
          rev_date: golfer.rev_date || null,
        }),
      };
    }

    if (action === 'refresh') {
      const authHeader = event.headers.authorization || event.headers.Authorization || '';
      const token = authHeader.replace('Bearer ', '').trim();
      const ghinNum = params.ghin_number;

      if (!token || !ghinNum) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'token and ghin_number required' }) };
      }

      const res = await fetch(
        `https://api2.ghin.com/api/v1/golfers/search.json?golfer_id=${ghinNum}&per_page=1&page=1&source=GHINcom`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );

      if (res.status === 401) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token expired' }) };
      }

      const data = await res.json();
      const golfer = data.golfers?.[0] || {};

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          handicap_index: golfer.handicap_index || null,
          low_hi: golfer.low_hi || null,
          rev_date: golfer.rev_date || null,
        }),
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (err) {
    console.error('GHIN error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
  }
};
