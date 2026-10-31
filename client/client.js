// 鲸生 · DSH Web 客户端桥（dsh.client bundle）。
// 极薄原则：这里只有「把设置页的一个 tab 变成容器」的桥接代码；
// 面板本体（HTML/JS）由插件宿主侧的 webServer 路由提供，单份维护：
//   GET /whale-life/settings-body → 面板骨架（同源）
//   GET /whale-life/settings.js   → 面板逻辑（apiBase 指向行动路由 3939）
// 加载方式符合 dsh-client-modules 的 ModuleLoader 约定（无需构建工具）。

window.__ModuleLoader__.load({
  id: "dsh-whale-life",
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })
    let react
    try {
      react = require("react")
    } catch (e) {
      // react 不在模块表时兜底：从 DSH 前端全局取（renderer 挂载的共享 React）
      react = window.React || null
    }

    /** 鲸生设置 tab：挂载点容器，拉取宿主提供的面板并激活。 */
    function WhaleLifeSettingsTab() {
      const ref = react.useRef(null)
      react.useEffect(() => {
        const host = ref.current
        if (!host) return
        let alive = true
        const script = document.createElement("script")
        ;(async () => {
          try {
            const r = await fetch("/whale-life/settings-body", { cache: "no-store" })
            if (!r.ok) throw new Error(`settings-body ${r.status}`)
            const html = await r.text()
            if (!alive || !host) return
            host.innerHTML = html
            // 面板骨架含 data-wl-root 容器；面板 JS 会自动寻找并 boot
            script.src = "/whale-life/settings.js?v=" + Date.now()
            document.head.appendChild(script)
          } catch (e) {
            if (host && alive) {
              host.textContent = "🐋 鲸生面板加载失败：" + (e && e.message ? e.message : e)
                + "（行动路由服务器未启动？独立入口：http://127.0.0.1:3939/settings-page）"
            }
          }
        })()
        return () => {
          alive = false
          if (script.parentNode) script.parentNode.removeChild(script)
          if (host) host.innerHTML = ""
          const t = host && host.ownerDocument && host.ownerDocument.defaultView
          if (t && t.__wlTimer) { clearInterval(t.__wlTimer); t.__wlTimer = null }
        }
      }, [])
      return react.createElement("div", {
        ref,
        style: {
          width: "100%", maxWidth: "860px", margin: "0 auto",
          padding: "16px 4px 48px", minHeight: "60vh",
        },
      })
    }

    /** 客户端 provider 入口：注册设置页 tab。任何失败静默跳过（不拖垮 DSH Web 启动）。 */
    function apply(ctx) {
      try {
        if (!react || !ctx || !ctx.slots || typeof ctx.slots.inject !== "function") return
        ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
          name: "settings.plugins.tab",
          id: "whale-life",
          order: 20,
          label: () => "🐋 鲸生",
        }, WhaleLifeSettingsTab))
      } catch (e) {
        try { ctx && ctx.logger && ctx.logger.warn && ctx.logger.warn(`whale-life client tab 注册失败：${e && e.message}`) } catch {}
      }
    }

    exports.apply = apply
    return module.exports
  },
})
