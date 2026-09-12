/**
 * 移动端跳转
 *
 * 抽成独立文件而非内联 <script>，以便启用不含 'unsafe-inline' 的严格 CSP。
 */
(function () {
    var ua = navigator.userAgent;
    var isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
    var isSmallScreen = window.innerWidth < 768;
    var isAlreadyMobile = /^\/mobile(\/|$)/.test(window.location.pathname);

    if ((isMobile || isSmallScreen) && !isAlreadyMobile) {
        window.location.replace('/mobile/' + window.location.hash);
    }
})();
