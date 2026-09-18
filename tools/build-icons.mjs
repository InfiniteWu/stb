#!/usr/bin/env node
/**
 * 由 Lucide 生成 public/js/icons.js。
 *
 * 用法：npm run icons
 *
 * ## 为什么要换图标库
 *
 * 现有图标是 Feather 风格的 24×24 描边图标，这个视觉语言本身没问题，
 * 问题出在工程实现：
 *   - index.html 里 11 个 <symbol> 全部从未被引用（app.js 用的是自己的字符串）
 *   - 同一个图标最多重复定义 3 次（<symbol> / 内联 <svg> / App.icons）
 *   - stroke-width 三套并存：侧栏靠 CSS 继承、App.icons 写死 2、
 *     统计卡内联写死 1.5
 *
 * 与其手工重画几十条路径（那只会制造新的不一致），不如换用成熟上游统一收口：
 * Lucide 是 Feather 的社区继任者，ISC 许可，活跃维护，与现有图标同源。
 *
 * 只抽取实际用到的图标，产物入库 —— 应用本身零运行时依赖、零 CDN、无需构建。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const LUCIDE_DIR = resolve(REPO, 'node_modules/lucide-static/icons');
const OUT = resolve(REPO, 'public/js/icons.js');

/**
 * 实际用到的图标。
 * 键 = 应用内的引用名，值 = lucide-static 的文件名。
 */
const ICONS = {
    // 通用动作
    check: 'check',
    x: 'x',
    plus: 'plus',
    edit: 'pencil',
    trash: 'trash-2',
    refresh: 'refresh-cw',
    search: 'search',
    upload: 'upload',
    download: 'download',
    save: 'save',
    key: 'key-round',
    'log-out': 'log-out',
    'chevron-left': 'chevron-left',
    'chevron-right': 'chevron-right',
    'chevron-down': 'chevron-down',
    'arrow-left': 'arrow-left',
    'arrow-right': 'arrow-right',
    'alert-circle': 'circle-alert',
    'help-circle': 'circle-help',
    'circle-check': 'circle-check',
    'circle-x': 'circle-x',

    // 导航与业务
    dashboard: 'layout-dashboard',
    book: 'book-open',
    'book-stack': 'library',
    'file-text': 'file-text',
    users: 'users',
    user: 'user',
    'user-plus': 'user-plus',
    // 登录页：字段图标与密码显隐
    lock: 'lock',
    eye: 'eye',
    'eye-off': 'eye-off',
    'list-checks': 'list-checks',
    'bar-chart': 'chart-column',
    target: 'target',
    inbox: 'inbox',
    sparkles: 'sparkles',
    'shield-check': 'shield-check',
    clock: 'clock',
    calendar: 'calendar',
    'graduation-cap': 'graduation-cap',
};

/** 统一描边参数：单一 stroke-width 取代现在的 1.5 / 2 / 继承三套 */
const STROKE_WIDTH = '1.75';

const parseAttrs = (tag) => {
    const attrs = {};
    const re = /([a-zA-Z-]+)="([^"]*)"/g;
    let m;
    while ((m = re.exec(tag)) !== null) attrs[m[1]] = m[2];
    return attrs;
};

/** 只保留几何属性，丢弃 lucide 可能带上的 class / stroke 等表现属性 */
const GEOMETRY_ATTRS = new Set([
    'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
    'width', 'height', 'points', 'transform',
]);

function convertBody(svg) {
    const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '');
    const out = [];

    const tagRe = /<(path|circle|rect|line|polyline|polygon|ellipse)\b([^>]*)\/?>/g;
    let m;
    while ((m = tagRe.exec(inner)) !== null) {
        const [, name, attrStr] = m;
        const attrs = parseAttrs(attrStr);
        const kept = Object.entries(attrs)
            .filter(([k]) => GEOMETRY_ATTRS.has(k))
            .map(([k, v]) => `${k}="${v}"`)
            .join(' ');
        out.push(`<${name}${kept ? ' ' + kept : ''}/>`);
    }
    return out.join('');
}

const entries = [];
const missing = [];

for (const [alias, lucideName] of Object.entries(ICONS)) {
    const file = resolve(LUCIDE_DIR, `${lucideName}.svg`);
    let raw;
    try {
        raw = readFileSync(file, 'utf8');
    } catch {
        missing.push(`${alias} (${lucideName}.svg)`);
        continue;
    }

    const body = convertBody(raw);
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ` +
        `stroke="currentColor" stroke-width="${STROKE_WIDTH}" stroke-linecap="round" ` +
        `stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

    entries.push(`    ${alias.includes('-') ? `'${alias}'` : alias}: '${svg}'`);
}

if (missing.length) {
    console.error('✘ 以下图标未找到，请检查名称：');
    for (const m of missing) console.error('  - ' + m);
    process.exit(1);
}

// 品牌标记：Lucide 没有对应物，按同一套 24px 网格手工绘制。
// 构图：摊开的书页 + 书签 + 对勾，呼应「刷题」与「答对」。
// 基线对齐：图形控制在 3..21 之间，与 Lucide 的 2px 光学边距一致。
const BRAND = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5.5A1.5 1.5 0 0 1 4.5 4H9a3 3 0 0 1 3 3v12a2.5 2.5 0 0 0-2.5-2.5H3z"/><path d="M21 5.5A1.5 1.5 0 0 0 19.5 4H15a3 3 0 0 0-3 3v12a2.5 2.5 0 0 1 2.5-2.5H21z"/><path d="M8.5 9.5l1.75 1.75L14 7.5"/></svg>`;

const banner = `/**
 * 图标模块 —— 自动生成，请勿手工编辑。
 *
 * 生成: npm run icons   （来源: lucide-static，ISC 许可）
 * 统一规格: 24×24 viewBox、fill=none、stroke=currentColor、
 *          stroke-width=${STROKE_WIDTH}、round 端点与拐角。
 *
 * 用法: Icons.check、Icons.book …
 * 品牌标记 Icons.brand 为手工绘制，不在 Lucide 中。
 */
`;

const file = `${banner}
const Icons = {
${entries.join(',\n')},

    /* 品牌标记：手工绘制（Lucide 无对应图标） */
    brand: '${BRAND}',
};

/* 便于在传统脚本与模块环境中同时使用 */
if (typeof window !== 'undefined') window.Icons = Icons;
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, file, 'utf8');

console.log(`✔ 已生成 ${OUT}`);
console.log(`  图标数: ${entries.length + 1}（含手工绘制的 brand）`);
console.log(`  大小: ${(Buffer.byteLength(file, 'utf8') / 1024).toFixed(1)} KB`);
