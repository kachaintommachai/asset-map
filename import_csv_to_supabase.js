/**
 * Script นำเข้าไฟล์ CSV จากโฟลเดอร์ airtable_data เข้า Supabase
 * มีระบบ Auto-clean:
 * 1. ลบ BOM (\uFEFF) จากหัวไฟล์
 * 2. ลบสัญลักษณ์ ฿ และเครื่องหมายจุลภาคออกจากราคา
 * 3. แปลงรูปแบบวันที่ D/M/YYYY หรือ YYYY-MM-DD ให้เข้ากับ Postgres DATE
 * 4. Map ชื่อฟิลด์ให้ตรงกับ Table Schema ของ Supabase
 */

const fs = require('fs');
const path = require('path');

const CONFIG = {
  supabaseUrl: 'https://zfnfxbordtzapkkeqlte.supabase.co',
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || 'sb_publishable_OpjggLJTlGaiE3pXn8PMhA_m-x_9mLF',
  dataDir: path.join(__dirname, 'airtable_data')
};

// ฟังก์ชันแปลง CSV แบบรองรับ Comma ในเครื่องหมายคำพูด ""
function parseCSV(text) {
  // ลบ BOM
  const cleanText = text.replace(/^\uFEFF/, '').trim();
  const lines = cleanText.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];

  const parseLine = (line) => {
    const res = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === ',' && !inQuotes) {
        res.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    res.push(cur.trim());
    return res;
  };

  const headers = parseLine(lines[0]).map(h => h.replace(/^\uFEFF/, '').trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = parseLine(lines[i]);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = vals[j] !== undefined ? vals[j] : '';
    }
    rows.push(row);
  }
  return rows;
}

// แปลงรูปแบบวันที่ D/M/YYYY เป็น YYYY-MM-DD
function parseDate(rawDate) {
  if (!rawDate) return null;
  const str = String(rawDate).trim();
  if (!str) return null;

  // ถ้าเป็น YYYY-MM-DD อยู่แล้ว
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(str)) {
    return str.slice(0, 10);
  }

  // รูปแบบ D/M/YYYY
  const parts = str.split('/');
  if (parts.length === 3) {
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    let year = parts[2].trim();
    if (year.length > 4) year = year.slice(0, 4);
    // แปลง พ.ศ. เป็น ค.ศ. ถ้าปีเกิน 2500
    let yNum = parseInt(year, 10);
    if (yNum > 2400) yNum -= 543;
    return `${yNum}-${month}-${day}`;
  }

  return null;
}

// ล้างตัวเลขเงิน (เอา ฿ และ comma ออก)
function parseCost(rawCost) {
  if (!rawCost) return 0;
  const cleaned = String(rawCost).replace(/[฿,\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

// ยิงข้อมูลชุดละ (Batch) เข้า Supabase
async function sendToSupabase(table, rows) {
  if (rows.length === 0) return;
  const url = `${CONFIG.supabaseUrl}/rest/v1/${table}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': CONFIG.supabaseKey,
      'Authorization': `Bearer ${CONFIG.supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(rows)
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`   ❌ ข้อผิดพลาดที่ตาราง ${table} (${res.status}):`, errText);
  } else {
    console.log(`   ✨ บันทึก ${rows.length} รายการลง "${table}" สำเร็จ!`);
  }
}

async function run() {
  console.log('==================================================');
  console.log('🚀 เริ่มต้นการ Import ข้อมูลจาก CSV เข้า Supabase');
  console.log('==================================================\n');

  // 1. Department
  const deptFile = path.join(CONFIG.dataDir, 'departments.csv');
  if (fs.existsSync(deptFile)) {
    console.log('▶ กำลังนำเข้าตาราง: departments...');
    const raw = parseCSV(fs.readFileSync(deptFile, 'utf8'));
    const rows = raw.map(r => ({ department: (r.department || '').trim() })).filter(r => r.department);
    await sendToSupabase('departments', rows);
  }

  // 2. Site
  const siteFile = path.join(CONFIG.dataDir, 'site.csv');
  if (fs.existsSync(siteFile)) {
    console.log('▶ กำลังนำเข้าตาราง: site...');
    const raw = parseCSV(fs.readFileSync(siteFile, 'utf8'));
    const rows = raw.map(r => ({ name: (r.Name || r.name || '').trim() })).filter(r => r.name);
    await sendToSupabase('site', rows);
  }

  // 3. Map
  const mapFile = path.join(CONFIG.dataDir, 'map.csv');
  if (fs.existsSync(mapFile)) {
    console.log('▶ กำลังนำเข้าตาราง: map...');
    const raw = parseCSV(fs.readFileSync(mapFile, 'utf8'));
    const rows = raw.map(r => ({
      map_id: (r.map_id || '').trim(),
      map_name: r.map_name || '',
      map_pic: r.map_pic || ''
    })).filter(r => r.map_id);
    await sendToSupabase('map', rows);
  }

  // 4. Users
  const userFile = path.join(CONFIG.dataDir, 'user.csv');
  if (fs.existsSync(userFile)) {
    console.log('▶ กำลังนำเข้าตาราง: users...');
    const raw = parseCSV(fs.readFileSync(userFile, 'utf8'));
    const rows = raw.map(r => ({
      name: (r.Name || r.name || '').trim(),
      password: r.password || '',
      department: r.department || '',
      camera_user: r.camera_user || '',
      map_user: r.map_user || ''
    })).filter(r => r.name);
    await sendToSupabase('users', rows);
  }

  // 5. Device (IT Assets)
  const devFile = path.join(CONFIG.dataDir, 'device.csv');
  if (fs.existsSync(devFile)) {
    console.log('▶ กำลังนำเข้าตาราง: device...');
    const raw = parseCSV(fs.readFileSync(devFile, 'utf8'));
    const rows = raw.map(r => ({
      asset_code: (r.asset_code || '').trim() || null,
      asset_name: r.asset_name || '',
      holder: r.holder || '',
      type: r.type_ID || r.type || '',
      brand: r.brand || '',
      model: r.model || '',
      serial: r.serial || '',
      department: r.department || '',
      ip: r.ip || '',
      mac_address: r.mac_address || '',
      status: r.status || 'Active',
      image: r.image || '',
      map_id: (r.map_id || '').trim(),
      x: parseFloat(r.x) || 0,
      y: parseFloat(r.y) || 0,
      site: r.site || ''
    }));

    // บันทึกทีละชุด (Batch ละ 100 แถว)
    for (let i = 0; i < rows.length; i += 100) {
      await sendToSupabase('device', rows.slice(i, i + 100));
    }
  }

  // 6. Repair
  const repFile = path.join(CONFIG.dataDir, 'repair.csv');
  if (fs.existsSync(repFile)) {
    console.log('▶ กำลังนำเข้าตาราง: repair...');
    const raw = parseCSV(fs.readFileSync(repFile, 'utf8'));
    const rows = raw.map(r => ({
      asset_code: (r.asset_code || '').trim(),
      name: r.Name || '',
      type: r.type || 'ส่งซ่อม',
      date: parseDate(r.Date || r.date),
      cost: parseCost(r.Value || r.cost),
      vendor: r.vendor || '',
      invoice_no: r.invoice_no || '',
      description: r.description || '',
      status: 'Completed',
      created_by: r.created_by || ''
    }));

    // บันทึกทีละชุด (Batch ละ 100 แถว)
    for (let i = 0; i < rows.length; i += 100) {
      await sendToSupabase('repair', rows.slice(i, i + 100));
    }
  }

  console.log('\n==================================================');
  console.log('🎉 เสร็จสิ้นขั้นตอนการนำเข้าข้อมูล!');
  console.log('==================================================');
}

run();
