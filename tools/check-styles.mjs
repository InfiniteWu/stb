#!/usr/bin/env node
/**
 * 样式覆盖自检
 *
 * 用法: npm run check:styles
 *
 * 做三件事：
 *   1. 标记里用到、样式里却没有定义的类名（会渲染成裸样式）
 *   2. 样式文件里的裸十六进制颜色（设计系统要求颜色只来自 tokens.css）
 *   3. 落在 4px 网格之外的 padding / margin / gap
 *
 * 第 1 项是重写样式时最容易出的问题：JS 模板里拼出来的类名一旦漏掉，
 * 页面不会报错，只是悄悄失去样式 —— 靠肉眼很难发现。
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CSS_FILES = [
    'public/css/tokens.css',
    'public/css/style.css',
    'public/mobile/css/mobile.css',
];

const MARKUP_FILES = [
    'public/index.html',
    'public/mobile/index.html',
    'public/js/app.js',
    'public/mobile/js/app.js',
];

const read = (p) => readFileSync(resolve(REPO, p), 'utf8');

/**
 * 有意不带样式的类名 —— 它们是 JS 的选择器钩子，不是样式类：
 *   .admin-only      —— app.js 通过内联 display 控制显隐
 *   .start-practice  —— 移动端事件委托的判定依据，样式由 .m-btn 系列承担
 *   .recite-bank     —— 同上，背题入口按钮的 JS 钩子，样式由 .m-btn 系列承担
 * 除此之外不应出现「用了但没有样式」的类名。
 */
const STYLELESS_HOOKS = new Set(['admin-only', 'start-practice', 'recite-bank']);

let failures = 0;

// ── 1. 类名覆盖 ────────────────────────────────────────────────
const css = CSS_FILES.filter((f) => existsSync(resolve(REPO, f))).map(read).join('\n');
const defined = new Set([...css.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((m) => m[1]));

/**
 * 类名可能是模板拼出来的，例如 class="nav-q ${cls}" 或 m-badge-${status}。
 * 这里只取静态部分，动态前缀用 collectedDynamic 单独提示，避免误报。
 */
const CLASS_RE = /class="([^"]*)"/g;
const CLASS_LIST_RE = /classList\.(?:add|toggle|remove)\(\s*['"]([^'"]+)['"]/g;
const CLASSNAME_RE = /className\s*=\s*['"]([^'"]+)['"]/g;

function collect(file) {
    const src = read(file);
    const names = new Set();
    const dynamic = new Set();

    const add = (raw) => {
        for (const token of raw.split(/\s+/)) {
            if (!token) continue;
            if (token.includes('$')) {
                // 取 ${...} 之前的静态前缀，用于提示
                const prefix = token.split('$')[0];
                if (prefix) dynamic.add(prefix + '…');
                continue;
            }
            if (/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(token)) names.add(token);
        }
    };

    for (const re of [CLASS_RE, CLASS_LIST_RE, CLASSNAME_RE]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(src)) !== null) add(m[1]);
    }
    return { names: [...names], dynamic: [...dynamic] };
}

console.log('══ 类名覆盖 ══');
for (const file of MARKUP_FILES) {
    if (!existsSync(resolve(REPO, file))) continue;
    const { names, dynamic } = collect(file);
    const missing = names.filter((n) => !defined.has(n) && !STYLELESS_HOOKS.has(n));

    if (missing.length) {
        failures += missing.length;
        console.log(`  ✘ ${file}`);
        console.log(`      缺少样式: ${missing.join(', ')}`);
    } else {
        console.log(`  ✔ ${file}（${names.length} 个类）`);
    }
    if (dynamic.length) {
        console.log(`      动态拼接（请确认变体都有定义）: ${dynamic.join(', ')}`);
    }
}

// ── 2. 裸十六进制颜色 ──────────────────────────────────────────
console.log('\n══ 颜色令牌 ══');
for (const file of CSS_FILES) {
    const src = read(file);
    const isTokens = file.endsWith('tokens.css');

    // tokens.css 是颜色的唯一定义处，允许出现字面量
    const lines = src.split('\n');
    const offenders = [];
    lines.forEach((line, i) => {
        if (isTokens) return;
        if (/#[0-9a-fA-F]{3,8}\b/.test(line) && !/rgba?\(/.test(line)) {
            offenders.push(`${i + 1}: ${line.trim()}`);
        }
    });

    if (offenders.length) {
        failures += offenders.length;
        console.log(`  ✘ ${file} 出现裸色值：
${offenders.map((o) => '      ' + o).join('\n')}`);
    } else {
        console.log(`  ✔ ${file}${isTokens ? '（令牌定义处，允许字面量）' : ''}`);
    }
}

// ── 3. 4px 网格 ───────────────────────────────────────────────
console.log('\n══ 间距网格 ══');
const ALLOWED = new Set([0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 100]);
for (const file of CSS_FILES) {
    const src = read(file);
    const bad = new Set();
    for (const m of src.matchAll(/(?:padding|margin|gap)[a-z-]*\s*:\s*([^;]+);/g)) {
        for (const px of m[1].matchAll(/(-?\d+)px/g)) {
            const v = Math.abs(parseInt(px[1], 10));
            if (!ALLOWED.has(v)) bad.add(v);
        }
    }
    if (bad.size) {
        failures += bad.size;
        console.log(`  ✘ ${file} 非 4px 倍数: ${[...bad].sort((a, b) => a - b).map((v) => v + 'px').join(', ')}`);
    } else {
        console.log(`  ✔ ${file}`);
    }
}

console.log();
if (failures) {
    console.log(`✘ 共 ${failures} 处问题`);
    process.exit(1);
}
console.log('✔ 全部检查通过');
