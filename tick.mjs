// 매 분 실행되는 예약 게시 처리기 (Netlify 스케줄 함수: 최대 30초)
// 1단계: 시각이 된 글의 Threads 컨테이너를 만든다.  2단계: 35초 이상 지난 뒤 다음 실행에서 게시한다.
import { getStore } from "@netlify/blobs";
import { tpost } from "../../lib/shared.mjs";

export default async () => {
  if (!process.env.THREADS_ACCESS_TOKEN) return;
  const t0 = Date.now();
  const store = getStore("cardnews");
  const { blobs } = await store.list({ prefix: "jobs/" });
  const jobs = (await Promise.all(blobs.map(b => store.get(b.key, { type: "json" })))).filter(Boolean);
  const save = j => store.setJSON("jobs/" + j.id, j);
  const free = j => !(j.lockUntil > Date.now());
  const errMsg = e => String((e && e.message) || e).slice(0, 300);

  // 2단계: 게시
  for (const j of jobs.filter(j => j.status === "ready" && j.readyAt <= Date.now() && free(j))) {
    if (Date.now() - t0 > 15000) break;
    j.lockUntil = Date.now() + 60000; await save(j);
    try {
      j.postId = (await tpost("me/threads_publish", { creation_id: j.creationId })).id;
      j.status = "done";
      for (const u of j.images) { const m = /\/cards\/([a-f0-9]{16})\.jpg/.exec(u); if (m) await store.delete("cards/" + m[1]).catch(() => {}); }
    } catch (e) { j.status = "failed"; j.error = errMsg(e); }
    j.lockUntil = 0; j.doneAt = Date.now(); await save(j);
  }

  // 1단계: 컨테이너 생성 (한 번에 글 1개, 시간이 모자라면 다음 실행에서 이어서)
  const j = jobs.filter(j => j.status === "pending" && j.runAt <= Date.now() && free(j)).sort((a, b) => a.runAt - b.runAt)[0];
  if (!j) return;
  j.lockUntil = Date.now() + 60000; await save(j);
  try {
    j.kids = j.kids || [];
    while (j.kids.length < j.images.length && Date.now() - t0 < 18000)
      j.kids.push((await tpost("me/threads", { media_type: "IMAGE", image_url: j.images[j.kids.length], is_carousel_item: "true" })).id);
    if (j.kids.length === j.images.length) {
      j.creationId = (await tpost("me/threads", { media_type: "CAROUSEL", children: j.kids.join(","), text: j.text })).id;
      j.status = "ready"; j.readyAt = Date.now() + 35000;
    }
  } catch (e) { j.status = "failed"; j.error = errMsg(e); }
  j.lockUntil = 0; await save(j);
};

export const config = { schedule: "* * * * *" };
