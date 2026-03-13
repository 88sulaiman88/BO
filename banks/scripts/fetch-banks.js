const fs = require("fs/promises");
const path = require("path");
const cheerio = require("cheerio");

const BANKS_DIR = path.join(process.cwd(), "banks");

async function writeJsonTxt(filename, data) {
  const filePath = path.join(BANKS_DIR, filename);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
  console.log(`Saved ${filename} (${Array.isArray(data) ? data.length : 0} items)`);
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
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  return res.text();
}

function absoluteUrl(url, base = "https://www.alrajhibank.com.sa") {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("//")) return `https:${url}`;
  return new URL(url, base).toString();
}

function cleanText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\u200f|\u200e/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings(values) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function parseArabicDate(text) {
  const raw = cleanText(text);
  if (!raw) return "";

  const easternToWestern = raw.replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));

  const months = {
    "يناير": 1,
    "فبراير": 2,
    "مارس": 3,
    "أبريل": 4,
    "ابريل": 4,
    "مايو": 5,
    "يونيو": 6,
    "يوليو": 7,
    "أغسطس": 8,
    "اغسطس": 8,
    "سبتمبر": 9,
    "أكتوبر": 10,
    "اكتوبر": 10,
    "نوفمبر": 11,
    "ديسمبر": 12,
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "may": 5,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12
  };

  const m = easternToWestern.match(/(\d{1,2})\s+([^\s]+)\s+(\d{4})/i);
  if (m) {
    const day = Number(m[1]);
    const monthName = m[2].toLowerCase();
    const year = Number(m[3]);
    const month = months[monthName];
    if (month) {
      return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
    }
  }

  const direct = new Date(easternToWestern);
  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString().slice(0, 10);
  }

  return "";
}

function extractTerms($) {
  const terms = [];

  $("h2, h3, h4, h5").each((_, el) => {
    const heading = cleanText($(el).text());

    if (/الشروط|الأحكام|terms/i.test(heading)) {
      let next = $(el).next();

      while (next.length) {
        const tag = (next[0]?.tagName || "").toLowerCase();
        if (["h1", "h2", "h3", "h4", "h5"].includes(tag)) break;

        if (tag === "ul" || tag === "ol") {
          next.find("li").each((__, li) => {
            const t = cleanText($(li).text());
            if (t) terms.push(t);
          });
        } else {
          const t = cleanText(next.text());
          if (t) terms.push(t);
        }

        next = next.next();
      }
    }
  });

  return uniqueStrings(terms);
}

function extractDetails($) {
  const details = [];

  $("h2, h3, h4, h5").each((_, el) => {
    const heading = cleanText($(el).text());

    if (/تفاصيل العرض|about offer|offer details/i.test(heading)) {
      let next = $(el).next();

      while (next.length) {
        const tag = (next[0]?.tagName || "").toLowerCase();
        if (["h1", "h2", "h3", "h4", "h5"].includes(tag)) break;

        if (tag === "ul" || tag === "ol") {
          next.find("li").each((__, li) => {
            const t = cleanText($(li).text());
            if (t) details.push(t);
          });
        } else {
          const t = cleanText(next.text());
          if (t) details.push(t);
        }

        next = next.next();
      }
    }
  });

  return uniqueStrings(details).join("\n");
}

function inferCategoryFromRajhiUrl(url) {
  const u = String(url || "").toLowerCase();

  if (u.includes("/e-com/")) return "التجارة الإلكترونية";
  if (u.includes("/travel-and-entertainment/")) return "السفر والترفيه";
  if (u.includes("/mokafaa/")) return "مكافأة";
  if (u.includes("/others/")) return "أخرى";

  return "";
}

function inferMerchantFromTitleOrUrl(title, url) {
  const last = decodeURIComponent(String(url || "").split("/").filter(Boolean).pop() || "")
    .replace(/[-_]+/g, " ")
    .trim();

  if (!title) return last;

  const firstChunk = title.split(" - ")[0].trim();
  return firstChunk || last;
}

async function getRajhiOfferUrlsFromSitemap() {
  const xml = await fetchText("https://www.alrajhibank.com.sa/sitemap.xml");

  const matches = [...xml.matchAll(/<loc>(.*?)<\/loc>/gi)].map((m) => m[1]);

  const urls = matches
    .map((u) => absoluteUrl(u, "https://www.alrajhibank.com.sa"))
    .filter((u) => /\/(ar|en)\/Personal\/Offers\/CardsOffers\//i.test(u))
    .filter((u) => !/\/(ar|en)\/Personal\/Offers\/CardsOffers\/?$/i.test(u));

  return [...new Set(urls)];
}

async function scrapeRajhiOffer(url) {
  const html = await fetchText(url);
  const $ = cheerio.load(html);

  const title =
    cleanText($("h1").first().text()) ||
    cleanText($("meta[property='og:title']").attr("content")) ||
    cleanText($("title").text());

  let discountText = "";
  let endDate = "";

  $("body *").each((_, el) => {
    const txt = cleanText($(el).text());
    if (!txt) return;

    if (!endDate && /صالح حتى|valid to/i.test(txt)) {
      const normalized = txt
        .replace(/.*?(صالح حتى:?)/i, "")
        .replace(/.*?(valid to:?)/i, "")
        .trim();

      endDate = parseArabicDate(normalized) || normalized;
    }

    if (
      !discountText &&
      (txt.includes("%") || /خصم|استرداد|كاش باك|cashback|off/i.test(txt)) &&
      txt.length <= 220
    ) {
      discountText = txt;
    }
  });

  const details = extractDetails($);
  const termsList = extractTerms($);

  const imageUrl = absoluteUrl(
    $("meta[property='og:image']").attr("content") ||
      $("img").first().attr("src") ||
      "",
    "https://www.alrajhibank.com.sa"
  );

  const merchant = inferMerchantFromTitleOrUrl(title, url);

  return {
    bank: "مصرف الراجحي",
    bankCode: "alrajhi",
    title,
    merchant,
    category: inferCategoryFromRajhiUrl(url),
    discountText,
    details,
    terms: termsList.join("\n"),
    startDate: "",
    endDate,
    offerUrl: url,
    imageUrl,
    tags: ["rajhi", "cards-offers"]
  };
}

async function updateRajhi() {
  const urls = await getRajhiOfferUrlsFromSitemap();
  console.log(`Rajhi sitemap URLs found: ${urls.length}`);

  const offers = [];

  for (const url of urls) {
    try {
      const item = await scrapeRajhiOffer(url);

      if (item.title || item.details || item.offerUrl) {
        offers.push(item);
      }
    } catch (error) {
      console.error(`Rajhi scrape failed for ${url}: ${error.message}`);
    }
  }

  const filtered = offers.filter((o) => {
    const u = String(o.offerUrl || "").toLowerCase();
    return u.includes("/personal/offers/cardsoffers/");
  });

  await writeJsonTxt("Rajhi.txt", filtered);
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
