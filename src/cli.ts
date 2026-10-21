import { fetchMyPrs } from './github'
import { loadHiddenRepos } from './hidden'
import { withoutHidden } from './repos'
import { loadReviews, postSaved, runReview } from './saved-review'

const USAGE = 'Usage: bun src/cli.ts prs | review <url> | reviews | post <url> <commit> <index>'

const [command, ...args] = process.argv.slice(2)

async function prs() {
  const [all, hidden] = await Promise.all([fetchMyPrs(), loadHiddenRepos()])
  return withoutHidden(all, hidden)
}

async function review(url: string) {
  const saved = await runReview(url)
  if (saved.state === 'failed') throw new Error(saved.error)
  return saved
}

function run(): Promise<unknown> | null {
  if (command === 'prs') return prs()
  if (command === 'review' && args.length === 1) return review(args[0])
  if (command === 'reviews' && args.length === 0) return loadReviews()
  if (command === 'post' && args.length === 3) return postSaved(args[0], args[1], Number(args[2]))
  return null
}

const running = run()
if (!running) {
  console.error(USAGE)
  process.exit(1)
}

try {
  console.log(JSON.stringify(await running))
} catch (failure) {
  console.error(failure instanceof Error ? failure.message : String(failure))
  process.exit(1)
}
