/**
 * 客户端口令拉伸
 *
 * 为什么放在浏览器：Workers 免费版每个请求只有 10ms CPU，而实测
 * PBKDF2-SHA256 600k 轮需要约 201ms、bcrypt cost12 约 250ms —— 服务端
 * 无法承载任何强度合格的口令哈希。把拉伸放到客户端，用的是用户自己的 CPU，
 * 服务端只剩一次 HMAC 比较（<0.1ms）。
 *
 * 安全性：服务端存的是 HMAC(salt, stretched)。库泄露时攻击者拿到盐与
 * HMAC 值，两者都不可逆，破解每个候选口令仍需完整跑一次 600k 轮 PBKDF2，
 * 强度与直接存 bcrypt/PBKDF2 完全相同。
 *
 * 前提：crypto.subtle 仅在安全上下文可用（HTTPS 或 localhost）。
 * 用 http://192.168.x.x 访问会失败 —— 本地调试请走 http://localhost。
 */
(function (global) {
    var DEFAULT_ITERATIONS = 600000;

    function base64ToBytes(b64) {
        var bin = atob(b64);
        var out = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    function bytesToBase64(bytes) {
        var bin = '';
        for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
    }

    function ensureAvailable() {
        if (!global.crypto || !global.crypto.subtle) {
            throw new Error(
                '当前环境不支持安全加密运算，请使用 HTTPS 或 localhost 访问。' +
                '（crypto.subtle 仅在安全上下文可用）'
            );
        }
    }

    /**
     * 用给定盐与轮数拉伸口令。
     * @returns {Promise<string>} base64 编码的 32 字节派生值
     */
    async function stretchPassword(password, saltB64, iterations) {
        ensureAvailable();
        var iters = iterations || DEFAULT_ITERATIONS;

        var key = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(password),
            'PBKDF2',
            false,
            ['deriveBits']
        );
        var bits = await crypto.subtle.deriveBits(
            { name: 'PBKDF2', salt: base64ToBytes(saltB64), iterations: iters, hash: 'SHA-256' },
            key,
            256
        );
        return bytesToBase64(new Uint8Array(bits));
    }

    /**
     * 为新口令生成 KDF 载荷（盐由客户端生成 —— 盐不是秘密，只需唯一）。
     * 服务端会严格校验盐与派生值的长度与格式。
     */
    async function makeKdfPayload(password, iterations) {
        ensureAvailable();
        var iters = iterations || DEFAULT_ITERATIONS;
        var salt = bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
        var verifier = await stretchPassword(password, salt, iters);
        return { salt: salt, iterations: iters, verifier: verifier };
    }

    global.KDF = {
        DEFAULT_ITERATIONS: DEFAULT_ITERATIONS,
        stretchPassword: stretchPassword,
        makeKdfPayload: makeKdfPayload,
    };
})(window);
