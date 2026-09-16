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
    return [
      'device', 'devices', 'Device', 'Devices', 'device.csv', 'Device.csv',
      'asset_map', 'Asset_Map', 'asset', 'assets', 'Asset', 'Assets', 'it_asset', 'IT Asset',
      'camera', 'cameras', 'Camera', 'Cameras', 'camera.csv', 'Camera.csv',
      'อุปกรณ์', 'ทรัพย์สิน', 'Table 1'
    ];
  }
  if (lower === 'map' || lower === 'maps') {
    return [
      'map', 'maps', 'Map', 'Maps', 'map.csv', 'Map.csv',
      'cctv_map', 'asset_map', 'แผนผัง', 'แปลน', 'แผนที่', 'Table 2', 'Table 1'
    ];
  }
  if (lower === 'user' || lower === 'users') {
    return [
      'user', 'users', 'User', 'Users', 'user.csv', 'User.csv',
      'ผู้ใช้', 'ผู้ใช้งาน', 'Table 4', 'Table 1'
    ];
  }
  if (lower === 'department' || lower === 'departments') {
    return [
      'department', 'departments', 'Department', 'Departments', 'department.csv', 'Department.csv',
      'dept', 'depts', 'แผนก', 'ฝ่าย', 'Table 3', 'Table 1'
    ];
  }
  return [t, `${t}.csv`];
}

function normalizeFields(table, fields) {
  const t = (table || '').trim().toLowerCase();
  const f = { ...(fields || {}) };

  if (t === 'device' || t === 'devices' || t === 'camera' || t === 'cameras') {
    const code = f.asset_code || f.Asset_Code || f['Asset Code'] || f.asset_no || f.account_no || f.cam_id || f.id || f.ID || f.Name || f.name || '';
    const name = f.asset_name || f.Asset_Name || f['Asset Name'] || f.eng_name || f.Name || f.name || code;
    const holder = f.holder || f.Holder || f.thai_name || f.user || f.User || '';
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

    let rawX = f.x != null && f.x !== '' ? f.x : (f.X != null && f.X !== '' ? f.X : (f.pos_x != null ? f.pos_x : null));
    let rawY = f.y != null && f.y !== '' ? f.y : (f.Y != null && f.Y !== '' ? f.Y : (f.pos_y != null ? f.pos_y : null));
    let numX = rawX != null ? parseFloat(rawX) : null;
    let numY = rawY != null ? parseFloat(rawY) : null;
    if (numX != null && isNaN(numX)) numX = null;
    if (numY != null && isNaN(numY)) numY = null;
    if (numX != null && numY != null && numX > 0 && numX <= 1 && numY > 0 && numY <= 1) {
      numX = Math.round(numX * 10000) / 100;
      numY = Math.round(numY * 10000) / 100;
    }

    let devMapId = '1';
    if (Array.isArray(f.map_id) && f.map_id.length > 0) devMapId = String(f.map_id[0]);
    else if (Array.isArray(f.map) && f.map.length > 0) devMapId = String(f.map[0]);
    else if (Array.isArray(f.Map) && f.Map.length > 0) devMapId = String(f.Map[0]);
    else if (f.map_id != null && f.map_id !== '') devMapId = String(f.map_id);
    else if (f.map != null && f.map !== '') devMapId = String(f.map);
    else if (f.Map != null && f.Map !== '') devMapId = String(f.Map);
    else if (f['Map ID'] != null && f['Map ID'] !== '') devMapId = String(f['Map ID']);
    else if (f.map_name != null && f.map_name !== '') devMapId = String(f.map_name);

    let rawHolder = f.holder || f.Holder || f.thai_name || f.user || f.User || f['ผู้ถือครอง'] || f['ชื่อผู้ใช้'] || '';
    if (Array.isArray(rawHolder)) {
      rawHolder = rawHolder.length > 0 ? (typeof rawHolder[0] === 'object' && rawHolder[0].name ? rawHolder[0].name : String(rawHolder[0])) : '';
    }
    const holder = String(rawHolder || '').trim();

    let rawDept = f.department || f.Department || f.dept || f.Dept || f.group || f['แผนก'] || f['ชื่อแผนก'] || '';
    if (Array.isArray(rawDept)) {
      rawDept = rawDept.length > 0 ? (typeof rawDept[0] === 'object' && rawDept[0].name ? rawDept[0].name : String(rawDept[0])) : '';
    }
    const devDept = String(rawDept || '').trim();

    return {
      ...f,
      asset_code: String(code),
      account_no: String(code),
      id: String(code),
      asset_name: String(name),
      eng_name: String(name),
      holder: holder,
      thai_name: holder,
      type: f.type || f.Type || 'Other',
      status: f.status || f.Status || 'Active',
      brand: f.brand || f.Brand || '',
      model: f.model || f.Model || '',
      serial: f.serial || f.Serial || f.serial_number || '',
      department: devDept,
      ip: f.ip || f.IP || f.ip_address || '',
      mac_address: f.mac_address || f.MAC || f.mac || '',
      image: img,
      image_url: img,
      go2rtc_link: img,
      map_id: String(devMapId),
      x: numX,
      y: numY
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
    const mapId = f.map_id != null && f.map_id !== '' ? f.map_id : (f['Map ID'] != null ? f['Map ID'] : (f.id != null ? f.id : '1'));
    return {
      ...f,
      map_id: String(mapId),
      map_name: f.map_name || f['Map Name'] || f.Name || f.name || `แผนผัง ${mapId}`,
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

  if (t === 'department' || t === 'departments') {
    let deptName = f.department || f.Department || f.dept || f.Dept || f.Name || f.name || f['แผนก'] || f['ชื่อแผนก'] || '';
    if (!deptName && typeof f === 'object') {
      const vals = Object.values(f).filter(v => typeof v === 'string' && v.trim() && !v.startsWith('http') && !v.startsWith('rec'));
      if (vals.length > 0) deptName = vals[0];
    }
    return {
      ...f,
      department: String(deptName).trim(),
      Name: String(deptName).trim()
    };
  }

  return f;
}

async function inspectBaseTables(baseId, token) {
  try {
    const res = await fetch(`${AIRTABLE_API_ROOT}/meta/bases/${baseId}/tables`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(data.tables)) {
      return { ok: true, tables: data.tables };
    }
    return { ok: false, status: res.status, error: data.error };
  } catch (err) {
    return { ok: false, error: { message: err.message } };
  }
}

// Fetch all records with pagination support and fallback across candidate table names
async function fetchAllRecords(baseId, token, candidateTables, sortField, requestedTable) {
  let lastError = null;
  let firstAttempt = null;

  for (const tableName of candidateTables) {
    let records = [];
    let offset = null;
    let success = true;

    do {
      let url = `${AIRTABLE_API_ROOT}/${baseId}/${encodeURIComponent(tableName)}?pageSize=100`;
      if (offset) url += `&offset=${encodeURIComponent(offset)}`;

      try {
        const res = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        const data = await res.json().catch(() => ({}));

        if (!firstAttempt) {
          firstAttempt = { tableName, status: res.status, error: data.error || null };
        }

        if (res.status === 404 || res.status === 403) {
          lastError = data.error || { message: `Airtable API error ${res.status}` };
          success = false;
          break;
        }

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

  // If candidate tables failed, attempt automatic discovery via Airtable base schema
  if (requestedTable) {
    const meta = await inspectBaseTables(baseId, token);
    if (meta.ok && Array.isArray(meta.tables) && meta.tables.length > 0) {
      const tableNames = meta.tables.map(t => t.name);
      const reqLower = requestedTable.toLowerCase();
      const matchedTable = meta.tables.find(t => {
        const n = t.name.toLowerCase();
        const fields = Array.isArray(t.fields) ? t.fields : [];
        if (reqLower.startsWith('map')) return n.includes('map') || n.includes('ผัง') || n.includes('แปลน') || fields.some(f => f.name.toLowerCase().includes('map'));
        if (reqLower.startsWith('device') || reqLower.startsWith('camera')) return n.includes('device') || n.includes('cam') || n.includes('asset') || fields.some(f => f.name.toLowerCase().includes('asset'));
        if (reqLower.startsWith('user')) return n.includes('user') || fields.some(f => f.name.toLowerCase() === 'password');
        if (reqLower.startsWith('department')) return n.includes('dept') || n.includes('แผนก') || fields.some(f => f.name.toLowerCase().includes('department'));
        return false;
      });

      if (matchedTable) {
        return await fetchAllRecords(baseId, token, [matchedTable.name, matchedTable.id], sortField, '');
      }

      return {
        ok: false,
        error: {
          type: 'TABLE_NOT_FOUND',
          message: `ไม่พบตาราง '${requestedTable}' ใน Base '${baseId}' (ตารางที่มีอยู่ใน Base ของคุณคือ: [${tableNames.join(', ')}])`
        }
      };
    }
  }

  // Use the error from the primary candidate attempt instead of masked meta error
  const finalErr = (firstAttempt && firstAttempt.error) || lastError || { message: 'Table not found in Airtable' };
  return { ok: false, error: finalErr, status: firstAttempt ? firstAttempt.status : 500 };
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

    // Auto-remove unknown field if Airtable rejects schema mismatch, with case-fallback for coordinates
    if (data.error && typeof data.error.message === 'string' && data.error.message.includes('Unknown field name:')) {
      const match = data.error.message.match(/Unknown field name:\s*["']([^"']+)["']/i);
      if (match && match[1]) {
        const rejected = match[1];
        if (rejected in payloadFields) {
          const val = payloadFields[rejected];
          delete payloadFields[rejected];
          if (rejected === 'x' && !('X' in payloadFields)) payloadFields['X'] = val;
          else if (rejected === 'y' && !('Y' in payloadFields)) payloadFields['Y'] = val;
          else if (rejected === 'X' && !('x' in payloadFields)) payloadFields['x'] = val;
          else if (rejected === 'Y' && !('y' in payloadFields)) payloadFields['y'] = val;
          continue;
        }
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

  // ─── DEBUG / STATUS CHECK ───
  if (table === 'debug' || query.action === 'debug') {
    const testTables = ['department', 'map', 'user', 'device'];
    const tableResults = {};

    for (const t of testTables) {
      try {
        const testRes = await fetch(`${AIRTABLE_API_ROOT}/${baseId}/${encodeURIComponent(t)}?pageSize=1`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const testData = await testRes.json().catch(() => ({}));
        tableResults[t] = {
          status: testRes.status,
          ok: testRes.ok,
          hasRecords: Array.isArray(testData.records) && testData.records.length > 0,
          sampleFields: testData.records && testData.records[0] ? Object.keys(testData.records[0].fields || {}) : [],
          error: testData.error || null
        };
      } catch (err) {
        tableResults[t] = { status: 500, ok: false, error: { message: err.message } };
      }
    }

    const anyOk = Object.values(tableResults).some(r => r.ok);
    const all403 = Object.values(tableResults).every(r => r.status === 403);
    const any404 = Object.values(tableResults).some(r => r.status === 404);

    return res.status(200).json({
      success: anyOk,
      baseId,
      all403,
      any404,
      tables: tableResults
    });
  }

  const candidateTables = getCandidateTables(table);

  // ─── GET ───
  if (req.method === 'GET') {
    const sortField = query.sort || null;
    const result = await fetchAllRecords(baseId, token, candidateTables, sortField, table);

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

      if (err.type === 'BASE_ACCESS_DENIED' || err.type === 'TABLE_NOT_FOUND') {
        msg = err.message;
      } else if (err.type === 'AUTHENTICATION_REQUIRED' || String(err.message).toLowerCase().includes('authentication required')) {
        msg = 'Airtable Token ไม่ถูกต้อง หรือหมดอายุ (Authentication required): กรุณาตรวจสอบ AIRTABLE_TOKEN ใน Vercel Environment Variables ว่าคัดลอกมาถูกต้องครบถ้วน และขึ้นต้นด้วย "pat..."';
      } else if (err.type === 'INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND' || String(err.message).includes('Invalid permissions')) {
        msg = `สิทธิ์ไม่ถูกต้อง หรือไม่พบ Base/Table (${candidateTables.slice(0, 4).join('/')}) กรุณาตรวจสอบ: 1) ใน airtable.com/create/tokens > แก้ไข Token > หัวข้อ Access ต้องกด '+ Add a base' ให้ Token เข้าถึง Base '${baseId}' 2) ตรวจสอบว่า AIRTABLE_BASE_ID (${baseId.slice(0, 6)}...) ถูกต้องหรือไม่ 3) ตาราง '${candidateTables[0]}' มีอยู่ใน Base หรือไม่`;
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
    if (table.toLowerCase().startsWith('department')) {
      if (preparedFields.department) {
        preparedFields.Name = preparedFields.department;
        preparedFields.Department = preparedFields.department;
      }
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
    if (table.toLowerCase().startsWith('department')) {
      if (preparedFields.department) {
        preparedFields.Name = preparedFields.department;
        preparedFields.Department = preparedFields.department;
      }
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
