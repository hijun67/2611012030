// api.mjs 와 tick.mjs 가 함께 쓰는 공통 코드
export const UA = "Mozilla/5.0 (compatible; CardNewsBot/1.0)";
export const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[)/i;
export const okHost = u => process.env.ALLOW_ANY === "1" || /(^|\.)(blogspot\.[a-z.]+|blogger\.com)$/i.test(u.hostname);

export function decode(s) {
  return s
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function extractBody(html) {
  const open = /<div[^>]*class=['"][^'"]*post-body[^'"]*['"][^>]*>/i.exec(html);
  if (!open) return "";
  const start = open.index + open[0].length;
  const re = /<(\/?)div\b[^>]*>/gi;
  re.lastIndex = start;
  let depth = 1, m;
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index);
  }
  return html.slice(start);
}

function meta(html, prop) {
  const r = new RegExp(`<meta[^>]+(?:property|name)=['"]${prop}['"][^>]*content=['"]([^'"]*)['"]`, "i");
  const r2 = new RegExp(`<meta[^>]+content=['"]([^'"]*)['"][^>]*(?:property|name)=['"]${prop}['"]`, "i");
  const m = r.exec(html) || r2.exec(html);
  return m ? decode(m[1]) : "";
}

export function parsePost(html, url) {
  const title = meta(html, "og:title") || decode((/<title>([^<]*)<\/title>/i.exec(html) || [, ""])[1]);
  const body = extractBody(html);
  const images = [];
  body.replace(/<img[^>]+src=['"]([^'"]+)['"]/gi, (_, src) => {
    src = decode(src);
    if (/^https?:/.test(src) && !images.includes(src)) images.push(src);
  });
  const text = decode(
    body
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h\d|blockquote)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  ).split("\n").map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
  const ogImg = meta(html, "og:image");
  if (!images.length && ogImg) images.push(ogImg);
  return { title, text, images, url };
}

const GRAPH = "https://graph.threads.net/v1.0";
export async function tpost(p, params) {
  const r = await fetch(`${GRAPH}/${p}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, access_token: process.env.THREADS_ACCESS_TOKEN || "" }),
  });
  const d = await r.json();
  if (!r.ok || d.error) throw new Error((d.error && d.error.message) || `Threads 오류 ${r.status}`);
  return d;
}
