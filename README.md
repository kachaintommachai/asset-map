# IT Asset Map - ระบบแผนผังทรัพย์สินสารสนเทศ (IT Asset Mapping System)

ระบบบริหารจัดการและแสดงตำแหน่งทรัพย์สิน/อุปกรณ์ไอที (PC, Notebook, Printer, Server, Network Switch, Router/AP, UPS, Camera ฯลฯ) บนแผนผังอาคารและแผนที่ชั้นต่างๆ พร้อมระบบจัดการสิทธิ์ผู้ใช้งานตามแผนก และเชื่อมต่อข้อมูลกับ **Supabase**

---

## 📁 โครงสร้างตารางและไฟล์ข้อมูลใน Supabase

| ตาราง Supabase | รายละเอียด | คอลัมน์สำคัญ |
|---|---|---|
| **`device`** | ข้อมูลอุปกรณ์และทรัพย์สินไอที | `asset_code`, `asset_name`, `holder`, `type`, `brand`, `model`, `serial`, `department`, `ip`, `mac_address`, `status`, `image`, `map_id`, `x`, `y`, `site`, `category` |
| **`map`** | แผนผังชั้น/อาคาร/ห้อง | `map_id`, `map_name`, `map_pic`, `site` |
| **`departments`** | รายชื่อแผนก/หน่วยงาน | `department` |
| **`users`** | บัญชีผู้ใช้งานและสิทธิ์แผนก/ผัง | `name`, `password`, `department`, `camera_user`, `map_user`, `site` |
| **`repair`** | ประวัติการซื้อ/การซ่อมบำรุง | `asset_code`, `name`, `type`, `date`, `cost`, `vendor`, `invoice_no`, `description`, `status` |
| **`type`** | ประเภทอุปกรณ์และค่าเสื่อม | `type_id`, `category`, `discription`, `depreciation` |
| **`site`** | สาขา / ไซต์ | `name` |

---

## 🛠️ รายละเอียดคอลัมน์ใน `device` (IT Asset)

คอลัมน์ทั้งหมดได้รับการปรับปรุงให้ตรงตามมาตรฐานการบันทึกข้อมูลทรัพย์สินไอที:

1. **`asset_code`**: รหัสทรัพย์สิน / รหัสอุปกรณ์ (เช่น `PC-001`, `NB-IT-01`, `C38.1312`)
2. **`asset_name`**: ชื่อทรัพย์สิน / ชื่ออุปกรณ์ (เช่น `Computer Dell OptiPlex`, `Core Switch ชั้น 2`)
3. **`holder`**: ผู้ถือครอง / ผู้ใช้งาน หรือรายละเอียดตำแหน่งที่ตั้ง (เช่น `สมชาย บัญชี`, `ห้องประชุมใหญ่`)
4. **`type`**: ประเภทอุปกรณ์ (`PC`, `Notebook`, `Printer`, `Monitor`, `Switch`, `Server`, `Router`, `UPS`, `Camera`, `Other`)
5. **`brand`**: ยี่ห้อผู้ผลิต (เช่น `Dell`, `HP`, `Cisco`, `Canon`, `APC`)
6. **`model`**: รุ่นอุปกรณ์ (เช่น `OptiPlex 7090`, `Catalyst 2960`)
7. **`serial`**: หมายเลขประจำเครื่อง (Serial Number / S/N)
8. **`department`**: แผนก / หน่วยงานเจ้าของทรัพย์สิน
9. **`ip`**: หมายเลข IP Address ของอุปกรณ์ในเครือข่าย
10. **`mac_address`**: หมายเลข MAC Address ของการ์ดเครือข่าย
11. **`status`**: สถานะของทรัพย์สิน (`Active`, `Spare`, `Repair`, `Retired`)
12. **`image`**: URL รูปภาพทรัพย์สิน (เก็บใน Cloudinary)
13. **`map_id`**: รหัสแผนผังที่ติดตั้ง (เชื่อมกับ `map_id` ในตาราง `map`)
14. **`x`**: ตำแหน่งพิกัดแนวนอนบนแผนผัง (%)
15. **`y`**: ตำแหน่งพิกัดแนวตั้งบนแผนผัง (%)

---

## 🚀 การติดตั้งและเปิดใช้งานในเครื่อง (Local Setup)

### รันด้วย Node.js / Vercel CLI
```bash
# ติดตั้ง dependencies (หากมี) หรือรันผ่าน vercel dev
npx vercel dev
```

### หรือรันเว็บเซิร์ฟเวอร์
```bash
php -S 0.0.0.0:3003
```
เปิดเบราว์เซอร์เข้าที่: `http://localhost:3003`

---

## ⚡ การ Deploy บน Vercel พร้อมเชื่อมต่อ Supabase

โปรเจกต์นี้รองรับการ Deploy บน **Vercel** โดยทำงานร่วมกับ Supabase ผ่าน Vercel Serverless Function:

### 1. นำเข้าโปรเจกต์เข้า Vercel
1. ไปที่ [Vercel Dashboard](https://vercel.com/dashboard)
2. กด **Add New...** > **Project**
3. เลือกคลัง GitHub `kachaintommachai/asset-map` แล้วกด **Import**

### 2. ตั้งค่า Environment Variables ใน Vercel
ก่อนกด Deploy (หรือในหน้า **Settings** > **Environment Variables** ของโปรเจกต์บน Vercel):

**Supabase (จำเป็น):**
- **`SUPABASE_URL`**: URL ของโปรเจกต์ Supabase (เช่น `https://xxxx.supabase.co`)
- **`SUPABASE_KEY`** หรือ **`SUPABASE_SERVICE_ROLE_KEY`**: Service Role Key หรือ Anon Key จาก Supabase Project Settings > API

**Cloudinary (สำหรับจัดเก็บรูปภาพ):**
- **`CLOUDINARY_CLOUD_NAME`**: Cloud Name (ค่าเริ่มต้น: `ugkaemul`)
- **`CLOUDINARY_UPLOAD_PRESET`**: Upload Preset (ค่าเริ่มต้น: `asset_map`)
- **`CLOUDINARY_API_KEY`**: (ไม่จำเป็นถ้าใช้ Unsigned Preset)
- **`CLOUDINARY_API_SECRET`**: (ไม่จำเป็นถ้าใช้ Unsigned Preset)

> รูปภาพทั้งหมดจะถูกอัปโหลดไปยัง Cloudinary โดยอัตโนมัติ จัดเก็บในโฟลเดอร์ `asset_map/devices` และ `asset_map/maps`

### 3. Deploy
- กดปุ่ม **Deploy**
- เมื่อ Deploy เสร็จสิ้น ระบบจะเชื่อมต่อไปยัง Supabase และ Cloudinary โดยอัตโนมัติ
- บัญชี Admin เริ่มต้น: Username `admin` / Password `cmfsupport`
