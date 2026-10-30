/**
 * boot.js —— 首帧前的同步脚本（经典脚本，不是 module）。
 *
 * 为什么单独成文件而不是内联在 index.html 里：
 * 内联脚本会逼着 CSP 放开 `script-src 'unsafe-inline'`，等于没有脚本防护；
 * 抽成外部文件后，CSP 可以写死 `script-src 'self'`。
 *
 * 它做两件事，都必须早于应用 bundle 执行：
 *  1. 给出 BASE_URL（静态托管固定在根；Go 模板版会注入 `/app/`）
 *  2. 把壁纸参数刷到 <html> 上——否则会先白一下再出图
 */
;(function () {
  // 静态托管：路由与 axios 的相对路径都从根解析。
  // 若页面里已经由模板注入过 BASE_URL（原版 s-ui 二进制），尊重它的值。
  if (!window.BASE_URL || window.BASE_URL.charAt(0) === '{') {
    window.BASE_URL = '/'
  }

  try {
    var wp = JSON.parse(localStorage.getItem('ui.wallpaper') || '{}')
    var isDark =
      document.documentElement.getAttribute('data-theme') === 'dark' ||
      (document.documentElement.getAttribute('data-theme') !== 'light' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches)
    var thumb = isDark ? wp.thumbDark || wp.thumbLight : wp.thumbLight || wp.thumbDark
    var pattern = wp.builtin && wp.builtin !== 'none'
    if (!wp.on || (!thumb && !pattern)) return

    var img = ''
    var size = wp.fit || 'cover'
    if (pattern) {
      if (wp.builtin === 'grid') {
        img =
          'linear-gradient(rgba(0,0,0,.06) 1px, transparent 1px),' +
          'linear-gradient(90deg, rgba(0,0,0,.06) 1px, transparent 1px)'
        size = '24px 24px, 24px 24px'
      } else if (wp.builtin === 'dots') {
        img = 'radial-gradient(rgba(0,0,0,.10) 1px, transparent 1px)'
        size = '16px 16px'
      } else {
        img =
          'repeating-linear-gradient(90deg, rgba(0,0,0,.035) 0 1px, transparent 1px 3px),' +
          'repeating-linear-gradient(0deg, rgba(0,0,0,.025) 0 1px, transparent 1px 4px)'
        size = 'auto, auto'
      }
    } else {
      img = 'url("' + thumb + '")'
    }

    var r = document.documentElement.style
    r.setProperty('--wp-image', img)
    r.setProperty('--wp-size', size)
    r.setProperty('--wp-blur', (wp.blur || 0) + 'px')
    r.setProperty('--wp-contrast', (wp.contrast || 100) + '%')
    r.setProperty('--wp-saturate', (wp.saturate || 100) + '%')
    r.setProperty('--wp-veil', String((wp.veil || 0) / 100))
    r.setProperty('--wp-grain', '0.008')
    document.documentElement.setAttribute('data-wallpaper', wp.glass ? 'glass' : 'on')
  } catch (e) {
    /* 壁纸读不出来不影响应用启动 */
  }
})()
