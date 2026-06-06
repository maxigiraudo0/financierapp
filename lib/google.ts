import { google } from 'googleapis'
import path from 'path'
import fs from 'fs'

// Credenciales: desde env GOOGLE_CREDENTIALS (Vercel) o desde el archivo local
function getCredentials() {
  const env = process.env.GOOGLE_CREDENTIALS
  if (env) {
    try { return JSON.parse(env) } catch { /* fallthrough */ }
  }
  const file = path.join(process.cwd(), 'google-creds.json')
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  }
  throw new Error('No hay credenciales de Google (GOOGLE_CREDENTIALS ni google-creds.json)')
}

export async function getSheetsClient(readonly = false) {
  const auth = new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: [readonly
      ? 'https://www.googleapis.com/auth/spreadsheets.readonly'
      : 'https://www.googleapis.com/auth/spreadsheets'],
  })
  return google.sheets({ version: 'v4', auth })
}
