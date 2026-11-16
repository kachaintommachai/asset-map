// Vercel Serverless Function for Image Uploads
// Uploads file to Cloudinary and updates Supabase record if record_id is provided

const crypto = require('crypto');

// ─── Cloudinary Config ───
function getCloudinaryConfig() {
  let cloudName = (process.env.CLOUDINARY_CLOUD_NAME || 'ugkaemul').trim();
  const apiKey    = (process.env.CLOUDINARY_API_KEY    || '').trim();
  const apiSecret = (process.env.CLOUDINARY_API_SECRET || '').trim();
  const uploadPreset = (process.env.CLOUDINARY_UPLOAD_PRESET || process.env.CLOUDINARY_PRESET || 'asset_map').trim();

  // กรณีผู้ใช้ใส่ชื่อโปรเจกต์ "asset_map" เป็น cloudName ให้ fallback ไปที่ cloud name จริง "ugkaemul"
  if (cloudName.toLowerCase() === 'asset_map' || cloudName.toLowerCase() === 'asset-map') {
    cloudName = 'ugkaemul';
  }

  return { cloudName, apiKey, apiSecret, uploadPreset };
}

// ─── Upload buffer to Cloudinary ───
async function uploadToCloudinary(buffer, mimeType, folder) {
  const { cloudName, apiKey, apiSecret, uploadPreset } = getCloudinaryConfig();
  if (!cloudName) {
    throw new Error('Cloudinary cloudName not configured.');
  }

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
  const epilogue = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);

  // 1. ถ้ามี uploadPreset ให้ลอง Unsigned Upload ก่อน
  if (uploadPreset) {
    try {
      const preambleUnsigned = Buffer.from(
        field('upload_preset', uploadPreset) +
        field('folder', folder || 'asset_map') +
        `--${boundary}${CRLF}Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}Content-Type: ${mimeType}${CRLF}${CRLF}`
      );
      const bodyUnsigned = Buffer.concat([preambleUnsigned, buffer, epilogue]);
      const resUnsigned = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': bodyUnsigned.length.toString()
        },
        body: bodyUnsigned
      });
      const dataUnsigned = await resUnsigned.json().catch(() => ({}));
      if (resUnsigned.ok && (dataUnsigned.secure_url || dataUnsigned.url)) {
        return dataUnsigned.secure_url || dataUnsigned.url;
      }
    } catch (_) {}
  }

  if (!apiKey || !apiSecret) {
    // ถ้าไม่มี API Key/Secret ให้ fallback เป็น Base64 โดยไม่ throw error เพื่อให้ระบบไม่ล่ม
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const folderParam = folder || 'asset_map';
  const paramsToSign = `folder=${folderParam}&timestamp=${timestamp}${apiSecret}`;

  // Cloudinary ค่าเริ่มต้นใช้ SHA-1 signature
  const signatureSha1 = crypto.createHash('sha1').update(paramsToSign).digest('hex');

  function buildBody(sig) {
    const preamble = Buffer.from(
      field('api_key', apiKey) +
      field('timestamp', timestamp) +
      field('folder', folderParam) +
      field('signature', sig) +
      `--${boundary}${CRLF}Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}Content-Type: ${mimeType}${CRLF}${CRLF}`
    );
    return Buffer.concat([preamble, buffer, epilogue]);
  }

  let body = buildBody(signatureSha1);
  let res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length.toString()
    },
    body
  });

  let data = await res.json().catch(() => ({}));

  // ถ้า SHA-1 ติดปัญหา signature ให้ลอง SHA-256
  if (!res.ok && data.error?.message?.toLowerCase().includes('signature')) {
    const signatureSha256 = crypto.createHash('sha256').update(paramsToSign).digest('hex');
    body = buildBody(signatureSha256);
    res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length.toString()
      },
      body
    });
    data = await res.json().catch(() => ({}));
  }

  if (!res.ok) {
    // หากติดสิทธิ์ ให้ fallback เป็น Base64 แทนที่จะ throw error
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  }

  return data.secure_url || data.url || '';
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

    function processBuffer(buffer) {
      try {
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
            const mimeType  = typeMatch ? typeMatch[1].trim() : 'application/octet-stream';
            fileData = { filename, mimeType, buffer: body };
          } else {
            fields[fieldName] = body.toString('utf-8').trim();
          }
        }
        resolve({ fields, file: fileData });
      } catch (err) {
        reject(err);
      }
    }

    if (Buffer.isBuffer(req.body)) {
      return processBuffer(req.body);
    }
    if (typeof req.body === 'string') {
      return processBuffer(Buffer.from(req.body, 'binary'));
    }
    if (typeof req.on === 'function') {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => processBuffer(Buffer.concat(chunks)));
      req.on('error', err => reject(err));
    } else {
      resolve({ fields: {}, file: null });
    }
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
    let fileBuffer = null;
    let fileMime = 'image/jpeg';
    let recordId = (req.query && req.query.record_id) || '';
    let uploadType = (req.query && req.query.type) || '';

    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('application/json')) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const rawText = Buffer.concat(chunks).toString('utf-8');
      let json = {};
      try { json = JSON.parse(rawText); } catch (_) {}
      
      const dataUrl = json.dataUrl || json.image || json.image_url || '';
      recordId = recordId || json.record_id;
      uploadType = uploadType || json.type;

      if (dataUrl && dataUrl.startsWith('data:')) {
        const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (m) {
          fileMime = m[1];
          fileBuffer = Buffer.from(m[2], 'base64');
        }
      }
    } else {
      const { fields, file } = await parseMultipart(req);
      if (file && file.buffer) {
        fileBuffer = file.buffer;
        fileMime = file.mimeType;
      }
      recordId = recordId || fields.record_id;
      uploadType = uploadType || fields.type;
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const isMap     = uploadType === 'map' || (req.url && req.url.includes('upload_map'));
    const folder    = isMap ? 'asset_map/maps' : 'asset_map/devices';

    // ─── Upload to Cloudinary ───
    let imageUrl = '';
    const { cloudName } = getCloudinaryConfig();

    if (cloudName) {
      imageUrl = await uploadToCloudinary(fileBuffer, fileMime, folder);
    } else {
      // Fallback: Base64 data URL (when Cloudinary is not configured)
      console.warn('Cloudinary not configured — falling back to Base64 data URL');
      imageUrl = `data:${fileMime};base64,${fileBuffer.toString('base64')}`;
    }

    // ─── Sync URL to Supabase ───
    const supabaseUrl = (process.env.SUPABASE_URL || 'https://zfnfxbordtzapkkeqlte.supabase.co').trim();
    const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || 'sb_publishable_OpjggLJTlGaiE3pXn8PMhA_m-x_9mLF').trim();
    if (supabaseUrl && supabaseKey && recordId) {
      const isNumeric = /^\d+$/.test(recordId);
      const tableName = isMap ? 'map' : 'device';
      const patchUrl = isMap
        ? (isNumeric ? `${supabaseUrl}/rest/v1/map?or=(id.eq.${encodeURIComponent(recordId)},map_id.eq.${encodeURIComponent(recordId)})` : `${supabaseUrl}/rest/v1/map?map_id=eq.${encodeURIComponent(recordId)}`)
        : (isNumeric ? `${supabaseUrl}/rest/v1/device?or=(id.eq.${encodeURIComponent(recordId)},asset_code.eq.${encodeURIComponent(recordId)})` : `${supabaseUrl}/rest/v1/device?asset_code=eq.${encodeURIComponent(recordId)}`);
      const patchBody = isMap ? { map_pic: imageUrl } : { image: imageUrl };

      try {
        await fetch(patchUrl, {
          method: 'PATCH',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(patchBody)
        });
      } catch (sbErr) {
        console.warn('Supabase sync warning:', sbErr);
      }
    }

    return res.status(200).json({ success: true, url: imageUrl });
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = handler;
module.exports.config = {
  api: { bodyParser: false }
};
