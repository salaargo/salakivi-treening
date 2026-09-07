/** Argo / Salakivi administraator — näeb kasutajaid ja avaldab näidiskava. */
export const ADMIN_EMAILS = ['salaargo@gmail.com']

export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false
  const allowed = new Set(ADMIN_EMAILS.map((item) => item.toLowerCase()))
  const extra = import.meta.env.VITE_ADMIN_EMAIL?.trim()
  if (extra) allowed.add(extra.toLowerCase())
  return allowed.has(email.trim().toLowerCase())
}
