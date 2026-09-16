// Vercel Serverless Function Proxy for Airtable API
// Works as drop-in replacement for api.php on Vercel

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

function getCandidateTables(table) {
  const t = (table || '').trim();
  const lower = t.toLowerCase();
  if (lower === 'device' || lower === 'devices' || lower === 'camera' || lower === 'cameras') {
    return ['device', 'devices', 'Device', 'Devices', 'camera', 'cameras', 'Camera', 'Cameras'];
  }
  if (lower === 'map' || lower === 'maps') {
    return ['map', 'maps', 'Map', 'Maps'];
  }
  if (lower === 'user' || lower === 'users') {
    return ['user', 'users', 'User', 'Users'];
  }
  if (lower === 'department' || lower === 'departments') {
    return ['department', 'departments', 'Department', 'Departments'];
  }
  return [t];
}

function normalizeFields(table, fields) {
  const t = (table || '').trim().toLowerCase();
  const f = { ...(fields || {}) };

  if (t === 'device' || t === 'devices' || t === 'camera' || t === 'cameras') {
    const code = f.asset_code || f.asset_no || f.account_no || f.cam_id || f.id || '';
    const name = f.asset_name || f.eng_name || '';
    const holder = f.holder || f.thai_name || '';
    let img = '';
    if (Array.isArray(f.image) && f.image.length > 0) {
      img = f.image[0].url || '';
    } else if (typeof f.image === 'string') {
      img = f.image;
    } else if (f.image_url) {
      img = f.image_url;
    } else if (f.go2rtc_link) {
      img = f.go2rtc_link;
    }

    return {
      ...f,
      asset_code: code,
      account_no: code,
      id: code,
      asset_name: name,
      eng_name: name,
      holder: holder,
      thai_name: holder,
      type: f.type || 'Other',
      status: f.status || 'Active',
      image: img,
      image_url: img,
      go2rtc_link: img,
      map_id: String(f.map_id || '1'),
      x: f.x !== undefined ? f.x : null,
      y: f.y !== undefined ? f.y : null
    };
  }

  if (t === 'map' || t === 'maps') {
    let img = '';
    if (Array.isArray(f.map_pic) && f.map_pic.length > 0) {
      img = f.map_pic[0].url || '';
    } else if (typeof f.map_pic === 'string') {
      img = f.map_pic;
    } else if (f.map_url) {
      img = f.map_url;
    }
    return {
      ...f,
      map_id: f.map_id || f.id,
      map_name: f.map_name || '',
      map_url: img,
      map_pic: img
    };
  }

  if (t === 'user' || t === 'users') {
    return {
      ...f,
      Name: f.Name || f.name || f.username || '',
      password: f.password || f.Password || '',
      department: f.department || f.Department || '',
      camera_user: f.camera_user || '',
      map_user: f.map_user || ''
    };
  }

  return f;
}

// Fetch all records with pagination support and fallback across candidate table names
async function fetchAllRecords(baseId, token, candidateTables, sortField) {
  let lastError = null;

  for (const tableName of candidateTables) {
    let records = [];
    let offset = null;
    let success = true;

    do {
      let url = `${AIRTABLE_API_ROOT}/${baseId}/${encodeURIComponent(tableName)}?pageSize=100`;
      if (offset) url += `&offset=${encodeURIComponent(offset)}`;
      if (sortField) {
        url += `&sort[0][field]=${encodeURIComponent(sortField)}&sort[0][direction]=asc`;
      }

      try {
        const res = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (res.status === 404 || res.status === 403) {
          const errData = await res.json().catch(() => ({}));
          lastError = errData.error || { message: `Airtable API error ${res.status}` };
          success = false;
          break;
        }

        const data = await res.json();
        if (!res.ok) {
          lastError = data.error || { message: `Airtable API error ${res.status}` };
          success = false;
          break;
        }

        if (Array.isArray(data.records)) {
          records = records.concat(data.records);
        }
        offset = data.offset || null;
      } catch (err) {
        lastError = { message: err.message };
        success = false;
        break;
      }
    } while (offset);

    if (success) {
      return { ok: true, records, tableName };
    }
  }

  return { ok: false, error: lastError || { message: 'Table not found in Airtable' } };
}

// Helper to write to Airtable with unknown field pruning retry
async function writeAirtableWithRetry(url, method, token, fields) {
  let payloadFields = { ...fields };

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields: payloadFields, typecast: true })
    });

    const data = await res.json();
    if (res.ok) {
      return { ok: true, data };
    }

    // Auto-remove unknown field if Airtable rejects schema mismatch
    if (data.error && typeof data.error.message === 'string' && data.error.message.includes('Unknown field name:')) {
      const match = data.error.message.match(/Unknown field name:\s*["']([^"']+)["']/i);
      if (match && match[1] && match[1] in payloadFields) {
        delete payloadFields[match[1]];
        continue;
      }
    }

    return { ok: false, status: res.status, data };
  }

  return { ok: false, data: { error: 'Exceeded retry attempts for Airtable write' } };
}

// Helper to find record ID in Airtable if passed ID is not an Airtable rec ID
async function findAirtableRecordId(baseId, token, tableName, searchId) {
  if (typeof searchId === 'string' && searchId.startsWith('rec')) {
    return searchId;
  }

  try {
    const formula = `OR(RECORD_ID()='${searchId}',{asset_code}='${searchId}',{account_no}='${searchId}',{cam_id}='${searchId}',{id}='${searchId}',{map_id}='${searchId}')`;
    const url = `${AIRTABLE_API_ROOT}/${baseId}/${encodeURIComponent(tableName)}?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (res.ok && data.records && data.records.length > 0) {
      return data.records[0].id;
    }
  } catch (err) {
    console.warn('Error resolving Airtable record ID:', err);
  }

  return searchId;
}

module.exports = async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { token, baseId } = getAirtableConfig();
  const query = req.query || {};
  const table = (query.table || '').trim();

  // If table is missing
  if (!table) {
    return res.status(400).json({ error: 'Missing required parameter: table' });
  }

  // Fallback if Airtable credentials are not yet set
  if (!token || !baseId) {
    if (table.toLowerCase().startsWith('user') && query.name === 'admin' && query.password === 'cmfsupport') {
      return res.status(200).json({
        records: [{
          id: 'admin_fallback',
          fields: {
            Name: 'admin',
            password: 'cmfsupport',
            department: 'admin',
            camera_user: '',
            map_user: ''
          }
        }],
        note: 'Fallback admin login. Set AIRTABLE_TOKEN and AIRTABLE_BASE_ID in Vercel to connect to Airtable.'
      });
    }

    return res.status(500).json({
      error: 'Airtable credentials not configured. Please set AIRTABLE_TOKEN and AIRTABLE_BASE_ID in Vercel Environment Variables.',
      records: []
    });
  }

  const candidateTables = getCandidateTables(table);

  // ─── GET ───
  if (req.method === 'GET') {
    const sortField = query.sort || null;
    const result = await fetchAllRecords(baseId, token, candidateTables, sortField);

    if (!result.ok) {
      const err = result.error || {};
      let msg = err.message || 'Airtable error';

      // If user login attempt with default admin credentials, allow fallback access so user is never locked out
      if (table.toLowerCase().startsWith('user') && query.name === 'admin' && query.password === 'cmfsupport') {
        return res.status(200).json({
          records: [{
            id: 'admin_fallback',
            fields: {
              Name: 'admin',
              password: 'cmfsupport',
              department: 'admin',
              camera_user: '',
              map_user: ''
            }
          }],
          warning: 'เข้าสู่ระบบด้วยบัญชีฉุกเฉิน Admin เนื่องจากเชื่อมต่อ Airtable ไม่สำเร็จ: ' + (err.message || 'Error')
        });
      }

      if (err.type === 'AUTHENTICATION_REQUIRED' || String(err.message).toLowerCase().includes('authentication required')) {
        msg = 'Airtable Token ไม่ถูกต้อง หรือหมดอายุ (Authentication required): กรุณาตรวจสอบ AIRTABLE_TOKEN ใน Vercel Environment Variables ว่าคัดลอกมาถูกต้องครบถ้วน และขึ้นต้นด้วย "pat..."';
      } else if (err.type === 'INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND' || String(err.message).includes('Invalid permissions')) {
        msg = `สิทธิ์ไม่ถูกต้อง หรือไม่พบ Base/Table (${candidateTables.join('/')}) กรุณาตรวจสอบ: 1) ใน airtable.com/create/tokens ได้กด '+ Add a base' ให้ Token เข้าถึง Base แล้วหรือยัง 2) ตรวจสอบว่า AIRTABLE_BASE_ID (${baseId.slice(0, 6)}...) ถูกต้องหรือไม่ 3) ตาราง '${candidateTables[0]}' มีอยู่ใน Base หรือไม่`;
      }
      return res.status(500).json({ error: msg, raw: err });
    }

    let records = result.records.map(r => ({
      id: r.id,
      fields: normalizeFields(table, r.fields)
    }));

    // Handle User Login verification
    if (table.toLowerCase().startsWith('user') && query.name && query.password) {
      const qName = String(query.name).trim().toLowerCase();
      const qPass = String(query.password);
      records = records.filter(r => {
        const f = r.fields || {};
        const rName = String(f.Name || f.name || '').trim().toLowerCase();
        const rPass = String(f.password || f.Password || '');
        return rName === qName && rPass === qPass;
      });

      // Fallback for default admin if no Airtable user matched
      if (records.length === 0 && qName === 'admin' && qPass === 'cmfsupport') {
        records = [{
          id: 'admin_default',
          fields: {
            Name: 'admin',
            password: 'cmfsupport',
            department: 'admin',
            camera_user: '',
            map_user: ''
          }
        }];
      }
    }

    // Sort maps if requested
    if (table.toLowerCase().startsWith('map') && query.sort === 'map_id') {
      records.sort((a, b) => (Number(a.fields.map_id) || 0) - (Number(b.fields.map_id) || 0));
    }

    return res.status(200).json({ records });
  }

  // Parse Body for POST / PATCH
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};
  let fields = body.fields || body;

  // ─── POST (Create Record) ───
  if (req.method === 'POST') {
    const targetTable = candidateTables[0];
    
    // Prepare field mappings
    const preparedFields = { ...fields };
    if (table.toLowerCase().startsWith('device') || table.toLowerCase().startsWith('camera')) {
      if (preparedFields.asset_code) {
        preparedFields.account_no = preparedFields.asset_code;
        preparedFields.id = preparedFields.asset_code;
      }
      if (preparedFields.asset_name) preparedFields.eng_name = preparedFields.asset_name;
      if (preparedFields.holder) preparedFields.thai_name = preparedFields.holder;
    }

    const postUrl = `${AIRTABLE_API_ROOT}/${baseId}/${encodeURIComponent(targetTable)}`;
    const writeResult = await writeAirtableWithRetry(postUrl, 'POST', token, preparedFields);

    if (!writeResult.ok) {
      return res.status(writeResult.status || 500).json(writeResult.data);
    }

    return res.status(200).json({
      id: writeResult.data.id,
      fields: normalizeFields(table, writeResult.data.fields)
    });
  }

  // ─── PATCH (Update Record) ───
  if (req.method === 'PATCH') {
    const rawId = query.id || body.id;
    if (!rawId) {
      return res.status(400).json({ error: 'Missing record id for PATCH' });
    }

    const targetTable = candidateTables[0];
    const realRecordId = await findAirtableRecordId(baseId, token, targetTable, rawId);

    const preparedFields = { ...fields };
    if (table.toLowerCase().startsWith('device') || table.toLowerCase().startsWith('camera')) {
      if (preparedFields.asset_code) {
        preparedFields.account_no = preparedFields.asset_code;
        preparedFields.id = preparedFields.asset_code;
      }
      if (preparedFields.asset_name) preparedFields.eng_name = preparedFields.asset_name;
      if (preparedFields.holder) preparedFields.thai_name = preparedFields.holder;
    }

    const patchUrl = `${AIRTABLE_API_ROOT}/${baseId}/${encodeURIComponent(targetTable)}/${encodeURIComponent(realRecordId)}`;
    const writeResult = await writeAirtableWithRetry(patchUrl, 'PATCH', token, preparedFields);

    if (!writeResult.ok) {
      return res.status(writeResult.status || 500).json(writeResult.data);
    }

    return res.status(200).json({
      id: writeResult.data.id,
      fields: normalizeFields(table, writeResult.data.fields)
    });
  }

  // ─── DELETE (Delete Record) ───
  if (req.method === 'DELETE') {
    const rawId = query.id;
    if (!rawId) {
      return res.status(400).json({ error: 'Missing record id for DELETE' });
    }

    const targetTable = candidateTables[0];
    const realRecordId = await findAirtableRecordId(baseId, token, targetTable, rawId);
    const deleteUrl = `${AIRTABLE_API_ROOT}/${baseId}/${encodeURIComponent(targetTable)}/${encodeURIComponent(realRecordId)}`;

    const resDelete = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const data = await resDelete.json();
    if (!resDelete.ok) {
      return res.status(resDelete.status).json(data);
    }

    return res.status(200).json({ deleted: true, id: rawId });
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed` });
};
