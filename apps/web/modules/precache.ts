import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defineNuxtModule } from 'nuxt/kit'

// 构建时把各个页面的路径和这次发布 /_nuxt/ 下的全部脚本、样式写进 public/sw.js 的 PAGES 和 PRECACHE 清单（见 sw.js 开头的说明）。
// 开发时不处理：开发环境不注册 Service Worker。
export default defineNuxtModule({
  meta: { name: 'precache' },
  setup(_options, nuxt) {
    if (nuxt.options.dev) return
    // 不带参数的页面（/、/local、/history、/room）；pages:resolved 在去掉设计预览页之后触发。
    let pages: string[] = []
    nuxt.hook('pages:resolved', resolved => { pages = resolved.map(page => page.path).filter(path => !path.includes(':')) })
    // 静态文件复制到输出目录之后、Nitro 记下文件大小和 ETag 之前改写，SSR 部署时服务端返回的才是改写后的内容。
    nuxt.hook('nitro:build:public-assets', async nitro => {
      const publicDir = nitro.options.output.publicDir
      const sw = join(publicDir, 'sw.js')
      const source = await readFile(sw, 'utf8').catch(() => null)
      if (!source?.includes('const PRECACHE = [];') || !source.includes('const PAGES = [];')) return
      const dir = join(publicDir, nuxt.options.app.buildAssetsDir)
      const files = (await readdir(dir)).filter(file => /\.(js|css)$/.test(file)).sort()
      const paths = files.map(file => join(nuxt.options.app.buildAssetsDir, file))
      await writeFile(sw, source
        .replace('const PAGES = [];', `const PAGES = ${JSON.stringify(pages)};`)
        .replace('const PRECACHE = [];', `const PRECACHE = ${JSON.stringify(paths)};`))
    })
  },
})
