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

      // Step 1: Authenticate with GHIN
      let loginRes, loginData;
      try {
        loginRes = await fetch('https://api2.ghin.com/api/v1/golfer_login.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({
            user: { password, email_or_ghin: ghin_number, remember_me: true },
            token: generateToken(),
          }),
        });
        loginData = await loginRes.json();
      } catch (fetchErr) {
        return { statusCode: 502, headers, body: JSON.stringify({ error: 'Could not reach GHIN servers: ' + fetchErr.message }) };
      }

      // Extract token
      const token = loginData.golfer_user_token
        || loginData.golfer_token
        || loginData.token;

      if (!loginRes.ok || !token) {
        const msg = loginData.error
          || loginData.errors?.digital_profile?.[0]?.top_line
          || (loginData.errors ? JSON.stringify(loginData.errors) : null)
          || ('GHIN status ' + loginRes.status);
        console.log('GHIN login failed:', msg, JSON.stringify(loginData).slice(0, 500));
        // DEBUG MODE — when status is 200 but no token found, return the full response shape
        // so we can identify the correct token field name
        if (loginRes.ok && !token) {
          return { statusCode: 401, headers, body: JSON.stringify({
            error: 'Token field not found in GHIN response',
            debug_keys: Object.keys(loginData),
            debug_sample: JSON.stringify(loginData).slice(0, 1500)
          }) };
        }
        return { statusCode: 401, headers, body: JSON.stringify({ error: msg }) };
      }

      console.log('GHIN login OK, token obtained. Response keys:', Object.keys(loginData).join(', '));

      // Extract golfer info from login response (may already be included)
      const golferFromLogin = loginData.golfers?.[0] || loginData.golfer || loginData.golfer_user || {};
      const ghinNum = golferFromLogin.ghin_number || golferFromLogin.ghin || ghin_number;

      // Step 2: Fetch handicap (only if not already in login response)
      let handicapIndex = golferFromLogin.handicap_index || golferFromLogin.HandicapIndex || null;
      let lowHi = golferFromLogin.low_hi || null;
      let revDate = golferFromLogin.rev_date || null;
      let clubName = golferFromLogin.club_name || '';
      let firstName = golferFromLogin.first_name || golferFromLogin.FirstName || '';

      if (!handicapIndex && ghinNum) {
        try {
          const hRes = await fetch(
            `https://api2.ghin.com/api/v1/golfers/search.json?golfer_id=${ghinNum}&per_page=1&page=1&source=GHINcom`,
            { headers: { 'Authorization': `Bearer ${token}` } }
          );
          const hData = await hRes.json();
          const g = hData.golfers?.[0] || {};
          handicapIndex = g.handicap_index || null;
          lowHi = g.low_hi || null;
          revDate = g.rev_date || null;
          clubName = g.club_name || '';
          firstName = firstName || g.first_name || '';
        } catch (hErr) {
          console.warn('Handicap fetch failed (non-fatal):', hErr.message);
          // Don't fail the whole login just because handicap fetch failed
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ token, ghin_number: ghinNum, first_name: firstName, handicap_index: handicapIndex, low_hi: lowHi, club_name: clubName, rev_date: revDate }),
      };
    }

    if (action === 'refresh') {
      const authHeader = event.headers.authorization || event.headers.Authorization || '';
      const token = authHeader.replace('Bearer ', '').trim();
      const ghinNum = params.ghin_number;
      if (!token || !ghinNum) return { statusCode: 400, headers, body: JSON.stringify({ error: 'token and ghin_number required' }) };
      const res = await fetch(
        `https://api2.ghin.com/api/v1/golfers/search.json?golfer_id=${ghinNum}&per_page=1&page=1&source=GHINcom`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      if (res.status === 401) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token expired' }) };
      const data = await res.json();
      const g = data.golfers?.[0] || {};
      return { statusCode: 200, headers, body: JSON.stringify({ handicap_index: g.handicap_index || null, low_hi: g.low_hi || null, rev_date: g.rev_date || null }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (err) {
    console.error('GHIN function unhandled error:', err.message, err.stack);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
  }
};
