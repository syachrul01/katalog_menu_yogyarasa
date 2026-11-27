const express = require("express");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const CACHE_TTL_MS = (Number(process.env.CACHE_TTL_SECONDS) || 60) * 1000;

// Penyimpanan cache di memori server
let menuCache = {
  payload: null,
  updatedAt: 0
};

// Sajikan file statis dari folder public/ saat dijalankan di lokal
app.use(express.static(path.join(__dirname, "../public")));

// Endpoint kesehatan server
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    has_apps_script_url: Boolean(APPS_SCRIPT_URL)
  });
});

// Endpoint utama data menu & tenant
app.get("/api/menu", async (req, res) => {
  try {
    if (!APPS_SCRIPT_URL) {
      return res.status(500).json({
        status: "error",
        message: "APPS_SCRIPT_URL belum diatur di environment variables."
      });
    }

    const now = Date.now();
    const forceRefresh = req.query.refresh === "1";
    const isCacheValid =
      !forceRefresh &&
      menuCache.payload &&
      now - menuCache.updatedAt < CACHE_TTL_MS;

    // Jika cache masih segar, langsung kembalikan tanpa hit Google Sheets
    if (isCacheValid) {
      res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
      return res.json({
        ...menuCache.payload,
        cache_source: "memory_cache"
      });
    }

    // Tarik data terbaru dari Google Apps Script
    const response = await fetch(APPS_SCRIPT_URL, {
      method: "GET",
      redirect: "follow"
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} dari Google Apps Script`);
    }

    const rawData = await response.json();

    if (rawData.status !== "success") {
      throw new Error(rawData.message || "Respon Apps Script tidak valid");
    }

    // Ekstrak daftar kategori unik secara dinamis dari MASTER_TENANT
    const categories = [
      "Semua",
      ...new Set(
        (rawData.tenants || [])
          .map((t) => t.kategori)
          .filter(Boolean)
      )
    ];

    const normalizedPayload = {
      status: "success",
      fetched_at: rawData.fetched_at || new Date().toISOString(),
      total_tenants: rawData.total_tenants || (rawData.tenants || []).length,
      categories,
      tenants: rawData.tenants || []
    };

    // Simpan ke cache
    menuCache = {
      payload: normalizedPayload,
      updatedAt: now
    };

    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    return res.json({
      ...normalizedPayload,
      cache_source: "google_sheets_origin"
    });
  } catch (error) {
    console.error("Gagal mengambil data menu:", error.message);

    // Fallback: kirim cache lama jika tersedia agar pengunjung tetap bisa melihat menu
    if (menuCache.payload) {
      return res.json({
        ...menuCache.payload,
        cache_source: "stale_fallback_cache"
      });
    }

    return res.status(502).json({
      status: "error",
      message: "Gagal memuat data katalog menu. Silakan coba beberapa saat lagi.",
      detail: error.message
    });
  }
});

// Jalankan server hanya saat dieksekusi di lokal (bukan saat di-import Vercel)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
    console.log(`Cek API menu di http://localhost:${PORT}/api/menu`);
  });
}

module.exports = app;