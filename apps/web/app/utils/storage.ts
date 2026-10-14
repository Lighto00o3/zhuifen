// 浏览器禁止存储（隐私模式、拦截 Cookie）或空间写满时，访问和读写 localStorage 都可能抛异常。
// 联机数据以服务端为准，本机存储只用于刷新后恢复，失败时返回 undefined，不影响当前操作。
export function withStorage<T>(run: (storage: Storage) => T): T | undefined {
  try { return run(localStorage) } catch { return undefined }
}
