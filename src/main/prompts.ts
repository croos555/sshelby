import { BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { PromptRequest, PromptResponse } from '@shared/types'

type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never

const pending = new Map<string, (res: PromptResponse) => void>()

ipcMain.on('prompt:respond', (_e, res: PromptResponse) => {
  const resolve = pending.get(res.id)
  if (resolve) {
    pending.delete(res.id)
    resolve(res)
  }
})

// Ask the renderer to show a modal and wait for the user's answer
export function ask(req: DistributiveOmit<PromptRequest, 'id'>): Promise<PromptResponse> {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return Promise.resolve({ id: '', values: null })
  const id = randomUUID()
  return new Promise((resolve) => {
    pending.set(id, resolve)
    win.webContents.send('prompt:request', { ...req, id })
  })
}

export async function askSecret(title: string, message: string, offerSave = false): Promise<string | null> {
  return (await askSecretEx(title, message, offerSave)).value
}

export async function askSecretEx(
  title: string,
  message: string,
  offerSave: boolean
): Promise<{ value: string | null; save: boolean }> {
  const res = await ask({ kind: 'password', title, message, offerSave })
  if (!('values' in res) || !res.values) return { value: null, save: false }
  return { value: res.values[0], save: !!res.save }
}
