import { getStore } from "@netlify/blobs";
import { UA, PRIVATE, okHost, parsePost } from "../../lib/shared.mjs";

const json = (d, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const env = k => process.env[k] || "";
const rid = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, "0")).join("");

async function list(q) {
  let u;
  try { u = new URL(q.get("blog")); } catch { return json({ error: "주소 형식이 올바르지 않아요." }, 400); }
  if (PRIVATE.test(u.hostname) || !okHost(u)) return json({ error: "blogspot.com 주소만 가능해요." }, 400);
  const start = +q.get("start") || 1;
  const r = await fetch(`${u.origin}/feeds/posts/summary?alt=json&max-results=20&start-index=${start}`, { headers: { "User-Agent": UA } });
  if (!r.ok) return json({ error: `목록 응답 오류 (${r.status})` }, 502);
  const f = (await r.json()).feed;
  const posts = (f.entry || []).map(e => ({
    title: e.title.$t,
    url: (e.link.find(l => l.rel === "alternate") || {}).href,
    date: (e.published || {}).$t,
    thumb: (e.media$thumbnail || {}).url || "",
  }));
  return json({ posts, total: +((f.openSearch$totalResults || {}).$t || 0), next: start + posts.length });
}

async function fetchPost(q) {
  let u;
  try { u = new URL(q.get("url")); } catch { return json({ error: "주소 형식이 올바르지 않아요." }, 400); }
  if (!/^https?:$/.test(u.protocol) || PRIVATE.test(u.hostname) || !okHost(u)) return json({ error: "blogspot.com 주소만 가능해요." }, 400);
  const r = await fetch(u, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!r.ok) return json({ error: `블로그 응답 오류 (${r.status})` }, 502);
  const post = parsePost(await r.text(), u.origin + u.pathname);
  if (!post.text) return json({ error: "본문을 찾지 못했어요. 글 상세 주소인지 확인해 주세요." }, 422);
  return json(post);
}

async function img(q) {
  let u;
  try { u = new URL(q.get("url")); } catch { return new Response("bad url", { status: 400 }); }
  if (u.protocol !== "https:" || PRIVATE.test(u.hostname)) return new Response("https only", { status: 400 });
  const r = await fetch(u, { headers: { "User-Agent": UA } });
  const type = r.headers.get("content-type") || "";
  if (!r.ok || !type.startsWith("image/")) return new Response("not image", { status: 502 });
  const buf = await r.arrayBuffer();
  if (buf.byteLength > 6 * 1024 * 1024) return new Response("too large", { status: 413 });
  return new Response(buf, { headers: { "content-type": type } });
}

async function summarize(req) {
  const body = await req.json();
  if (!env("ANTHROPIC_API_KEY")) return json({ cards: null, note: "ANTHROPIC_API_KEY가 없어 본문을 단순 분할합니다." });
  const prompt = `다음 블로그 글을 인스타그램 카드뉴스로 요약해 JSON만 출력하세요(코드블록 금지).
형식: {"cover":{"title":"","subtitle":""},"cards":[{"head":"","body":""}],"outro":{"title":"","body":""}}
규칙: 한국어. cover.title 25자 이내로 호기심을 끌게, subtitle 40자 이내. cards는 5~7개, head 20자 이내, body 90자 이내로 핵심만 쉬운 말로. outro는 한 줄 요약과 행동 유도. 원문에 없는 사실은 만들지 마세요.

제목: ${body.title}
본문:
${String(body.text).slice(0, 8000)}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: env("ANTHROPIC_MODEL") || "claude-sonnet-5-5", max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) return json({ cards: null, note: `요약 API 오류(${r.status}) - 단순 분할로 대체` });
  const data = await r.json();
  const txt = (data.content || []).map(c => c.text || "").join("").replace(/```json|```/g, "").trim();
  try { return json({ cards: JSON.parse(txt) }); }
  catch { return json({ cards: null, note: "요약 결과를 해석하지 못해 단순 분할로 대체" }); }
}

export default async (req) => {
  try {
    const u = new URL(req.url);
    const store = getStore("cardnews");

    const cm = /^\/cards\/([a-f0-9]{16})\.jpg$/.exec(u.pathname);
    if (cm) {
      const d = await store.get("cards/" + cm[1], { type: "arrayBuffer" });
      if (!d) return new Response("not found", { status: 404 });
      return new Response(d, { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=86400" } });
    }

    if (env("ACCESS_CODE") && u.searchParams.get("code") !== env("ACCESS_CODE"))
      return json({ error: "접속 코드가 올바르지 않아요." }, 401);

    const p = u.pathname, q = u.searchParams;
    if (p === "/api/list") return await list(q);
    if (p === "/api/fetch") return await fetchPost(q);
    if (p === "/api/img") return await img(q);
    if (p === "/api/summarize" && req.method === "POST") return await summarize(req);

    if (p === "/api/upload" && req.method === "POST") {
      const { dataUrl } = await req.json();
      const m = /^data:image\/jpeg;base64,(.+)$/.exec(dataUrl || "");
      if (!m) return json({ error: "JPEG 이미지가 아니에요." }, 400);
      const bytes = Uint8Array.from(atob(m[1]), c => c.charCodeAt(0));
      if (bytes.length > 5 * 1024 * 1024) return json({ error: "이미지가 너무 커요." }, 413);
      const id = rid(8);
      await store.set("cards/" + id, bytes.buffer);
      return json({ url: `${env("PUBLIC_BASE_URL").replace(/\/$/, "") || u.origin}/cards/${id}.jpg` });
    }

    if (p === "/api/queue" && req.method === "POST") {
      if (!env("THREADS_ACCESS_TOKEN")) return json({ error: "THREADS_ACCESS_TOKEN이 설정되지 않았어요." }, 400);
      const { jobs } = await req.json();
      for (const j of jobs || []) {
        if (!Array.isArray(j.images) || j.images.length < 2 || j.images.length > 20) return json({ error: "카드는 2~20장이어야 해요." }, 400);
      }
      for (const j of jobs || []) {
        const id = rid(6);
        await store.setJSON("jobs/" + id, { id, title: String(j.title || "").slice(0, 100), text: String(j.text || "").slice(0, 500),
          images: j.images, runAt: +j.runAt, status: "pending" });
      }
      return json({ ok: true });
    }

    if (p === "/api/queue") {
      const { blobs } = await store.list({ prefix: "jobs/" });
      const all = (await Promise.all(blobs.map(b => store.get(b.key, { type: "json" })))).filter(Boolean);
      all.sort((a, b) => a.runAt - b.runAt);
      return json({ jobs: all.map(({ images, kids, ...j }) => ({ ...j, count: images.length })), threads: !!env("THREADS_ACCESS_TOKEN") });
    }

    if (p === "/api/cancel" && req.method === "POST") {
      const key = "jobs/" + String(q.get("id") || "").replace(/[^a-f0-9]/g, "");
      const j = await store.get(key, { type: "json" });
      if (j && j.status === "pending") { j.status = "canceled"; await store.setJSON(key, j); return json({ ok: true }); }
      return json({ ok: false });
    }

    return json({ error: "not found" }, 404);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
};

export const config = { path: ["/api/*", "/cards/*"] };
