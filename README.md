# IT Asset Map - ระบบแผนผังทรัพย์สินสารสนเทศ (IT Asset Mapping System)

ระบบบริหารจัดการและแสดงตำแหน่งทรัพย์สิน/อุปกรณ์ไอที (PC, Notebook, Printer, Server, Network Switch, Router/AP, UPS, Camera ฯลฯ) บนแผนผังอาคารและแผนที่ชั้นต่างๆ พร้อมระบบจัดการสิทธิ์ผู้ใช้งานตามแผนก และรองรับการเชื่อมต่อข้อมูลกับ **Airtable** หรือฐานข้อมูล **MySQL**

---

## 📁 โครงสร้างตารางและไฟล์ข้อมูลสำหรับขึ้น GitHub / Airtable

| ไฟล์ CSV | ตาราง Airtable / MySQL | รายละเอียด | คอลัมน์สำคัญ |
|---|---|---|---|
| **[`device.csv`](file:///home/itcm/Downloads/Project1/asset/asset_map/device.csv)** | `device` (หรือ `cameras`) | ข้อมูลอุปกรณ์และทรัพย์สินไอที | `asset_code`, `asset_name`, `holder`, `type`, `brand`, `model`, `serial`, `department`, `ip`, `mac_address`, `status`, `image`, `map_id`, `x`, `y` |
| **[`map.csv`](file:///home/itcm/Downloads/Project1/asset/asset_map/map.csv)** | `map` (หรือ `maps`) | แผนผังชั้น/อาคาร/ห้อง | `map_id`, `map_name`, `map_pic` |
| **[`department.csv`](file:///home/itcm/Downloads/Project1/asset/asset_map/department.csv)** | `department` | รายชื่อแผนก/หน่วยงาน | `department` |
| **[`user.csv`](file:///home/itcm/Downloads/Project1/asset/asset_map/user.csv)** | `user` (หรือ `users`) | บัญชีผู้ใช้งานและสิทธิ์แผนก | `Name`, `password`, `department`, `camera_user`, `map_user` |

---

## 🛠️ รายละเอียดคอลัมน์ใน `device.csv` (IT Asset)

คอลัมน์ทั้งหมดได้รับการปรับปรุงให้ตรงตามมาตรฐานการบันทึกข้อมูลทรัพย์สินไอที โดยตัดฟิลด์เฉพาะของกล้องวงจรปิด (เช่น `recorder`, `recorder_ch`, `in/out`) ออกเรียบร้อยแล้ว:

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
12. **`image`**: ไฟล์รูปภาพทรัพย์สิน (ตั้งค่าฟิลด์เป็น **Attachment** ใน Airtable)
13. **`map_id`**: รหัสแผนผังที่ติดตั้ง (เชื่อมกับ `map_id` ในตาราง `map`)
14. **`x`**: ตำแหน่งพิกัดแนวนอนบนแผนผัง (%)
15. **`y`**: ตำแหน่งพิกัดแนวตั้งบนแผนผัง (%)

---

## ☁️ วิธีการ Import เข้า Airtable

1. **สร้าง Base ใหม่** บน Airtable (หรือใช้ Base เดิม)
2. **นำเข้า CSV แต่ละไฟล์**:
   - นำเข้า `device.csv` ตั้งชื่อตารางว่า **`device`**
   - นำเข้า `map.csv` ตั้งชื่อตารางว่า **`map`**
   - นำเข้า `department.csv` ตั้งชื่อตารางว่า **`department`**
   - นำเข้า `user.csv` ตั้งชื่อตารางว่า **`user`**
3. **ตั้งค่าคอลัมน์รูปภาพเป็น Attachment**:
   - ในตาราง **`device`**: คลิกขวาที่หัวคอลัมน์ **`image`** > เลือก **Edit field** > เปลี่ยน Type เป็น **Attachment**
   - ในตาราง **`map`**: คลิกขวาที่หัวคอลัมน์ **`map_pic`** > เลือก **Edit field** > เปลี่ยน Type เป็น **Attachment**
4. สามารถลากไฟล์รูปถ่ายอุปกรณ์ และรูปภาพแปลนแผนที่มาวางในช่อง Attachment ได้โดยตรง

---

## 🚀 การติดตั้งและเปิดใช้งานในเครื่อง (Local Setup)

### วิธีที่ 1: รันด้วย PHP Built-in Server
```bash
# เปิดใช้งานเว็บเซิร์ฟเวอร์ที่พอร์ต 3003
php -S 0.0.0.0:3003
```
เปิดเบราว์เซอร์เข้าที่: `http://localhost:3003`

### วิธีที่ 2: ใช้ฐานข้อมูล MySQL
1. นำเข้าฐานข้อมูล:
```bash
mysql -u root -p < schema.sql
mysql -u cctv_user -pcctv_pass cctv_monitor < import_data.sql
```
2. ตั้งค่าการเชื่อมต่อใน `db_config.php`
3. รันผ่านเว็บเซิร์ฟเวอร์ Apache / Nginx / PHP-FPM

---

## ⚡ การ Deploy บน Vercel พร้อมเชื่อมต่อ Airtable

โปรเจกต์นี้รองรับการ Deploy บน **Vercel** โดยทำงานร่วมกับ Airtable ผ่าน Vercel Serverless Function:

### 1. นำเข้าโปรเจกต์เข้า Vercel
1. ไปที่ [Vercel Dashboard](https://vercel.com/dashboard)
2. กด **Add New...** > **Project**
3. เลือกคลัง GitHub `kachaintommachai/asset-map` แล้วกด **Import**

### 2. ตั้งค่า Environment Variables ใน Vercel
ก่อนกด Deploy (หรือในหน้า **Settings** > **Environment Variables** ของโปรเจกต์บน Vercel):
- **`AIRTABLE_TOKEN`**: Personal Access Token จาก [Airtable Create Token](https://airtable.com/create/tokens) (สิทธิ์ `data.records:read` และ `data.records:write`)
- **`AIRTABLE_BASE_ID`**: รหัส Base ID ของคุณ (ขึ้นต้นด้วย `app...` ดูได้จาก URL ของ Airtable)

### 3. Deploy
- กดปุ่ม **Deploy**
- เมื่อ Deploy เสร็จสิ้น ระบบจะเชื่อมต่อไปยัง Airtable โดยอัตโนมัติ
- บัญชี Admin เริ่มต้น (หากยังไม่ได้สร้างใน Airtable): Username `admin` / Password `cmfsupport`

