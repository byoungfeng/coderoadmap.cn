#!/usr/bin/env node
/**
 * 从 coderoadmap.cn 生产接口拉取课程 / 路线图 / 课时索引，
 * 生成仓库内的索引文件：README、docs/**、data/**。
 *
 * 设计约束：
 * 1. 只同步标题、摘要与链接，不搬运正文 —— 正文与 canonical 始终在主站。
 * 2. 生成前做条数与字段校验，校验不通过直接退出且不写文件，
 *    避免接口异常把仓库刷成空壳。
 * 3. 输出使用 LF 换行与固定排序，保证 diff 只反映真实内容变化。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = "https://coderoadmap.cn";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GENERATED = "<!-- 本文件由 scripts/sync.mjs 自动生成，请勿手动编辑 -->";

const TRACK_CATEGORY = {
  ai: "AI 与智能体",
  devops: "DevOps 与运维",
  dsa: "数据结构与算法",
  framework: "框架与生态",
  fullstack: "全栈开发",
  interview: "面试准备",
  language: "编程语言",
};

const ROADMAP_CATEGORY = {
  ai: "AI 与智能体",
  mobile: "移动端开发",
  web: "Web 前端",
  engineering: "工程实践",
  devops: "DevOps 与运维",
  data: "数据与数据库",
  "computer-science": "计算机基础",
  language: "编程语言",
  security: "安全",
  algorithm: "算法",
  career: "职业发展",
};

const LEVEL = { beginner: "入门", intermediate: "进阶", advanced: "高级" };

/** 展示顺序按站内主推主题排列，不跟随字母序 */
const TRACK_ORDER = ["ai", "language", "framework", "fullstack", "dsa", "devops", "interview"];
const ROADMAP_ORDER = [
  "ai",
  "web",
  "mobile",
  "devops",
  "data",
  "computer-science",
  "language",
  "algorithm",
  "engineering",
  "security",
  "career",
];

const MIN_COUNTS = { tracks: 100, roadmaps: 50, lessons: 500 };

async function getJson(path, tries = 3) {
  let lastError;
  for (let i = 1; i <= tries; i += 1) {
    try {
      const res = await fetch(`${SITE}${path}`, {
        headers: { "User-Agent": "coderoadmap-index-sync/1.0" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      lastError = error;
      if (i < tries) await new Promise((r) => setTimeout(r, 2_000 * i));
    }
  }
  throw new Error(`拉取失败 ${path}: ${lastError?.message}`);
}

function categoryLabel(map, key) {
  return map[key] ?? key;
}

function orderCategories(map, items, preferred) {
  const present = [...new Set(items.map((i) => i.category))].filter(Boolean);
  const ordered = preferred.filter((key) => present.includes(key));
  const rest = present
    .filter((key) => !preferred.includes(key))
    .sort((a, b) => categoryLabel(map, a).localeCompare(categoryLabel(map, b), "zh-CN"));
  return [...ordered, ...rest];
}

function escapeCell(text, limit = 80) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  const short = flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
  return short.replace(/\|/g, "\\|");
}

function trackUrl(slug) {
  return `${SITE}/tracks/${slug}`;
}

function roadmapUrl(slug) {
  return `${SITE}/roadmaps/${slug}`;
}

function validate(tracks, roadmaps, sitemap) {
  const errors = [];
  if (!Array.isArray(tracks) || tracks.length < MIN_COUNTS.tracks) {
    errors.push(`课程条数异常: ${tracks?.length} < ${MIN_COUNTS.tracks}`);
  }
  if (!Array.isArray(roadmaps) || roadmaps.length < MIN_COUNTS.roadmaps) {
    errors.push(`路线图条数异常: ${roadmaps?.length} < ${MIN_COUNTS.roadmaps}`);
  }
  if (!Array.isArray(sitemap) || sitemap.length < MIN_COUNTS.lessons) {
    errors.push(`课时条数异常: ${sitemap?.length} < ${MIN_COUNTS.lessons}`);
  }
  for (const t of tracks ?? []) {
    if (!t.slug || !t.title || !t.category) {
      errors.push(`课程字段缺失: ${JSON.stringify(t).slice(0, 120)}`);
      break;
    }
  }
  for (const r of roadmaps ?? []) {
    if (!r.slug || !r.title || !r.category) {
      errors.push(`路线图字段缺失: ${JSON.stringify(r).slice(0, 120)}`);
      break;
    }
  }
  if (errors.length > 0) {
    const message = `[sync] 数据校验失败，已中止且未写入任何文件:\n- ${errors.join("\n- ")}`;
    throw new Error(message);
  }
}

function buildTrackDoc(category, tracks) {
  const rows = tracks
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.title.localeCompare(b.title, "zh-CN"))
    .map(
      (t) =>
        `| [${escapeCell(t.title, 40)}](${trackUrl(t.slug)}) | ${LEVEL[t.level] ?? t.level ?? "-"} | ${
          t.lessonCount ?? "-"
        } | ${t.estimatedWeeks ?? "-"} | ${escapeCell(t.description, 70)} |`
    );

  return [
    GENERATED,
    "",
    `# ${category} · 课程索引`,
    "",
    `共 ${tracks.length} 门课程，全部讲义与练习题在 [coderoadmap.cn](${SITE}/tracks)。`,
    "",
    "| 课程 | 级别 | 课时 | 预计周数 | 简介 |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

function buildRoadmapDoc(category, roadmaps) {
  const rows = roadmaps
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.title.localeCompare(b.title, "zh-CN"))
    .map(
      (r) =>
        `| [${escapeCell(r.title, 40)}](${roadmapUrl(r.slug)}) | ${r.nodeCount ?? "-"} | ${
          escapeCell(r.sourceName ?? "CodeRoadMap", 24)
        } | ${escapeCell(r.description, 70)} |`
    );

  return [
    GENERATED,
    "",
    `# ${category} · 路线图索引`,
    "",
    `共 ${roadmaps.length} 条路线图，节点级要点在 [coderoadmap.cn](${SITE}/roadmaps)。`,
    "",
    "| 路线图 | 节点数 | 来源 | 简介 |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

function buildReadme({ tracks, roadmaps, lessons, meta }) {
  const trackCats = orderCategories(TRACK_CATEGORY, tracks, TRACK_ORDER);
  const roadmapCats = orderCategories(ROADMAP_CATEGORY, roadmaps, ROADMAP_ORDER);
  const customCount = tracks.filter((t) => (t.sourceType ?? "custom") === "custom").length;
  const avgLessons = Math.round(tracks.reduce((sum, t) => sum + (t.lessonCount ?? 0), 0) / tracks.length);
  const importedSources = [
    ...new Set(roadmaps.map((r) => r.sourceName).filter((n) => n && n !== "CodeRoadMap")),
  ];
  const badge = (alt, label, value, color) =>
    `![${alt}](https://img.shields.io/badge/${label}-${value}-${color})`;

  const trackRows = trackCats.map((cat) => {
    const list = tracks.filter((t) => t.category === cat);
    const top = list
      .slice()
      .sort((a, b) => (b.lessonCount ?? 0) - (a.lessonCount ?? 0))
      .slice(0, 3)
      .map((t) => `[${escapeCell(t.title, 22)}](${trackUrl(t.slug)})`)
      .join("、");
    return `| **${categoryLabel(TRACK_CATEGORY, cat)}** | ${list.length} | ${top} | [明细](docs/tracks/${cat}.md) |`;
  });

  const roadmapRows = roadmapCats.map((cat) => {
    const list = roadmaps.filter((r) => r.category === cat);
    const top = list
      .slice()
      .sort((a, b) => (b.nodeCount ?? 0) - (a.nodeCount ?? 0))
      .slice(0, 3)
      .map((r) => `[${escapeCell(r.title, 22)}](${roadmapUrl(r.slug)})`)
      .join("、");
    return `| **${categoryLabel(ROADMAP_CATEGORY, cat)}** | ${list.length} | ${top} | [明细](docs/roadmaps/${cat}.md) |`;
  });

  return [
    GENERATED,
    "",
    "# coderoadmap.cn · 中文 AI 编程学习路线与课程导航",
    "",
    `面向中文开发者的免费学习路线图与课程讲义索引。当前收录 **${roadmaps.length} 条路线图**、**${tracks.length} 门课程**、**${lessons.length} 节带讲义课时**，全部内容托管在 [coderoadmap.cn](${SITE})。`,
    "",
    "> 本仓库只是主站的内容索引：每天自动同步标题、摘要与链接，不含正文。所有内容以主站为准。",
    "",
    badge("roadmaps", "roadmaps", roadmaps.length, "2f6fed"),
    badge("courses", "courses", tracks.length, "2f6fed"),
    badge("lessons", "lessons", lessons.length, "2f6fed"),
    badge("last sync", "last_sync", meta.syncedAt.slice(0, 10).replace(/-/g, "--"), "informational"),
    "",
    "## 这是什么",
    "",
    `coderoadmap.cn 是一个中文编程学习导航站，解决的是「先学什么、后学什么」。它把学习路径拆成 ${roadmaps.length} 条可执行路线图，每条路线的节点对应一节带讲义的课时，学完能立刻做题验证。覆盖 ${trackCats.length} 大类：${trackCats
      .map((c) => categoryLabel(TRACK_CATEGORY, c))
      .join("、")}。`,
    "",
    `站内内容分两层。**路线图**负责阶段划分与依赖顺序，节点上写明该阶段要掌握的具体要点；**课程**负责逐节讲义，${tracks.length} 门课平均 ${avgLessons} 节，每节配自研练习题与即时判分。两者都免费开放，学习进度只存在浏览器本地，不做账号门槛。`,
    "",
    `其中 ${customCount} 门课程为站内原创讲义，其余 ${tracks.length - customCount} 门为公开课程的中文整理，来源与授权在各页面标注。`,
    "",
    "## 课程索引",
    "",
    "| 分类 | 课程数 | 代表课程 | 完整清单 |",
    "| --- | --- | --- | --- |",
    ...trackRows,
    "",
    "## 路线图索引",
    "",
    "| 分类 | 路线图数 | 代表路线图 | 完整清单 |",
    "| --- | --- | --- | --- |",
    ...roadmapRows,
    "",
    "## 怎么用",
    "",
    "1. 选一条路线图确认阶段顺序 → [路线图](https://coderoadmap.cn/roadmaps)",
    "2. 按路线节点进入对应课程逐节读讲义、做练习 → [课程](https://coderoadmap.cn/tracks)",
    "3. 用面试题库交叉验证掌握程度 → [面试题](https://coderoadmap.cn/practice)",
    "",
    "## 数据同步",
    "",
    "- 数据源：`/api/tracks`、`/api/roadmaps`、`/api/search/sitemap-index`",
    "- 同步方式：GitHub Actions，每天北京时间 04:00 执行 `scripts/sync.mjs`",
    "- 快照：`data/*.json`；同步失败时保留上一版，不覆盖",
    `- AI 友好索引：[llms.txt](${SITE}/llms.txt)、[llms-full.txt](${SITE}/llms-full.txt)、[RSS](${SITE}/rss.xml)`,
    "",
    "## 来源与授权",
    "",
    `- 站内原创课程（${customCount} 门）：CodeRoadMap 原创，CC BY-NC 4.0`,
    `- 路线图来源：${["CodeRoadMap", ...importedSources].join("、")}`,
    "- 本仓库脚本：MIT",
    "",
    "## 反馈",
    "",
    "内容纠错请提交 Issue，或到 [站内社区](https://coderoadmap.cn/community) 反馈。本仓库不接受内容投稿。",
    "",
    `---`,
    "",
    `最后同步：${meta.syncedAt} · 数据快照见 [data/meta.json](data/meta.json)`,
    "",
  ].join("\n");
}

async function write(relPath, content) {
  const target = join(ROOT, relPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${content.replace(/\r\n/g, "\n").trimEnd()}\n`, "utf8");
}

async function main() {
  const [tracks, roadmaps, sitemap] = await Promise.all([
    getJson("/api/tracks"),
    getJson("/api/roadmaps"),
    getJson("/api/search/sitemap-index"),
  ]);

  validate(tracks, roadmaps, sitemap);

  const byTrack = new Map();
  for (const item of sitemap) {
    const prev = byTrack.get(item.trackSlug) ?? { count: 0, updatedAt: null };
    byTrack.set(item.trackSlug, {
      count: prev.count + 1,
      updatedAt: (item.updatedAt ?? "") > (prev.updatedAt ?? "") ? item.updatedAt : prev.updatedAt,
    });
  }

  const enriched = tracks.map((t) => ({
    ...t,
    lessonCount: t.lessonCount ?? byTrack.get(t.slug)?.count ?? 0,
    updatedAt: t.updatedAt ?? byTrack.get(t.slug)?.updatedAt ?? null,
  }));

  const meta = {
    site: SITE,
    syncedAt: new Date().toISOString(),
    counts: { tracks: tracks.length, roadmaps: roadmaps.length, lessons: sitemap.length },
    categories: {
      tracks: orderCategories(TRACK_CATEGORY, tracks, TRACK_ORDER),
      roadmaps: orderCategories(ROADMAP_CATEGORY, roadmaps, ROADMAP_ORDER),
    },
  };

  await write("data/tracks.json", JSON.stringify(enriched, null, 2));
  await write("data/roadmaps.json", JSON.stringify(roadmaps, null, 2));
  await write("data/meta.json", JSON.stringify(meta, null, 2));

  for (const cat of meta.categories.tracks) {
    await write(
      `docs/tracks/${cat}.md`,
      buildTrackDoc(categoryLabel(TRACK_CATEGORY, cat), tracks.filter((t) => t.category === cat))
    );
  }
  for (const cat of meta.categories.roadmaps) {
    await write(
      `docs/roadmaps/${cat}.md`,
      buildRoadmapDoc(categoryLabel(ROADMAP_CATEGORY, cat), roadmaps.filter((r) => r.category === cat))
    );
  }

  await write("README.md", buildReadme({ tracks: enriched, roadmaps, lessons: sitemap, meta }));

  console.log(
    `[sync] 完成：${tracks.length} 课程 / ${roadmaps.length} 路线图 / ${sitemap.length} 课时，快照 ${meta.syncedAt}`
  );
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
