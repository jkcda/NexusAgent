import request from '@/utils/http'

export interface KnowledgeBase {
  id: number
  user_id: number
  name: string
  description: string | null
  document_count: number
  chunk_count: number
  created_at: string
  updated_at: string
}

export interface KbDocument {
  id: number
  kb_id: number
  filename: string
  file_path: string
  file_type: string
  file_size: number
  chunk_count: number
  status: 'pending' | 'processing' | 'completed' | 'failed'
  error_message: string | null
  user_id: number | null
  file_hash: string
  version: number
  is_latest: number
  created_at: string
  updated_at: string
}

export interface KbDocumentVersion {
  id: number
  kb_id: number
  filename: string
  file_path: string
  file_type: string
  file_size: number
  version: number
  is_latest: number
  created_at: string
}

export interface SearchChunk {
  content: string
  source: string
  score: number
}

export const createKnowledgeBase = (data: { name: string; description?: string }) =>
  request.post('/kb', data)

export const getKnowledgeBases = () =>
  request.get('/kb')

export const getKnowledgeBase = (kbId: number) =>
  request.get(`/kb/${kbId}`)

export const deleteKnowledgeBase = (kbId: number) =>
  request.delete(`/kb/${kbId}`)

export const uploadDocumentsToKB = async (kbId: number, files: File[]) => {
  const formData = new FormData()
  files.forEach(f => formData.append('files', f))
  const baseURL = (import.meta.env as any).VITE_BASE_URL || ''
  const response = await fetch(`${baseURL}/api/kb/${kbId}/documents`, {
    method: 'POST',
    body: formData,
    headers: {
      Authorization: `Bearer ${localStorage.getItem('token')}`
    }
  })

  if (!response.ok) {
    let message = `服务器错误 (${response.status})`
    try {
      const body = await response.json()
      if (body.message) message = body.message
      if (body.error) message += ` — ${body.error}`
    } catch {}
    throw new Error(message)
  }

  return response.json()
}

export const getKBDocuments = (kbId: number) =>
  request.get(`/kb/${kbId}/documents`)

export const deleteKBDocument = (kbId: number, docId: number) =>
  request.delete(`/kb/${kbId}/documents/${docId}`)

export const searchKB = (kbId: number, query: string) =>
  request.post(`/kb/${kbId}/search`, { query })

export const previewDocument = (kbId: number, docId: number) =>
  request.get(`/kb/${kbId}/documents/${docId}/preview`)

export const getDocumentVersions = (kbId: number, docId: number) =>
  request.get<KbDocumentVersion[]>(`/kb/${kbId}/documents/${docId}/versions`)

export const restoreDocumentVersion = (kbId: number, docId: number) =>
  request.post(`/kb/${kbId}/documents/${docId}/restore`)

export const deleteDocumentVersion = (kbId: number, docId: number, versionId: number) =>
  request.delete(`/kb/${kbId}/documents/${docId}/versions/${versionId}`)
