// Vercel Serverless Function for Image Uploads
// Uploads file to Cloudinary and updates Airtable record if record_id is provided

const crypto = require('crypto');
const AIRTABLE_API_ROOT = 'https://api.airtable.com/v0';

// ─── Cloudinary Config ───
function getCloudinaryConfig() {
  return {
    cloudName: (process.env.CLOUDINARY_CLOUD_NAME || '').trim(),
    apiKey:    (process.env.CLOUDINARY_API_KEY    || '').trim(),
    apiSecret: (process.env.CLOUDINARY_API_SECRET || '').trim()
  };
}

// ─── Upload buffer to Cloudinary (Signed Upload) ───
async function uploadToCloudinary(buffer, mimeType, folder) {
  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary credentials not configured. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.');
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const folderParam = folder || 'asset_map';

  // Build signature string (sorted params)
  const paramsToSign = `folder=${folderParam}&timestamp=${timestamp}${apiSecret}`;
  const signature = crypto.createHash('sha256').update(paramsToSign).digest('hex');

  // Build multipart/form-data manually
  const boundary = `----CloudinaryBoundary${Date.now()}`;
  const CRLF = '\r\n';

  function field(name, value) {
    return [
      `--${boundary}`,
      `Content-Disposition: form-data; name="${name}"`,
      '',
      value
    ].join(CRLF) + CRLF;
  }

  const ext = (mimeType || 'image/jpeg').split('/')[1] || 'jpg';
  const filename = `upload.${ext}`;

  const preamble = Buffer.from(
    field('api_key', apiKey) +
    field('timestamp', timestamp) +
    field('folder', folderParam) +
    field('signature', signature) +
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}` +
    `Content-Type: ${mimeType}${CRLF}${CRLF}`
  );
  const epilogue = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);

  const body = Buffer.concat([preamble, buffer, epilogue]);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length.toString()
    },
    body
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error?.message || `Cloudinary upload failed (HTTP ${res.status})`);
  }

  return data.secure_url || data.url || '';
}

// ─── Airtable Config ───
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
  const rawToken  = process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_PAT || '';
  const rawBaseId = process.env.AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE || '';
  return { token: cleanToken(rawToken), baseId: cleanBaseId(rawBaseId) };
}

// ─── Multipart Parser ───
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
          if (buffer[start] === 45 && buffer[start + 1] === 45) break; // '--' end
          if (buffer[start] === 13 && buffer[start + 1] === 10) start += 2; // CRLF
          const nextBoundary = buffer.indexOf(boundaryBuffer, start);
          if (nextBoundary === -1) break;
          parts.push(buffer.subarray(start, nextBoundary - 2));
          start = nextBoundary;
        }

        const fields = {};
        let fileData = null;

        for (const part of parts) {
          const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
          if (headerEnd === -1) continue;
          const headerStr = part.subarray(0, headerEnd).toString('utf-8');
          const body      = part.subarray(headerEnd + 4);

          const dispMatch = headerStr.match(/Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]+)")?/i);
          if (!dispMatch) continue;
          const fieldName = dispMatch[1];
          const filename  = dispMatch[2];

          if (filename) {
            const typeMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);
            fileData = {
              filename,
              mimeType: typeMatch ? typeMatch[1].trim() : 'image/jpeg',
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

// ─── Main Handler ───
async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { fields, file } = await parseMultipart(req);

    if (!file || !file.buffer || file.buffer.length === 0) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const recordId  = fields.record_id || (req.query && req.query.record_id);
    const uploadType = (req.query && req.query.type) || (fields && fields.type) || '';
    const isMap     = uploadType === 'map' || (req.url && req.url.includes('upload_map'));
    const folder    = isMap ? 'asset_map/maps' : 'asset_map/devices';

    // ─── Upload to Cloudinary ───
    let imageUrl = '';
    const { cloudName } = getCloudinaryConfig();

    if (cloudName) {
      imageUrl = await uploadToCloudinary(file.buffer, file.mimeType, folder);
    } else {
      // Fallback: Base64 data URL (when Cloudinary is not configured)
      console.warn('Cloudinary not configured — falling back to Base64 data URL');
      imageUrl = `data:${file.mimeType};base64,${file.buffer.toString('base64')}`;
    }

    // ─── Sync URL to Airtable ───
    const { token, baseId } = getAirtableConfig();
    if (token && baseId && recordId) {
      const tableName     = isMap ? 'map' : 'device';
      const updatePayload = isMap
        ? { map_url: imageUrl, map_pic: imageUrl }
        : { image_url: imageUrl, go2rtc_link: imageUrl };

      try {
        await fetch(`${AIRTABLE_API_ROOT}/${baseId}/${encodeURIComponent(tableName)}/${encodeURIComponent(recordId)}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ fields: updatePayload, typecast: true })
        });
      } catch (err) {
        console.warn('Airtable sync warning:', err);
      }
    }

    return res.status(200).json({ success: true, url: imageUrl });
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

handler.config = {
  api: { bodyParser: false }
};

module.exports = handler;
