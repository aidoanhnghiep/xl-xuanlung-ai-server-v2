import fetch from "node-fetch";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import OpenAI from "openai";

// ====== CONFIG ======
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const KB_SHEET_URL = process.env.KB_SHEET_URL;      // Sheet giới thiệu: XL_XuanLung_AI_Master
const TTHC_SHEET_URL = process.env.TTHC_SHEET_URL;  // Sheet thủ tục hành chính

// GOOGLE AUTH
const jwt = new JWT({
  email: process.env.GOOGLE_SERVICE_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

// ====== HÀM ĐỌC GOOGLE SHEET ======
async function loadGoogleSheet(sheetUrl) {
  const sheetId = sheetUrl.match(/spreadsheets\/d\/(.+?)\//)[1];
  const doc = new GoogleSpreadsheet(sheetId, jwt);

  await doc.loadInfo();
  const sheet = doc.sheetsByIndex[0];
  const rows = await sheet.getRows();

  return rows.map(r => ({ ...r }));
}

// ====== XỬ LÝ TRẢ LỜI “BẠN LÀ AI?” ======
function checkWhoAmI(question, kbRows) {
  const keywords = ["bạn là ai", "mày là ai", "trợ lý là ai", "bạn là gì", "ai vậy"];

  if (keywords.some(k => question.includes(k))) {
    const firstRow = kbRows[0];
    return firstRow?.noi_dung_chinh?.split("\n")[0] || 
      "Tôi là Trợ lý AI của Trung tâm Hành chính công xã Xuân Lũng.";
  }
  return null;
}

// ====== TÌM THỦ TỤC THEO TỪ KHÓA ======
function findTTHC(question, rows) {
  question = question.toLowerCase();

  for (const r of rows) {
    if (!r.tu_khoa_tim_kiem) continue;

    const list = r.tu_khoa_tim_kiem.toLowerCase().split(";");

    if (list.some(k => question.includes(k.trim()))) {
      return {
        ma: r.ma_thu_tuc,
        ten: r.ten_thu_tuc,
        co_quan: r.co_quan_1,
        giay_to: [r.giay_to_1, r.giay_to_2, r.giay_to_3].filter(Boolean),
        buoc: [r.buoc_1, r.buoc_2, r.buoc_3].filter(Boolean),
        le_phi: r.le_phi,
        thoi_gian: r.thoi_gian_giai_quyet,
        link_chi_tiet: r.link_chi_tiet || "",
        link_mau: r.link_mau_1 || "",
      };
    }
  }
  return null;
}

// ====== FORMAT TRẢ LỜI ======
function formatTTHC(t) {
  return `
1️⃣ Cơ quan giải quyết:
- ${t.co_quan}

2️⃣ Hồ sơ cần chuẩn bị:
${t.giay_to.map(g => `- ${g}`).join("\n")}

3️⃣ Các bước thực hiện:
${t.buoc.map((b, i) => `- B${i+1}: ${b}`).join("\n")}

4️⃣ Lệ phí – thời gian giải quyết:
- ${t.le_phi}
- ${t.thoi_gian}

5️⃣ Link chi tiết & biểu mẫu:
- Link chi tiết: ${t.link_chi_tiet || "[Chưa có thông tin]"}
- Mẫu/tờ khai: ${t.link_mau || "[Chưa có thông tin]"}
`;
}

// ====== API MAIN HANDLER ======
export default async function handler(req, res) {
  try {
    const question = (req.query.q || "").toLowerCase().trim();
    if (!question) return res.status(200).send("Bạn vui lòng nhập câu hỏi!");

    // Load dữ liệu
    const kbRows = await loadGoogleSheet(KB_SHEET_URL);
    const tthcRows = await loadGoogleSheet(TTHC_SHEET_URL);

    // 1️⃣ Xử lý “bạn là ai?”
    const who = checkWhoAmI(question, kbRows);
    if (who) return res.status(200).send(who);

    // 2️⃣ Kiểm tra thủ tục hành chính
    const foundTTHC = findTTHC(question, tthcRows);
    if (foundTTHC) {
      return res.status(200).send(formatTTHC(foundTTHC));
    }

    // 3️⃣ Nếu không tìm thấy – trả về câu chuẩn
    return res.status(200).send(
      "Hiện tại tôi chưa có thông tin chính xác, Ông/Bà vui lòng liên hệ bộ phận Một cửa UBND Xã Xuân Lũng hoặc hotline 0982250283 để được xác nhận."
    );

  } catch (err) {
    console.error("ERROR:", err);
    res.status(500).send("Lỗi hệ thống API.");
  }
}
