/**
 * Script สำหรับย้ายข้อมูลจาก Airtable ไปยัง Supabase (รวมย้ายรูปเข้า Supabase Storage)
 * 
 * วิธีใช้งาน:
 *   node migrate_to_supabase.js
 * 
 * หรือส่ง Environment Variables:
 *   AIRTABLE_PAT="patxxx" AIRTABLE_BASE_ID="appxxx" \
 *   SUPABASE_URL="https://xxx.supabase.co" SUPABASE_SERVICE_ROLE_KEY="eyxxx" \
 *   node migrate_to_supabase.js
 */

const fs = require('fs');
const path = require('path');

// ─── 1. ตั้งค่าการเชื่อมต่อ (แก้ไขตรงนี้ หรือใช้ ENV) ───
const CONFIG = {
  // ข้อมูล Airtable เดิม
  airtableToken: process.env.AIRTABLE_PAT || process.env.AIRTABLE_TOKEN || 'pattglEfSkFqs9edH',
  airtableBaseId: process.env.AIRTABLE_BASE_ID || 'appMcPT39UaFQCV1c',

  // ข้อมูล Supabase ปลายทาง (หาได้จาก Supabase -> Project Settings -> API)
  supabaseUrl: process.env.SUPABASE_URL || 'https://zfnfxbordtzapkkeqlte.supabase.co',
  // แนะนำให้ใช้ Service Role Key เพื่องาน Migration จะได้ข้ามข้อจำกัดสิทธิ์ RLS
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || 'sb_publishable_OpjggLJTlGaiE3pXn8PMhA_m-x_9mLF',

  // Storage Bucket สำหรับเก็บรูป (สร้างเป็น public bucket ไว้ใน Supabase Storage)
  storageBucket: 'asset_images',

  // รายชื่อตารางที่จะย้าย: { airtableTable: 'ชื่อบน Airtable', supabaseTable: 'ชื่อบน Supabase' }
  tablesToMigrate: [
    { airtable: 'department', supabase: 'department' },
    { airtable: 'map',        supabase: 'map' },
    { airtable: 'user',       supabase: 'users' },
    { airtable: 'device',     supabase: 'device' },
    { airtable: 'repair',     supabase: 'repair' },
    { airtable: 'site',       supabase: 'site' }
  ]
};

// ─── Helper Functions ───
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ดึงข้อมูลทั้งหมดจาก Airtable (รองรับ Pagination)
async function fetchAllAirtableRecords(tableName) {
  let records = [];
  let offset = null;
  const baseUrl = `https://api.airtable.com/v0/${CONFIG.airtableBaseId}/${encodeURIComponent(tableName)}`;

  console.log(`📥 กำลังดึงข้อมูลตาราง "${tableName}" จาก Airtable...`);

  do {
    let url = `${baseUrl}?pageSize=100`;
    if (offset) url += `&offset=${encodeURIComponent(offset)}`;

    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${CONFIG.airtableToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!res.ok) {
      const errText = await res.text();
      // ถ้าไม่มีตารางนี้ใน Airtable ให้ข้ามไป
      if (res.status === 404) {
        console.log(`   ⚠️ ไม่พบตาราง "${tableName}" ใน Airtable (ข้าม)`);
        return [];
      }
      throw new Error(`Airtable error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    records = records.concat(data.records || []);
    offset = data.offset;

    if (offset) await sleep(250); // กันติด Rate Limit ของ Airtable (5 requests/sec)
  } while (offset);

  console.log(`   ✅ พบทั้งหมด ${records.length} แถว`);
  return records;
}

// อัปโหลดไฟล์รูปเข้า Supabase Storage
async function uploadToSupabaseStorage(fileUrl, destFileName) {
  try {
    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) return null;

    const arrayBuffer = await fileRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = fileRes.headers.get('content-type') || 'image/jpeg';

    const uploadUrl = `${CONFIG.supabaseUrl}/storage/v1/object/${CONFIG.storageBucket}/${destFileName}`;
    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CONFIG.supabaseKey}`,
        'Content-Type': contentType,
        'x-upsert': 'true'
      },
      body: buffer
    });

    if (res.ok) {
      // คืนค่า Public URL ของรูปใน Supabase
      return `${CONFIG.supabaseUrl}/storage/v1/object/public/${CONFIG.storageBucket}/${destFileName}`;
    }
  } catch (err) {
    console.error(`   ❌ อัปโหลดรูป ${destFileName} ล้มเหลว:`, err.message);
  }
  return null;
}

// ดึง URL รูปจากฟิลด์ Airtable (Attachment Array หรือ String URL)
async function extractAndUploadImage(fieldValue, prefix) {
  if (!fieldValue) return '';

  let sourceUrl = '';
  let filename = `${prefix}_${Date.now()}.jpg`;

  if (Array.isArray(fieldValue) && fieldValue.length > 0) {
    sourceUrl = fieldValue[0].url || '';
    if (fieldValue[0].filename) {
      filename = `${prefix}_${fieldValue[0].filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    }
  } else if (typeof fieldValue === 'string' && fieldValue.startsWith('http')) {
    // ถ้าเป็นรูปที่ฝากไว้บน Cloudinary หรือ host อื่นอยู่แล้ว ไม่ต้องย้ายก็ได้
    if (fieldValue.includes('cloudinary.com') || fieldValue.includes('supabase.co')) {
      return fieldValue;
    }
    sourceUrl = fieldValue;
  }

  if (sourceUrl) {
    const newUrl = await uploadToSupabaseStorage(sourceUrl, filename);
    return newUrl || sourceUrl;
  }

  return '';
}

// แปลงรูปแบบฟิลด์ให้ตรงกับ Table ใน Supabase
async function mapRecordToSupabase(supabaseTable, airtableRec) {
  const f = airtableRec.fields || {};

  if (supabaseTable === 'device') {
    const assetCode = (f.asset_code || f.account_no || f.id || '').trim();
    let imgUrl = f.image || '';
    if (Array.isArray(f.image) || (typeof f.image === 'string' && f.image.startsWith('http'))) {
      imgUrl = await extractAndUploadImage(f.image, `dev_${assetCode || 'pic'}`);
    }

    return {
      asset_code: assetCode || null,
      asset_name: f.asset_name || f.thai_name || f.eng_name || '',
      holder: f.holder || '',
      type: f.type || '',
      brand: f.brand || '',
      model: f.model || '',
      serial: f.serial || '',
      department: f.department || '',
      ip: f.ip || '',
      mac_address: f.mac_address || '',
      status: f.status || 'Active',
      image: imgUrl || '',
      map_id: String(f.map_id || ''),
      x: parseFloat(f.x) || 0,
      y: parseFloat(f.y) || 0,
      account_no: f.account_no || '',
      site: f.site || ''
    };
  }

  if (supabaseTable === 'repair') {
    let imgUrl = f.image || '';
    if (Array.isArray(f.image) || (typeof f.image === 'string' && f.image.startsWith('http'))) {
      imgUrl = await extractAndUploadImage(f.image, `repair_${airtableRec.id}`);
    }

    let dateVal = f.date || f.event_date || (new Date()).toISOString().slice(0, 10);
    if (typeof dateVal === 'string' && dateVal.length >= 10) dateVal = dateVal.slice(0, 10);

    return {
      asset_code: f.asset_code || f.code || '',
      name: f.name || f.Name || f.title || '',
      device_name: f.device_name || f.asset_name || '',
      type: f.type || f.event_type || 'ส่งซ่อม',
      date: dateVal,
      cost: parseFloat(f.cost) || 0,
      vendor: f.vendor || '',
      invoice_no: f.invoice_no || f.doc_no || '',
      description: f.description || f.detail || '',
      status: f.status || 'Completed',
      image: imgUrl || '',
      created_by: f.created_by || ''
    };
  }

  if (supabaseTable === 'map') {
    let picUrl = f.map_pic || f.map_url || '';
    if (Array.isArray(f.map_pic) || (typeof f.map_pic === 'string' && f.map_pic.startsWith('http'))) {
      picUrl = await extractAndUploadImage(f.map_pic, `map_${f.map_id || 'pic'}`);
    }
    return {
      map_id: String(f.map_id || '').trim(),
      map_name: f.map_name || '',
      map_pic: picUrl || ''
    };
  }

  if (supabaseTable === 'department') {
    return {
      department: String(f.department || f.name || '').trim()
    };
  }

  if (supabaseTable === 'users') {
    return {
      name: String(f.Name || f.name || '').trim(),
      password: String(f.password || ''),
      department: f.department || '',
      camera_user: f.camera_user ? String(f.camera_user) : '',
      map_user: f.map_user ? String(f.map_user) : ''
    };
  }

  if (supabaseTable === 'site') {
    return {
      name: String(f.name || f.site || '').trim()
    };
  }

  return f;
}

// ยิงข้อมูลชุดละ (Batch) เข้า Supabase REST API
async function insertBatchToSupabase(tableName, rows) {
  if (rows.length === 0) return;

  const url = `${CONFIG.supabaseUrl}/rest/v1/${tableName}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CONFIG.supabaseKey}`,
      'apikey': CONFIG.supabaseKey,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal' // หรือ 'resolution=merge-duplicates' ถ้าต้องการ upsert
    },
    body: JSON.stringify(rows)
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`   ❌ บันทึกข้อมูลลง "${tableName}" ล้มเหลว (${res.status}):`, errText);
  } else {
    console.log(`   ✨ บันทึก ${rows.length} รายการลง "${tableName}" เรียบร้อยแล้ว`);
  }
}

// ─── Main Execution ───
async function runMigration() {
  console.log('==================================================');
  console.log('🚀 เริ่มต้นการย้ายข้อมูล Airtable -> Supabase');
  console.log('==================================================\n');

  if (CONFIG.airtableToken.includes('YOUR_') || CONFIG.supabaseUrl.includes('YOUR_')) {
    console.error('⚠️ กรุณาระบุ AIRTABLE_TOKEN, AIRTABLE_BASE_ID, SUPABASE_URL และ SUPABASE_KEY ให้ถูกต้อง');
    process.exit(1);
  }

  for (const item of CONFIG.tablesToMigrate) {
    try {
      console.log(`\n▶ ตาราง: ${item.airtable} ➔ ${item.supabase}`);
      const airtableRecords = await fetchAllAirtableRecords(item.airtable);
      if (airtableRecords.length === 0) continue;

      const preparedRows = [];
      for (let i = 0; i < airtableRecords.length; i++) {
        const row = await mapRecordToSupabase(item.supabase, airtableRecords[i]);
        if (row) preparedRows.push(row);
      }

      // บันทึกทีละชุด (batch ละ 100 แถว)
      const BATCH_SIZE = 100;
      for (let i = 0; i < preparedRows.length; i += BATCH_SIZE) {
        const chunk = preparedRows.slice(i, i + BATCH_SIZE);
        await insertBatchToSupabase(item.supabase, chunk);
      }
    } catch (err) {
      console.error(`❌ เกิดข้อผิดพลาดกับตาราง ${item.airtable}:`, err.message);
    }
  }

  console.log('\n==================================================');
  console.log('🎉 ย้ายข้อมูลเสร็จสมบูรณ์เรียบร้อยแล้ว!');
  console.log('==================================================');
}

runMigration();
