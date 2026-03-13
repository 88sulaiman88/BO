const fs = require("fs/promises");
const path = require("path");
const cheerio = require("cheerio");

const BANKS_DIR = path.join(process.cwd(), "banks");
const RAJHI_BASE = "https://www.alrajhibank.com.sa";
const RAJHI_MAX_CATEGORY_PAGES = 20;
const RAJHI_MAX_OFFERS = 500;

async function writeJsonTxt(filename, data) {
  const filePath = path.join(BANKS_DIR, filename);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
  console.log(
    `Saved ${filename} (${Array.isArray(data) ? data.length : (data?.offers?.length || 0)} items)`
  );
}

async function readExistingJsonTxt(filename, fallback = []) {
  try {
    const filePath = path.join(BANKS_DIR, filename);
    const txt = await fs.readFile(filePath, "utf8");
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      "accept-language": "ar,en;q=0.9",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "cache-control": "no-cache",
      pragma: "no-cache",
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  return res.text();
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      "accept-language": "ar,en;q=0.9",
      accept: "application/json,text/plain,*/*",
      "x-nextjs-data": "1",
      "cache-control": "no-cache",
      pragma: "no-cache",
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  return res.json();
}

function absoluteUrl(url, base = RAJHI_BASE) {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("//")) return `https:${url}`;
  try {
    return new URL(url, base).toString();
  } catch {
    return "";
  }
}

function cleanText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\u200f|\u200e/g, "")
    .replace(/\t+/g, " ")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ ]{2,}/g, " ")
    .trim();
}

function uniqueStrings(values) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function parseArabicDate(text) {
  const raw = cleanText(text);
  if (!raw) return "";

  const easternToWestern = raw.replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));

  const months = {
    يناير: 1,
    فبراير: 2,
    مارس: 3,
    أبريل: 4,
    ابريل: 4,
    مايو: 5,
    يونيو: 6,
    يوليو: 7,
    أغسطس: 8,
    اغسطس: 8,
    سبتمبر: 9,
    أكتوبر: 10,
    اكتوبر: 10,
    نوفمبر: 11,
    ديسمبر: 12,
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
  };

  const monthTextMatch = easternToWestern.match(/(\d{1,2})\s+([^\s]+)\s+(\d{4})/i);
  if (monthTextMatch) {
    const day = Number(monthTextMatch[1]);
    const monthName = monthTextMatch[2].toLowerCase();
    const year = Number(monthTextMatch[3]);
    const month = months[monthName];
    if (month) {
      return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
    }
  }

  const slashMatch = easternToWestern.match(/(\d{1,4})[\/\-](\d{1,2})[\/\-](\d{1,4})/);
  if (slashMatch) {
    const a = Number(slashMatch[1]);
    const b = Number(slashMatch[2]);
    const c = Number(slashMatch[3]);

    if (String(a).length === 4) {
      const d = new Date(Date.UTC(a, b - 1, c));
      if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }

    if (String(c).length === 4) {
      const d = new Date(Date.UTC(c, b - 1, a));
      if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  }

  const direct = new Date(easternToWestern);
  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString().slice(0, 10);
  }

  return "";
}

function inferCategoryFromRajhiUrl(url) {
  const u = String(url || "").toLowerCase();

  if (u.includes("/finance-offers/")) return "عروض التمويل";
  if (u.includes("/travel-and-entertainment/")) return "السفر والترفيه";
  if (u.includes("/furniture-and-home-appliances/")) return "الأثاث والأجهزة المنزلية";
  if (u.includes("/car-services/")) return "خدمات السيارات";
  if (u.includes("/e-com/")) return "التجارة الإلكترونية";
  if (u.includes("/mokafaa/")) return "مكافأة";
  if (u.includes("/others/")) return "أخرى";

  return "";
}

function extractXmlLinkHref(value) {
  const raw = String(value || "");
  if (!raw) return "";

  const urlMatch = raw.match(/url="([^"]+)"/i);
  if (urlMatch?.[1]) return urlMatch[1];

  const hrefMatch = raw.match(/href="([^"]+)"/i);
  if (hrefMatch?.[1]) return hrefMatch[1];

  return "";
}

function cleanHtmlText(value) {
  return cleanText(
    String(value || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
  );
}

function splitTerms(text) {
  const cleaned = cleanHtmlText(text);
  if (!cleaned) return [];

  return uniqueStrings(
    cleaned
      .split(/\n|•|●|▪|-+/g)
      .map((x) => x.trim())
      .filter(Boolean)
  );
}

function discoverRajhiBuildIdFromHtml(html) {
  const match = html.match(/\/_next\/data\/([^/]+)\/ar\/Personal\/Discounts\.json/i);
  return match?.[1] || "";
}

async function discoverRajhiBuildId() {
  const html = await fetchText(`${RAJHI_BASE}/Personal/Discounts`);
  const buildId = discoverRajhiBuildIdFromHtml(html);
  if (!buildId) {
    throw new Error("Could not discover Rajhi Next.js build ID");
  }
  return buildId;
}

function buildRajhiDiscountsJsonUrl(buildId, page = 1, category = "") {
  const url = new URL(`${RAJHI_BASE}/_next/data/${buildId}/ar/Personal/Discounts.json`);
  if (category) {
    url.searchParams.set("category", category);
  }
  url.searchParams.set("sort", "Default");
  url.searchParams.set("page", String(page));
  url.searchParams.append("path", "Personal");
  url.searchParams.append("path", "Discounts");
  return url.toString();
}

function extractRajhiBestOffer(json) {
  return json?.pageProps?.layoutData?.sitecore?.route?.fields?.BestOffer || [];
}

function isRajhiCategoryItem(item) {
  const fields = item?.fields || {};
  return (
    cleanText(fields.Title?.value) &&
    !cleanText(fields.OfferTitle?.value) &&
    !cleanText(fields.AboutOffer?.value) &&
    !cleanText(fields.HowToRedeemOffer?.value) &&
    !cleanText(fields.ExpiryDate?.value)
  );
}

function isRajhiOfferItem(item) {
  const fields = item?.fields || {};
  return Boolean(
    cleanText(fields.OfferTitle?.value) ||
    cleanText(fields.AboutOffer?.value) ||
    cleanText(fields.HowToRedeemOffer?.value) ||
    cleanText(fields.ExpiryDate?.value) ||
    cleanText(fields.SubTitle?.value)
  );
}

function extractRajhiCategories(json) {
  const bestOffer = extractRajhiBestOffer(json);

  return bestOffer
    .filter((item) => item?.fields?.IsActive?.value !== false)
    .filter(isRajhiCategoryItem)
    .map((item) => ({
      id: cleanText(item?.id),
      title: cleanText(item?.fields?.Title?.value || item?.displayName || item?.name),
      url: absoluteUrl(item?.url, RAJHI_BASE),
    }))
    .filter((x) => x.id);
}

function extractRajhiOffersOnly(json) {
  return extractRajhiBestOffer(json)
    .filter((item) => item?.fields?.IsActive?.value !== false)
    .filter(isRajhiOfferItem);
}

function mapRajhiOfferItem(item) {
  const fields = item?.fields || {};

  const title =
    cleanText(fields.OfferTitle?.value) ||
    cleanText(fields.Title?.value) ||
    cleanText(item?.displayName) ||
    cleanText(item?.name);

  const merchant =
    cleanText(fields.OfferTitle?.value) ||
    cleanText(fields.Title?.value) ||
    cleanText(item?.displayName) ||
    cleanText(item?.name);

  const details = cleanHtmlText(fields.AboutOffer?.value);
  const terms = splitTerms(fields.HowToRedeemOffer?.value);

  const storeWebsite =
    extractXmlLinkHref(fields.StoreWebsite?.value) || "";

  const link = absoluteUrl(item?.url, RAJHI_BASE);

  const imageUrl = absoluteUrl(
    fields.Logo?.value?.src ||
      fields.CardImage?.value?.src ||
      fields.BannerImage?.value?.src,
    RAJHI_BASE
  );

  const startDate = cleanText(fields.StartDate?.value);
  const expiryDate = cleanText(fields.ExpiryDate?.value);

  const discount =
    cleanText(fields.SubTitle?.value) ||
    cleanText(fields.Discount?.value) ||
    cleanText(fields.AboutOffer?.value);

  return {
    id: `alrajhi-${cleanText(item?.id || merchant || title)}`
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, ""),
    merchant,
    title,
    category: inferCategoryFromRajhiUrl(link),
    discount,
    cards: [],
    cardText: "",
    promoCode: cleanText(fields.PromoCode?.value),
    expiryDate,
    startDate,
    status: fields.IsActive?.value === false ? "inactive" : "active",
    notes: details,
    terms,
    link,
    storeWebsite,
    imageUrl,
    source: "alrajhi-next-data",
  };
}

function normalizePreviousRajhiOffers(previous) {
  if (Array.isArray(previous)) return previous;
  if (Array.isArray(previous?.offers)) return previous.offers;
  return [];
}

async function collectRajhiOffersFromJson(buildId) {
  const firstJsonUrl = buildRajhiDiscountsJsonUrl(buildId, 1, "");
  const firstJson = await fetchJson(firstJsonUrl);

  const categories = extractRajhiCategories(firstJson);
  console.log(`Rajhi categories found: ${categories.length}`);

  const offers = [];
  const seenLinks = new Set();

  function appendOffers(items, label) {
    let added = 0;

    for (const item of items) {
      const mapped = mapRajhiOfferItem(item);
      if (!mapped.link) continue;
      if (seenLinks.has(mapped.link)) continue;

      seenLinks.add(mapped.link);
      offers.push(mapped);
      added += 1;
    }

    console.log(`Rajhi collected from ${label}: raw=${items.length}, added=${added}`);
    return added;
  }

  appendOffers(extractRajhiOffersOnly(firstJson), "root page 1");

  for (const category of categories) {
    let stalePages = 0;

    for (let page = 1; page <= RAJHI_MAX_CATEGORY_PAGES; page++) {
      try {
        const url = buildRajhiDiscountsJsonUrl(buildId, page, category.id);
        const json = await fetchJson(url);
        const items = extractRajhiOffersOnly(json);
        const added = appendOffers(items, `${category.title} page ${page}`);

        if (!items.length || added === 0) {
          stalePages += 1;
        } else {
          stalePages = 0;
        }

        if (stalePages >= 2) {
          break;
        }

        if (offers.length >= RAJHI_MAX_OFFERS) {
          return offers.slice(0, RAJHI_MAX_OFFERS);
        }
      } catch (error) {
        console.error(`Rajhi category fetch failed (${category.title} page ${page}): ${error.message}`);
        break;
      }
    }
  }

  return offers.slice(0, RAJHI_MAX_OFFERS);
}

async function updateRajhi() {
  const previous = await readExistingJsonTxt("Rajhi.txt", {});
  const previousOffers = normalizePreviousRajhiOffers(previous);

  try {
    const buildId = await discoverRajhiBuildId();
    console.log(`Rajhi build ID: ${buildId}`);

    const offers = await collectRajhiOffersFromJson(buildId);

    console.log(`Rajhi offers collected before save: ${offers.length}`);

    if (!offers.length) {
      console.warn("Rajhi scraper returned 0 offers after JSON fetch. Keeping previous file.");
      await writeJsonTxt("Rajhi.txt", previous);
      return;
    }

    const wrapped = {
      bank: "مصرف الراجحي",
      bankCode: "alrajhi",
      source: `${RAJHI_BASE}/Personal/Discounts`,
      lastChecked: todayIsoDate(),
      fetchedCount: offers.length,
      previousCount: previousOffers.length,
      offers,
    };

    await writeJsonTxt("Rajhi.txt", wrapped);
  } catch (error) {
    console.error(`Rajhi update failed بالكامل: ${error.message}`);
    await writeJsonTxt("Rajhi.txt", previous);
  }
}

/* ===== Placeholder updaters لبقية البنوك ===== */

async function preserveExistingFile(filename) {
  const existing = await readExistingJsonTxt(filename, []);
  await writeJsonTxt(filename, existing);
}

async function updateAhli() {
  await preserveExistingFile("Ahli.txt");
}

async function updateAlJazira() {
  await preserveExistingFile("AlJazira.txt");
}

async function updateANB() {
  await preserveExistingFile("ANB.txt");
}

async function updateBSF() {
  await preserveExistingFile("BSF.txt");
}

async function updateENBD() {
  await preserveExistingFile("ENBD.txt");
}

async function updateInma() {
  await preserveExistingFile("Inma Offer.txt");
}

async function updateRiyadh() {
  await preserveExistingFile("Riyadh Offer.txt");
}

async function updateSABB() {
  await preserveExistingFile("SABB.txt");
}

async function updateSaib() {
  await preserveExistingFile("Saib.txt");
}

async function main() {
  await fs.mkdir(BANKS_DIR, { recursive: true });

  const jobs = [
    ["Ahli", updateAhli],
    ["AlJazira", updateAlJazira],
    ["ANB", updateANB],
    ["BSF", updateBSF],
    ["ENBD", updateENBD],
    ["Inma", updateInma],
    ["Rajhi", updateRajhi],
    ["Riyadh", updateRiyadh],
    ["SABB", updateSABB],
    ["Saib", updateSaib],
  ];

  for (const [name, job] of jobs) {
    try {
      console.log(`Updating ${name}...`);
      await job();
    } catch (error) {
      console.error(`Failed updating ${name}: ${error.message}`);
    }
  }
}

main().catch((err) => {
  console.error("fetch-banks failed:", err);
  process.exit(1);
});
