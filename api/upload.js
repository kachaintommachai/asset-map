// Vercel Serverless Function for Image Uploads
// Converts uploaded file to Base64 Data URL and updates Airtable if record_id is provided

const AIRTABLE_API_ROOT = 'https://api.airtable.com/v0';

function cleanToken(token) {
  let t = (token || '').trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1).trim();
  }
  if (t.toLowerCase().startsWith('bearer ')) {
    t = t.slice(7).trim();
  }
  return t;
}

function cleanBaseId(baseId) {
  let b = (baseId || '').trim();
  if ((b.startsWith('"') && b.endsWith('"')) || (b.startsWith("'") && b.endsWith("'"))) {
    b = b.slice(1, -1).trim();
  }
  return b;
}

function getAirtableConfig() {
  const rawToken = process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_PAT || '';
  const rawBaseId = process.env.AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE || '';
  const token = cleanToken(rawToken);
  const baseId = cleanBaseId(rawBaseId);
  return { token, baseId };
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!match) {
      return resolve({ fields: {}, file: null });
    }
    const boundary = match[1] || match[2];
    const chunks = [];

    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);
        const boundaryBuffer = Buffer.from('--' + boundary);
        const parts = [];
        let start = 0;

        while ((start = buffer.indexOf(boundaryBuffer, start)) !== -1) {
          start += boundaryBuffer.length;
          if (buffer[start] === 45 && buffer[start + 1] === 45) { // '--' end boundary
            break;
          }
          if (buffer[start] === 13 && buffer[start + 1] === 10) { // CRLF
            start += 2;
          }
          const nextBoundary = buffer.indexOf(boundaryBuffer, start);
          if (nextBoundary === -1) break;
          const partBuffer = buffer.subarray(start, nextBoundary - 2);
          parts.push(partBuffer);
          start = nextBoundary;
        }

        const fields = {};
        let fileData = null;

        for (const part of parts) {
          const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
          if (headerEnd === -1) continue;
          const headerStr = part.subarray(0, headerEnd).toString('utf-8');
          const body = part.subarray(headerEnd + 4);

          const dispMatch = headerStr.match(/Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]+)")?/i);
          if (!dispMatch) continue;
          const fieldName = dispMatch[1];
          const filename = dispMatch[2];

          if (filename) {
            const typeMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);
            const mimeType = typeMatch ? typeMatch[1].trim() : 'image/jpeg';
            fileData = {
              filename,
              mimeType,
              buffer: body
            };
          } else {
            fields[fieldName] = body.toString('utf-8').trim();
          }
        }

        resolve({ fields, file: fileData });
      } catch (err) {
        reject(err);
      }
    });

    req.on('error', reject);
  });
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { fields, file } = await parseMultipart(req);

    if (!file || !file.buffer || file.buffer.length === 0) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    // Convert to Data URL
    const dataUrl = `data:${file.mimeType};base64,${file.buffer.toString('base64')}`;
    const recordId = fields.record_id || (req.query && req.query.record_id);
    const uploadType = (req.query && req.query.type) || (fields && fields.type) || '';
    const isMap = uploadType === 'map' || req.url.includes('upload_map');

    // Optionally update Airtable if credentials and record_id are provided
    const { token, baseId } = getAirtableConfig();
    if (token && baseId && recordId) {
      const tableName = isMap ? 'map' : 'device';
      const updatePayload = isMap
        ? { map_url: dataUrl }
        : { image_url: dataUrl, go2rtc_link: dataUrl };

      try {
        const patchUrl = `${AIRTABLE_API_ROOT}/${baseId}/${encodeURIComponent(tableName)}/${encodeURIComponent(recordId)}`;
        await fetch(patchUrl, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ fields: updatePayload, typecast: true })
        });
      } catch (err) {
        console.warn('Airtable upload sync warning:', err);
      }
    }

    return res.status(200).json({ success: true, url: dataUrl });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

handler.config = {
  api: {
    bodyParser: false
  }
};

module.exports = handler;
