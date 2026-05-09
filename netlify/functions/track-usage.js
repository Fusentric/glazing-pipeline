// track-usage.js — Fusentric Glazing Extractor usage tracking
// Fires on every successful extraction, logs to Airtable
// Required env vars: AIRTABLE_API_KEY, AIRTABLE_BASE_ID, AIRTABLE_TABLE_NAME

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const AIRTABLE_API_KEY  = process.env.AIRTABLE_API_KEY;
  const AIRTABLE_BASE_ID  = process.env.AIRTABLE_BASE_ID;
  const AIRTABLE_TABLE    = process.env.AIRTABLE_TABLE_NAME || 'Usage';

  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
    console.warn('Airtable env vars not set — skipping tracking');
    return { statusCode: 200, body: JSON.stringify({ skipped: true }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const record = {
    fields: {
      'Project Address': body.project_address || '',
      'Client Name':     body.client_name     || '',
      'Filename':        body.filename         || '',
      'Page Count':      body.page_count       || 0,
      'Windows Found':   body.window_count     || 0,
      'Scope':           body.scope            || '',
      'Confidence':      body.confidence       || '',
      'Flag Count':      body.flags            || 0,
      'Timestamp':       body.timestamp        || new Date().toISOString(),
    }
  };

  try {
    const res = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify(record),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      console.error('Airtable error:', res.status, err);
      return { statusCode: 200, body: JSON.stringify({ tracked: false, error: err }) };
    }

    const result = await res.json();
    console.log('Tracked usage record:', result.id);
    return { statusCode: 200, body: JSON.stringify({ tracked: true, id: result.id }) };

  } catch (e) {
    console.error('Airtable fetch failed:', e.message);
    return { statusCode: 200, body: JSON.stringify({ tracked: false, error: e.message }) };
  }
};
