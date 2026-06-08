// Progresso da Trilha salvo no localStorage (client-side, igual filosofia do Guardian).
// Validação: não persiste entre dispositivos, mas é instantâneo e sem migration.
// Pode ser migrado pra banco depois, se necessário.

const STORAGE_KEY = "traderos_trilha_progress_v1"

export function getCompletedLessons(): Set<string> {
  if (typeof window === "undefined") return new Set()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as string[]
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

export function setLessonCompleted(lessonId: string, completed: boolean): Set<string> {
  const current = getCompletedLessons()
  if (completed) current.add(lessonId)
  else current.delete(lessonId)
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...current]))
    } catch {
      /* storage cheio ou bloqueado — ignora silenciosamente */
    }
  }
  return current
}

export function isLessonCompleted(lessonId: string): boolean {
  return getCompletedLessons().has(lessonId)
}
