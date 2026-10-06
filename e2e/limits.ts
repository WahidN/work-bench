export function remaining(limit: number, used: number): number {
  return Math.max(0, limit - used)
}
