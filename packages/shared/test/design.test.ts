import { describe, expect, test } from "bun:test";
import {
  BrandKit,
  DEFAULT_BRAND_KIT,
  DESIGN_ICON_NAMES,
  DESIGN_SIZES,
  DesignSizeId,
  DesignTemplateId,
  contrastRatio,
  renderDesignPages,
} from "../src/index.ts";

const SHORT_FIELDS: Record<DesignTemplateId, Record<string, unknown>> = {
  quote: { quote: "Main lebih tajam hari ini.", author: "SmashPoint" },
  tip_carousel: {
    title: "3 Tip Smash Padu",
    slides: [
      { heading: "Posisi Kaki", body: "Pastikan bahu menghadap jaring sebelum melompat." },
      { heading: "Titik Impak", body: "Pukul bulu tangkis pada titik tertinggi." },
    ],
    cta: "Simpan & kongsi!",
  },
  list_top: { title: "Top 3 Gelanggang", items: ["Gelanggang A · VIP", "Gelanggang B · Pro", "Gelanggang C · Sosial"] },
  before_after: { title: "Naik Taraf Lantai", before_label: "SEBELUM", after_label: "SELEPAS" },
  promo: { headline: "Pakej Pagi Santai", price: "RM18/jam", cta: "Tempah Sekarang", subtitle: "Isnin–Jumaat" },
  announcement: { eyebrow: "BARU", headline: "Kejohanan Terbuka Mac", body: "Pendaftaran kini dibuka.", cta: "Daftar Sekarang" },
  testimonial: { body: "Gelanggang sangat selesa dan bersih!", author: "Aina", role: "Ahli Mingguan", rating: 5 },
  story_frame: { headline: "Slot Malam Ada!", body: "Baki 2 gelanggang.", cta: "Tempah Cepat" },
  highlight_cover: { icon: "trophy", label: "Harga" },
};

const LONG_FIELDS: Record<DesignTemplateId, Record<string, unknown>> = {
  quote: {
    quote: "Kemenangan dalam gelanggang badminton bukan bermula daripada smash paling kuat, tetapi daripada latihan konsisten, gerak kaki yang kemas, dan fokus penuh pada setiap mata.",
    author: "Jurulatih Hazman · SmashPoint",
  },
  tip_carousel: {
    title: "5 Kesilapan Biasa Pemain Badminton Sosial Yang Buat Cepat Penat",
    subtitle: "Panduan lengkap untuk tingkatkan stamina dan kawalan permainan",
    slides: [
      { heading: "Genggaman Terlalu Ketat", body: "Pegang raket dengan santai sehingga saat impak supaya pergelangan tangan lebih pantas dan tidak cepat lenguh." },
      { heading: "Tidak Kembali Ke Tengah", body: "Selepas setiap pukulan, segera kembali ke posisi asas di tengah gelanggang agar mudah mencapai sudut lawan." },
    ],
    cta: "Simpan panduan ini dan tag rakan beregu anda!",
  },
  list_top: {
    title: "5 Persediaan Wajib Sebelum Sesi Badminton Malam Minggu",
    items: [
      "Panaskan badan dan regangkan bahu selama 10 minit",
      "Semak ketegangan tali raket serta grip gantian",
      "Bawa air elektrolit dan tuala bersih mencukupi",
      "Pakai kasut gelanggang bertapak getah anti-gelincir",
      "Tempah slot awal supaya tidak terlepas waktu puncak",
    ],
  },
  before_after: { title: "Perubahan Pencahayaan LED Anti-Silau Gelanggang Utama", before_label: "LAMPU LAMA", after_label: "LED PRO BARU" },
  promo: {
    headline: "Pakej Sewaan Gelanggang Hujung Minggu + Tabung Bulu Tangkis",
    price: "RM65 / 2 Jam",
    subtitle: "Termasuk air mineral sejuk dan tempat letak kereta percuma untuk semua ahli.",
    cta: "Tempah Slot Anda Hari Ini",
  },
  announcement: {
    eyebrow: "PENGUMUMAN RASMI",
    headline: "Waktu Operasi Lanjutan Hingga 1 Pagi Setiap Jumaat & Sabtu",
    body: "Atas permintaan ramai komuniti badminton Lembah Klang, semua 8 gelanggang kini dibuka lebih lewat dengan pencahayaan penuh.",
    cta: "Tempah di smashpoint.my",
  },
  testimonial: {
    body: "Sejak mula main di sini setiap minggu, memang puas hati dengan lantai getah yang tidak licin, lampu tidak menyilaukan mata, dan sistem tempahan dalam talian yang pantas.",
    author: "Amirul Hakim",
    role: "Kapten Kelab Beregu Shah Alam",
    rating: 5,
  },
  story_frame: {
    headline: "Promosi Akhir Bulan Untuk Semua Pemain Sosial & Kelab",
    body: "Nikmati potongan istimewa untuk tempahan dua jam berturut-turut pada hari bekerja sebelum jam 5 petang.",
    cta: "Klik Pautan Tempahan",
  },
  highlight_cover: { icon: "calendar", label: "Kejohanan" },
};

describe("Task 040 & 043: Brand Kit & Pure Offline Design Templates", () => {
  test("BrandKit validates hex colours and contrastRatio computes WCAG contrast", () => {
    expect(BrandKit.safeParse({ colors: { primary: "not-a-hex" } }).success).toBe(false);
    expect(BrandKit.safeParse({ colors: { primary: "#12345" } }).success).toBe(false);
    const valid = BrandKit.parse({
      colors: { primary: "#059669", secondary: "#0F172A", accent: "#F59E0B", background: "#FFFFFF", text: "#111827" },
      fonts: { heading: "poppins", body: "inter" },
      style: "minimal",
      handle: "@myofis",
      highlights: [{ label: "Harga", icon: "price" }],
    });
    expect(valid.handle).toBe("@myofis");
    expect(contrastRatio("#111827", "#FFFFFF")).toBeGreaterThan(15);
    expect(contrastRatio("#CCCCCC", "#FFFFFF")).toBeLessThan(4.5);
    expect(DESIGN_ICON_NAMES.length).toBeGreaterThanOrEqual(40);
  });

  test("every template x size renders cleanly without overflow warnings for normal text and contains no http URL or script", () => {
    for (const template of DesignTemplateId.options) {
      for (const size of DesignSizeId.options) {
        const res = renderDesignPages(template, DEFAULT_BRAND_KIT, SHORT_FIELDS[template], size, { projectName: "SmashPoint" });
        expect(res.warnings).toEqual([]);
        expect(res.pages.length).toBeGreaterThanOrEqual(template === "tip_carousel" ? 4 : 1);
        const expectedSize = template === "story_frame" || template === "highlight_cover" ? DESIGN_SIZES.story : DESIGN_SIZES[size];
        expect(res.width).toBe(expectedSize.width);
        expect(res.height).toBe(expectedSize.height);
        for (const html of res.pages) {
          expect(html).not.toMatch(/https?:\/\//i);
          expect(html).not.toMatch(/<script/i);
        }
      }
    }
  });

  test("Task 043 font-size minima: every font-size:Npx across all 9 templates (short + long, all sizes) is >= 26px and body/list/author >= 34px", () => {
    for (const variant of [SHORT_FIELDS, LONG_FIELDS]) {
      for (const template of DesignTemplateId.options) {
        for (const size of DesignSizeId.options) {
          const res = renderDesignPages(template, DEFAULT_BRAND_KIT, variant[template], size, { projectName: "SmashPoint" });
          for (const html of res.pages) {
            const matches = [...html.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/gi)];
            expect(matches.length).toBeGreaterThan(0);
            for (const m of matches) {
              const px = Number(m[1]);
              expect(px).toBeGreaterThanOrEqual(26);
            }
            // Check <p> (body/subtitle) tags are always >= 34px
            for (const pm of html.matchAll(/<p\b[^>]*font-size\s*:\s*(\d+(?:\.\d+)?)px/gi)) {
              expect(Number(pm[1])).toBeGreaterThanOrEqual(34);
            }
          }
        }
      }
    }
  });

  test("Task 043 brand footer fallback, full-bleed photo support, and no lone placeholder icon in promo", () => {
    // Footer shows projectName when Brand Kit has no handle and no logo
    const noHandle = renderDesignPages("quote", DEFAULT_BRAND_KIT, { quote: "Fokus penuh.", author: "Hazman" }, "post_4x5", { projectName: "SmashPoint" });
    expect(noHandle.pages[0]).toContain("SmashPoint");

    // Promo without photo never falls back to a lone sparkles icon
    const promoNoPhoto = renderDesignPages("promo", DEFAULT_BRAND_KIT, { headline: "Pakej Pagi", price: "RM18", cta: "Tempah" }, "post_4x5", { projectName: "SmashPoint" });
    expect(promoNoPhoto.pages[0]).not.toContain("M12 3l1.9 5.8L20 11");

    // quote, announcement, tip_carousel (cover), promo accept photos[0] as full-bleed background with overlay
    const fakePhoto = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    for (const tmpl of ["quote", "announcement", "tip_carousel", "promo"] as const) {
      const r = renderDesignPages(tmpl, DEFAULT_BRAND_KIT, SHORT_FIELDS[tmpl], "post_4x5", { photoDataUrls: [fakePhoto], projectName: "SmashPoint" });
      expect(r.pages[0]).toContain(fakePhoto);
      expect(r.pages[0]).toContain("linear-gradient");
    }
  });

  test("600-character quote produces an overflow warning and <script> in fields is escaped", () => {
    const longQuote = "Kualiti video yang sangat tajam dan kemas ".repeat(16); // > 600 chars
    const res = renderDesignPages(
      "quote",
      DEFAULT_BRAND_KIT,
      {
        quote: longQuote,
        author: '<script>alert("xss")</script>',
      },
      "square",
    );
    expect(res.warnings.length).toBeGreaterThan(0);
    expect(res.pages[0]).not.toContain("<script>");
    expect(res.pages[0]).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
  });

  test("story_frame keeps text outside top 250px and bottom 340px safe areas", () => {
    const res = renderDesignPages("story_frame", DEFAULT_BRAND_KIT, { headline: "Selamat Pagi", body: "Tips hari ini." }, "story");
    expect(res.pages[0]).toContain("padding:260px 80px 350px 80px");
  });
});
