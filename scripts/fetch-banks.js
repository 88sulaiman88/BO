const fs = require("fs/promises");
const path = require("path");
const cheerio = require("cheerio");

const BANKS_DIR = path.join(process.cwd(), "banks");
const RAJHI_BASE = "https://www.alrajhibank.com.sa";
const RAJHI_MAX_CATEGORY_PAGES = 20;
const RAJHI_MAX_OFFERS = 500;

const BSF_BASE = "https://bsf.sa";
const BSF_LISTING_ENDPOINT = `${BSF_BASE}/Toolkit/GetListingPaging`;
const BSF_MAX_PAGES = 20;

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

async function postFormJson(url, formData, referer = `${BSF_BASE}/arabic/personal/cards/offers/all-offers`) {
  const body = new URLSearchParams(formData).toString();

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "user-agent": "Mozilla/5.0",
      "accept-language": "ar,en;q=0.9",
      accept: "application/json, text/javascript, */*; q=0.01",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      origin: BSF_BASE,
      referer,
    },
    body,
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

  const storeWebsite = extractXmlLinkHref(fields.StoreWebsite?.value) || "";

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
        console.error(
          `Rajhi category fetch failed (${category.title} page ${page}): ${error.message}`
        );
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

/* ===== BSF ===== */

function normalizeBsfUrl(url) {
  return String(url || "")
    .replace(/[#?].*$/, "")
    .replace(/\/+$/, "");
}

function inferBsfCategoryFromPath(pageUrl) {
  const u = String(pageUrl || "").toLowerCase();
  if (u.endsWith("/travel")) return "السفر";
  if (u.endsWith("/live-well")) return "أسلوب حياة";
  if (u.endsWith("/shopping")) return "التسوق";
  if (u.endsWith("/restaurants")) return "المطاعم";
  if (u.endsWith("/entertainment")) return "الترفيه";
  return "كل العروض";
}

function extractBsfOfferBlocks($) {
  return $("li.listingItemLI, li[class*='listingItemLI']").toArray();
}

function parseBsfExpiry(text) {
  const raw = cleanText(text);
  if (!raw) return "";

  const matches = [
    ...raw.matchAll(/(\d{1,2}\s+[^\s]+\s+\d{4})/gi),
    ...raw.matchAll(/(\d{1,4}[\/\-]\d{1,2}[\/\-]\d{1,4})/gi),
  ];

  for (const match of matches) {
    const parsed = parseArabicDate(match[1]);
    if (parsed) return parsed;
  }

  return "";
}

function parseBsfDiscount(text) {
  const raw = cleanText(text);
  if (!raw) return "";

  const patterns = [
    /خصم\s*يصل\s*إلى\s*\d+%/i,
    /خصم\s*\d+%/i,
    /\d+%\s*خصم/i,
    /اشتر\s*واحدة\s*واحصل\s*على\s*الأخرى/i,
    /الثانية\s*مجانا|الثانية\s*مجاناً/i,
    /استرداد\s*نقدي/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[0]) return cleanText(match[0]);
  }

  return "";
}

function parseBsfTitle(node, $) {
  const preferred = [
    node.find(".cards strong").first().text(),
    node.find("strong").first().text(),
    node.find("h1,h2,h3,h4,h5").first().text(),
    node.find("img").first().attr("alt"),
    node.find("a").first().text(),
  ];

  for (const value of preferred) {
    const text = cleanText(value);
    if (text) return text;
  }

  return "";
}

function extractBsfVerificationToken($) {
  return (
    cleanText($('input[name="__RequestVerificationToken"]').attr("value")) ||
    cleanText($('input[name="__RequestVerificationToken"]').first().val()) ||
    ""
  );
}

function extractBsfPageId($) {
  const text = $.html() || "";

  const patterns = [
    /pageId["']?\s*[:=]\s*["']?(\d+)/i,
    /pageid["']?\s*[:=]\s*["']?(\d+)/i,
    /name=["']pageId["'][^>]*value=["']?(\d+)/i,
    /\bpageId=(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return cleanText(match[1]);
  }

  return "10881";
}

function extractBsfPortletId($) {
  const text = $.html() || "";

  const patterns = [
    /pagePortletID["']?\s*[:=]\s*["']?(\d+)/i,
    /pageportletid["']?\s*[:=]\s*["']?(\d+)/i,
    /name=["']pagePortletID["'][^>]*value=["']?(\d+)/i,
    /\bpagePortletID=(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return cleanText(match[1]);
  }

  return "999123456";
}

function extractBsfCondition($) {
  const text = $.html() || "";

  const patterns = [
    /condition["']?\s*[:=]\s*["']([^"']+)["']/i,
    /name=["']condition["'][^>]*value=["']([^"']+)["']/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return cleanText(match[1]);
  }

  return "and MenuShowInMenu<>0";
}

function extractBsfLang($) {
  const htmlLang = cleanText($("html").attr("lang")).toLowerCase();
  if (htmlLang === "ar") return "3";
  return "3";
}

function parseBsfOffersFromHtml(html, pageUrl, category) {
  const $ = cheerio.load(html);
  const blocks = extractBsfOfferBlocks($);
  const offers = [];
  const seen = new Set();

  for (const el of blocks) {
    const node = $(el);
    const href = cleanText(node.find("a.item[href]").attr("href") || node.find("a[href]").first().attr("href"));
    const fullUrl = normalizeBsfUrl(absoluteUrl(href, BSF_BASE));
    if (!fullUrl.startsWith(BSF_BASE)) continue;

    const text = cleanText(node.find(".text").text() || node.text());
    const dateText = cleanText(node.find(".date").text());
    const title = parseBsfTitle(node, $);
    const merchant = title || cleanText(node.find("img").first().attr("alt")) || "";
    const expiryDate = parseBsfExpiry(dateText || text);
    const discount = parseBsfDiscount(text);
    const imageUrl = absoluteUrl(node.find("img").first().attr("src") || "", BSF_BASE);

    const key = `${fullUrl}||${title}`;
    if (seen.has(key)) continue;
    seen.add(key);

    offers.push({
      id: `bsf-${cleanText(fullUrl || title || merchant)}`
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-+|-+$/g, ""),
      merchant,
      title: title || merchant || "عرض البنك السعودي الفرنسي",
      category,
      discount,
      cards: [],
      cardText: "",
      promoCode: null,
      expiryDate,
      status: "active",
      notes: text,
      terms: [],
      link: fullUrl,
      imageUrl,
      source: "bsf-offers-pages-scraper",
    });
  }

  return offers;
}

async function scrapeBsfOfferDetail(url, fallback = {}) {
  try {
    const html = await fetchText(url);
    const $ = cheerio.load(html);

    const title =
      cleanText($("h1").first().text()) ||
      cleanText($("meta[property='og:title']").attr("content")) ||
      fallback.title ||
      "";

    const bodyText = cleanText($("main").text() || $("body").text());
    const details =
      cleanHtmlText($("main").text()) ||
      cleanHtmlText($("article").text()) ||
      fallback.notes ||
      "";

    const imageUrl = absoluteUrl(
      $("meta[property='og:image']").attr("content") ||
        $("img").first().attr("src") ||
        fallback.imageUrl ||
        "",
      BSF_BASE
    );

    const expiryDate = fallback.expiryDate || parseBsfExpiry(bodyText);
    const discount = fallback.discount || parseBsfDiscount(bodyText);

    return {
      ...fallback,
      title: title || fallback.title || "عرض البنك السعودي الفرنسي",
      merchant: fallback.merchant || title || fallback.title || "",
      notes: details || fallback.notes || "",
      expiryDate,
      discount,
      imageUrl,
      link: url,
    };
  } catch (error) {
    console.error(`BSF detail fetch failed for ${url}: ${error.message}`);
    return {
      ...fallback,
      link: url,
    };
  }
}

async function scrapeBsfListingPage(pageUrl) {
  const html = await fetchText(pageUrl);
  const $ = cheerio.load(html);
  const category = inferBsfCategoryFromPath(pageUrl);

  const firstPageOffers = parseBsfOffersFromHtml(html, pageUrl, category);

  const token = extractBsfVerificationToken($);
  const pageId = extractBsfPageId($);
  const pagePortletID = extractBsfPortletId($);
  const condition = extractBsfCondition($);
  const lang = extractBsfLang($);

  console.log(
    `BSF paging config for ${pageUrl}: token=${token ? "yes" : "no"}, pageId=${pageId}, pagePortletID=${pagePortletID}, condition=${condition}, lang=${lang}`
  );

  const allOffers = [...firstPageOffers];
  const seen = new Set(firstPageOffers.map((x) => `${x.link}||${x.title}`));

  if (!token || !pageId || !pagePortletID) {
    return allOffers;
  }

  let totalRecords = null;
  let stalePages = 0;

  for (let page = 2; page <= BSF_MAX_PAGES; page++) {
    try {
      const response = await postFormJson(
        BSF_LISTING_ENDPOINT,
        {
          pageId,
          pagePortletID,
          page: String(page),
          condition: ` ${condition} `,
          lang,
          __RequestVerificationToken: token,
        },
        pageUrl
      );

      if (!response?.success) {
        console.error(`BSF load more returned unsuccessful response for ${pageUrl} page ${page}`);
        break;
      }

      if (typeof response?.totalRecords === "number") {
        totalRecords = response.totalRecords;
      }

      const htmlChunk = response?.html || "";
      const nextOffers = parseBsfOffersFromHtml(htmlChunk, pageUrl, category);

      let added = 0;
      for (const item of nextOffers) {
        const key = `${item.link}||${item.title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        allOffers.push(item);
        added += 1;
      }

      console.log(
        `BSF load more for ${pageUrl} page ${page}: raw=${nextOffers.length}, added=${added}, totalRecords=${totalRecords ?? "?"}, collected=${allOffers.length}`
      );

      if (totalRecords && allOffers.length >= totalRecords) {
        break;
      }

      if (!nextOffers.length || added === 0) {
        stalePages += 1;
      } else {
        stalePages = 0;
      }

      if (stalePages >= 2) {
        break;
      }
    } catch (error) {
      console.error(`BSF load more failed for ${pageUrl} page ${page}: ${error.message}`);
      break;
    }
  }

  return allOffers;
}

async function updateBSF() {
  const previous = await readExistingJsonTxt("BSF.txt", {});
  const previousOffers = Array.isArray(previous?.offers)
    ? previous.offers
    : Array.isArray(previous)
      ? previous
      : [];

  const pages = [
    `${BSF_BASE}/arabic/personal/cards/offers/all-offers`,
    `${BSF_BASE}/arabic/personal/cards/offers/travel`,
    `${BSF_BASE}/arabic/personal/cards/offers/live-well`,
    `${BSF_BASE}/arabic/personal/cards/offers/shopping`,
    `${BSF_BASE}/arabic/personal/cards/offers/restaurants`,
    `${BSF_BASE}/arabic/personal/cards/offers/entertainment`,
  ];

  try {
    const allOffers = [];
    const seen = new Set();

    for (const pageUrl of pages) {
      try {
        const pageOffers = await scrapeBsfListingPage(pageUrl);
        console.log(`BSF page scanned: ${pageUrl} -> ${pageOffers.length} offers`);

        for (const rawItem of pageOffers) {
          const key = `${rawItem.link}||${rawItem.title}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const enriched = await scrapeBsfOfferDetail(rawItem.link, rawItem);
          allOffers.push(enriched);
        }
      } catch (error) {
        console.error(`BSF page scan failed for ${pageUrl}: ${error.message}`);
      }
    }

    console.log(`BSF offers collected before save: ${allOffers.length}`);

    if (!allOffers.length) {
      console.warn("BSF scraper returned 0 offers. Keeping previous file.");
      await writeJsonTxt("BSF.txt", previous);
      return;
    }

    const wrapped = {
      bank: "البنك السعودي الفرنسي",
      bankCode: "bsf",
      source: pages,
      lastChecked: todayIsoDate(),
      fetchedCount: allOffers.length,
      previousCount: previousOffers.length,
      offers: allOffers,
    };

    await writeJsonTxt("BSF.txt", wrapped);
  } catch (error) {
    console.error(`BSF update failed بالكامل: ${error.message}`);
    await writeJsonTxt("BSF.txt", previous);
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
