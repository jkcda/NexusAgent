import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs'

const execFileAsync = promisify(execFile)

const OFFICE_MIMES = [
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]

const PREVIEW_DIR = path.join(process.cwd(), 'uploads', 'previews')

function ensureDir() {
  if (!fs.existsSync(PREVIEW_DIR)) {
    fs.mkdirSync(PREVIEW_DIR, { recursive: true })
  }
}

export function isOfficeMime(mimeType: string): boolean {
  return OFFICE_MIMES.includes(mimeType)
}

export async function convertToPdf(inputPath: string): Promise<string | null> {
  ensureDir()

  const ext = path.extname(inputPath)
  const basename = path.basename(inputPath, ext)
  const outputPath = path.join(PREVIEW_DIR, `${basename}.pdf`)

  if (fs.existsSync(outputPath)) {
    try {
      const inMtime = fs.statSync(inputPath).mtimeMs
      const outMtime = fs.statSync(outputPath).mtimeMs
      if (outMtime >= inMtime) {
        return path.relative(process.cwd(), outputPath)
      }
    } catch {}
  }

  try {
    await execFileAsync('soffice', [
      '--headless', '--norestore',
      '--convert-to', 'pdf',
      '--outdir', PREVIEW_DIR,
      inputPath,
    ], { timeout: 180000 })

    if (fs.existsSync(outputPath)) {
      return path.relative(process.cwd(), outputPath)
    }
    return null
  } catch (e: any) {
    if (e.code === 'ETIMEDOUT') {
      console.error('[OfficePreview] 转换超时（3分钟）:', inputPath)
    } else {
      console.error('[OfficePreview] 转换失败:', inputPath, e.message || e)
    }
    return null
  }
}
