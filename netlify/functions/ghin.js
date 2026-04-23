// Netlify function — GHIN authentication and handicap fetch proxy

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

// Generate a token similar to what GHIN's app uses
function generateToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 20; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
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

      console.log('Attempting GHIN login for:', ghin_number);

      // Use the correct endpoint and field names from GHIN's own app source
      const loginRes = await fetch('https://api2.ghin.com/api/v1/golfer_login.json', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        body: JSON.stringify({
          user: {
            password: password,
            email_or_ghin: ghin_number,
            remember_me: true,
          },
          token: generateToken(),
        }),
      });

      const loginData = await loginRes.json();
      console.log('GHIN login status:', loginRes.status);
      console.log('GHIN response keys:', Object.keys(loginData).join(', '));

      // Extract token — check multiple possible locations
      const golferToken = loginData.golfer_user?.golfer_token
        || loginData.golfer_token
        || loginData.token
        || loginData.jwt;

      if (!loginRes.ok || !golferToken) {
        const ghinError = loginData.error
          || (loginData.errors ? JSON.stringify(loginData.errors) : null)
          || 'Login failed';
        console.log('GHIN login failed:', ghinError, JSON.stringify(loginData));
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ error: ghinError }),
        };
      }

      const golfer_user = loginData.golfer_user || {};
      const ghinNum = golfer_user.ghin_number || ghin_number;

      // Fetch current handicap index
      const handicapRes = await fetch(
        `https://api2.ghin.com/api/v1/golfers/search.json?golfer_id=${ghinNum}&per_page=1&page=1&source=GHINcom`,
        { headers: { 'Authorization': `Bearer ${golferToken}` } }
      );

      const handicapData = await handicapRes.json();
      const golfer = (handicapData.golfers && handicapData.golfers[0]) || {};

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          token: golferToken,
          ghin_number: ghinNum,
          first_name: golfer_user.first_name || golfer.first_name || '',
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
      const golfer = (data.golfers && data.golfers[0]) || {};

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
    console.error('GHIN function error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
  }
};
