const fs = require("fs/promises");
const path = require("path");

const BANKS_DIR = path.join(process.cwd(), "banks");
const OUTPUT_ALL = path.join(process.cwd(), "all-offers.json");

const BANK_SOURCES = [
  {
    bank: "البنك الأهلي",
    code: "ahli",
    file: path.join(BANKS_DIR, "Ahli.txt"),
    updater: fetchAhliOffers,
  },
  {
    bank: "بنك الجزيرة",
    code: "aljazira",
    file: path.join(BANKS_DIR, "AlJazira.txt"),
    updater: fetchAljaziraOffers,
  },
  {
    bank: "البنك العربي",
    code: "anb",
    file: path.join(BANKS_DIR, "ANB.txt"),
    updater: fetchAnbOffers,
  },
  {
    bank: "البنك السعودي الفرنسي",
    code: "bsf",
    file: path.join(BANKS_DIR, "BSF.txt"),
    updater: fetchBsfOffers,
  },
  {
    bank: "بنك الإمارات دبي الوطني",
    code: "enbd",
    file: path.join(BANKS_DIR, "ENBD.txt"),
    updater: fetchEnbdOffers,
  },
  {
    bank: "مصرف الإنماء",
    code: "alinma",
    file: path.join(BANKS_DIR, "Inma Offer.txt"),
    updater: fetchInmaOffers,
  },
  {
    bank: "مصرف الراجحي",
    code: "alrajhi",
    file: path.join(BANKS_DIR, "Rajhi.txt"),
    updater: fetchRajhiOffers,
  },
  {
    bank: "بنك الرياض",
    code: "riyadh",
    file: path.join(BANKS_DIR, "Riyadh Offer.txt"),
    updater: fetchRiyadhOffers,
  },
  {
    bank: "ساب",
    code: "sabb",
    file: path.join(BANKS_DIR, "SABB.txt"),
    updater: fetchSabbOffers,
  },
  {
    bank: "البنك السعودي للاستثمار",
    code: "saib",
    file: path.join(BANKS_DIR, "Saib.txt"),
    updater: fetchSaibOffers,
  },
];

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return [value];
}

function cleanString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const str = String(value).trim();
    if (str) return str;
  }
  return "";
}

function firstArray(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length) return value;
  }
  return [];
}

function normalizeDate(value) {
  const raw = cleanString(value);
  if (!raw) return "";

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString().slice(0, 10);
  }

  const normalized = raw
    .replace(/\u200f|\u200e/g, "")
    .replace(/\//g, "-")
    .replace(/\./g, "-")
    .trim();

  const match = normalized.match(/^(\d{1,4})-(\d{1,2})-(\d{1,4})$/);
  if (match) {
    const a = Number(match[1]);
    const b = Number(match[2]);
    const c = Number(match[3]);

    if (String(a).length === 4) {
      const d = new Date(Date.UTC(a, b - 1, c));
      if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }

    if (String(c).length === 4) {
      const d = new Date(Date.UTC(c, b - 1, a));
      if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  }

  return raw;
}

function isExpired(endDate) {
  if (!endDate) return false;

  const d = new Date(endDate);
  if (Number.isNaN(d.getTime())) return false;

  const end = new Date(d);
  end.setHours(23, 59, 59, 999);

  return end.getTime() < Date.now();
}

function buildId(bankCode, title = "", merchant = "", offerUrl = "") {
  const base = `${bankCode}-${title}-${merchant}-${offerUrl}`
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  return base || `${bankCode}-${Date.now()}`;
}

function extractOffersContainer(parsed) {
  if (Array.isArray(parsed)) return parsed;

  const candidates = [
    parsed?.offers,
    parsed?.data,
    parsed?.items,
    parsed?.results,
    parsed?.promotions,
    parsed?.list,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

function normalizeOffer(raw, bankName, bankCode) {
  const now = new Date().toISOString();

  const title = firstNonEmpty(
    raw.title,
    raw.offerTitle,
    raw.name,
    raw.heading,
    raw.offer_name
  );

  const merchant = firstNonEmpty(
    raw.merchant,
    raw.store,
    raw.partner,
    raw.brand,
    raw.vendor,
    raw.merchantName
  );

  const category = firstNonEmpty(
    raw.category,
    raw.segment,
    raw.type,
    raw.offerCategory
  );

  const discountText = firstNonEmpty(
    raw.discountText,
    raw.discount,
    raw.offer,
    raw.shortDescription,
    raw.subtitle,
    raw.badge
  );

  const details = firstNonEmpty(
    raw.details,
    raw.description,
    raw.desc,
    raw.longDescription,
    raw.summary,
    raw.content,
    raw.notes
  );

  const terms = firstNonEmpty(
    raw.terms,
    raw.termsAndConditions,
    raw.tnc,
    raw.conditions
  );

  const startDate = normalizeDate(
    firstNonEmpty(raw.startDate, raw.start, raw.validFrom, raw.fromDate)
  );

  const endDate = normalizeDate(
    firstNonEmpty(raw.endDate, raw.end, raw.validTo, raw.toDate, raw.expiryDate)
  );

  const offerUrl = firstNonEmpty(
    raw.offerUrl,
    raw.url,
    raw.link,
    raw.detailsUrl,
    raw.ctaUrl
  );

  const imageUrl = firstNonEmpty(
    raw.imageUrl,
    raw.image,
    raw.thumbnail,
    raw.logo,
    raw.banner
  );

  const tags = firstArray(raw.tags, raw.labels)
    .map((x) => cleanString(x))
    .filter(Boolean);

  return {
    id: firstNonEmpty(raw.id, raw.offerId) || buildId(bankCode, title, merchant, offerUrl),
    bank: bankName,
    bankCode,
    title,
    merchant,
    category,
    discountText,
    details,
    terms,
    startDate,
    endDate,
    offerUrl,
    imageUrl,
    tags,
    isExpired: isExpired(endDate),
    sourceFile: path.basename(
      BANK_SOURCES.find((b) => b.code === bankCode)?.file || ""
    ),
    updatedAt: now,
  };
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function readJsonFromTxt(filePath, fallback = []) {
  try {
    const txt = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(txt);
    return extractOffersContainer(parsed);
  } catch (error) {
    console.error(`Failed reading/parsing ${filePath}: ${error.message}`);
    return fallback;
  }
}

async function updateOneBank(source) {
  try {
    console.log(`Updating ${source.bank} from ${path.basename(source.file)}...`);

    const rawOffers = await source.updater();
    const normalized = toArray(rawOffers)
      .map((o) => normalizeOffer(o, source.bank, source.code))
      .filter((o) => o.title || o.merchant || o.details || o.offerUrl);

    console.log(`Normalized ${normalized.length} offers for ${source.bank}`);
    return normalized;
  } catch (error) {
    console.error(`Failed updating ${source.bank}: ${error.message}`);
    return [];
  }
}

function sortOffers(offers) {
  return [...offers].sort((a, b) => {
    if (a.isExpired !== b.isExpired) return a.isExpired ? 1 : -1;

    const aDate = a.endDate ? new Date(a.endDate).getTime() : Number.MAX_SAFE_INTEGER;
    const bDate = b.endDate ? new Date(b.endDate).getTime() : Number.MAX_SAFE_INTEGER;

    if (aDate !== bDate) return aDate - bDate;

    return (a.title || "").localeCompare(b.title || "", "ar");
  });
}

async function main() {
  await fs.mkdir(BANKS_DIR, { recursive: true });

  const allResults = [];

  for (const source of BANK_SOURCES) {
    const bankOffers = await updateOneBank(source);
    allResults.push(...bankOffers);
  }

  const sorted = sortOffers(allResults);
  await writeJson(OUTPUT_ALL, sorted);

  console.log(`Saved merged file: ${OUTPUT_ALL}`);
  console.log(`Total offers: ${sorted.length}`);
}

main().catch((err) => {
  console.error("Daily updater failed:", err);
  process.exit(1);
});

/* ===== Bank loaders ===== */

async function fetchAhliOffers() {
  return readJsonFromTxt(path.join(BANKS_DIR, "Ahli.txt"), []);
}

async function fetchAljaziraOffers() {
  return readJsonFromTxt(path.join(BANKS_DIR, "AlJazira.txt"), []);
}

async function fetchAnbOffers() {
  return readJsonFromTxt(path.join(BANKS_DIR, "ANB.txt"), []);
}

async function fetchBsfOffers() {
  return readJsonFromTxt(path.join(BANKS_DIR, "BSF.txt"), []);
}

async function fetchEnbdOffers() {
  return readJsonFromTxt(path.join(BANKS_DIR, "ENBD.txt"), []);
}

async function fetchInmaOffers() {
  return readJsonFromTxt(path.join(BANKS_DIR, "Inma Offer.txt"), []);
}

async function fetchRajhiOffers() {
  return readJsonFromTxt(path.join(BANKS_DIR, "Rajhi.txt"), []);
}

async function fetchRiyadhOffers() {
  return readJsonFromTxt(path.join(BANKS_DIR, "Riyadh Offer.txt"), []);
}

async function fetchSabbOffers() {
  return readJsonFromTxt(path.join(BANKS_DIR, "SABB.txt"), []);
}

async function fetchSaibOffers() {
  return readJsonFromTxt(path.join(BANKS_DIR, "Saib.txt"), []);
}
