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

// Walk an object and find any key that looks like a JWT token
function findToken(obj, depth) {
  if (!obj || typeof obj !== 'object' || depth > 5) return null;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && v.startsWith('eyJ') && v.length > 50) return v;
    if (typeof v === 'object') {
      const found = findToken(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
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
        return { statusCode: 502, headers, body: JSON.stringify({ error: 'Could not reach GHIN: ' + fetchErr.message }) };
      }

      console.log('GHIN status:', loginRes.status, '| keys:', Object.keys(loginData).join(', '));

      // Walk the entire response to find any JWT token regardless of field name
      const token = findToken(loginData, 0);

      if (!loginRes.ok || !token) {
        const msg = loginData.error
          || loginData.errors?.digital_profile?.[0]?.top_line
          || (loginData.errors ? JSON.stringify(loginData.errors) : null)
          || 'GHIN status ' + loginRes.status;
        console.log('No token found. Error:', msg);
        console.log('Full response:', JSON.stringify(loginData).slice(0, 1000));
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({
            error: msg,
            debug_keys: Object.keys(loginData),
            debug_sample: JSON.stringify(loginData).slice(0, 2000)
          })
        };
      }

      console.log('Token found successfully');

      // Extract golfer info — search the response for known fields
      const golfers = loginData.golfers || loginData.Golfers || [];
      const golfer = golfers[0] || loginData.golfer || loginData.golfer_user || {};
      const ghinNum = golfer.ghin_number || golfer.ghin || golfer.GHINNumber || ghin_number;
      let handicapIndex = golfer.handicap_index || golfer.HandicapIndex || null;
      let lowHi = golfer.low_hi || golfer.LowHI || null;
      let revDate = golfer.rev_date || golfer.RevDate || null;
      let clubName = golfer.club_name || golfer.ClubName || '';
      let firstName = golfer.first_name || golfer.FirstName || '';

      // If no handicap in login response, fetch separately
      if (!handicapIndex && ghinNum) {
        try {
          const hRes = await fetch(
            `https://api2.ghin.com/api/v1/golfers/search.json?golfer_id=${ghinNum}&per_page=1&page=1&source=GHINcom`,
            { headers: { 'Authorization': 'Bearer ' + token } }
          );
          const hData = await hRes.json();
          const g = (hData.golfers || [])[0] || {};
          handicapIndex = g.handicap_index || null;
          lowHi = g.low_hi || null;
          revDate = g.rev_date || null;
          clubName = clubName || g.club_name || '';
          firstName = firstName || g.first_name || '';
        } catch (hErr) {
          console.warn('Handicap fetch failed (non-fatal):', hErr.message);
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
        { headers: { 'Authorization': 'Bearer ' + token } }
      );
      if (res.status === 401) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token expired' }) };
      const data = await res.json();
      const g = (data.golfers || [])[0] || {};
      return { statusCode: 200, headers, body: JSON.stringify({ handicap_index: g.handicap_index || null, low_hi: g.low_hi || null, rev_date: g.rev_date || null }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (err) {
    console.error('Unhandled error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
  }
};
