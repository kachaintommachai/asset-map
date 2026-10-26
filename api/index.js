// Vercel Serverless Function Proxy for Supabase API
// Drop-in replacement for api.php and Airtable on Vercel

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// ─── Supabase Config ───
function getSupabaseConfig() {
  const url = (process.env.SUPABASE_URL || 'https://zfnfxbordtzapkkeqlte.supabase.co').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || 'sb_publishable_OpjggLJTlGaiE3pXn8PMhA_m-x_9mLF').trim();
  return { url, key };
}

// ─── Cloudinary Config & Upload Helper ───
function getCloudinaryConfig() {
  let cloudName = (process.env.CLOUDINARY_CLOUD_NAME || '').trim();
  const apiKey    = (process.env.CLOUDINARY_API_KEY    || '').trim();
  const apiSecret = (process.env.CLOUDINARY_API_SECRET || '').trim();
  const uploadPreset = (process.env.CLOUDINARY_UPLOAD_PRESET || process.env.CLOUDINARY_PRESET || '').trim();

  if (cloudName.toLowerCase() === 'asset_map' || cloudName.toLowerCase() === 'asset-map') {
    cloudName = 'ugkaemul';
  }

  return { cloudName, apiKey, apiSecret, uploadPreset };
}

async function uploadBase64ToCloudinary(dataUrl, folder) {
  const { cloudName, apiKey, apiSecret, uploadPreset } = getCloudinaryConfig();
  if (!cloudName) return '';

  const matches = dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) return '';

  const mimeType = matches[1];
  const buffer   = Buffer.from(matches[2], 'base64');
  const ext      = mimeType.split('/')[1] || 'jpg';
  const boundary = '----WebKitFormBoundary' + crypto.randomBytes(16).toString('hex');
  const CRLF     = '\r\n';

  function field(name, val) {
    return `--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}${val}${CRLF}`;
  }
  const epilogue = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);

  if (uploadPreset) {
    try {
      const preambleUnsigned = Buffer.from(
        field('upload_preset', uploadPreset) +
        (folder ? field('folder', folder) : '') +
        `--${boundary}${CRLF}Content-Disposition: form-data; name="file"; filename="upload.${ext}"${CRLF}Content-Type: ${mimeType}${CRLF}${CRLF}`
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

  if (!apiKey || !apiSecret) return '';

  const timestamp   = Math.floor(Date.now() / 1000).toString();
  const folderParam = folder || 'asset_map';
  const paramsToSign = `folder=${folderParam}&timestamp=${timestamp}${apiSecret}`;
  const signatureSha1 = crypto.createHash('sha1').update(paramsToSign).digest('hex');

  function buildBody(sig) {
    const preamble = Buffer.from(
      field('api_key', apiKey) +
      field('timestamp', timestamp) +
      field('folder', folderParam) +
      field('signature', sig) +
      `--${boundary}${CRLF}Content-Disposition: form-data; name="file"; filename="upload.${ext}"${CRLF}Content-Type: ${mimeType}${CRLF}${CRLF}`
    );
    return Buffer.concat([preamble, buffer, epilogue]);
  }

  try {
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
    if (res.ok && (data.secure_url || data.url)) {
      return data.secure_url || data.url;
    }
  } catch (_) {}

  return '';
}

// ─── Image Store in /tmp ───
const IMAGE_STORE_FILE = '/tmp/asset_images_store.json';
let inMemoryImages = {};

function loadImageStore() {
  try {
    if (fs.existsSync(IMAGE_STORE_FILE)) {
      inMemoryImages = JSON.parse(fs.readFileSync(IMAGE_STORE_FILE, 'utf8') || '{}');
    }
  } catch (_) {}
  return inMemoryImages;
}

function saveImageToStore(key, url) {
  if (!key || !url) return;
  loadImageStore();
  inMemoryImages[String(key).trim()] = url;
  try {
    fs.writeFileSync(IMAGE_STORE_FILE, JSON.stringify(inMemoryImages), 'utf8');
  } catch (_) {}
}

function getImageFromStore(key) {
  if (!key) return '';
  loadImageStore();
  return inMemoryImages[String(key).trim()] || '';
}

// Map Table Name to Supabase Table Name
function resolveSupabaseTable(tableName) {
  const t = (tableName || '').trim().toLowerCase();
  if (t === 'device' || t === 'devices' || t === 'camera' || t === 'cameras' || t === 'asset' || t === 'assets') return 'device';
  if (t === 'map' || t === 'maps') return 'map';
  if (t === 'department' || t === 'departments') return 'departments';
  if (t === 'user' || t === 'users') return 'users';
  if (t === 'type' || t === 'types') return 'type';
  if (t.startsWith('maint') || t.startsWith('repair') || t.startsWith('hist') || t.startsWith('purch') || t.startsWith('service')) return 'repair';
  if (t === 'site' || t === 'sites') return 'site';
  return t;
}

// Map Fields from Supabase row to Frontend Airtable-like format
function formatRow(tName, row) {
  if (!row) return null;
  const target = resolveSupabaseTable(tName);
  const id = row.id ? String(row.id) : (row.asset_code || row.map_id || row.department || row.name || '');

  let fields = { ...row };

  if (target === 'device') {
    fields = {
      asset_code: row.asset_code || '',
      asset_name: row.asset_name || '',
      thai_name: row.asset_name || '',
      eng_name: row.asset_name || '',
      holder: row.holder || '',
      type: row.type || '',
      type_ID: row.type || '',
      brand: row.brand || '',
      model: row.model || '',
      serial: row.serial || '',
      department: row.department || '',
      ip: row.ip || '',
      mac_address: row.mac_address || '',
      status: row.status || 'Active',
      image: row.image || '',
      image_url: row.image || '',
      map_id: row.map_id || '',
      x: row.x !== null ? Number(row.x) : 0,
      y: row.y !== null ? Number(row.y) : 0,
      account_no: row.account_no || '',
      site: row.site || ''
    };
  } else if (target === 'repair') {
    fields = {
      asset_code: row.asset_code || '',
      Name: row.name || '',
      name: row.name || '',
      device_name: row.device_name || '',
      type: row.type || 'ส่งซ่อม',
      date: row.date || '',
      Date: row.date || '',
      cost: row.cost !== null ? Number(row.cost) : 0,
      Value: row.cost !== null ? Number(row.cost) : 0,
      vendor: row.vendor || '',
      invoice_no: row.invoice_no || '',
      description: row.description || '',
      status: row.status || 'Completed',
      image: row.image || '',
      created_by: row.created_by || ''
    };
  } else if (target === 'map') {
    fields = {
      map_id: row.map_id || '',
      map_name: row.map_name || '',
      map_pic: row.map_pic || '',
      map_url: row.map_pic || '',
      site: row.site || ''
    };
  } else if (target === 'departments') {
    fields = {
      department: row.department || ''
    };
  } else if (target === 'users') {
    fields = {
      Name: row.name || '',
      name: row.name || '',
      password: row.password || '',
      department: row.department || '',
      camera_user: row.camera_user || '',
      map_user: row.map_user || ''
    };
  } else if (target === 'site') {
    fields = {
      Name: row.name || '',
      name: row.name || ''
    };
  } else if (target === 'type') {
    fields = {
      type_ID: row.type_id || '',
      type_id: row.type_id || '',
      category: row.category || 'hardware',
      discription: row.discription || '',
      description: row.discription || '',
      depreciation: row.depreciation != null ? Number(row.depreciation) : 0
    };
  }

  return { id, fields };
}

// Convert Frontend input payload to Supabase Database row
function preparePayloadForSupabase(tName, fields) {
  const target = resolveSupabaseTable(tName);
  const f = fields || {};

  if (target === 'device') {
    const payload = {};
    if (f.asset_code !== undefined) payload.asset_code = String(f.asset_code).trim();
    if (f.asset_name !== undefined) payload.asset_name = f.asset_name;
    if (f.thai_name !== undefined && !f.asset_name) payload.asset_name = f.thai_name;
    if (f.holder !== undefined) payload.holder = f.holder;
    if (f.type !== undefined) payload.type = f.type;
    if (f.type_ID !== undefined && !f.type) payload.type = f.type_ID;
    if (f.brand !== undefined) payload.brand = f.brand;
    if (f.model !== undefined) payload.model = f.model;
    if (f.serial !== undefined) payload.serial = f.serial;
    if (f.department !== undefined) payload.department = f.department;
    if (f.ip !== undefined) payload.ip = f.ip;
    if (f.mac_address !== undefined) payload.mac_address = f.mac_address;
    if (f.status !== undefined) payload.status = f.status;
    if (f.image !== undefined) payload.image = f.image;
    if (f.image_url !== undefined && !f.image) payload.image = f.image_url;
    if (f.map_id !== undefined) payload.map_id = String(f.map_id).trim();
    if (f.x !== undefined) payload.x = parseFloat(f.x) || 0;
    if (f.y !== undefined) payload.y = parseFloat(f.y) || 0;
    if (f.account_no !== undefined) payload.account_no = f.account_no;
    if (f.site !== undefined) payload.site = f.site;
    return payload;
  }

  if (target === 'repair') {
    const payload = {};
    if (f.asset_code !== undefined) payload.asset_code = String(f.asset_code).trim();
    if (f.Name !== undefined) payload.name = f.Name;
    if (f.name !== undefined) payload.name = f.name;
    if (f.device_name !== undefined) payload.device_name = f.device_name;
    if (f.type !== undefined) payload.type = f.type;
    if (f.date !== undefined || f.Date !== undefined) {
      let d = f.date || f.Date || '';
      if (typeof d === 'string' && d.length >= 10) d = d.slice(0, 10);
      payload.date = d || new Date().toISOString().slice(0, 10);
    }
    if (f.cost !== undefined || f.Value !== undefined) {
      const val = f.cost !== undefined ? f.cost : f.Value;
      const num = parseFloat(String(val).replace(/[฿,\s]/g, ''));
      payload.cost = isNaN(num) ? 0 : num;
    }
    if (f.vendor !== undefined) payload.vendor = f.vendor;
    if (f.invoice_no !== undefined) payload.invoice_no = f.invoice_no;
    if (f.description !== undefined) payload.description = f.description;
    if (f.status !== undefined) payload.status = f.status;
    if (f.image !== undefined) payload.image = f.image;
    if (f.created_by !== undefined) payload.created_by = f.created_by;
    return payload;
  }

  if (target === 'map') {
    const payload = {};
    if (f.map_id !== undefined) payload.map_id = String(f.map_id).trim();
    if (f.map_name !== undefined) payload.map_name = f.map_name;
    if (f.map_pic !== undefined) payload.map_pic = f.map_pic;
    if (f.map_url !== undefined && !f.map_pic) payload.map_pic = f.map_url;
    if (f.site !== undefined) payload.site = f.site;
    return payload;
  }

  if (target === 'departments') {
    return { department: String(f.department || f.name || '').trim() };
  }

  if (target === 'users') {
    const payload = {};
    if (f.Name !== undefined || f.name !== undefined) payload.name = String(f.Name || f.name).trim();
    if (f.password !== undefined) payload.password = String(f.password);
    if (f.department !== undefined) payload.department = f.department;
    if (f.camera_user !== undefined) payload.camera_user = String(f.camera_user);
    if (f.map_user !== undefined) payload.map_user = String(f.map_user);
    return payload;
  }

  if (target === 'site') {
    return { name: String(f.Name || f.name || '').trim() };
  }

  if (target === 'type') {
    const payload = {};
    const tId = f.type_id !== undefined ? f.type_id : (f.type_ID !== undefined ? f.type_ID : f.name);
    if (tId !== undefined) payload.type_id = String(tId).trim();
    if (f.category !== undefined) payload.category = String(f.category).toLowerCase().trim();
    if (f.discription !== undefined) payload.discription = String(f.discription).trim();
    if (f.description !== undefined && payload.discription === undefined) payload.discription = String(f.description).trim();
    if (f.depreciation !== undefined) payload.depreciation = parseFloat(f.depreciation) || 0;
    if (f.icon !== undefined) payload.icon = String(f.icon).trim();
    return payload;
  }

  return f;
}

// ─── Main API Handler ───
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { url: supabaseUrl, key: supabaseKey } = getSupabaseConfig();
  const query = req.query || {};
  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }

  // 1. Settings API
  const SETTINGS_STORE_FILE = '/tmp/asset_settings_store.json';
  if (query.action === 'save_settings') {
    try {
      let existing = {};
      if (fs.existsSync(SETTINGS_STORE_FILE)) {
        try { existing = JSON.parse(fs.readFileSync(SETTINGS_STORE_FILE, 'utf8') || '{}'); } catch (_) {}
      }
      const updated = { ...existing, ...body, updatedAt: new Date().toISOString() };
      fs.writeFileSync(SETTINGS_STORE_FILE, JSON.stringify(updated, null, 2), 'utf8');
      return res.status(200).json({ success: true, settings: updated });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (query.action === 'get_settings') {
    try {
      let settings = {};
      if (fs.existsSync(SETTINGS_STORE_FILE)) {
        try { settings = JSON.parse(fs.readFileSync(SETTINGS_STORE_FILE, 'utf8') || '{}'); } catch (_) {}
      }
      return res.status(200).json({ success: true, settings });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // 2. Image API
  if (query.action === 'save_image' || query.action === 'upload_image') {
    const key = (query.id || body.id || body.asset_code || body.code || '').trim();
    let img   = (body.image || body.image_url || body.dataUrl || '').trim();
    if (!key || !img) {
      return res.status(400).json({ error: 'Missing id or image payload' });
    }
    if (img.startsWith('data:')) {
      const cloudUrl = await uploadBase64ToCloudinary(img, 'asset_map/devices');
      if (cloudUrl) img = cloudUrl;
    }
    saveImageToStore(key, img);
    return res.status(200).json({ success: true, id: key, url: img });
  }

  if (query.action === 'get_image') {
    const key = (query.id || query.asset_code || '').trim();
    const img = getImageFromStore(key);
    return res.status(200).json({ id: key, image: img });
  }

  // 3. Batch Init API (โหลดทุกตารางใน Request เดียว)
  if (query.action === 'init') {
    const tableKeys = ['device', 'departments', 'map', 'repair', 'users', 'site', 'type'];
    const results = {};

    try {
      await Promise.all(tableKeys.map(async (t) => {
        const fetchUrl = `${supabaseUrl}/rest/v1/${t}?select=*`;
        const r = await fetch(fetchUrl, {
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`
          }
        });
        if (r.ok) {
          const list = await r.json();
          results[t] = {
            records: list.map(item => formatRow(t, item))
          };
        } else {
          results[t] = { records: [] };
        }
      }));

      // รองรับ fallback ชื่อ table แบบเก่า
      results['department'] = results['departments'];
      results['user'] = results['users'];

      return res.status(200).json({ ok: true, results });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to init tables: ' + err.message });
    }
  }

  // 4. Debug Action
  if (query.action === 'debug' || query.table === 'debug') {
    return res.status(200).json({
      supabaseUrl,
      supabaseConnected: !!supabaseUrl,
      time: new Date().toISOString()
    });
  }

  const requestedTable = query.table || body.table || '';
  if (!requestedTable) {
    return res.status(400).json({ error: 'Missing table parameter' });
  }

  const supabaseTable = resolveSupabaseTable(requestedTable);

  // ─── GET (Query records) ───
  if (req.method === 'GET') {
    let fetchUrl = `${supabaseUrl}/rest/v1/${supabaseTable}?select=*`;

    // Filter by specific ID or Asset Code
    if (query.id) {
      const rawId = query.id.trim();
      if (supabaseTable === 'device') {
        fetchUrl += `&asset_code=eq.${encodeURIComponent(rawId)}`;
      } else if (supabaseTable === 'map') {
        fetchUrl += `&or=(id.eq.${encodeURIComponent(rawId)},map_id.eq.${encodeURIComponent(rawId)})`;
      } else if (supabaseTable === 'departments') {
        fetchUrl += `&department=eq.${encodeURIComponent(rawId)}`;
      } else if (supabaseTable === 'site') {
        fetchUrl += `&name=eq.${encodeURIComponent(rawId)}`;
      } else {
        fetchUrl += `&id=eq.${encodeURIComponent(rawId)}`;
      }
    }

    try {
      const response = await fetch(fetchUrl, {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`
        }
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({ error: errText });
      }

      const rows = await response.json();
      const records = rows.map(r => formatRow(supabaseTable, r));

      return res.status(200).json({ records });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ─── POST (Create Record) ───
  if (req.method === 'POST') {
    let fields = body.fields || body;

    // แปลง Base64 รูปภาพถ้ามี
    const imgKeys = ['image_url', 'image', 'Image', 'photo', 'picture', 'map_url', 'map_pic'];
    for (const k of imgKeys) {
      if (fields[k] && typeof fields[k] === 'string' && fields[k].startsWith('data:image/')) {
        const folder = supabaseTable === 'map' ? 'asset_map/maps' : 'asset_map/devices';
        const cUrl = await uploadBase64ToCloudinary(fields[k], folder);
        if (cUrl) fields[k] = cUrl;
      }
    }

    const payload = preparePayloadForSupabase(supabaseTable, fields);
    const postUrl = `${supabaseUrl}/rest/v1/${supabaseTable}`;

    try {
      const response = await fetch(postUrl, {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({ error: errText });
      }

      const created = await response.json();
      const firstRow = Array.isArray(created) ? created[0] : created;
      const formatted = formatRow(supabaseTable, firstRow);

      return res.status(200).json({
        id: formatted.id,
        fields: formatted.fields
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ─── PATCH / PUT (Update Record) ───
  if (req.method === 'PATCH' || req.method === 'PUT') {
    const rawId = query.id || body.id;
    let fields = body.fields || body;

    // แปลง Base64 รูปภาพถ้ามี
    const imgKeys = ['image_url', 'image', 'Image', 'photo', 'picture', 'map_url', 'map_pic'];
    for (const k of imgKeys) {
      if (fields[k] && typeof fields[k] === 'string' && fields[k].startsWith('data:image/')) {
        const folder = supabaseTable === 'map' ? 'asset_map/maps' : 'asset_map/devices';
        const cUrl = await uploadBase64ToCloudinary(fields[k], folder);
        if (cUrl) fields[k] = cUrl;
      }
    }

    const payload = preparePayloadForSupabase(supabaseTable, fields);
    // ใส่ updated_at เฉพาะตารางที่มีคอลัมน์ updated_at (เช่น device, repair)
    if (supabaseTable === 'device' || supabaseTable === 'repair') {
      payload.updated_at = new Date().toISOString();
    }

    let patchUrl = `${supabaseUrl}/rest/v1/${supabaseTable}`;
    if (rawId) {
      if (supabaseTable === 'device') {
        patchUrl += `?asset_code=eq.${encodeURIComponent(rawId)}`;
      } else if (supabaseTable === 'map') {
        const isNumeric = /^\d+$/.test(rawId);
        patchUrl += isNumeric ? `?or=(id.eq.${encodeURIComponent(rawId)},map_id.eq.${encodeURIComponent(rawId)})` : `?map_id=eq.${encodeURIComponent(rawId)}`;
      } else if (supabaseTable === 'departments') {
        patchUrl += `?department=eq.${encodeURIComponent(rawId)}`;
      } else if (supabaseTable === 'site') {
        patchUrl += `?name=eq.${encodeURIComponent(rawId)}`;
      } else if (supabaseTable === 'type') {
        const isNumeric = /^\d+$/.test(rawId);
        patchUrl += isNumeric ? `?or=(id.eq.${encodeURIComponent(rawId)},type_id.eq.${encodeURIComponent(rawId)})` : `?type_id=eq.${encodeURIComponent(rawId)}`;
      } else {
        patchUrl += `?id=eq.${encodeURIComponent(rawId)}`;
      }
    } else {
      return res.status(400).json({ error: 'Missing record id for update' });
    }

    try {
      const response = await fetch(patchUrl, {
        method: 'PATCH',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({ error: errText });
      }

      const updated = await response.json();
      const firstRow = Array.isArray(updated) && updated.length > 0 ? updated[0] : payload;
      const formatted = formatRow(supabaseTable, firstRow);

      return res.status(200).json({
        id: formatted ? formatted.id : rawId,
        fields: formatted ? formatted.fields : fields
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ─── DELETE (Delete Record) ───
  if (req.method === 'DELETE') {
    const rawId = query.id;
    if (!rawId) {
      return res.status(400).json({ error: 'Missing record id for DELETE' });
    }

    let deleteUrl = `${supabaseUrl}/rest/v1/${supabaseTable}`;
    if (supabaseTable === 'device') {
      deleteUrl += `?asset_code=eq.${encodeURIComponent(rawId)}`;
    } else if (supabaseTable === 'map') {
      const isNumeric = /^\d+$/.test(rawId);
      deleteUrl += isNumeric ? `?or=(id.eq.${encodeURIComponent(rawId)},map_id.eq.${encodeURIComponent(rawId)})` : `?map_id=eq.${encodeURIComponent(rawId)}`;
    } else if (supabaseTable === 'departments') {
      deleteUrl += `?department=eq.${encodeURIComponent(rawId)}`;
    } else if (supabaseTable === 'site') {
      deleteUrl += `?name=eq.${encodeURIComponent(rawId)}`;
    } else if (supabaseTable === 'type') {
      const isNumeric = /^\d+$/.test(rawId);
      deleteUrl += isNumeric ? `?or=(id.eq.${encodeURIComponent(rawId)},type_id.eq.${encodeURIComponent(rawId)})` : `?type_id=eq.${encodeURIComponent(rawId)}`;
    } else {
      deleteUrl += `?id=eq.${encodeURIComponent(rawId)}`;
    }

    try {
      const response = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`
        }
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({ error: errText });
      }

      return res.status(200).json({ deleted: true, id: rawId });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed` });
};
