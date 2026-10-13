/**
 * 自定义档位背图的存储层。
 *
 * - 图片按内容哈希（SHA-256 前 10 字节）存进 IndexedDB，同一张图给多个档位只存一份；
 *   写入后自动回收不再被任何档位引用的条目；
 * - localStorage 只保存「档位 → 图片 id」的映射（见 {@link normalizeImageMap}）；
 * - IndexedDB 不可用（隐私模式、测试环境）时退回进程内内存，功能可用但不持久；
 * - 所有函数都不抛异常：失败只意味着该档位回退到内置档位图。
 */

/** localStorage 里的映射键：长度 31 的数组，元素是图片 id 或 null。 */
export const IMAGES_KEY = 'liang-calibrator:images'

/** 压缩后长边上限（px）：背景图铺满窗口，1920 足够且体积可控。 */
export const MAX_EDGE = 1920

const DB_NAME = 'liang-calibrator'
const STORE_NAME = 'images'
const MAP_LENGTH = 31

/** IndexedDB 不可用时的兜底存储（进程内存，刷新即失）。 */
const memory = new Map()
let dbPromise = null

/** 把任意输入规整为 31 个 id（去空格，空/非法按 null 处理）。 */
export function normalizeImageMap(raw, length = MAP_LENGTH) {
  return Array.from({ length }, (_, index) => {
    const value = Array.isArray(raw) ? raw[index] : undefined
    if (typeof value !== 'string') return null
    const id = value.trim()
    return id === '' ? null : id
  })
}

function openDb() {
  if (dbPromise !== null) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined' || indexedDB === null) {
        resolve(null)
        return
      }
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

async function withStore(mode, operation) {
  const db = await openDb()
  if (db === null) return null
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, mode)
      const store = transaction.objectStore(STORE_NAME)
      let result = null
      const request = operation(store)
      if (request !== undefined && request !== null) {
        request.onsuccess = () => {
          result = request.result
        }
        request.onerror = () => {
          result = null
        }
      }
      transaction.oncomplete = () => resolve(result)
      transaction.onerror = () => resolve(null)
      transaction.onabort = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

/** 读一张图：返回 Blob 或 null。 */
export async function galleryGet(id) {
  if (typeof id !== 'string' || id === '') return null
  if (memory.has(id)) return memory.get(id)
  try {
    const db = await openDb()
    if (db === null) return null
    const value = await withStore('readonly', (store) => store.get(id))
    if (value instanceof Blob) {
      memory.set(id, value)
      return value
    }
    // jsdom / 非 Blob 环境：结构化克隆回来的东西原样返回。
    return value ?? null
  } catch {
    return null
  }
}

/**
 * 存一张图（同 id 覆盖）。
 * 返回 { ok, persisted }：ok=false 仅参数异常；persisted=false 表示只进了内存
 * （IndexedDB 不可用或写失败，刷新即失）——调用方要如实提示，不许假装已持久化。
 */
export async function galleryPut(id, blob) {
  if (typeof id !== 'string' || id === '' || blob === null || blob === undefined) {
    return { ok: false, persisted: false }
  }
  memory.set(id, blob)
  try {
    const db = await openDb()
    if (db === null) return { ok: true, persisted: false }
    const stored = await withStore('readwrite', (store) => store.put(blob, id))
    if (stored === null || stored === undefined) return { ok: true, persisted: false }
    return { ok: true, persisted: true }
  } catch {
    return { ok: true, persisted: false }
  }
}

/** 删除若干张图。 */
export async function galleryDelete(ids) {
  const list = Array.isArray(ids) ? ids : [ids]
  for (const id of list) memory.delete(id)
  try {
    const db = await openDb()
    if (db === null) return
    for (const id of list) await withStore('readwrite', (store) => store.delete(id))
  } catch {
    // 删除失败只影响空间占用。
  }
}

/** 回收：删掉所有不在 keepIds 里的图（防止换图后旧数据越囤越多）。 */
export async function galleryGC(keepIds) {
  const keep = new Set(Array.isArray(keepIds) ? keepIds : [])
  for (const id of [...memory.keys()]) if (!keep.has(id)) memory.delete(id)
  try {
    const db = await openDb()
    if (db === null) return
    const keys = await withStore('readonly', (store) => store.getAllKeys())
    if (!Array.isArray(keys)) return
    for (const key of keys) {
      if (typeof key === 'string' && !keep.has(key)) {
        await withStore('readwrite', (store) => store.delete(key))
      }
    }
  } catch {
    // 回收失败只影响空间占用。
  }
}

/** 内容哈希：同一张图必然得到同一个 id（SHA-256 前 10 字节，40 hex 取前 20 位）。 */
export async function imageFileId(blob) {
  try {
    const bytes = await blob.arrayBuffer()
    const subtle = globalThis.crypto?.subtle
    if (subtle !== undefined && subtle !== null) {
      const digest = await subtle.digest('SHA-256', bytes)
      return [...new Uint8Array(digest)]
        .slice(0, 10)
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
    }
  } catch {
    // 落到随机 id。
  }
  return `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob ?? null), type, quality)
    } catch {
      resolve(null)
    }
  })
}

/**
 * 读取用户挑的图片文件，尽量压成「长边 ≤ {@link MAX_EDGE} 的 webp」。
 * 画布不可用时（jsdom、异常环境）原样返回文件字节，保证功能不中断。
 *
 * @returns {Promise<{ blob: Blob, width: number, height: number, compressed: boolean }>}
 */
export async function compressImageFile(file) {
  const raw = async () => {
    try {
      const bytes = await file.arrayBuffer()
      return { blob: new Blob([bytes], { type: file.type || 'image/*' }), width: 0, height: 0, compressed: false }
    } catch {
      return { blob: file, width: 0, height: 0, compressed: false }
    }
  }
  try {
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return raw()
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height, 1))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (context === null) return raw()
    context.drawImage(bitmap, 0, 0, width, height)
    try {
      bitmap.close()
    } catch {
      // close 只是尽早释放位图。
    }
    const blob = (await toBlob(canvas, 'image/webp', 0.85)) ?? (await toBlob(canvas, 'image/jpeg', 0.9))
    if (blob === null) return raw()
    return { blob, width, height, compressed: true }
  } catch {
    return raw()
  }
}
