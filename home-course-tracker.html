// Netlify serverless function — proxies requests to GolfCourseAPI
// Keeps the API key off the frontend and out of the GitHub repo.
// Deployed automatically by Netlify when this file is in netlify/functions/

const GOLF_API_KEY = process.env.GOLF_COURSE_API_KEY;
const BASE_URL = 'https://api.golfcourseapi.com/v1';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (!GOLF_API_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'API key not configured. Add GOLF_COURSE_API_KEY to Netlify environment variables.' }),
    };
  }

  const params = event.queryStringParameters || {};
  const action = params.action;

  try {
    let url;

    if (action === 'search') {
      // Search for courses by name
      // GET /v1/search?search_query=Pebble+Beach
      if (!params.q) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing search query' }) };
      url = `${BASE_URL}/search?search_query=${encodeURIComponent(params.q)}`;

    } else if (action === 'course') {
      // Get full course details including tees, slope, rating
      // GET /v1/courses/:id
      if (!params.id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing course ID' }) };
      url = `${BASE_URL}/courses/${params.id}`;

    } else {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action. Use action=search or action=course' }) };
    }

    const response = await fetch(url, {
      headers: { 'Authorization': `Key ${GOLF_API_KEY}` },
    });

    if (!response.ok) {
      const text = await response.text();
      return { statusCode: response.status, headers, body: JSON.stringify({ error: text }) };
    }

    const data = await response.json();
    return { statusCode: 200, headers, body: JSON.stringify(data) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
