# Pengurus Sosial & Siaran Pelbagai Platform (Zernio)

Panduan ini menerangkan cara menghubungkan akaun sosial melalui **Zernio**, keperluan setiap placement, penggunaan set pos (`set_id`), penjadualan, dan pelan mingguan (`content_week`).

## 1. Menyambung Akaun dalam Zernio
1. Sambungkan akaun **TikTok, Instagram, Facebook Page, Threads, dan YouTube** di papan pemuka Zernio (`zernio.com`).
2. Salin **API Key** daripada Zernio → Settings → API Keys.
3. Dalam MyOfis, buka **Settings → Social accounts** dan klik **Connect a Zernio key**.
4. Semua akaun merentas 5 platform akan disenaraikan secara automatik. Anda boleh menukar label dan suis **on/off** bagi setiap akaun.
5. Di bahagian **Akaun lalai mengikut projek**, pilih akaun mana yang digunakan oleh setiap projek.

### Peraturan Laluan (Routing)
Apabila draf diluluskan, hub memilih akaun mengikut urutan berikut:
1. Akaun yang ditetapkan pada draf (`meta.social_account`);
2. Akaun projek bagi platform tersebut (`Settings → Social accounts`);
3. Satu-satunya akaun aktif bagi platform tersebut dalam bilik/workspace semasa;
4. Sambungan terus Meta lama bagi projek (untuk pos foto tunggal atau teks sahaja).
- **Akaun yang dimatikan (off) tidak pernah ditukar secara senyap** kepada akaun lain.

## 2. Keperluan Setiap Placement (`placementCheck`)
`save_draft` menolak draf yang melanggar syarat berikut (dan `DraftCard` turut memaparkan amaran):
- **IG Story (`ig_story`) & FB Story (`fb_story`):** tepat **1 gambar** ATAU **1 video ≤ 60 saat** setiap draf. (Video panjang yang dipecahkan oleh Video HD menjadi beberapa draf Story berasingan dalam set yang sama.)
- **IG Reels (`ig_reels`) & FB Reels (`fb_reels`):** video menegak (`9:16`).
- **IG Carousel (`ig_carousel`):** **2 hingga 10 gambar** mengikut susunan `meta.images`.
- **YouTube Shorts (`yt_shorts`):** tajuk (`title`, ≤ 100 aksara) wajib + video menegak (`≤ 180 s`). YouTube mengesan Shorts secara automatik berdasarkan nisbah & tempoh.
- **Threads (`threads`):** teks sahaja, gambar, atau video; had kapsyen ketat **500 aksara**.
- **TikTok (`tiktok`):** video menegak + kapsyen ≤ 2,200 aksara.
- **FB Feed (`fb_feed`):** teks, gambar, atau video (kapsyen ≤ 63,206 aksara).

## 3. Set Pos (`set_id`) & Penjadualan
- Semua draf bagi satu idea (contoh: TikTok + IG Reel + 3 IG Story + Threads) berkongsi `meta.set_id`.
- Dalam **Drafts**, set pos dipaparkan sebagai **satu kad** dengan tab bagi setiap platform, butang **Lulus semua** (idempoten — cubaan semula tidak menyiarkan dua kali), **Tolak**, dan satu masa jadual untuk keseluruhan set.
- Dalam **Telegram**, set baharu dihantar sebagai satu kad ringkas dengan butang bertandatangan HMAC **✅ Lulus semua** dan **❌ Tolak**.

## 4. Pelan Mingguan (`content_week`)
- Ejen terbina **Pengurus Sosial** (`pengurus-sosial`) hadir dengan kemahiran `social-captions-multi` dan jadual `Pelan Kandungan Mingguan` (**Ahad 20:00 KL**, dimatikan secara lalai).
- Apabila dihidupkan atau dijalankan secara manual, ia menghasilkan set draf minggu hadapan berdasarkan tonggak kandungan dalam `brief.yaml` dan fakta daripada log ciri sahaja, lengkap dengan `proposed_publish_at` untuk semakan di **Grid Planner** (`/planner`) atau **Drafts**.

## 5. Nota Instagram Highlights
- Instagram tidak menyediakan API awam untuk mencipta atau mengemas kini **Highlights**.
- Gunakan kulit Highlight (`highlight_cover`) yang dirender melalui templat Brand Kit (Task 040) dan dimuat turun dari **Grid Planner** (`/planner`) untuk ditetapkan secara manual dalam aplikasi Instagram.
