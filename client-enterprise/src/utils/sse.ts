// SSE (Server-Sent Events) 工具函数
// 用于处理流式响应

/**
 * 处理 SSE 流式响应
 * @param response - fetch 响应对象
 * @param onContent - 内容回调函数
 * @param onError - 错误回调函数
 * @param onComplete - 完成回调函数
 */
export interface SSEEvent {
  type?: string
  content?: string
  error?: string
  tool?: string
  imageUrl?: string
  sources?: { title: string; url: string; snippet: string }[]
  chunks?: { source: string; score: number }[]
}

export async function handleSSE(
  response: Response,
  onContent: (content: string) => void,
  onError: (error: Error) => void,
  onComplete: () => void,
  onEvent?: (event: SSEEvent) => void
) {
  try {
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()

    if (!reader) {
      throw new Error('无法获取响应流')
    }

    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        onComplete()
        break
      }

      buffer += decoder.decode(value, { stream: true })
      // SSE 消息以 \n\n 结尾，按双换行分割保证消息完整性
      const parts = buffer.split('\n\n')
      // 最后一个可能是不完整的消息，保留到下次
      buffer = parts.pop() || ''

      for (const part of parts) {
        const lines = part.split('\n')
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') {
              onComplete()
              return
            }

            try {
              const parsed = JSON.parse(data)
              if (parsed.content) {
                onContent(parsed.content)
              } else if (parsed.error) {
                let errMsg: string = parsed.error
                if (errMsg.includes('DataInspectionFailed') || errMsg.includes('inappropriate')) {
                  errMsg = '内容审核拦截：回复包含敏感内容，请重新措辞后重试。'
                } else if (errMsg.includes('terminated') || errMsg.includes('abort')) {
                  errMsg = '连接中断，请重试。如上传图片过大，请压缩后再试。'
                }
                onError(new Error(errMsg))
                return
              } else if (parsed.type) {
                onEvent?.(parsed as SSEEvent)
              }
            } catch {
              // JSON 解析失败，跳过该行继续处理
            }
          }
        }
      }
    }
  } catch (error: any) {
    onError(error)
  }
}
