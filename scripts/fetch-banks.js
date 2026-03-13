const fs = require("fs/promises");
const path = require("path");
const cheerio = require("cheerio");

const BANKS_DIR = path.join(process.cwd(), "banks");
const RAJHI_BASE = "https://www.alrajhibank.com.sa";
const RAJHI_DISCOUNTS_START = `${RAJHI_BASE}/Personal/Discounts`;
const RAJHI_MAX_DISCOUNT_PAGES = 30;
const RAJHI_MAX_OFFERS = 400;

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
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings(values) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function normalizeWhitespaceLines(text) {
  return String(text || "")
    .split("\n")
    .map((line) => cleanText(line))
    .filter(Boolean)
    .join("\n");
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

function extractTerms($) {
  const terms = [];

  $("h2, h3, h4, h5, strong").each((_, el) => {
    const heading = cleanText($(el).text());

    if (/الشروط|الأحكام|terms/i.test(heading)) {
      let next = $(el).next();

      while (next.length) {
        const tag = (next[0]?.tagName || "").toLowerCase();
        if (["h1", "h2", "h3", "h4", "h5", "strong"].includes(tag)) break;

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

  $("h2, h3, h4, h5, strong").each((_, el) => {
    const heading = cleanText($(el).text());

    if (/تفاصيل العرض|about offer|offer details/i.test(heading)) {
      let next = $(el).next();

      while (next.length) {
        const tag = (next[0]?.tagName || "").toLowerCase();
        if (["h1", "h2", "h3", "h4", "h5", "strong"].includes(tag)) break;

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

  return normalizeWhitespaceLines(uniqueStrings(details).join("\n"));
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

function normalizeRajhiUrl(url) {
  return String(url || "")
    .replace(/[#].*$/, "")
    .replace(/\/+$/, "");
}

function canonicalRajhiUrl(url) {
  return normalizeRajhiUrl(url);
}

function sortRajhiUrls(urls) {
  return [...urls].sort((a, b) => a.localeCompare(b));
}

function isArabicRajhiOfferUrl(url) {
  const u = String(url || "").toLowerCase();
  if (!u.includes("/ar/personal/offers/cardsoffers/")) return false;
  if (/\/ar\/personal\/offers\/cardsoffers\/?$/.test(u)) return false;
  if (u.endsWith("/viewall")) return false;
  return true;
}

function isRajhiDiscountsPage(url) {
  const u = String(url || "").toLowerCase();
  return (
    u.startsWith(`${RAJHI_BASE.toLowerCase()}/personal/discounts`) ||
    u.startsWith(`${RAJHI_BASE.toLowerCase()}/ar/personal/discounts`)
  );
}

function shouldQueueRajhiDiscountPage(url) {
  const u = canonicalRajhiUrl(url).toLowerCase();
  if (!isRajhiDiscountsPage(u)) return false;
  return true;
}

function isProbablyBadTitle(title) {
  const t = cleanText(title).toLowerCase();
  if (!t) return true;

  const badTitles = [
    "al rajhi bank",
    "مصرف الراجحي",
    "offers",
    "العروض",
    "cards offers",
    "عروض البطاقات",
    "e com",
    "others",
    "mokafaa",
    "travel and entertainment",
  ];

  return badTitles.includes(t);
}

function tryExtractEndDateFromText(text) {
  const cleaned = cleanText(text);
  if (!cleaned) return "";

  const labels = [
    "صالح حتى",
    "ينتهي في",
    "تاريخ الانتهاء",
    "valid to",
    "expiry date",
    "expires on",
  ];

  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`${escaped}\\s*:?\\s*(.{1,60})`, "i");
    const match = cleaned.match(regex);

    if (match?.[1]) {
      const candidate = cleanText(match[1]);
      const parsed = parseArabicDate(candidate);
      if (parsed) return parsed;
      if (/\d/.test(candidate)) return candidate;
    }
  }

  const parsedDirect = parseArabicDate(cleaned);
  if (parsedDirect) return parsedDirect;

  return "";
}

function extractMetaImage($) {
  return (
    $("meta[property='og:image']").attr("content") ||
    $("meta[name='twitter:image']").attr("content") ||
    $("img").first().attr("src") ||
    ""
  );
}

async function getRajhiOfferUrlsFromSitemap() {
  return [];
}

function collectRajhiLinksFromDiscountHtml(html, pageUrl) {
  const $ = cheerio.load(html);
  const offerUrls = [];
  const pageUrls = [];

  $("a[href], area[href]").each((_, el) => {
    const href = cleanText($(el).attr("href"));
    const full = canonicalRajhiUrl(absoluteUrl(href, pageUrl));

    if (isArabicRajhiOfferUrl(full)) offerUrls.push(full);
    if (shouldQueueRajhiDiscountPage(full)) pageUrls.push(full);
  });

  $("[data-href], [data-url], [data-link]").each((_, el) => {
    const href =
      cleanText($(el).attr("data-href")) ||
      cleanText($(el).attr("data-url")) ||
      cleanText($(el).attr("data-link"));

    const full = canonicalRajhiUrl(absoluteUrl(href, pageUrl));

    if (isArabicRajhiOfferUrl(full)) offerUrls.push(full);
    if (shouldQueueRajhiDiscountPage(full)) pageUrls.push(full);
  });

  $("script").each((_, el) => {
    const scriptText = $(el).html() || "";

    const absoluteMatches =
      scriptText.match(/https:\/\/www\.alrajhibank\.com\.sa\/[^\s"'\\]+/g) || [];

    for (const raw of absoluteMatches) {
      const full = canonicalRajhiUrl(raw);
      if (isArabicRajhiOfferUrl(full)) offerUrls.push(full);
      if (shouldQueueRajhiDiscountPage(full)) pageUrls.push(full);
    }

    const relativeMatches =
      scriptText.match(/\/(?:ar\/)?Personal\/(?:Discounts|Offers\/CardsOffers)\/[^\s"'\\,]+/g) || [];

    for (const raw of relativeMatches) {
      const full = canonicalRajhiUrl(absoluteUrl(raw, RAJHI_BASE));
      if (isArabicRajhiOfferUrl(full)) offerUrls.push(full);
      if (shouldQueueRajhiDiscountPage(full)) pageUrls.push(full);
    }
  });

  return {
    offerUrls: sortRajhiUrls([...new Set(offerUrls)]),
    pageUrls: sortRajhiUrls([...new Set(pageUrls)]),
  };
}

async function getRajhiOfferUrlsFromPages() {
  const queue = [
    `${RAJHI_BASE}/Personal/Discounts`,
    `${RAJHI_BASE}/ar/Personal/Discounts`,
  ].map(canonicalRajhiUrl);

  const visitedPages = new Set();
  const foundOfferUrls = new Set();

  while (queue.length && visitedPages.size < RAJHI_MAX_DISCOUNT_PAGES) {
    const pageUrl = queue.shift();
    if (!pageUrl || visitedPages.has(pageUrl)) continue;
    if (!shouldQueueRajhiDiscountPage(pageUrl)) continue;

    visitedPages.add(pageUrl);

    try {
      const html = await fetchText(pageUrl);
      const { offerUrls, pageUrls } = collectRajhiLinksFromDiscountHtml(html, pageUrl);

      offerUrls.forEach((url) => foundOfferUrls.add(url));

      for (const nextPage of pageUrls) {
        if (!visitedPages.has(nextPage) && !queue.includes(nextPage)) {
          queue.push(nextPage);
        }
      }

      console.log(
        `Rajhi discount page scanned: ${pageUrl} -> offers=${offerUrls.length}, nextPages=${pageUrls.length}`
      );
    } catch (error) {
      console.error(`Rajhi discount page scan failed for ${pageUrl}: ${error.message}`);
    }
  }

  const unique = sortRajhiUrls([...foundOfferUrls]).slice(0, RAJHI_MAX_OFFERS);
  console.log(`Rajhi discount pages visited: ${visitedPages.size}`);
  console.log(`Rajhi page-discovered URLs: ${unique.length}`);
  return unique;
}

async function getRajhiOfferUrls() {
  const [fromSitemap, fromPages] = await Promise.all([
    getRajhiOfferUrlsFromSitemap(),
    getRajhiOfferUrlsFromPages(),
  ]);

  const merged = sortRajhiUrls(
    [...new Set([...fromSitemap, ...fromPages].map(canonicalRajhiUrl))]
  )
    .filter((url) => isArabicRajhiOfferUrl(url))
    .slice(0, RAJHI_MAX_OFFERS);

  console.log(`Rajhi total merged URLs: ${merged.length}`);

  if (merged.length) {
    console.log("Rajhi sample URLs:", merged.slice(0, 10));
  }

  return merged;
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

    if (!endDate) {
      const extractedDate = tryExtractEndDateFromText(txt);
      if (extractedDate) {
        endDate = extractedDate;
      }
    }

    if (
      !discountText &&
      (txt.includes("%") || /خصم|استرداد|كاش باك|cashback|off|وفر/i.test(txt)) &&
      txt.length <= 220
    ) {
      discountText = txt;
    }
  });

  const details = extractDetails($);
  const termsList = extractTerms($);
  const imageUrl = absoluteUrl(extractMetaImage($), RAJHI_BASE);
  const merchant = inferMerchantFromTitleOrUrl(title, url);

  return {
    id: `alrajhi-${merchant}`
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, ""),
    merchant,
    title,
    category: inferCategoryFromRajhiUrl(url),
    discount: discountText,
    cards: [],
    cardText: "",
    promoCode: null,
    expiryDate: endDate,
    status: "active",
    notes: details,
    terms: termsList,
    link: url,
    imageUrl,
    source: "alrajhi-cards-offers-scraper",
  };
}

function normalizePreviousRajhiOffers(previous) {
  if (Array.isArray(previous)) return previous;
  if (Array.isArray(previous?.offers)) return previous.offers;
  return [];
}

async function updateRajhi() {
  const previous = await readExistingJsonTxt("Rajhi.txt", {});
  const previousOffers = normalizePreviousRajhiOffers(previous);

  try {
    const urls = await getRajhiOfferUrls();

    if (!urls.length) {
      console.warn("Rajhi scraper found 0 URLs. Keeping previous file.");
      await writeJsonTxt("Rajhi.txt", previous);
      return;
    }

    const offers = [];
    const seen = new Set();

    for (const url of urls) {
      try {
        const item = await scrapeRajhiOffer(url);

        if (!item.link || seen.has(item.link)) continue;
        if (isProbablyBadTitle(item.title)) continue;
        if (!(item.title || item.notes || item.link)) continue;

        seen.add(item.link);
        offers.push(item);
      } catch (error) {
        console.error(`Rajhi scrape failed for ${url}: ${error.message}`);
      }
    }

    console.log(`Rajhi offers collected before save: ${offers.length}`);

    if (!offers.length) {
      console.warn("Rajhi scraper returned 0 offers after scraping. Keeping previous file.");
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
