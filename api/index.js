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
  if (lower === 'device' || lower === 'devices') {
    return [
      'device', 'devices', 'Device', 'Devices', 'device.csv', 'Device.csv',
      'it_asset', 'it_assets', 'IT_Asset', 'IT_Assets', 'IT Asset', 'IT Assets',
      'camera', 'cameras', 'Camera', 'Cameras', 'camera.csv', 'Camera.csv',
      'asset', 'assets', 'Asset', 'Assets', 'asset.csv', 'Asset.csv',
      'อุปกรณ์', 'ทรัพย์สิน'
    ];
  }
  if (lower === 'camera' || lower === 'cameras') {
    return [
      'camera', 'cameras', 'Camera', 'Cameras', 'camera.csv', 'Camera.csv',
      'device', 'devices', 'Device', 'Devices', 'device.csv', 'Device.csv',
      'it_asset', 'it_assets', 'IT_Asset', 'IT_Assets',
      'asset', 'assets', 'Asset', 'Assets', 'asset.csv', 'Asset.csv',
      'กล้อง', 'อุปกรณ์'
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

function extractFieldValue(fields, candidates) {
  if (!fields || typeof fields !== 'object') return '';
  // 1. Direct key match
  for (const c of candidates) {
    if (fields[c] != null && String(fields[c]).trim() !== '') {
      return String(fields[c]).trim();
    }
  }
  // 2. Normalized key match (case-insensitive, ignores spaces, underscores, dashes)
  const norm = str => String(str).trim().toLowerCase().replace(/[\s_\-]+/g, '');
  const normCandidates = new Set(candidates.map(norm));
  for (const [k, v] of Object.entries(fields)) {
    if (v == null || String(v).trim() === '') continue;
    if (normCandidates.has(norm(k))) {
      return String(v).trim();
    }
  }
  return '';
}

function isLikelyDepartment(str) {
  if (!str || typeof str !== 'string') return false;
  const s = str.trim().toLowerCase();
  if (s.includes('ผลิต') || s.includes('แพคกิ้ง') || s.includes('สโตร์') || s.includes('บุคคล') || 
      s.includes('เครื่องกล') || s.includes('วัตถุดิบ') || s.includes('ห้องปฏิบัติการ') || s.includes('สารสนเทศ') ||
      s.includes('สิ่งแวดล้อม') || s.includes('ไอที') || s.includes('บัญชี') || s.includes('การเงิน') ||
      s.includes('จัดซื้อ') || s.includes('การตลาด') || s.includes('ขาย') || s.includes('คลัง') ||
      s.startsWith('แผนก') || s.startsWith('ฝ่าย') || s.startsWith('ส่วน')) {
    return true;
  }
  return false;
}

function normalizeFields(table, fields) {
  const t = (table || '').trim().toLowerCase();
  const f = { ...(fields || {}) };

  if (t === 'device' || t === 'devices' || t === 'camera' || t === 'cameras') {
    // 1. Extract department first so we can protect asset code from department contamination
    let rawDept = extractFieldValue(f, ['department', 'Department', 'dept', 'Dept', 'group', 'แผนก', 'ชื่อแผนก', 'ฝ่าย', 'หน่วยงาน']);
    if (Array.isArray(f.department)) {
      rawDept = f.department.length > 0 ? (typeof f.department[0] === 'object' && f.department[0].name ? f.department[0].name : String(f.department[0])) : '';
    }
    const devDept = String(rawDept || '').trim();

    // 2. Extract asset code strictly from code fields
    let code = extractFieldValue(f, [
      'asset_code', 'asset code', 'Asset Code', 'Asset_Code', 'Asset_code', 'asset-code',
      'รหัสทรัพย์สิน', 'รหัสอุปกรณ์', 'รหัสเครื่อง', 'รหัส', 'code', 'Code',
      'asset_no', 'account_no', 'cam_id'
    ]);

    // If code field matched but value is actually identical to department or is a department name, ignore it
    if (code && ((devDept && code.toLowerCase() === devDept.toLowerCase()) || isLikelyDepartment(code))) {
      code = '';
    }

    // Check id / ID if not an Airtable rec ID and not department
    if (!code) {
      const idVal = extractFieldValue(f, ['id', 'ID']);
      if (idVal && !idVal.startsWith('rec') && (!devDept || idVal.toLowerCase() !== devDept.toLowerCase()) && !isLikelyDepartment(idVal)) {
        code = idVal;
      }
    }

    // Check Name / name ONLY as last resort and only if it is NOT department
    if (!code) {
      const nameVal = extractFieldValue(f, ['Name', 'name']);
      if (nameVal && (!devDept || nameVal.toLowerCase() !== devDept.toLowerCase()) && !isLikelyDepartment(nameVal)) {
        code = nameVal;
      }
    }

    // Fallback search across fields: skip all non-code fields (including Thai department/name labels)
    if (!code && typeof f === 'object') {
      for (const [k, v] of Object.entries(f)) {
        const kLow = k.toLowerCase();
        const valStr = typeof v === 'string' ? v.trim() : '';
        if (!valStr) continue;
        if (kLow.includes('type') || kLow.includes('ประเภท') ||
            kLow.includes('status') || kLow.includes('สถานะ') ||
            kLow.includes('dept') || kLow.includes('แผนก') || kLow.includes('ฝ่าย') || kLow.includes('หน่วยงาน') || kLow.includes('กลุ่ม') || kLow.includes('group') ||
            kLow.includes('image') || kLow.includes('pic') || kLow.includes('รูป') || kLow.includes('ภาพ') ||
            kLow.includes('map') || kLow.includes('ผัง') || kLow.includes('แปลน') ||
            kLow.includes('ip') || kLow.includes('mac') ||
            kLow.includes('brand') || kLow.includes('ยี่ห้อ') ||
            kLow.includes('model') || kLow.includes('รุ่น') ||
            kLow.includes('serial') ||
            kLow.includes('holder') || kLow.includes('user') || kLow.includes('ผู้ใช้') || kLow.includes('ผู้ถือครอง') ||
            kLow.includes('name') || kLow.includes('ชื่อ') ||
            kLow.includes('note') || kLow.includes('หมายเหตุ')) {
          continue;
        }
        if (devDept && valStr.toLowerCase() === devDept.toLowerCase()) continue;
        if (isLikelyDepartment(valStr)) continue;

        code = valStr;
        break;
      }
    }

    // Final safety check
    if (code && ((devDept && code.toLowerCase() === devDept.toLowerCase()) || isLikelyDepartment(code))) {
      code = '';
    }

    const name = extractFieldValue(f, [
      'asset_name', 'asset name', 'Asset Name', 'Asset_Name', 'Asset_name', 'asset-name',
      'eng_name', 'thai_name', 'Name', 'name', 'ชื่ออุปกรณ์', 'ชื่อ'
    ]) || code;

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

    let rawHolder = extractFieldValue(f, ['holder', 'Holder', 'thai_name', 'user', 'User', 'ผู้ถือครอง', 'ชื่อผู้ใช้']);
    if (Array.isArray(f.holder)) {
      rawHolder = f.holder.length > 0 ? (typeof f.holder[0] === 'object' && f.holder[0].name ? f.holder[0].name : String(f.holder[0])) : '';
    }
    const holder = String(rawHolder || '').trim();

    const devType = extractFieldValue(f, ['type', 'Type', 'ประเภท']) || 'Other';
    const devStatus = extractFieldValue(f, ['status', 'Status', 'สถานะ']) || 'Active';
    const devBrand = extractFieldValue(f, ['brand', 'Brand', 'ยี่ห้อ']);
    const devModel = extractFieldValue(f, ['model', 'Model', 'รุ่น']);
    const devSerial = extractFieldValue(f, ['serial', 'Serial', 'serial_number', 'Serial Number']);
    const devIp = extractFieldValue(f, ['ip', 'IP', 'ip_address']);
    const devMac = extractFieldValue(f, ['mac_address', 'MAC', 'mac']);

    return {
      ...f,
      asset_code: String(code),
      account_no: String(code),
      id: String(code),
      Name: String(code || name),
      asset_name: String(name),
      eng_name: String(name),
      holder: holder,
      thai_name: holder,
      type: devType,
      status: devStatus,
      brand: devBrand,
      model: devModel,
      serial: devSerial,
      department: devDept,
      ip: devIp,
      mac_address: devMac,
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
      cachedWorkingTables[requestedTable.toLowerCase()] = tableName;
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
        if (reqLower.startsWith('device') || reqLower.startsWith('camera')) {
          if (n.includes('map') || n.includes('ผัง') || n.includes('แปลน')) return false;
          return n.includes('device') || n.includes('cam') || (n.includes('asset') && !n.includes('map')) || fields.some(f => f.name.toLowerCase().includes('asset') || f.name.toLowerCase().includes('serial') || f.name.toLowerCase().includes('ip'));
        }
        if (reqLower.startsWith('user')) return n.includes('user') || fields.some(f => f.name.toLowerCase() === 'password');
        if (reqLower.startsWith('department')) return n.includes('dept') || n.includes('แผนก') || fields.some(f => f.name.toLowerCase().includes('department'));
        return false;
      });

      if (matchedTable) {
        cachedWorkingTables[requestedTable.toLowerCase()] = matchedTable.name;
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

const cachedWorkingTables = {};

async function resolveWorkingTable(baseId, token, requestedTable) {
  const reqKey = (requestedTable || '').trim().toLowerCase();
  if (cachedWorkingTables[reqKey]) {
    return cachedWorkingTables[reqKey];
  }

  const candidates = getCandidateTables(requestedTable);
  for (const t of candidates) {
    try {
      const res = await fetch(`${AIRTABLE_API_ROOT}/${baseId}/${encodeURIComponent(t)}?pageSize=1`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        cachedWorkingTables[reqKey] = t;
        return t;
      }
    } catch (_) {}
  }

  const meta = await inspectBaseTables(baseId, token);
  if (meta.ok && Array.isArray(meta.tables) && meta.tables.length > 0) {
    const matched = meta.tables.find(t => {
      const n = t.name.toLowerCase();
      const fields = Array.isArray(t.fields) ? t.fields : [];
      if (reqKey.startsWith('map')) return n.includes('map') || n.includes('ผัง') || n.includes('แปลน') || fields.some(f => f.name.toLowerCase().includes('map'));
      if (reqKey.startsWith('device') || reqKey.startsWith('camera')) {
        if (n.includes('map') || n.includes('ผัง') || n.includes('แปลน')) return false;
        return n.includes('device') || n.includes('cam') || (n.includes('asset') && !n.includes('map')) || fields.some(f => f.name.toLowerCase().includes('asset') || f.name.toLowerCase().includes('serial') || f.name.toLowerCase().includes('ip'));
      }
      if (reqKey.startsWith('user')) return n.includes('user') || fields.some(f => f.name.toLowerCase() === 'password');
      if (reqKey.startsWith('department')) return n.includes('dept') || n.includes('แผนก') || fields.some(f => f.name.toLowerCase().includes('department'));
      return false;
    });
    if (matched) {
      cachedWorkingTables[reqKey] = matched.name;
      return matched.name;
    }
  }

  return candidates[0] || requestedTable;
}

const cachedTableSchemas = {};

async function discoverTableSchema(baseId, token, targetTable) {
  const key = targetTable.toLowerCase();
  if (cachedTableSchemas[key]) {
    return cachedTableSchemas[key];
  }

  // 1. Try meta inspectBaseTables if token has schema.bases:read scope
  try {
    const meta = await inspectBaseTables(baseId, token);
    if (meta && meta.ok && Array.isArray(meta.tables)) {
      const tableObj = meta.tables.find(tbl => tbl.name.toLowerCase() === key || tbl.id === targetTable);
      if (tableObj && Array.isArray(tableObj.fields) && tableObj.fields.length > 0) {
        const schema = {
          fields: tableObj.fields,
          primaryField: tableObj.fields[0] || null,
          fieldNames: tableObj.fields.map(f => f.name)
        };
        cachedTableSchemas[key] = schema;
        return schema;
      }
    }
  } catch (_) {}

  // 2. Query table directly for existing records to discover actual column names
  try {
    const res = await fetch(`${AIRTABLE_API_ROOT}/${baseId}/${encodeURIComponent(targetTable)}?pageSize=10`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.records) && data.records.length > 0) {
        const names = new Set();
        data.records.forEach(r => {
          if (r.fields && typeof r.fields === 'object') {
            Object.keys(r.fields).forEach(k => names.add(k));
          }
        });
        const fieldList = Array.from(names);
        if (fieldList.length > 0) {
          const schema = {
            fields: fieldList.map(name => ({ name, type: 'unknown' })),
            primaryField: { name: fieldList[0], type: 'unknown' },
            fieldNames: fieldList
          };
          cachedTableSchemas[key] = schema;
          return schema;
        }
      }
    }
  } catch (_) {}

  return null;
}

function findMatchingAirtableFieldName(availableFieldNames, candidateAliases) {
  if (!availableFieldNames || availableFieldNames.length === 0) return null;
  // 1. Exact match
  for (const cand of candidateAliases) {
    if (availableFieldNames.includes(cand)) return cand;
  }
  // 2. Normalized match (ignore spaces, underscores, dashes, lowercase)
  const norm = str => String(str).trim().toLowerCase().replace(/[\s_\-]+/g, '');
  const candidateNormMap = new Map();
  candidateAliases.forEach(c => candidateNormMap.set(norm(c), c));

  for (const realName of availableFieldNames) {
    const realNorm = norm(realName);
    if (candidateNormMap.has(realNorm)) {
      return realName;
    }
  }
  return null;
}

// Helper to write to Airtable with unknown field pruning retry
async function writeAirtableWithRetry(url, method, token, fields) {
  let payloadFields = { ...fields };
  const debugLog = [];

  if (method === 'POST') {
    for (const [k, v] of Object.entries(payloadFields)) {
      if (v === '' || v === null || v === undefined) {
        delete payloadFields[k];
      }
    }
  }

  debugLog.push({ attempt: 'initial', fields: Object.keys(payloadFields) });

  for (let attempt = 0; attempt < 30; attempt++) {
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
      return { ok: true, data, _debug: debugLog };
    }

    const errMsg = (data.error && typeof data.error.message === 'string') ? data.error.message : '';
    debugLog.push({ attempt, status: res.status, error: errMsg, fieldsAttempted: Object.keys(payloadFields) });

    if (errMsg) {
      // 1. Auto-remove unknown field
      if (errMsg.includes('Unknown field name:')) {
        const match = errMsg.match(/Unknown field name:\s*["']([^"']+)["']/i);
        if (match && match[1] && match[1] in payloadFields) {
          const rejected = match[1];
          const val = payloadFields[rejected];
          delete payloadFields[rejected];

          // If coordinates casing issue
          if (rejected === 'x' && !('X' in payloadFields)) payloadFields['X'] = val;
          else if (rejected === 'y' && !('Y' in payloadFields)) payloadFields['Y'] = val;
          else if (rejected === 'X' && !('x' in payloadFields)) payloadFields['x'] = val;
          else if (rejected === 'Y' && !('y' in payloadFields)) payloadFields['y'] = val;

          // If asset_code / code field was rejected because table uses Name as primary field
          // ALWAYS override Name with the code value (even if Name already exists)
          const rejNorm2 = rejected.trim().toLowerCase().replace(/[\s_\-]+/g, '');
          if ((rejNorm2 === 'assetcode' || rejected === 'รหัสทรัพย์สิน' || rejected === 'รหัสอุปกรณ์') && val) {
            payloadFields['Name'] = val;  // Override Name with asset code value
            debugLog.push({ action: 'overrideNameWithCode', rejected, val });
          }
          continue;
        }
      }

      // 2. Field cannot accept value (e.g. Field "xxx" cannot accept...)
      const fieldMatch = errMsg.match(/Field\s*["']([^"']+)["']/i) || errMsg.match(/["']([^"']+)["']\s*cannot accept/i);
      if (fieldMatch && fieldMatch[1] && (fieldMatch[1] in payloadFields)) {
        const rejected = fieldMatch[1];
        const val = payloadFields[rejected];

        // Linked record array conversion
        if ((rejected.toLowerCase().includes('map') || rejected.toLowerCase().includes('dept')) && typeof val === 'string') {
          payloadFields[rejected] = [val];
          continue;
        }

        // If asset_code was rejected (e.g. user defined column as Number or Formula in Airtable)
        const rejNorm = rejected.trim().toLowerCase().replace(/[\s_\-]+/g, '');
        if (rejNorm === 'assetcode') {
          delete payloadFields[rejected];
          // Always set Name = code value
          payloadFields['Name'] = val;
          debugLog.push({ action: 'assetcodeCannotAccept_overrideName', rejected, val });
          continue;
        }
        if (rejNorm === 'name') {
          return {
            ok: false,
            status: 422,
            data: {
              error: `คอลัมน์ "Name" ใน Airtable ไม่ยอมรับค่า "${val}" (${errMsg}) กรุณาตรวจสอบประเภทคอลัมน์ใน Airtable`,
              _debug: debugLog
            }
          };
        }

        delete payloadFields[rejected];
        continue;
      }

      // 3. Attachment decoding error
      if (errMsg.toLowerCase().includes('attachment')) {
        if ('image' in payloadFields) { delete payloadFields['image']; continue; }
        if ('map_pic' in payloadFields) { delete payloadFields['map_pic']; continue; }
        if ('image_url' in payloadFields) { delete payloadFields['image_url']; continue; }
      }

      // 4. Linked record error (e.g. Value is not an array of record IDs)
      if (errMsg.toLowerCase().includes('record id') || errMsg.toLowerCase().includes('linked')) {
        if ('map_id' in payloadFields) { delete payloadFields['map_id']; continue; }
        if ('map' in payloadFields) { delete payloadFields['map']; continue; }
        if ('department' in payloadFields) { delete payloadFields['department']; continue; }
      }
    }

    return { ok: false, status: res.status, data: { ...data, _debug: debugLog } };
  }

  return { ok: false, data: { error: 'Exceeded retry attempts for Airtable write', _debug: debugLog } };
}

// Helper to find record ID in Airtable if passed ID is not an Airtable rec ID
async function findAirtableRecordId(baseId, token, tableName, searchId) {
  if (typeof searchId === 'string' && searchId.startsWith('rec')) {
    return searchId;
  }

  try {
    const formula = `RECORD_ID()='${searchId}'`;
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

async function prepareFieldsForTable(baseId, token, table, targetTable, fields) {
  const t = (table || '').trim().toLowerCase();
  const raw = { ...(fields || {}) };

  const schema = await discoverTableSchema(baseId, token, targetTable);
  const availableNames = schema ? schema.fieldNames : null;
  const primaryField = schema ? schema.primaryField : null;

  if (t.startsWith('device') || t.startsWith('camera')) {
    const codeVal = raw.asset_code || raw['Asset Code'] || raw.Asset_Code || raw['รหัสทรัพย์สิน'] || raw['รหัสอุปกรณ์'] || raw['รหัส'] || raw.account_no || raw.cam_id || raw.code || (raw.id && !raw.id.startsWith('rec') ? raw.id : '') || (raw.Name && !isLikelyDepartment(raw.Name) ? raw.Name : '') || '';
    const nameVal = raw.asset_name || raw['Asset Name'] || raw.eng_name || codeVal;
    const holderVal = raw.holder || raw.Holder || raw.thai_name || '';
    const typeVal = raw.type || raw.Type || 'Other';
    const statusVal = raw.status || raw.Status || 'Active';
    const deptVal = raw.department || raw.Department || '';
    const mapVal = raw.map_id || raw['Map ID'] || raw.map || '';
    const brandVal = raw.brand || raw.Brand || '';
    const modelVal = raw.model || raw.Model || '';
    const serialVal = raw.serial || raw.Serial || raw.serial_number || '';
    const ipVal = raw.ip || raw.IP || '';
    const macVal = raw.mac_address || raw.MAC || raw.mac || '';
    const imgVal = raw.image_url || raw.image || raw.go2rtc_link || '';
    const xVal = raw.x != null && raw.x !== '' ? (parseFloat(raw.x) || 0) : null;
    const yVal = raw.y != null && raw.y !== '' ? (parseFloat(raw.y) || 0) : null;

    const result = {
      asset_code: codeVal,
      Name: codeVal || nameVal,
      asset_name: nameVal,
      holder: holderVal,
      type: typeVal,
      status: statusVal
    };
    if (deptVal) result.department = deptVal;
    if (mapVal) result.map_id = mapVal;
    if (brandVal) result.brand = brandVal;
    if (modelVal) result.model = modelVal;
    if (serialVal) result.serial = serialVal;
    if (ipVal) result.ip = ipVal;
    if (macVal) result.mac_address = macVal;
    if (imgVal) result.image_url = imgVal;
    if (xVal != null) result.x = xVal;
    if (yVal != null) result.y = yVal;

    if (availableNames && availableNames.length > 0) {
      const codeCol = findMatchingAirtableFieldName(availableNames, ['asset_code', 'asset code', 'Asset Code', 'Asset_Code', 'รหัสทรัพย์สิน', 'รหัสอุปกรณ์', 'รหัสเครื่อง', 'รหัส', 'code', 'account_no', 'cam_id', 'id', 'Name']);
      const nameCol = findMatchingAirtableFieldName(availableNames, ['asset_name', 'asset name', 'Asset Name', 'Asset_Name', 'eng_name', 'thai_name', 'Name', 'name', 'ชื่ออุปกรณ์', 'ชื่อ']);
      const holderCol = findMatchingAirtableFieldName(availableNames, ['holder', 'Holder', 'thai_name', 'user', 'ผู้ถือครอง', 'ชื่อผู้ใช้']);
      const typeCol = findMatchingAirtableFieldName(availableNames, ['type', 'Type', 'ประเภท']);
      const statusCol = findMatchingAirtableFieldName(availableNames, ['status', 'Status', 'สถานะ']);
      const deptCol = findMatchingAirtableFieldName(availableNames, ['department', 'Department', 'dept', 'Dept', 'แผนก', 'ชื่อแผนก', 'ฝ่าย']);
      const mapCol = findMatchingAirtableFieldName(availableNames, ['map_id', 'Map ID', 'map', 'Map', 'ผัง']);
      const brandCol = findMatchingAirtableFieldName(availableNames, ['brand', 'Brand', 'ยี่ห้อ']);
      const modelCol = findMatchingAirtableFieldName(availableNames, ['model', 'Model', 'รุ่น']);
      const serialCol = findMatchingAirtableFieldName(availableNames, ['serial', 'Serial', 'serial_number', 'Serial Number']);
      const ipCol = findMatchingAirtableFieldName(availableNames, ['ip', 'IP', 'ip_address']);
      const macCol = findMatchingAirtableFieldName(availableNames, ['mac_address', 'mac', 'MAC']);
      const imgCol = findMatchingAirtableFieldName(availableNames, ['image_url', 'image', 'go2rtc_link', 'map_pic']);
      const xCol = findMatchingAirtableFieldName(availableNames, ['x', 'X', 'pos_x']);
      const yCol = findMatchingAirtableFieldName(availableNames, ['y', 'Y', 'pos_y']);

      if (codeCol && codeCol !== 'asset_code' && codeVal) result[codeCol] = codeVal;
      if (nameCol && nameCol !== 'asset_name' && nameVal) result[nameCol] = nameVal;
      if (holderCol && holderCol !== 'holder' && holderVal) result[holderCol] = holderVal;
      if (typeCol && typeCol !== 'type' && typeVal) result[typeCol] = typeVal;
      if (statusCol && statusCol !== 'status' && statusVal) result[statusCol] = statusVal;
      if (deptCol && deptCol !== 'department' && deptVal) result[deptCol] = deptVal;
      if (mapCol && mapCol !== 'map_id' && mapVal) result[mapCol] = mapVal;
      if (brandCol && brandCol !== 'brand' && brandVal) result[brandCol] = brandVal;
      if (modelCol && modelCol !== 'model' && modelVal) result[modelCol] = modelVal;
      if (serialCol && serialCol !== 'serial' && serialVal) result[serialCol] = serialVal;
      if (ipCol && ipCol !== 'ip' && ipVal) result[ipCol] = ipVal;
      if (macCol && macCol !== 'mac_address' && macVal) result[macCol] = macVal;
      if (imgCol && imgCol !== 'image_url' && imgVal) result[imgCol] = imgVal;
      if (xCol && xCol !== 'x' && xVal != null) result[xCol] = xVal;
      if (yCol && yCol !== 'y' && yVal != null) result[yCol] = yVal;

      // Always populate Name column if present in table
      const nameColExplicit = availableNames.find(n => n.trim().toLowerCase() === 'name');
      if (nameColExplicit && !result[nameColExplicit]) {
        result[nameColExplicit] = codeVal || nameVal;
      }
      if (primaryField && primaryField.name && !result[primaryField.name]) {
        result[primaryField.name] = codeVal || nameVal;
      }
    }

    return result;
  }

  if (t.startsWith('department')) {
    const deptName = raw.department || raw.Department || raw.Name || raw.name || '';
    if (availableNames && availableNames.length > 0) {
      const result = {};
      const deptCol = findMatchingAirtableFieldName(availableNames, ['department', 'Department', 'dept', 'Dept', 'Name', 'name', 'แผนก']);
      if (deptCol && deptName) result[deptCol] = deptName;
      if (primaryField && primaryField.name && !result[primaryField.name] && deptName) {
        result[primaryField.name] = deptName;
      }
      return result;
    }
    const fallback = { ...raw };
    if (deptName) {
      fallback.department = deptName;
      fallback.Department = deptName;
      fallback.Name = deptName;
      fallback.name = deptName;
    }
    return fallback;
  }

  if (t.startsWith('map')) {
    const mapName = raw.map_name || raw['Map Name'] || raw.Name || raw.name || '';
    const mapId = raw.map_id || raw['Map ID'] || raw.id || '';
    const mapPic = raw.map_pic || raw.map_url || raw.image || '';

    if (availableNames && availableNames.length > 0) {
      const result = {};
      const nameCol = findMatchingAirtableFieldName(availableNames, ['map_name', 'Map Name', 'Name', 'name', 'ชื่อแผนผัง']);
      const idCol = findMatchingAirtableFieldName(availableNames, ['map_id', 'Map ID', 'id', 'ID']);
      const picCol = findMatchingAirtableFieldName(availableNames, ['map_pic', 'map_url', 'image', 'ภาพ']);
      if (nameCol && mapName) result[nameCol] = mapName;
      if (idCol && mapId) result[idCol] = mapId;
      if (picCol && mapPic) result[picCol] = mapPic;
      if (primaryField && primaryField.name && !result[primaryField.name] && mapName) {
        result[primaryField.name] = mapName;
      }
      return result;
    }

    const fallback = { ...raw };
    if (mapName) {
      fallback.map_name = mapName;
      fallback.Name = mapName;
    }
    return fallback;
  }

  return raw;
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
    const testTables = ['device', 'devices', 'camera', 'cameras', 'map', 'maps', 'asset_map', 'cctv_map', 'department', 'departments', 'user', 'users'];
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

    let activeDeviceTable = 'unknown';
    let activeMapTable = 'unknown';
    try {
      activeDeviceTable = await resolveWorkingTable(baseId, token, 'device');
      activeMapTable = await resolveWorkingTable(baseId, token, 'map');
    } catch (_) {}

    let baseSchemaTables = [];
    try {
      const meta = await inspectBaseTables(baseId, token);
      if (meta && meta.ok && Array.isArray(meta.tables)) {
        baseSchemaTables = meta.tables.map(tbl => tbl.name);
      }
    } catch (_) {}

    return res.status(200).json({
      success: anyOk,
      baseId,
      activeDeviceTable,
      activeMapTable,
      baseSchemaTables,
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

  // ─── DRYRUN (Preview fields without writing to Airtable) ───
  if (query.action === 'dryrun') {
    const targetTable = await resolveWorkingTable(baseId, token, table);
    const dryFields = body.fields || body || {};
    const preparedFields = await prepareFieldsForTable(baseId, token, table, targetTable, dryFields);
    return res.status(200).json({
      dryrun: true,
      targetTable,
      baseId,
      preparedFields,
      rawInput: dryFields
    });
  }

  // ─── POST (Create Record) ───
  if (req.method === 'POST') {
    const targetTable = await resolveWorkingTable(baseId, token, table);
    const preparedFields = await prepareFieldsForTable(baseId, token, table, targetTable, fields);

    const postUrl = `${AIRTABLE_API_ROOT}/${baseId}/${encodeURIComponent(targetTable)}`;
    const writeResult = await writeAirtableWithRetry(postUrl, 'POST', token, preparedFields);

    if (!writeResult.ok) {
      return res.status(writeResult.status || 500).json(writeResult.data);
    }

    return res.status(200).json({
      id: writeResult.data.id,
      fields: normalizeFields(table, { ...(fields || {}), ...(writeResult.data.fields || {}) }),
      targetTable: targetTable,
      baseId: baseId,
      _debug: writeResult._debug
    });
  }

  // ─── PATCH (Update Record) ───
  if (req.method === 'PATCH') {
    const rawId = query.id || body.id;
    if (!rawId) {
      return res.status(400).json({ error: 'Missing record id for PATCH' });
    }

    const targetTable = await resolveWorkingTable(baseId, token, table);
    const realRecordId = await findAirtableRecordId(baseId, token, targetTable, rawId);
    const preparedFields = await prepareFieldsForTable(baseId, token, table, targetTable, fields);

    const patchUrl = `${AIRTABLE_API_ROOT}/${baseId}/${encodeURIComponent(targetTable)}/${encodeURIComponent(realRecordId)}`;
    const writeResult = await writeAirtableWithRetry(patchUrl, 'PATCH', token, preparedFields);

    if (!writeResult.ok) {
      return res.status(writeResult.status || 500).json(writeResult.data);
    }

    return res.status(200).json({
      id: writeResult.data.id,
      fields: normalizeFields(table, { ...(fields || {}), ...(writeResult.data.fields || {}) }),
      targetTable: targetTable,
      baseId: baseId,
      _debug: writeResult._debug
    });
  }

  // ─── DELETE (Delete Record) ───
  if (req.method === 'DELETE') {
    const rawId = query.id;
    if (!rawId) {
      return res.status(400).json({ error: 'Missing record id for DELETE' });
    }

    const targetTable = await resolveWorkingTable(baseId, token, table);
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
