// Netlify function — GHIN authentication and handicap fetch proxy

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

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

      const loginRes = await fetch('https://api2.ghin.com/api/v1/users/login.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          user: { email: ghin_number, password: password, remember_me: true },
          token: 'undefined',
        }),
      });

      const loginData = await loginRes.json();
      console.log('GHIN login status:', loginRes.status);
      console.log('GHIN login response keys:', Object.keys(loginData).join(', '));

      // Extract token — try multiple response shapes
      const golferToken = loginData.golfer_user?.golfer_token
        || loginData.token
        || loginData.golfer_token
        || loginData.jwt;

      if (!loginRes.ok || !golferToken) {
        // Pass through the actual GHIN error
        const ghinError = loginData.error
          || (loginData.errors && JSON.stringify(loginData.errors))
          || 'Login failed';
        console.log('GHIN login failed:', ghinError);
        console.log('Full GHIN response:', JSON.stringify(loginData));
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ error: 'GHIN login failed: ' + ghinError, debug: loginData }),
        };
      }

      const golfer_user = loginData.golfer_user || {};
      const ghinNum = golfer_user.ghin_number || ghin_number;

      // Fetch handicap index
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
