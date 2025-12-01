// ================== API CHAT – XUÂN LŨNG V2 (TTHC + TÀI LIỆU) ==================
import OpenAI from "openai";
import fetch from "node-fetch";

// ====== KẾT NỐI OPENAI ======
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ====== ENV ======
// CSV Google Sheet TTHC (bản hộ kinh doanh + các thủ tục khác)
const TTHC_SHEET_URL = process.env.TTHC_SHEET_URL || "";

// CSV Google Sheet kho tài liệu AI (XL_XuanLung_AI_Master)
const KB_SHEET_URL = process.env.KB_SHEET_URL || "";

const TEN_XA = process.env.TEN_XA || "Xã Xuân Lũng";
const TEN_TINH = process.env.TEN_TINH || "Phú Thọ";

const NO_DATA_FALLBACK =
  "Hiện tại tôi chưa có thông tin chính xác, Ông/Bà vui lòng liên hệ bộ phận Một cửa UBND Xã Xuân Lũng hoặc hotline 0325224888 để được xác nhận.";

// ===== TEMPLATE TRẢ LỜI THỦ TỤC =====
const RESPONSE_TEMPLATE = `
1️⃣ Cơ quan giải quyết:
- ...

2️⃣ Hồ sơ cần chuẩn bị:
- ...

3️⃣ Cách thực hiện:
- B1: ...
- B2: ...
- B3: ...
- Online (nếu có): ...

4️⃣ Lệ phí – thời gian giải quyết:
- Lệ phí: ...
- Thời gian: ...

5️⃣ Link chi tiết & biểu mẫu:
- Link chi tiết: ...
- Mẫu/tờ khai: ...
- Đăng ký online: ...
`.trim();

// ===== SYSTEM PROMPT CHO THỦ TỤC =====
const SYSTEM_PROMPT_TTHC = `
Bạn là Trợ lý AI – Hành chính công của ${TEN_XA}, ${TEN_TINH}.
Nhiệm vụ: trả lời NGẮN – GỌN – RÕ – ĐÚNG MẪU cho THỦ TỤC HÀNH CHÍNH.

🎯 QUY TẮC TRẢ LỜI
- Không lan man, không giải thích lý thuyết dài.
- Ưu tiên viết tắt: UBND, CCCD, HK, GPLX, TTHC, TN&MT, KH&ĐT,...
- Tuyệt đối không nhắc "cấp huyện", "UBND huyện", "cơ quan cấp huyện", v.v.
- Chỉ dùng: cấp xã (UBND xã), cấp tỉnh (Sở, UBND tỉnh), trung ương (Bộ, Tổng cục,...).
- Nếu dữ liệu cho thấy cơ quan giải quyết là cấp xã → ưu tiên dùng: "UBND ${TEN_XA}".
- Nếu là cấp tỉnh hoặc Sở → ưu tiên ghi: "Sở/UBND ... tỉnh ${TEN_TINH}".

📌 FORMAT TRẢ LỜI BẮT BUỘC
Luôn bám đúng khung sau, cả tiêu đề lẫn thứ tự:

${RESPONSE_TEMPLATE}

⚠️ LƯU Ý:
- Mỗi bullet là 1 dòng.
- Các mục 1️⃣→5️⃣ phải cách nhau rõ ràng, không gộp.
- Không gộp tiêu đề và nội dung vào cùng dòng.
`.trim();

// ===== SYSTEM PROMPT CHO KHO TÀI LIỆU =====
const SYSTEM_PROMPT_KB = `
Bạn là Trợ lý AI nội bộ của ${TEN_XA}, ${TEN_TINH}.

Chỉ được phép dùng thông tin trong phần "CONTEXT TÀI LIỆU" bên dưới.
- Không được bịa, không suy diễn, không lấy dữ liệu bên ngoài.
- Nếu câu hỏi không nằm trong nội dung context → phải trả lời đúng câu:
"${NO_DATA_FALLBACK}"

Khi trả lời:
- Giải thích ngắn gọn, dễ hiểu, như cán bộ đang hướng dẫn trực tiếp.
- Nếu có link_goc hoặc link_tai_lieu, hãy liệt kê rõ cho người dùng bấm vào.
`.trim();

// ====== CACHE SHEET (TTHC) ======
let cacheTTHC = null;
let lastFetchTTHC = 0;
const TTL_TTHC = 5 * 60 * 1000; // 5 phút

// ====== CACHE SHEET (KB TÀI LIỆU) ======
let cacheKB = null;
let lastFetchKB = 0;
const TTL_KB = 5 * 60 * 1000;

// ====== HÀM LOAD CSV ĐƠN GIẢN ======
async function loadCsv(url, type) {
  if (!url) return null;

  const now = Date.now();
  if (type === "tthc" && cacheTTHC && now - lastFetchTTHC < TTL_TTHC) return cacheTTHC;
  if (type === "kb" && cacheKB && now - lastFetchKB < TTL_KB) return cacheKB;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch CSV failed: ${res.status} ${res.statusText}`);
  const text = await res.text();
  if (!text.trim()) return [];

  const lines = text.split("\n").filter(Boolean);
  const header = lines[0].split(",").map((h) => h.trim());

  const data = lines.slice(1).map((row) => {
    const cols = row.split(",");
    const item = {};
    header.forEach((h, i) => {
      item[h] = (cols[i] || "").trim();
    });
    return item;
  });

  if (type === "tthc") {
    cacheTTHC = data;
    lastFetchTTHC = now;
  } else {
    cacheKB = data;
    lastFetchKB = now;
  }

  return data;
}

// ===== TÌM THỦ TỤC TRONG SHEET TTHC =====
function findTT(question, data) {
  if (!question || !data || !data.length) return null;
  const q = question.toLowerCase();

  return data.find((item) => {
    const ten = (item.ten_thu_tuc || "").toLowerCase();
    const ma = (item.ma_thu_tuc || "").toLowerCase();
    const kw = (item.tu_khoa_tim_kiem || "")
      .toLowerCase()
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean);

    return (
      (ten && ten.includes(q)) ||
      (ma && ma.includes(q)) ||
      kw.some((k) => k && q.includes(k))
    );
  });
}

// ===== CHUẨN HÓA CƠ QUAN GIẢI QUYẾT =====
function normalizeAgency(raw) {
  if (!raw) return "";
  const txt = raw.trim();
  const lower = txt.toLowerCase();

  if (
    lower === "xa" ||
    lower === "xã" ||
    /cấp\s*xã/.test(lower) ||
    /ubnd\s*xã/.test(lower)
  ) {
    return `UBND ${TEN_XA}`;
  }

  if (lower === "tinh" || lower === "tỉnh" || /cấp\s*tỉnh/.test(lower)) {
    return `UBND tỉnh ${TEN_TINH}`;
  }

  if (/^sở\s/i.test(txt) && !/tỉnh/i.test(txt)) {
    return `${txt} ${TEN_TINH}`.trim();
  }

  if (/tỉnh/i.test(txt)) return txt;

  return txt;
}

// ===== TÌM TÀI LIỆU TRONG SHEET KB =====
function findDoc(question, data) {
  if (!question || !data || !data.length) return null;
  const q = question.toLowerCase();

  // ưu tiên tìm theo từ khóa
  let best = null;
  let bestScore = 0;

  for (const row of data) {
    const title = (row.tieu_de || "").toLowerCase();
    const kw = (row.tu_khoa || "").toLowerCase();
    let score = 0;

    if (title && q.includes(title)) score += 3;
    if (kw) {
      kw.split(";")
        .map((x) => x.trim())
        .filter(Boolean)
        .forEach((k) => {
          if (q.includes(k)) score += 2;
        });
    }
    if (!score && title && title.includes(q)) score += 1;

    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }

  return bestScore > 0 ? best : null;
}

// ===== PHÂN TÍCH CHẾ ĐỘ TỪ WIDGET =====
function parseMode(rawMessage) {
  const m = rawMessage.match(/^\[CHẾ ĐỘ:\s*([^\]]+)\]/i);
  const modeLabel = m ? m[1].trim().toUpperCase() : "CHUNG";
  const question = rawMessage.replace(/^\[CHẾ ĐỘ:[^\]]+\]\s*/i, "").trim();
  return { modeLabel, question };
}

// ================== HANDLER ==================
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    const { message } = req.body || {};
    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Missing 'message' field" });
    }

    const { modeLabel, question } = parseMode(message);

    // ===== TRƯỜNG HỢP HỎI THỦ TỤC / BIỂU MẪU / LIÊN HỆ CÁN BỘ =====
    const isThuTuc =
      modeLabel.includes("THỦ TỤC") ||
      modeLabel.includes("BIỂU MẪU") ||
      modeLabel.includes("LIÊN HỆ");

    if (isThuTuc) {
      const dataset = await loadCsv(TTHC_SHEET_URL, "tthc");
      const sheetOK = Array.isArray(dataset);

      if (!sheetOK) {
        return res.status(200).json({ reply: NO_DATA_FALLBACK });
      }

      const matched = findTT(question, dataset);

      if (!matched) {
        return res.status(200).json({ reply: NO_DATA_FALLBACK });
      }

      const cq1 = normalizeAgency(matched.co_quan_1 || "");
      const cq2 = normalizeAgency(matched.co_quan_2 || "");

      const context = `
ten_thu_tuc: ${matched.ten_thu_tuc || ""}

co_quan_1: ${cq1}
co_quan_2: ${cq2}

giay_to_1: ${matched.giay_to_1 || ""}
giay_to_2: ${matched.giay_to_2 || ""}
giay_to_3: ${matched.giay_to_3 || ""}

buoc_1: ${matched.buoc_1 || ""}
buoc_2: ${matched.buoc_2 || ""}
buoc_3: ${matched.buoc_3 || ""}

le_phi: ${matched.le_phi || ""}
thoi_gian_giai_quyet: ${matched.thoi_gian_giai_quyet || ""}

link_chi_tiet: ${matched.link_chi_tiet || ""}
link_mau_1: ${matched.link_mau_1 || ""}
link_mau_2: ${matched.link_mau_2 || ""}
link_dang_ky_online: ${matched.link_dang_ky_online || ""}

ghi_chu: ${matched.ghi_chu || ""}
      `.trim();

      const messages = [
        { role: "system", content: SYSTEM_PROMPT_TTHC },
        {
          role: "system",
          content:
            "Dưới đây là dữ liệu chính thức từ Google Sheet. Hãy tóm tắt NGẮN theo đúng format 1️⃣→5️⃣, không bịa thêm, không nhắc đến cấp huyện:\n\n" +
            context,
        },
        { role: "user", content: question },
      ];

      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages,
      });

      const reply =
        completion.choices?.[0]?.message?.content?.trim() || NO_DATA_FALLBACK;

      return res.status(200).json({ reply });
    }

    // ===== TRƯỜNG HỢP HỎI VỀ NỘI DUNG TÀI LIỆU (FOLDER DRIVE) =====
    const kbData = await loadCsv(KB_SHEET_URL, "kb");
    const kbOK = Array.isArray(kbData);

    if (!kbOK) {
      return res.status(200).json({ reply: NO_DATA_FALLBACK });
    }

    const doc = findDoc(question, kbData);

    if (!doc) {
      return res.status(200).json({ reply: NO_DATA_FALLBACK });
    }

    const contextDoc = `
[CONTEXT TÀI LIỆU]
- Tiêu đề: ${doc.tieu_de || ""}
- Loại: ${doc.loai || ""}
- Từ khóa: ${doc.tu_khoa || ""}
- Mô tả ngắn: ${doc.mo_ta_ngan || ""}
- Nội dung chính: ${doc.noi_dung_chinh || ""}

- Link gốc: ${doc.link_goc || ""}
- Link tài liệu Drive: ${doc.link_tai_lieu || ""}
- Ghi chú: ${doc.ghi_chu || ""}
    `.trim();

    const messages = [
      { role: "system", content: SYSTEM_PROMPT_KB },
      { role: "system", content: contextDoc },
      { role: "user", content: question },
    ];

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages,
    });

    let reply =
      completion.choices?.[0]?.message?.content?.trim() || NO_DATA_FALLBACK;

    // Thêm link rõ ràng cuối câu trả lời (cho chắc chắn)
    const extraLinks = [];
    if (doc.link_goc) extraLinks.push(`🔗 Link gốc: ${doc.link_goc}`);
    if (doc.link_tai_lieu) extraLinks.push(`📄 Tài liệu chi tiết: ${doc.link_tai_lieu}`);
    if (extraLinks.length) {
      reply += `\n\n${extraLinks.join("\n")}`;
    }

    return res.status(200).json({ reply });
  } catch (err) {
    console.error("API Error:", err);
    return res.status(500).json({
      reply:
        "Bộ phận Online đang bận Ông/Bà vui lòng liên hệ hotline 0325224888 để được hỗ trợ.",
    });
  }
}
// ================== HẾT FILE API CHAT V2 ==================
