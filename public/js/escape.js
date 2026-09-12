/**
 * HTML 转义
 *
 * 全站用 innerHTML 拼接模板字符串渲染，而题干、选项、题库名、显示名等
 * 都来自数据库（题库由管理员导入）。未转义时这是**存储型 XSS**：
 * 题干里写一段 <img src=x onerror=...> 就能窃取任意用户的会话。
 *
 * 所有插入到 innerHTML 的动态值都必须经过 esc()。
 */
(function (global) {
    var MAP = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    };

    /**
     * 转义为可安全插入 HTML 文本节点与属性值的字符串。
     * null / undefined 一律渲染为空串，避免出现 "null" 字样。
     */
    function esc(value) {
        if (value === null || value === undefined) return '';
        return String(value).replace(/[&<>"']/g, function (ch) {
            return MAP[ch];
        });
    }

    /**
     * 把数组渲染成以「、」分隔的转义文本。
     * 多选答案等场景常用。
     */
    function escList(list) {
        if (!Array.isArray(list)) return '';
        return list.map(esc).join('、');
    }

    global.esc = esc;
    global.escList = escList;
})(window);
