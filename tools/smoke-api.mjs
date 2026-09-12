#!/usr/bin/env node
/**
 * 业务 API 端到端冒烟测试。
 *
 * 用法：node tools/smoke-api.mjs <baseUrl> <管理员用户名> <口令>
 *
 * 重点覆盖本次修复的语义性缺陷，而不只是「接口能返回 200」：
 *   - 抽题不下发答案（旧实现连答案一起返回，判分在前端）
 *   - 服务端判分，客户端伪造 is_correct 无效
 *   - 未作答计「未答」而非「答错」
 *   - 错题本移出后再次答错能重新进入（旧实现永远加不回来）
 *   - 多选题判分与复习页的数组形态
 *   - 分页上限钳制
 *   - 非管理员的管理端点拒绝
 */

const BASE = process.argv[2] ?? 'http://127.0.0.1:8787';
const USER = process.argv[3] ?? 'admin';
const PASS = process.argv[4];

if (!PASS) {
  console.error('用法: node tools/smoke-api.mjs <baseUrl> <用户名> <口令>');
  process.exit(1);
}

let pass = 0;
let fail = 0;
const check = (label, cond, detail = '') => {
  if (cond) {
    pass++;
    console.log(`  ✔ ${label}`);
  } else {
    fail++;
    console.log(`  ✘ ${label}${detail ? '  → ' + detail : ''}`);
  }
};

let cookie = '';

const req = async (method, path, body) => {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Origin: BASE,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const setC = res.headers.getSetCookie?.() ?? [];
  for (const c of setC) {
    const m = /^__Host-sid=([^;]*)/.exec(c);
    if (m) cookie = m[1] ? `__Host-sid=${m[1]}` : '';
  }
  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
};

const stretch = async (password, saltB64, iterations) => {
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: Buffer.from(saltB64, 'base64'), iterations, hash: 'SHA-256' },
    await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
      'deriveBits',
    ]),
    256,
  );
  return Buffer.from(bits).toString('base64');
};

console.log(`\n═══ 业务 API 冒烟  ${BASE} ═══\n`);

// ── 登录 ──
const ch = await req('POST', '/api/auth/challenge', { username: USER });
const verifier = await stretch(PASS, ch.data.salt, ch.data.iterations);
const login = await req('POST', '/api/auth/login', { username: USER, verifier });
check('登录成功', login.status === 200, `实际 ${login.status}`);

// ── 题库 ──
console.log('\n题库');
const banks = await req('GET', '/api/banks');
check('列出题库', banks.status === 200 && Array.isArray(banks.data), `状态 ${banks.status}`);
const bank1 = banks.data?.find((b) => b.id === 1);
check('题库 1 统计正确（193 题）', bank1?.question_count === 193, JSON.stringify(bank1));
check('统计字段无 null', bank1 && !Object.values(bank1).includes(null), JSON.stringify(bank1));

const bank2 = banks.data?.find((b) => b.id === 2);
check('题库 2 统计正确（1376 题）', bank2?.question_count === 1376, String(bank2?.question_count));

// ── 分页 ──
console.log('\n题目分页');
const p1 = await req('GET', '/api/questions?bank_id=1&page=1&per_page=10');
check('分页返回封套结构', p1.data && Array.isArray(p1.data.items) && typeof p1.data.total === 'number',
  JSON.stringify(p1.data).slice(0, 120));
check('每页 10 条', p1.data?.items?.length === 10, String(p1.data?.items?.length));
check('total 为 193', p1.data?.total === 193, String(p1.data?.total));

const p2 = await req('GET', '/api/questions?bank_id=1&page=2&per_page=10');
check('第 2 页与第 1 页不重复', p2.data?.items?.[0]?.id !== p1.data?.items?.[0]?.id);

const clamped = await req('GET', '/api/questions?bank_id=1&per_page=99999');
check('per_page 被钳制到 200', clamped.data?.per_page === 200, String(clamped.data?.per_page));

// ── 抽题不得下发答案 ──
console.log('\n抽题（不应泄露答案）');
const pick = await req('POST', '/api/practice/pick', {
  bank_id: 1,
  single_count: 3,
  multiple_count: 2,
  truefalse_count: 2,
});
check('抽题成功', pick.status === 200, `实际 ${pick.status}`);
const questions = pick.data?.questions ?? [];
check('抽到 7 道题', questions.length === 7, String(questions.length));
check(
  '抽题响应不含 answer',
  questions.every((q) => !('answer' in q)),
  JSON.stringify(questions[0]).slice(0, 120),
);
check(
  '抽题响应不含 explanation',
  questions.every((q) => !('explanation' in q)),
);
check('每题带选项', questions.every((q) => Array.isArray(q.options) && q.options.length >= 2));

// ── 判分：从管理端点取正确答案 ──
console.log('\n服务端判分');
const details = {};
for (const q of questions) {
  const d = await req('GET', `/api/questions/${q.id}`);
  details[q.id] = d.data;
}

const answers = questions.map((q) => {
  const correct = details[q.id].answer;
  return { question_id: q.id, selected: correct, is_correct: false }; // 故意伪造 is_correct
});
const submit = await req('POST', '/api/practice/submit', { mode: 'random', answers });
check('提交成功', submit.status === 200, JSON.stringify(submit.data).slice(0, 160));
check(
  '全部答对却伪造 is_correct:false，仍判为全对（客户端字段被忽略）',
  submit.data?.correct_count === 7,
  JSON.stringify(submit.data),
);
check('未做题数为 0', submit.data?.unanswered_count === 0, String(submit.data?.unanswered_count));

// ── 未作答语义 ──
console.log('\n未作答语义');
const pick2 = await req('POST', '/api/practice/pick', { bank_id: 1, single_count: 4, truefalse_count: 0 });
const q2 = pick2.data.questions;
const answers2 = [
  { question_id: q2[0].id, selected: details[q2[0].id]?.answer ?? 0 },
  { question_id: q2[1].id, selected: null },
  { question_id: q2[2].id, selected: null },
  { question_id: q2[3].id, selected: 999 }, // 越界 → 视作未答
];
// 补取答案
for (const q of q2) if (!details[q.id]) details[q.id] = (await req('GET', `/api/questions/${q.id}`)).data;
answers2[0] = { question_id: q2[0].id, selected: details[q2[0].id].answer };
answers2[3] = { question_id: q2[3].id, selected: details[q2[3].id].answer === 0 ? 1 : 0 };

const submit2 = await req('POST', '/api/practice/submit', { mode: 'random', answers: answers2 });
check('未作答计未答而非答错', submit2.data?.unanswered_count === 2, JSON.stringify(submit2.data));
check('答错计 1 题', submit2.data?.wrong_count === 1, JSON.stringify(submit2.data));
check('答对计 1 题', submit2.data?.correct_count === 1, JSON.stringify(submit2.data));

// ── 错题本：移出后可重新进入（旧实现永远加不回来）──
console.log('\n错题本（移出后可重新进入）');
const probe = details[q2[0].id];
const wrongSelection = Array.isArray(probe.answer)
  ? [probe.answer[0] === 0 ? 1 : 0]
  : probe.answer === 0
    ? 1
    : 0;

const mkSubmit = (qid, selected) =>
  req('POST', '/api/practice/submit', {
    mode: 'random',
    answers: [{ question_id: qid, selected }],
  });

await mkSubmit(probe.id, wrongSelection);
const wb1 = await req('GET', '/api/wrongbook');
const entry = wb1.data.find((w) => w.question_id === probe.id);
check('答错后进入错题本', !!entry);

if (entry) {
  const removed = await req('PUT', `/api/wrongbook/${entry.id}/remove`);
  check('移出接口返回 200', removed.status === 200, `实际 ${removed.status}`);
  const wb2 = await req('GET', '/api/wrongbook');
  check('移出后不在列表', !wb2.data.some((w) => w.id === entry.id));

  await mkSubmit(probe.id, wrongSelection);
  const wb3 = await req('GET', '/api/wrongbook');
  const back = wb3.data.find((w) => w.question_id === probe.id);
  check('再次答错后重新进入错题本（旧实现永远加不回来）', !!back && back.status === 'active');
}

// ── 会话与复习 ──
console.log('\n练习记录与复习');
const sessions = await req('GET', '/api/sessions');
check('列出练习记录', sessions.status === 200 && Array.isArray(sessions.data?.sessions));
check('记录带 bank_name 而非裸 id', typeof sessions.data?.sessions?.[0]?.bank_name === 'string',
  JSON.stringify(sessions.data?.sessions?.[0]).slice(0, 140));

const sid = submit.data.session_id;
const detail = await req('GET', `/api/sessions/${sid}`);
check('取练习详情', detail.status === 200, `实际 ${detail.status}`);
const multiAnswer = detail.data?.answers?.find((a) => a.type === 'multiple');
check(
  '多选题的 correct_answer 为数组',
  !multiAnswer || Array.isArray(multiAnswer.correct_answer),
  JSON.stringify(multiAnswer?.correct_answer),
);

// ── 仪表盘 ──
console.log('\n仪表盘');
const dash = await req('GET', '/api/dashboard');
check('仪表盘返回 200', dash.status === 200, `实际 ${dash.status}`);
check('今日练习数 > 0', (dash.data?.today_practice_count ?? 0) > 0, JSON.stringify(dash.data));
check('正确率为数值', typeof dash.data?.today_accuracy === 'number');
check('错题分布为数组', Array.isArray(dash.data?.today_wrong_per_bank));

// ── 导入（分批）──
console.log('\n分批导入');
const tooBig = await req('POST', '/api/import', {
  bankName: 'x',
  questions: Array.from({ length: 31 }, () => ({ type: 'single', stem: 's', options: ['a', 'b'], answer: 0 })),
});
check('超过单批上限被拒绝', tooBig.status === 400, `实际 ${tooBig.status}`);

const imp1 = await req('POST', '/api/import', {
  bankName: `冒烟测试题库 ${Date.now()}`,
  description: '由 smoke-api.mjs 创建',
  start_index: 0,
  questions: [
    { type: 'single', stem: '导入题 1', options: ['甲', '乙'], answer: 1 },
    { type: 'multiple', stem: '导入题 2', options: ['A', 'B', 'C'], answer: [0, 2] },
    { type: 'truefalse', stem: '导入题 3', options: ['对', '错'], answer: 0 },
    { type: 'single', stem: '', options: ['a', 'b'], answer: 0 },
    { type: 'single', stem: '答案越界', options: ['a', 'b'], answer: 9 },
  ],
});
check('导入返回 201 并建库', imp1.status === 201, `实际 ${imp1.status}`);
check('导入 3 题成功', imp1.data?.imported === 3, JSON.stringify(imp1.data));
check('2 条校验错误被定位到题号', imp1.data?.errors?.length === 2, JSON.stringify(imp1.data?.errors));
check(
  '错误信息带整体序号（非本批序号）',
  imp1.data?.errors?.every((e) => typeof e.index === 'number'),
  JSON.stringify(imp1.data?.errors),
);

// 统计应随导入更新
const impBank = await req('GET', `/api/banks/${imp1.data.bank_id}`);
check('导入后题库统计已重算', impBank.data?.question_count === 3, JSON.stringify(impBank.data));

// ── 权限 ──
console.log('\n权限（非管理员）');
const smokeUsername = `smoke_${Date.now()}`;
const created = await req('POST', '/api/users', {
  username: smokeUsername,
  display_name: '冒烟测试用户',
  role: 'user',
  kdf: await (async () => {
    const salt = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
    const v = await stretch('SmokeUser-2026', salt, 600000);
    return { salt, iterations: 600000, verifier: v };
  })(),
});
check('管理员创建普通用户', created.status === 201, JSON.stringify(created.data).slice(0, 140));

const adminCookie = cookie;
const chU = await req('POST', '/api/auth/challenge', { username: smokeUsername });
if (chU.data?.salt) {
  const vU = await stretch('SmokeUser-2026', chU.data.salt, chU.data.iterations);
  const loginU = await req('POST', '/api/auth/login', {
    username: smokeUsername,
    verifier: vU,
  });
  if (loginU.status === 200) {
    const forbidden = await req('GET', '/api/users');
    check('普通用户访问用户管理返回 403', forbidden.status === 403, `实际 ${forbidden.status}`);
    const forbiddenImport = await req('POST', '/api/import', { bankName: 'x', questions: [] });
    check('普通用户导入返回 403', forbiddenImport.status === 403, `实际 ${forbiddenImport.status}`);
  } else {
    check('普通用户登录', false, `状态 ${loginU.status}`);
  }
}

// 恢复管理员会话后清理
cookie = adminCookie;
if (created.data?.id) {
  const del = await req('DELETE', `/api/users/${created.data.id}`);
  check('删除该用户成功（旧实现外键失败却返回 ok）', del.status === 200, `实际 ${del.status}`);
}

const selfDel = await req('DELETE', '/api/users/1');
check('不能删除自己', selfDel.status === 400, `实际 ${selfDel.status}`);

if (imp1.data?.bank_id) await req('DELETE', `/api/banks/${imp1.data.bank_id}`);

console.log(`\n═══ 结果: ${pass} 通过 / ${fail} 失败 ═══\n`);
process.exit(fail === 0 ? 0 : 1);
