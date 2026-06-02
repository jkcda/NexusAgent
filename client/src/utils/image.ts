/**
 * 图片工具：客户端等比缩放（Canvas API），避免手机上传统大图到后端
 */

const MAX_DIMENSION = 4096 // 最大边长 4k
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const JPEG_QUALITY = 0.85

export async function resizeImageIfNeeded(file: File): Promise<File> {
  // 非图片文件直接返回
  if (!file.type.startsWith('image/')) return file

  // SVG / GIF 不缩放
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') return file

  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)
      const { naturalWidth: w, naturalHeight: h } = img

      // 无需缩放
      if (w <= MAX_DIMENSION && h <= MAX_DIMENSION && file.size <= MAX_FILE_SIZE) {
        return resolve(file)
      }

      // 等比缩放到 MAX_DIMENSION 以内
      const scale = Math.min(MAX_DIMENSION / w, MAX_DIMENSION / h, 1)
      const outW = Math.round(w * scale)
      const outH = Math.round(h * scale)

      const canvas = document.createElement('canvas')
      canvas.width = outW
      canvas.height = outH
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, outW, outH)

      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('图片缩放失败'))
          const resized = new File([blob], file.name, { type: 'image/jpeg' })
          resolve(resized.size < file.size ? resized : file)
        },
        'image/jpeg',
        JPEG_QUALITY
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(file) // 无法读取时保持原文件
    }

    img.src = url
  })
}

/**
 * 将图片文件转为 base64 data URL（用于图生图参考图）
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}
